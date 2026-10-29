"""What the QML desk shows and does. The quiz server decides everything (scoring, timing, what's next); this turns its
state into a view for the screen and turns the desk's buttons into its existing API calls. No quiz logic lives here
beyond choosing the label for Next, which mirrors web/host.js."""
import base64
import json
import re
import secrets
import subprocess
import sys
import time
from pathlib import Path

from PySide6.QtCore import Property, QObject, QSettings, QTimer, QUrl, Signal, Slot

from .api import DeskApi
from .library import Library
from .server import ROOT, QuizServer, node_binary
from .tvsound import TvSound
from .live import LiveTools
from . import looks
from .online import OnlineVenue
from .prefs import Prefs

STEP_LABELS = {'reveal': 'Reveal next position', 'revealFirst': 'Reveal the leader', 'revealSecond': 'Reveal second place', 'show': 'Show leaderboard',
               'finish': 'Finish quiz', 'round': 'Start next round', 'question': 'Start next question'}
# Quiz files carry their pictures and sounds inside them (data: URLs); each is uploaded before the quiz loads, as the
# web desk does (unpackMedia in web/host.js).
MEDIA_TYPES = {'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'audio/mpeg': '.mp3', 'audio/ogg': '.ogg',
               'audio/wav': '.wav', 'audio/x-wav': '.wav', 'audio/wave': '.wav'}
DATA_URL = re.compile(r'^data:([^;,]+);base64,(.*)$', re.S)
TYPE_NAMES = {'text': 'Typed answer', 'choice': 'Multiple choice', 'multi': 'Tick all that apply', 'letter': 'Letter keypad',
              'number': 'Number', 'nearest': 'Nearest wins', 'sequence': 'Put in order', 'pinpoint': 'Pinpoint', 'wordsnake': 'Word snake',
              'tiles': 'Letter tiles', 'vote': 'Vote', 'buzzer': 'Buzzer', 'bingo': 'Bingo', 'musicbingo': 'Music bingo', 'clips': 'Sound clips',
              'picture': 'Picture', 'audio': 'Audio', 'sheet': 'Answer sheet'}


class Desk(QObject):
    viewChanged = Signal()
    tvChanged = Signal()
    statusChanged = Signal()
    toast = Signal(str, bool)       # message, is it an error
    confirmLoad = Signal(str)       # the quiz has been played: ask before replacing it (file path)
    confirmFinish = Signal(str)     # ask before finishing (what's at stake)
    quitRequested = Signal()        # Close BeerMat, pressed on a desk (also in a browser)
    transferCode = Signal(str)      # a team's 4-digit code to move to another phone
    networkChanged = Signal()

    def __init__(self, data_dir, host_key, port=3000, laptop=True, parent=None):
        super().__init__(parent)
        self.server = QuizServer(data_dir, host_key, port, laptop, self)
        self.api = DeskApi(self)
        self.library = Library(self.api, Path(data_dir) / 'media', self)
        self.library.toast.connect(self.toast)
        self.tvSound = TvSound(self)
        self.liveTools = LiveTools(self)
        self.liveTools.clipsChanged.connect(self._rebuild)
        self.onlineVenue = OnlineVenue(self)
        self.prefsModel = Prefs(self)
        self.resultsChanged.connect(self.onlineVenue.changed)
        self._state, self._library, self._view, self._tv = None, None, {}, {}
        self._laptop, self._network, self._checks = {}, {}, []
        self._review, self._results = None, {}
        self._status, self._connected, self._busy = 'Starting the quiz server…', False, False
        self._crashes = []
        self._refreshing = self._again = False
        self.server.ready.connect(self._server_ready)
        self.server.failed.connect(lambda message: self._set_status(f'Could not start: {message}'))
        self.server.stopped.connect(self._server_stopped)
        self.server.message.connect(self._server_message)
        self.api.changed.connect(self.refresh)
        self.api.connection.connect(self._set_connected)
        # A slow safety net in case an update is missed (the web desk does the same).
        self._poll = QTimer(self, interval=15000, timeout=self.refresh)

    # ---- properties for QML ----
    @Property('QVariantMap', notify=viewChanged)
    def view(self):
        return self._view

    @Property('QVariantMap', constant=True)
    def lookPalettes(self):
        """Each look's colours for the native TV (themes/<id>/look.css)."""
        if not hasattr(self, '_palettes'):
            self._palettes = looks.load(ROOT / 'themes')
        return self._palettes

    @Property(QObject, constant=True)
    def prefs(self):
        return self.prefsModel

    @Property(QObject, constant=True)
    def online(self):
        return self.onlineVenue

    @Property(QObject, constant=True)
    def live(self):
        return self.liveTools

    @Property(QObject, constant=True)
    def sound(self):
        return self.tvSound

    @Property(QObject, constant=True)
    def quizzes(self):
        return self.library

    @Property('QVariantMap', notify=tvChanged)
    def tv(self):
        """What the TV shows: the server's public state (/api/leaderboard, the same the web TV reads), plus the offset
        between this computer's clock and the server's so countdowns run locally between updates."""
        return self._tv

    @Property('QVariantMap', notify=networkChanged)
    def network(self):
        """Venue & network: the laptop's quiz Wi-Fi and online link (/api/host/laptop), its addresses on the venue
        network (/api/host/network) and the last connection check. The server and scripts/hotspot.py do the work."""
        settings = (self._state or {}).get('settings', {})
        return {'laptop': self._laptop, 'addresses': self._network.get('addresses', []), 'port': self._network.get('port', 0),
                'checks': self._checks, 'joinMode': settings.get('joinMode', 'hotspot'), 'joinUrl': settings.get('joinUrl', ''),
                'joinSsid': settings.get('joinSsid', ''), 'joinPassword': settings.get('joinPassword', ''), 'online': bool(settings.get('online'))}

    @Slot()
    def loadNetwork(self):
        if not self.api.session:
            return
        def laptop(status):
            self._laptop = status
            self.networkChanged.emit()
            # A Wi-Fi or online job running: look again shortly, as the web desk does.
            if any((job or {}).get('running') for job in (status.get('jobs') or {}).values()):
                QTimer.singleShot(1500, self.loadNetwork)
        self.api.host('laptop', {}, laptop, lambda e: (setattr(self, '_laptop', {'unavailable': e}), self.networkChanged.emit()), timeout_ms=30000)
        self.api.host('network', {}, lambda n: (setattr(self, '_network', n), self.networkChanged.emit()))

    @Slot()
    def checkNetwork(self):
        self._checks = [{'status': 'info', 'text': 'Checking…'}]
        self.networkChanged.emit()
        def done(reply):
            self._checks = reply.get('checks', [])
            self.networkChanged.emit()
        self.api.host('network/check', {}, done, lambda e: self.toast.emit(e, True), timeout_ms=30000)

    @Slot(str, str, str)
    def startWifi(self, card, ssid, password):
        """The quiz Wi-Fi (scripts/hotspot.py on Linux, Mobile Hotspot on Windows); the system asks for a password."""
        body = {'action': 'start', 'card': card or 'auto', 'ssid': ssid, **({'password': password} if (self._laptop.get('wifi') or {}).get('needsPassword') else {})}
        self.api.host('laptop/wifi', body, lambda _: (self.toast.emit('Starting the quiz Wi-Fi: approve the administrator prompt on this laptop' if (self._laptop.get('wifi') or {}).get('platform') == 'windows'
                                             else 'Starting the quiz Wi-Fi: answer the password prompt on this laptop', False), self.loadNetwork()),
                      lambda e: self.toast.emit(e, True), timeout_ms=30000)

    @Slot()
    def stopWifi(self):
        self.api.host('laptop/wifi', {'action': 'stop'}, lambda _: (self.toast.emit('Stopping the quiz Wi-Fi', False), self.loadNetwork()), lambda e: self.toast.emit(e, True))

    @Slot()
    def wifiOn(self):
        self.api.host('laptop/wifi', {'action': 'on'}, lambda _: self.loadNetwork(), lambda e: self.toast.emit(e, True))

    @Slot(bool)
    def setOnline(self, on):
        """The online link (a Cloudflare quick tunnel): needs internet on the laptop and cloudflared."""
        self.api.host('laptop/online', {'action': 'start' if on else 'stop'}, lambda _: self.loadNetwork(), lambda e: self.toast.emit(e, True))

    @staticmethod
    def hotspot_url(laptop, port):
        """Where phones on the quiz Wi-Fi open the quiz, as the web desk works it out: Linux's hotspot sends
        http://10.42.0.1 to the quiz; Windows' Mobile Hotspot is 192.168.137.1 and needs the quiz's port."""
        wifi = (laptop or {}).get('wifi') or {}
        windows = (laptop or {}).get('platform') == 'windows' or wifi.get('platform') == 'windows'
        address = wifi.get('address') or ('192.168.137.1' if windows else '10.42.0.1')
        return f'http://{address}' + (f':{port or 3000}' if windows else '')

    @Slot()
    def useHotspot(self):
        """As the web desk's join mode: players join on the quiz Wi-Fi."""
        url = self.hotspot_url(self._laptop, (self.server.info or {}).get('port'))
        self._act('settings', {'joinMode': 'hotspot', 'joinUrl': url}, 'Players join on the quiz Wi-Fi')

    @Slot(str, str)
    def useLan(self, address, ssid):
        port = self._network.get('port', 3000)
        url = f'http://{address}' + ('' if port == 80 else f':{port}')
        self._act('settings', {'joinMode': 'lan', 'joinUrl': url, **({'joinSsid': ssid.strip()} if ssid.strip() else {})}, 'The TV now shows the venue network address')

    @Property(str, notify=statusChanged)
    def serverUrl(self):
        return f'http://127.0.0.1:{self.server.info["port"]}' if self.server.info else ''

    @Property(str, notify=statusChanged)
    def status(self):
        return self._status

    @Property(bool, notify=statusChanged)
    def connected(self):
        return self._connected

    @Property(bool, notify=statusChanged)
    def busy(self):
        return self._busy

    def _set_status(self, text):
        self._status = text
        self.statusChanged.emit()

    def _set_connected(self, on):
        if on != self._connected:
            self._connected = on
            self.statusChanged.emit()
            if on:
                self.refresh()

    # ---- server lifecycle ----
    def start(self):
        self.server.start()

    def stop(self):
        self._poll.stop()
        self.api.close()
        self.server.stop()

    def _server_ready(self, info):
        self.api.use(info['port'])
        self._set_status(f'Quiz server on port {info["port"]}')
        self.server.send({'type': 'ticket', 'id': 'login'})

    def _server_message(self, message):
        if message.get('type') == 'backup':
            if message.get('error'):
                self.toast.emit(f'The backup failed: {message["error"]}', True)
            else:
                self.toast.emit(f'Backup saved: {message.get("file")}', False)
            self._set_status('Quiz server running')
        elif message.get('type') == 'quit':
            self.quitRequested.emit()
        if message.get('type') == 'ticket':
            self.api.login_with_ticket(message['ticket'], self._logged_in, lambda error: self._set_status(f'Could not unlock the desk: {error}'))

    def _logged_in(self):
        self._poll.start()
        self.refresh()
        self.load_library()
        self.loadResults()

    def _server_stopped(self, code):
        """It crashed: start it again (up to three times a minute), as the Electron app does. The quiz is saved."""
        now = time.monotonic()
        self._crashes = [t for t in self._crashes if now - t < 60] + [now]
        self._set_connected(False)
        self.api.session = None
        if len(self._crashes) <= 3:
            self._set_status(f'The quiz server stopped (exit {code}); restarting it…')
            self.toast.emit('The quiz server stopped; restarting it. Nothing is lost.', True)
            self.server.start()
        else:
            self._set_status('The quiz server keeps stopping. See the logs, then try again.')

    @Slot()
    def restartServer(self):
        self._crashes = []
        self.server.start()

    # ---- state ----
    @Slot()
    def refresh(self):
        if not self.api.session:
            return
        if self._refreshing:
            self._again = True
            return
        self._refreshing = True

        def got(state):
            self._state = state
            self._state['_receivedAt'] = time.time() * 1000
            if state.get('libraryRevision') != (self._library or {}).get('revision'):
                self.load_library()
            self._rebuild()
            settle()

        def settle(*_):
            self._refreshing = False
            if self._again:
                self._again = False
                self.refresh()
        self.api.host('state', {}, got, settle)
        self.refresh_tv()

    def refresh_tv(self):
        def got(state):
            state['offset'] = state.get('serverTime', time.time() * 1000) - time.time() * 1000
            self._tv = state
            self.tvChanged.emit()
            self.tvSound.base = self.serverUrl
            self.tvSound.follow(state)
        self.api.get('leaderboard', got)

    def load_library(self):
        def got(library):
            self._library = library
            self.library.received(library)
            self._rebuild()
        self.api.host('library', {}, got)

    def _rebuild(self):
        s, library = self._state, self._library or {}
        if not s:
            return
        q = s.get('question')
        settings = s.get('settings', {})
        rehearsal, plan = s.get('rehearsal') or {}, s.get('plan') or {}
        # The question being marked: the current one, or a past one chosen in Teams & marking.
        if self._review and self._review['question'].get('id') == (q or {}).get('id'):
            self._review = None
        marking = self._review['question'] if self._review else q
        history = s.get('history', [])
        teams = [t for t in s.get('teams', []) if t.get('enabled')]
        answered = {a['team'] for a in s.get('answers', []) if a.get('submitted')}
        step = self._next_step(s, library)
        played = {h.get('sourceId') for h in history}
        questions = [(r.get('title', ''), item) for r in library.get('rounds', []) for item in r.get('questions', []) if not item.get('tieBreaker')]
        upcoming = [{'round': round_title, 'text': item.get('text') or item.get('title') or '(untitled)', 'type': TYPE_NAMES.get(item.get('type'), item.get('type', '')),
                     'played': item.get('id') in played, 'current': bool(q) and item.get('id') == q.get('sourceId')} for round_title, item in questions]
        for i, item in enumerate(upcoming):
            item['first'] = i == 0 or upcoming[i - 1]['round'] != item['round']
        # The deadline in this computer's time, so the countdown runs smoothly between updates.
        skew = s['_receivedAt'] - s.get('serverTime', s['_receivedAt'])
        phase = ('Finished' if settings.get('ended') else 'Preparing' if not q else 'Paused' if q.get('paused')
                 else 'Live' if q.get('open') else 'Revealed' if q.get('revealed') else 'Revealing' if q.get('revealing') else 'Answers closed')
        self._view = {
            'title': library.get('title') or 'No quiz loaded', 'event': settings.get('title', 'BeerMat'), 'phase': phase,
            'question': None if not q else {
                'text': q.get('text') or q.get('title') or '', 'round': q.get('round', ''), 'type': TYPE_NAMES.get(q.get('type'), q.get('type', '')),
                'options': q.get('options') or [], 'answer': q.get('answer') if q.get('answer') not in (None, '') else '', 'note': q.get('answerNote') or '',
                'points': q.get('points', 0), 'seconds': q.get('seconds', 0), 'open': bool(q.get('open')), 'paused': bool(q.get('paused')),
                'revealed': bool(q.get('revealed')), 'deadline': (q['deadline'] + skew) if q.get('deadline') and q.get('open') and not q.get('paused') else 0,
                'remaining': q.get('remaining') or 0, 'tally': q.get('tally') or {}, 'correct': q.get('correctCount', 0)},
            'answers': len(answered), 'teams': [{'name': t['name'], 'score': t.get('score', 0), 'rank': t.get('rank', 0), 'connected': bool(t.get('connected')),
                                                  'answered': t['id'] in answered} for t in sorted(teams, key=lambda t: (t.get('rank') or 999, t['name'].lower()))],
            'next': {'step': step or '', 'label': STEP_LABELS.get(step, 'Quiz finished'), 'enabled': bool(step) and not (q and q.get('live'))},
            'canClose': bool(q and (q.get('open') or q.get('live')) and not q.get('revealed')),
            'canReveal': bool(q and not q.get('open') and not q.get('live') and not q.get('revealed') and not q.get('revealing')),
            'canPause': bool(q and q.get('open') and not q.get('paused')), 'canResume': bool(q and q.get('paused')),
            # Live or rehearsal is the server's decision (plan and session mode); the desk only shows it. Real phones that
            # joined a rehearsal are test devices, listed apart from the simulated teams that play it.
            'mode': rehearsal.get('mode', 'live'), 'canGoLive': bool(rehearsal.get('canGoLive')), 'rehearsing': bool(rehearsal.get('options')),
            'rehearsalOptions': rehearsal.get('options') or {}, 'rehearsalLog': rehearsal.get('log') or [],
            'plan': {'code': plan.get('plan', 'free'), 'name': plan.get('name', 'BeerMat Free'), 'live': bool(plan.get('live')),
                     'venue': plan.get('venue') or '', 'expires': plan.get('expires') or 0, 'paidUntil': plan.get('paidUntil') or 0},
            'devices': [{'name': d['name'], 'connected': bool(d.get('connected'))} for d in rehearsal.get('devices', [])],
            'sims': [{'name': t['name'], 'connected': bool(t.get('connected')), 'manual': bool(t.get('manual'))} for t in rehearsal.get('sims', [])],
            # Teams & marking: every team (disabled and waiting ones too), and the answers to the current question.
            'allTeams': [{'id': t['id'], 'name': t['name'], 'score': t.get('score', 0), 'rank': t.get('rank', 0), 'enabled': bool(t.get('enabled')),
                          'waiting': bool(t.get('waiting')), 'connected': bool(t.get('connected')), 'note': t.get('note') or '',
                          'answered': (t.get('stats') or {}).get('answered', 0), 'photo': t.get('photo') or '', 'photoStatus': t.get('photo_status') or ''} for t in sorted(s.get('teams', []), key=lambda t: t['name'].lower())],
            'waitingCount': sum(1 for t in s.get('teams', []) if t.get('waiting') and t.get('enabled')),
            'answerRows': self._answer_rows({**s, 'answers': self._review['answers']} if self._review else s, marking),
            'canMark': bool(marking and not marking.get('open') and not marking.get('live')),
            'isSheet': bool(marking and marking.get('type') == 'sheet'), 'sheetItems': (marking or {}).get('items') or [],
            'marking': {'id': (marking or {}).get('id'), 'text': (marking or {}).get('text', ''), 'points': (marking or {}).get('points', 1), 'past': bool(self._review)},
            # Questions played so far, newest first (the desk can mark any closed one).
            'history': [{'id': h.get('id'), 'text': h.get('text') or '', 'round': h.get('round', ''), 'type': TYPE_NAMES.get(h.get('type'), h.get('type', ''))}
                        for h in s.get('history', [])],
            'blockedWords': '\n'.join(s.get('blockedWords') or []),
            'looks': [{'value': i, 'text': n} for i, n in s.get('looks') or []], 'looksByType': s.get('looksByType') or {},
            'soundThemes': s.get('soundThemes') or [], 'soundThemesByType': s.get('soundThemesByType') or {},
            'formats': [{'value': k, 'text': v} for k, v in TYPE_NAMES.items()],
            # The live controls read the server's own question (host view), settings, tie and countdown as they are.
            'raw': q or {}, 'settings': settings, 'tie': s.get('tie') or {}, 'timer': s.get('timer') or {},
            'typeCode': (q or {}).get('type', ''), 'clipsRunning': (self.liveTools.clipsRunning() or {}).get('index', -1),
            'progress': f'{len(played & {item.get("id") for _, item in questions})} of {len(questions)} questions played' if questions else '',
            'upcoming': upcoming,
        }
        self.viewChanged.emit()
        self.networkChanged.emit()

    @staticmethod
    def _answer_rows(s, q):
        """Each team's answer to the current question, as the web desk's marking cards: value, points, sheet marks."""
        if not q:
            return []
        names = {t['id']: t['name'] for t in s.get('teams', [])}
        rows = []
        for a in s.get('answers', []):
            if a.get('team') not in names:
                continue
            try:
                value = json.loads(a['value']) if isinstance(a.get('value'), str) and a['value'][:1] in '[{"' else a.get('value')
            except ValueError:
                value = a.get('value')
            shown = ', '.join(map(str, value)) if isinstance(value, list) else '' if value is None else str(value)
            try:
                marks = json.loads(a['marks']) if isinstance(a.get('marks'), str) else (a.get('marks') or [])
            except ValueError:
                marks = []
            rows.append({'teamId': a['team'], 'team': names[a['team']], 'value': shown, 'items': value if isinstance(value, list) else [],
                         'points': a.get('points') or 0, 'marks': marks, 'submitted': a.get('submitted') is not None})
        return sorted(rows, key=lambda r: r['team'].lower())

    @staticmethod
    def _next_step(s, library):
        """Mirrors nextStep() in web/host.js: the next thing the big button does."""
        board = s.get('board') or {}
        if board.get('active') and not board.get('done'):
            return 'revealFirst' if board.get('shown') == board.get('rest') else 'revealSecond' if board.get('second') else 'reveal'
        if s.get('settings', {}).get('ended'):
            return None
        if board.get('canShow'):
            return 'show'
        played = {h.get('sourceId') for h in s.get('history', [])}
        ids = [item.get('id') for r in library.get('rounds', []) for item in r.get('questions', []) if not item.get('tieBreaker')]
        if ids and all(i in played for i in ids):
            return 'finish'
        return 'round' if board.get('roundOver') else 'question'

    # ---- actions ----
    def _act(self, route, body, success, then=None):
        if self._busy:
            return
        self._busy = True
        self.statusChanged.emit()

        def done(_):
            self._busy = False
            self.statusChanged.emit()
            self.toast.emit(success, False)
            if then:
                then()
            self.refresh()

        def failed(error):
            self._busy = False
            self.statusChanged.emit()
            self.toast.emit(error, True)
            self.refresh()
        self.api.host(route, body, done, failed)

    def _expected(self):
        q = (self._state or {}).get('question')
        return q.get('id') if q else None

    @Slot()
    def next(self):
        step = self._view.get('next', {}).get('step')
        if not step or not self._view['next']['enabled']:
            return
        if step == 'finish':
            tie = (self._state or {}).get('tie')
            tied = f'{", ".join(tie["teams"])} are tied for first. ' if tie else ''
            self.confirmFinish.emit(f'{tied}Finish this quiz and close answers and registration? You can resume it later.')
        elif step == 'show':
            self._act('board', {'action': 'show'}, 'Leaderboard on the TV')
        elif step in ('reveal', 'revealFirst', 'revealSecond'):
            self._act('board', {'action': 'next'}, {'revealFirst': 'The leader revealed', 'revealSecond': 'Second place revealed: the full board'}.get(step, 'Next position revealed'))
        else:
            self._act('next', {'expectedQuestion': self._expected()}, 'Next question opened')

    @Slot()
    def finishConfirmed(self):
        """As finishQuiz() in web/host.js: the quiz ends and the final standings go on the TV, revealed with Next."""
        settings = (self._state or {}).get('settings', {})
        body = {'ended': True, 'leaderboardVisible': True, **({} if settings.get('displayMode') == 'auto' else {'displayMode': 'leaderboard'})}
        has_question = bool((self._state or {}).get('question'))
        self._act('settings', body, 'Quiz finished: the final standings are on the TV',
                  then=(lambda: self.api.host('board', {'action': 'show'}, lambda _: self.refresh())) if has_question else None)

    @Slot()
    def closeAnswers(self):
        if self._view.get('canClose'):
            self._act('close', {'expectedQuestion': self._expected()}, 'Answers closed')

    @Slot()
    def reveal(self):
        if self._view.get('canReveal'):
            # The TV plays the drum roll and the answer appears as it ends (as the web desk: up to 10 s; none in a fast
            # rehearsal).
            fast = ((self._state or {}).get('rehearsal') or {}).get('options', {}) or {}
            delay = 0 if fast.get('speed') == 'fast' else min(10000, self.tvSound.duration_ms('reveal'))
            self._act('reveal', {'question': self._expected(), 'revealed': True, 'delay': delay},
                      f'Drum roll… the answer appears in {-(-delay // 1000)}s' if delay else 'Answer revealed on the TV')

    @Slot()
    def pause(self):
        if self._view.get('canPause'):
            self._act('pause', {'expectedQuestion': self._expected()}, 'Timer paused')

    @Slot()
    def resume(self):
        if self._view.get('canResume'):
            self._act('resume', {'expectedQuestion': self._expected()}, 'Timer resumed')

    @Slot(int)
    def startRehearsal(self, teams):
        self.startRehearsalWith({'teams': teams})

    @Slot('QVariantMap')
    def startRehearsalWith(self, options):
        """A rehearsal with simulated teams. Options as the web desk's Rehearsal panel (teams, auto, accuracy, speed,
        disconnects, buzzers); the server cleans them and ends a live quiz only when told to (endLive)."""
        options = dict(options)
        end_live = bool(options.pop('endLive', False))
        teams = int(options.get('teams', 6))
        self._act('rehearsal/start', {'options': options, **({'endLive': True} if end_live else {})}, f'Rehearsal started with {teams} simulated teams')

    @Slot()
    def stopRehearsal(self):
        self._act('rehearsal/stop', {}, 'Rehearsal stopped')

    @Slot(str, bool)
    def simManual(self, name, manual):
        """A simulated team waits for the quizmaster's actions (manual) or plays by itself."""
        self.api.host('rehearsal/team', {'name': name, 'manual': manual}, lambda _: self.refresh(), lambda e: self.toast.emit(e, True))

    @Slot(str, str)
    def simAct(self, name, action):
        """Make a simulated team do something; the server judges it exactly as it would a phone."""
        def done(reply):
            result = reply.get('result') or {}
            self.toast.emit(f'{name}: {action} ' + ('accepted' if result.get('ok') else f'refused: {result.get("detail") or "no reason given"}'), not result.get('ok'))
            self.refresh()
        self.api.host('rehearsal/team', {'name': name, 'action': action}, done, lambda e: self.toast.emit(e, True))

    # ---- teams and marking (the server checks every value) ----
    @Slot(str, int)
    def mark(self, team, points):
        self._act('mark', {'team': team, 'question': self._marking_id(), 'points': points}, 'Marked', then=self._reload_review)

    @Slot(str, 'QVariantList')
    def markSheet(self, team, marks):
        self._act('mark', {'team': team, 'question': self._marking_id(), 'marks': [1 if m else 0 for m in marks]}, 'Sheet marked', then=self._reload_review)

    def _marking_id(self):
        return self._review['question']['id'] if self._review else self._expected()

    @Slot(int)
    def review(self, question):
        """Mark a past question: its answers come from /api/host/review. 0 goes back to the current question."""
        if not question:
            self._review = None
            self._rebuild()
            return
        def got(reply):
            self._review = reply
            self._rebuild()
        self.api.host('review', {'question': question}, got, lambda e: self.toast.emit(e, True))

    def _reload_review(self):
        if self._review:
            self.review(self._review['question']['id'])

    @Slot(str, str)
    def teamNote(self, team, note):
        self.api.host('team', {'id': team, 'action': 'note', 'note': note}, lambda _: (self.toast.emit('Note saved', False), self.refresh()), lambda e: self.toast.emit(e, True))

    @Slot(str)
    def setBlockedWords(self, text):
        self._act('settings', {'blockedWords': text}, 'Blocked names saved')

    # ---- past quizzes and returning teams (/api/host/results) ----
    resultsChanged = Signal()

    @Property('QVariantMap', notify=resultsChanged)
    def results(self):
        return self._results

    @Slot()
    def loadResults(self):
        if not self.api.session:
            return
        self.api.host('results', {}, lambda r: (setattr(self, '_results', r), self.resultsChanged.emit()), lambda e: self.toast.emit(e, True))

    @Slot(str)
    def deleteResult(self, event):
        body = {'all': True} if event == '*' else {'event': event}
        self.api.host('results/delete', body, lambda _: (self.toast.emit('Deleted', False), self.loadResults()), lambda e: self.toast.emit(e, True))

    @Slot()
    def syncResults(self):
        self.api.host('results/sync', {}, lambda r: (self.toast.emit(f'{r.get("pending", 0)} waiting to send' if r.get('pending') else 'Results sent', False), self.loadResults()),
                      lambda e: self.toast.emit(e, True), timeout_ms=30000)

    @Slot(str)
    def forgetRegular(self, regular):
        self.api.host('regulars/forget', {'id': regular}, lambda _: (self.toast.emit('Returning team forgotten', False), self.loadResults()), lambda e: self.toast.emit(e, True))

    @Slot(QUrl)
    def saveResults(self, url):
        """This quiz's full results (as the web desk's Download results): every team, question, answer and mark."""
        path = Path(url.toLocalFile() if isinstance(url, QUrl) else str(url))
        def got(results):
            try:
                path.write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding='utf-8')
                self.toast.emit(f'Results saved to {path.name}', False)
            except OSError as e:
                self.toast.emit(f'Could not write {path.name}: {e}', True)
        self.api.host('export', {}, got, lambda e: self.toast.emit(e, True))

    @Slot(str, int, str)
    def adjust(self, team, points, reason):
        """A score correction with its reason; the request id makes a double press count once."""
        self._act('adjust', {'team': team, 'points': points, 'reason': reason, 'requestId': secrets.token_hex(8)}, f'Score corrected by {points:+d}')

    @Slot(str, str, str)
    def teamAction(self, team, action, name=''):
        """rename, disable, restore, admit or transfer (the server answers a 4-digit code for the team's new phone)."""
        def done(reply):
            if reply.get('code'):
                self.transferCode.emit(reply['code'])
            else:
                self.toast.emit({'rename': 'Team renamed', 'disable': 'Team disabled', 'restore': 'Team restored', 'admit': 'Team let in'}.get(action, 'Done'), False)
            self.refresh()
        self.api.host('team', {'id': team, 'action': action, **({'name': name} if action == 'rename' else {})}, done, lambda e: self.toast.emit(e, True))

    @Slot()
    def admitAll(self):
        self._act('admit', {}, 'Waiting teams let in')

    @Slot()
    def goLive(self):
        """Pro only; the server refuses it on Free with a sentence the desk shows."""
        self._act('live', {}, 'Live: real teams can join and play')

    def refreshPlanQuietly(self):
        """After signing in or registering: the plan comes with the laptop's registration (unregistered stays as is)."""
        self.api.host('plan/refresh', {}, lambda _: self.refresh(), lambda _: None, timeout_ms=30000)

    @Slot()
    def refreshPlan(self):
        def done(plan):
            self.toast.emit(f'Plan: {plan.get("name", "BeerMat Free")}', False)
            self.refresh()
        self.api.host('plan/refresh', {}, done, lambda e: self.toast.emit(f'Could not check the plan: {e}', True), timeout_ms=30000)

    # ---- the laptop: backups, key, folders ----
    keyKept = 'file'   # where __main__ found the quizmaster key: 'keychain' or 'file'

    @Property(str, constant=True)
    def keyStore(self):
        return self.keyKept

    @Property(str, constant=True)
    def hostKey(self):
        return self.server.host_key

    @Property(str, notify=statusChanged)
    def deskUrl(self):
        return f'http://127.0.0.1:{self.server.info["port"]}/host' if self.server.info else ''

    @Property(str, constant=True)
    def dataFolder(self):
        return str(self.server.data_dir)

    @Slot(QUrl)
    def restore(self, url):
        """Replaces the quiz with a backup (desktop/database.js restoreDatabase: the backup is checked first, and the
        current quiz backed up). The server stops for it and starts again; if the backup is bad, nothing changes."""
        source = url.toLocalFile() if isinstance(url, QUrl) else str(url)
        data = self.server.data_dir
        self._set_status('Restoring the backup…')
        self.api.close()
        self.server.stop()
        script = ("const [s, f, b] = process.argv.slice(1); import('" + (ROOT / 'desktop' / 'database.js').as_uri()
                  + "').then(m => m.restoreDatabase(s, f, b)).catch(e => {console.error(e.message); process.exit(1);});")
        result = subprocess.run([node_binary(), '--disable-warning=ExperimentalWarning', '--input-type=module', '-e', script, source, str(data / 'quiz.sqlite'), str(data / 'backups')],
                                capture_output=True, text=True, timeout=60)
        if result.returncode:
            self.toast.emit(f'That backup could not be restored: {result.stderr.strip() or "unknown problem"}. The current quiz is unchanged.', True)
        else:
            self.toast.emit('Backup restored', False)
        self._crashes = []
        self.server.start()

    @Slot(str)
    def importDrive(self, link):
        """A quiz file shared on Google Drive (the server fetches it), loaded as a fresh quiz."""
        def got(reply):
            quiz = reply.get('quiz')
            if not quiz:
                return self.toast.emit('No quiz found at that link', True)
            path = self.server.data_dir / 'drive-import.json'
            path.write_text(json.dumps(quiz), encoding='utf-8')
            self.loadQuiz(QUrl.fromLocalFile(str(path)))
        self.api.host('drive', {'url': link}, got, lambda e: self.toast.emit(e, True), timeout_ms=60000)

    # ---- first run ----
    @Property(bool, constant=True)
    def firstRun(self):
        return not QSettings().value('welcomed', False, bool)

    @Slot(str)
    def welcomed(self, choice):
        """How players join, chosen on the first run (as the Electron app's welcome): the venue's network or this
        laptop's quiz Wi-Fi; or decided later."""
        QSettings().setValue('welcomed', True)
        if choice == 'lan':
            def network(n):
                address = next((a for a in n.get('addresses', []) if a.get('kind') == 'lan'), None)
                self.api.host('settings', {'joinMode': 'lan', **({'joinUrl': f'http://{address["address"]}:{n["port"]}'} if address else {})}, lambda _: self.refresh())
            self.api.host('network', {}, network)
        elif choice == 'hotspot':
            # The laptop's status says which hotspot it has (Windows or Linux), so the address is right first time.
            port = (self.server.info or {}).get('port')
            set_url = lambda laptop: self.api.host('settings', {'joinMode': 'hotspot', 'joinUrl': self.hotspot_url(laptop, port)}, lambda _: self.refresh())
            self.api.host('laptop', {}, set_url, lambda _: set_url({}), timeout_ms=30000)

    @Slot(QUrl)
    def backup(self, folder):
        path = folder.toLocalFile() if isinstance(folder, QUrl) else str(folder)
        self._pending_backup = path
        self.server.send({'type': 'backup', 'id': 'backup', 'folder': path})
        self._set_status('Backing up the quiz…')

    @Slot(QUrl)
    def loadQuiz(self, url):
        path = url.toLocalFile() if isinstance(url, QUrl) else str(url)
        played = bool((self._state or {}).get('history') or (self._state or {}).get('teams'))
        if played or self.library.dirty:
            self.confirmLoad.emit(path)
        else:
            self.loadQuizConfirmed(path)

    @Slot(str)
    def loadQuizConfirmed(self, path):
        try:
            quiz = json.loads(Path(path).read_text(encoding='utf-8-sig'))
        except (OSError, ValueError) as e:
            self.toast.emit(f'That file couldn\'t be read as a BeerMat quiz: {e}', True)
            return
        fields = [(q, 'media') for r in quiz.get('rounds', []) for q in r.get('questions', [])]
        fields += [(item, 'media') for q, _ in list(fields) for item in [*(q.get('clips') or []), *(q.get('songs') or [])]]
        embedded = {}
        for holder, key in fields:
            match = DATA_URL.match(holder.get(key) or '') if isinstance(holder.get(key), str) else None
            if match:
                if match[1] not in MEDIA_TYPES:
                    self.toast.emit(f'Embedded {match[1]} files are not supported', True)
                    return
                embedded.setdefault(holder[key], match)
        uploaded, title = {}, quiz.get('title', Path(path).stem)
        self._busy = True
        self.statusChanged.emit()

        def upload_next():
            pending = [value for value in embedded if value not in uploaded]
            if not pending:
                for holder, key in fields:
                    if holder.get(key) in uploaded:
                        holder[key] = uploaded[holder[key]]
                self._busy = False
                # The loaded quiz replaces whatever the Quizzes page was editing.
                self.library.discard()
                self._act('new-event', {'questions': 'load', 'quiz': quiz}, f'Quiz loaded: {title}')
                return
            value = pending[0]
            match = embedded[value]

            def failed(error):
                self._busy = False
                self.statusChanged.emit()
                self.toast.emit(f'A picture or sound in that quiz couldn\'t be added: {error}', True)
            self.api.upload(base64.b64decode(match[2]), f'embedded{MEDIA_TYPES[match[1]]}',
                            lambda media: (uploaded.__setitem__(value, media), upload_next()), failed)
        upload_next()
