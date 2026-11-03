"""The quiz library, edited on the desk: a working copy of the server's library (rounds and questions) that the
Quizzes workspace changes field by field and saves with /api/host/library/save. The server validates every question
(server/model.js validateQuestion) and answers with a sentence when something's missing, so the rules for each format
live there, not here. Fields the native editor doesn't show (Risk It, speed bonus, buzzer and bingo options, …) are
kept exactly as they are."""
import base64
import copy
import json
import secrets
from pathlib import Path

from PySide6.QtCore import Property, QObject, QUrl, Signal, Slot

# Formats a question can be, as the web desk names them.
TYPES = [('text', 'Typed answer'), ('choice', 'Multiple choice'), ('multi', 'Tick all that apply'), ('letter', 'Letter keypad'),
         ('number', 'Number'), ('nearest', 'Nearest wins'), ('sequence', 'Put in order'), ('pinpoint', 'Pinpoint'), ('wordsnake', 'Word trail'),
         ('tiles', 'Letter tiles'), ('vote', 'Vote'), ('buzzer', 'Buzzer'), ('bingo', 'Bingo'), ('musicbingo', 'Music bingo'), ('clips', 'Sound clips'),
         ('picture', 'Picture'), ('audio', 'Audio'), ('sheet', 'Answer sheet'), ('clues', 'Progressive clues'), ('list', 'List answers'), ('pairs', 'Matching pairs'), ('sort', 'Sort into groups')]
# The fields the native editor shows; which ones apply depends on the format.
LIST_FIELDS = {'options', 'correct', 'items', 'itemAnswers', 'aliases', 'clues', 'accepted'}
FIELDS_BY_TYPE = {
    'choice': ['options', 'answer'], 'vote': ['options'], 'multi': ['options', 'correct'], 'sequence': ['items'],
    'sheet': ['items', 'itemAnswers'], 'picture': ['media', 'answer', 'aliases'], 'audio': ['media', 'answer', 'aliases'],
    'pinpoint': ['media'], 'text': ['answer', 'aliases'], 'letter': ['answer'], 'number': ['answer'], 'nearest': ['answer'], 'tiles': ['answer'],
    'wordsnake': ['answer'], 'buzzer': ['answer'], 'clues': ['clues', 'answer', 'aliases'], 'list': ['accepted'], 'pairs': ['pairs'], 'sort': ['sorting'],
}

SPEED = {'text', 'choice', 'multi', 'letter', 'number', 'sequence', 'pinpoint', 'wordsnake', 'tiles', 'picture', 'audio', 'bingo', 'musicbingo', 'clips'}
BINGO = {'bingo', 'musicbingo'}
# Formats with a right answer the server can mark (model.js autoMarked): Risk It and the fixed speed bonus need one.
MARKED = {'text', 'choice', 'multi', 'letter', 'number', 'sequence', 'pinpoint', 'wordsnake', 'tiles', 'picture', 'audio', 'clues', 'list', 'pairs', 'sort'}
# Each format's options (server/model.js validateQuestion): key, label, kind, for numbers their range, for choices
# their values, and when it's offered (the format and the question's other options: a buzzer's pass penalty only for
# an advanced buzzer, say). The server checks them again when the quiz is saved.
# Two-button Multiple choice (model.js PAIRS): its two choices, set for it.
PAIRS = {'trueFalse': ['True', 'False'], 'beforeAfter': ['Before', 'After']}
OPTIONS = [
    ('evil', 'Risk It: a wrong answer loses the points', 'bool', None, lambda t, q: t in MARKED and not q.get('wager')),
    ('wager', 'Wager: teams stake up to this many points, won if right, lost if wrong (0: off)', 'int', (0, 100), lambda t, q: t in MARKED and not q.get('evil')),
    ('fastestFingers', 'Fastest fingers first (speed bonus)', 'bool', None, lambda t, q: t in SPEED),
    ('speedBonus', 'Speed bonus points', 'int', (0, 100), lambda t, q: t in SPEED and q.get('fastestFingers')),
    ('bonusMode', 'Speed bonus', 'choice', [('sliding', 'Fades over the time allowed'), ('fixed', 'Only the fastest answers')], lambda t, q: t in SPEED & MARKED and q.get('fastestFingers')),
    ('bonusPlaces', 'Fastest answers given the fixed bonus', 'int', (1, 50), lambda t, q: t in SPEED & MARKED and q.get('fastestFingers') and q.get('bonusMode') == 'fixed'),
    ('tolerance', 'Also accept answers within ± (0: exact only)', 'int', (0, 1000000000), lambda t, q: t == 'number'),
    ('tolerancePercent', 'The margin is a percentage of the answer', 'bool', None, lambda t, q: t == 'number' and q.get('tolerance')),
    ('clueSeconds', 'Seconds between clues', 'int', (5, 120), lambda t, q: t == 'clues'),
    ('slots', 'Boxes each team fills (up to 20, and no more than the answers)', 'int', (1, 20), lambda t, q: t == 'list'),
    ('places', 'Places scored (closest first)', 'int', (1, 20), lambda t, q: t == 'nearest'),
    ('notOver', 'Closest without going over: answers above the answer score nothing', 'bool', None, lambda t, q: t == 'nearest'),
    ('tieBreaker', 'Tie-breaker (scores nothing, orders teams level on points)', 'bool', None, lambda t, q: t == 'nearest'),
    # goWide is the hint on a word trail and the second guess on a pinpoint (the key stays as it is in quiz files).
    ('goWide', 'Hint: teams can hide the decoy letters, for fewer points', 'bool', None, lambda t, q: t == 'wordsnake'),
    ('goWidePoints', 'Points with the hint', 'int', (0, 100), lambda t, q: t == 'wordsnake' and q.get('goWide')),
    ('goWide', 'Second guess: a second tap scores if the first misses', 'bool', None, lambda t, q: t == 'pinpoint' and 'targets' not in q),
    ('goWidePoints', 'Points for a second guess', 'int', (0, 100), lambda t, q: t == 'pinpoint' and q.get('goWide') and 'targets' not in q),
    ('pair', 'Buttons', 'choice', [('', 'Your own choices'), ('trueFalse', 'True or false: two big buttons'), ('beforeAfter', 'Before or after: two big buttons')], lambda t, q: t == 'choice'),
    ('fiftyFifty', '50/50: teams can take away half the wrong choices, for fewer points', 'bool', None, lambda t, q: t == 'choice' and not q.get('pair')),
    ('fiftyPoints', 'Points after a 50/50', 'int', (0, 100), lambda t, q: t == 'choice' and q.get('fiftyFifty')),
    ('variation', 'Buzzer game', 'choice', [('classic', 'Classic'), ('advanced', 'Advanced (pass and agree)')], lambda t, q: t == 'buzzer'),
    ('penalty', 'Points lost for a wrong answer', 'int', (0, 100), lambda t, q: t == 'buzzer'),
    ('passPenalty', 'Points lost for passing', 'int', (0, 100), lambda t, q: t == 'buzzer' and q.get('variation') == 'advanced'),
    ('agreePoints', 'Points for agreeing with a right answer', 'int', (0, 100), lambda t, q: t == 'buzzer' and q.get('variation') == 'advanced'),
    ('agreeSeconds', 'Seconds to agree', 'int', (5, 60), lambda t, q: t == 'buzzer' and q.get('variation') == 'advanced'),
    ('mode', 'Bingo game', 'choice', [('line', 'One line'), ('twoLines', 'Two lines'), ('fullHouse', 'Full house'), ('progressive', 'Full game: line, two lines, full house')], lambda t, q: t in BINGO),
    ('stagePoints', 'Full game points: line, two lines, full house (e.g. 2, 3, 5)', 'ints', (0, 100), lambda t, q: t in BINGO and q.get('mode') == 'progressive'),
    ('startAt', 'Songs start this far in (seconds)', 'int', (0, 600), lambda t, q: t == 'musicbingo'),
    ('songSeconds', 'Play each song for (seconds, 0: whole song)', 'int', (0, 600), lambda t, q: t == 'musicbingo'),
    ('autoNext', 'Play the next song by itself', 'bool', None, lambda t, q: t == 'musicbingo'),
    ('revealNow', 'Show each song title as it plays', 'bool', None, lambda t, q: t == 'musicbingo'),
    ('clipSeconds', 'Each clip plays for (seconds)', 'int', (3, 60), lambda t, q: t == 'clips'),
    ('hideText', "The TV and phones don't show the wording until the reveal (you read it out): for wording that gives the answer away", 'bool', None, lambda t, q: t not in BINGO | {'clips'}),
    ('reveal', 'Picture reveal', 'choice', [('', 'Shown straight away'), ('blur', 'Starts blurred, sharpens over the time'), ('tiles', 'Under twelve tiles that go one by one')],
     lambda t, q: t == 'picture'),
    # The picture shows itself over its first N seconds, then stays whole; a sliding speed bonus only counts until then.
    ('revealSeconds', 'Reveal over (seconds; 0 = the whole time)', 'int', (0, 7200), lambda t, q: t == 'picture' and q.get('reveal')),
    ('wipeout', 'Wipeout: any wrong tick scores nothing', 'bool', None, lambda t, q: t == 'multi'),
    ('perCall', 'Numbers called each time (1–3)', 'int', (1, 3), lambda t, q: t == 'bingo'),
    ('speed', 'Speed bingo: only numbers on a team’s ticket are called', 'bool', None, lambda t, q: t == 'bingo'),
    ('reactions', 'Reaction table: teams dab the song as soon as they know it', 'bool', None, lambda t, q: t == 'musicbingo'),
    ('reactionPoints', 'Points for the quickest team on each song', 'int', (0, 10), lambda t, q: t == 'musicbingo' and q.get('reactions')),
    ('partScoring', 'Sheet scoring', 'choice', [('each', 'A point for each part'), ('split', "The question's points shared"), ('all', 'Points only when every part is right')], lambda t, q: t == 'sheet'),
]
DEFAULTS = {'reveal': '', 'perCall': 1, 'bonusMode': 'sliding', 'bonusPlaces': 1, 'places': 1, 'variation': 'classic', 'agreeSeconds': 10, 'mode': 'line', 'clipSeconds': 15, 'partScoring': 'each'}
PICTURE, SOUND = ('.png', '.jpg', '.jpeg', '.webp'), ('.mp3', '.ogg', '.wav')


class Library(QObject):
    changed = Signal()
    toast = Signal(str, bool)

    def __init__(self, api, media_dir=None, parent=None):
        super().__init__(parent)
        self.api, self.media_dir = api, media_dir
        self._server, self._draft, self._dirty = None, None, False
        self._selected = (-1, -1)

    # ---- the server's copy ----
    def received(self, library):
        """A fresh library from the server. Unsaved edits are kept (the save then reports the conflict)."""
        self._server = library
        if not self._dirty:
            self._draft = copy.deepcopy(library)
        self.changed.emit()

    def discard(self):
        """A quiz file was loaded: its quiz replaces any unsaved edits (the desk asked first), with nothing selected."""
        self._dirty, self._selected = False, (-1, -1)
        if self._server is not None:
            self._draft = copy.deepcopy(self._server)
        self.changed.emit()

    # ---- what QML sees ----
    @Property(bool, notify=changed)
    def dirty(self):
        return self._dirty

    @Property(str, notify=changed)
    def title(self):
        return (self._draft or {}).get('title', '')

    @Property('QVariantList', constant=True)
    def types(self):
        return [{'value': v, 'text': t} for v, t in TYPES]

    @Property('QVariantList', notify=changed)
    def outline(self):
        """Rounds and their questions, flattened for a list: a round row, then its questions."""
        rows = []
        names = dict(TYPES)
        for r, rnd in enumerate((self._draft or {}).get('rounds', [])):
            rows.append({'kind': 'round', 'round': r, 'question': -1, 'text': rnd.get('title') or f'Round {r + 1}', 'count': len(rnd.get('questions', []))})
            for i, q in enumerate(rnd.get('questions', [])):
                rows.append({'kind': 'question', 'round': r, 'question': i, 'text': q.get('text') or q.get('title') or '(no question yet)',
                             'type': names.get(q.get('type'), q.get('type', '')), 'selected': (r, i) == self._selected,
                             'tieBreaker': bool(q.get('tieBreaker'))})
        return rows

    @Property('QVariantMap', notify=changed)
    def question(self):
        """The selected question as the editor shows it: list fields as lines of text."""
        q = self._current()
        if q is None:
            return {}
        shown = {k: ('\n'.join(map(str, q.get(k) or [])) if k in LIST_FIELDS else q.get(k)) for k in q}
        shown['fields'] = FIELDS_BY_TYPE.get(q.get('type'), [])
        shown['round'], shown['index'] = self._selected
        shown['roundTitle'] = self._draft['rounds'][self._selected[0]].get('title', '')
        shown['answer'] = '' if q.get('answer') is None else str(q.get('answer'))
        kind = q.get('type')
        shown['options_'] = [{'key': k, 'label': label, 'kind': kind_, 'range': list(rng) if kind_ in ('int', 'ints') else [],
                              'choices': [{'value': v, 'text': t} for v, t in rng] if kind_ == 'choice' else [],
                              'value': (', '.join(map(str, q.get(k) or [])) if kind_ == 'ints' else q.get(k, DEFAULTS.get(k, False if kind_ == 'bool' else 0)))}
                             for k, label, kind_, rng, applies in OPTIONS if applies(kind, {**DEFAULTS, **q})]
        shown['clipsList'] = [{'label': c.get('label', ''), 'media': c.get('media') or '', 'spotify': c.get('spotify') or '', 'start': c.get('start', 0)} for c in q.get('clips') or []]
        shown['songsList'] = [{'title': x.get('title', ''), 'media': x.get('media') or '', 'spotify': x.get('spotify') or '', 'start': x.get('start', ''), 'seconds': x.get('seconds', '')}
                              for x in q.get('songs') or []]
        shown['target'] = q.get('target') or {}
        shown['spotifyClip'] = q.get('clip') or {}
        shown['pairs'] = '\n'.join(f'{p[0]} = {p[1]}' for p in q.get('pairs') or [])
        shown['sorting'] = '\n'.join(f'{p[0]} = {p[1]}' for p in q.get('sorting') or [])
        shown['itemAliases'] = '\n'.join(' | '.join(a) for a in q.get('itemAliases') or [])
        return shown

    def _current(self):
        r, i = self._selected
        try:
            return self._draft['rounds'][r]['questions'][i] if r >= 0 and i >= 0 else None
        except (KeyError, IndexError, TypeError):
            return None

    def _touch(self):
        self._dirty = True
        self.changed.emit()

    # ---- editing ----
    @Slot(int, int)
    def select(self, r, i):
        self._selected = (r, i)
        self.changed.emit()

    @Slot(str)
    def setTitle(self, title):
        if self._draft is not None and title != self._draft.get('title'):
            self._draft['title'] = title
            self._touch()

    @Slot(str, 'QVariant')
    def setField(self, field, value):
        q = self._current()
        if q is None:
            return
        if field in ('pairs', 'sorting'):
            # Matching pairs ("left = right") or sorting ("item = group"), one a line.
            value = [[side.strip() for side in line.split('=', 1)] for line in str(value).split('\n') if '=' in line]
        elif field in LIST_FIELDS:
            value = [line.strip() for line in str(value).split('\n') if line.strip()]
        elif field in ('points', 'seconds'):
            value = int(value)
        # Leaving a box without typing anything (or typing the same thing) changes nothing: no "unsaved" quiz.
        if q.get(field, '' if field not in LIST_FIELDS else []) == value or (value in ('', [], None) and field not in q):
            return
        if value in ('', [], None) and field not in ('text',):
            q.pop(field, None)
        else:
            q[field] = value
        self._touch()

    @Slot(str, str)
    def setOption(self, key, value):
        """A format option, from the editor's text: true/false, a number, a choice, or numbers separated by commas."""
        q = self._current()
        spec = next((o for o in OPTIONS if o[0] == key), None)
        if q is None or spec is None:
            return
        kind = spec[2]
        try:
            q[key] = (value == 'true' if kind == 'bool' else int(value) if kind == 'int'
                      else [int(v) for v in value.replace(' ', '').split(',') if v] if kind == 'ints' else value)
        except ValueError:
            self.toast.emit(f'{spec[1]}: give whole numbers', True)
            return
        # Two big buttons: their two choices, and the right one kept if it is one of them; back to your own, none.
        if key == 'pair':
            if value in PAIRS:
                q['options'] = list(PAIRS[value]); q.pop('fiftyFifty', None)
                q['answer'] = next((o for o in PAIRS[value] if o.lower() == str(q.get('answer', '')).lower()), '')
            else:
                q.pop('pair', None)
        # 0 is "over the whole time"; with no reveal there's no reveal time either.
        if key == 'revealSeconds' and not q[key] or key == 'reveal' and not value:
            q.pop('revealSeconds', None)
        self._touch()

    @Slot(str, QUrl)
    def uploadMedia(self, field, url):
        """A picture or sound for the question, uploaded to the quiz server's media (as the web editor's upload)."""
        path = Path(url.toLocalFile() if isinstance(url, QUrl) else str(url))
        if path.suffix.lower() not in PICTURE + SOUND:
            return self.toast.emit('Choose a PNG, JPEG or WebP picture, or an MP3, Ogg or WAV sound', True)
        try:
            data = path.read_bytes()
        except OSError as e:
            return self.toast.emit(f'Could not read {path.name}: {e}', True)
        r, i = self._selected

        def done(media):
            q = self._draft['rounds'][r]['questions'][i]
            if field == 'clip':
                q.setdefault('clips', []).append({'media': media, 'label': path.stem[:100]})
            elif field == 'song':
                q.setdefault('songs', []).append({'title': path.stem[:100], 'media': media})
            else:
                q['media'] = media
                q.pop('clip', None)
            self._touch()
            self.toast.emit(f'{path.name} added', False)
        self.api.upload(data, f'upload{path.suffix.lower()}', done, lambda e: self.toast.emit(e, True))

    @Slot(float, float)
    def setTarget(self, x, y):
        """Pinpoint: the target's centre, as fractions of the picture; its size stays (or a sensible first size). With
        several places to find, each click adds one (up to ten)."""
        q = self._current()
        if q is None:
            return
        point = {'x': round(min(1, max(0, x)), 4), 'y': round(min(1, max(0, y)), 4)}
        if 'targets' in q:
            if len(q['targets']) >= 10:
                return self.toast.emit('Ten places is the most: clear them to start again', True)
            last = q['targets'][-1] if q['targets'] else {'r': 0.06, 'aspect': 1}
            q['targets'] = q['targets'] + [{'r': last['r'], 'aspect': last.get('aspect', 1), **point}]
        else:
            q['target'] = {**(q.get('target') or {'r': 0.06, 'aspect': 1}), **point}
        self._touch()

    @Slot(bool)
    def setSeveralTargets(self, on):
        """Pinpoint: several places to find (each click adds one; a point for each found), or the one target."""
        q = self._current()
        if q is None or on == ('targets' in q):
            return
        if on:
            q['targets'] = [q.pop('target')] if q.get('target') else []
            q.pop('goWide', None)
        else:
            targets = q.pop('targets')
            if targets:
                q['target'] = targets[0]
        self._touch()

    @Slot()
    def clearTargets(self):
        q = self._current()
        if q is not None and q.get('targets'):
            q['targets'] = []
            self._touch()

    @Slot(float, float)
    def setTargetShape(self, radius, aspect):
        q = self._current()
        if q is not None and q.get('targets'):
            q['targets'] = [{**t, 'r': round(radius, 3), 'aspect': round(aspect, 3)} for t in q['targets']]
            self._touch()
        elif q is not None and q.get('target'):
            q['target'] = {**q['target'], 'r': round(radius, 3), 'aspect': round(aspect, 3)}
            self._touch()

    @Slot(str, int, str, str)
    def setItem(self, kind, index, field, value):
        """A clip's or song's field: label, title, spotify (a track link), start, seconds. Empty numbers are removed."""
        q = self._current()
        items = (q or {}).get('clips' if kind == 'clip' else 'songs') or []
        if not 0 <= index < len(items):
            return
        item = items[index]
        if field in ('start', 'seconds'):
            if str(value).strip() == '':
                item.pop(field, None)
            else:
                try:
                    item[field] = int(value)
                except ValueError:
                    return self.toast.emit('Give whole seconds', True)
        elif field == 'spotify':
            if value.strip():
                item['spotify'] = value.strip()
                item.pop('media', None)
                if kind == 'clip':
                    item.setdefault('start', 0)
            else:
                item.pop('spotify', None)
        else:
            item[field] = value
        self._touch()

    @Slot(str)
    def addSpotifyItem(self, kind):
        q = self._current()
        if q is not None:
            if kind == 'clip':
                q.setdefault('clips', []).append({'spotify': '', 'start': 0, 'label': ''})
            else:
                q.setdefault('songs', []).append({'title': f'Song {len(q.get("songs") or []) + 1}', 'spotify': ''})
            self._touch()

    @Slot(str, int)
    def removeItem(self, kind, index):
        q = self._current()
        items = (q or {}).get('clips' if kind == 'clip' else 'songs') or []
        if 0 <= index < len(items):
            del items[index]
            self._touch()

    @Slot(int)
    def setTargetClip(self, index):
        q = self._current()
        if q is not None:
            q['targetClip'] = index
            self._touch()

    @Slot(str)
    def importSongs(self, links):
        """Music bingo from Spotify: the server looks up each track's title (needs Spotify connected, Pro)."""
        r, i = self._selected
        lines = [line.strip() for line in links.split('\n') if line.strip()]

        def done(reply):
            q = self._draft['rounds'][r]['questions'][i]
            q.setdefault('songs', []).extend({'title': x['title'][:100], 'spotify': x['spotify']} for x in reply.get('songs', []))
            self._touch()
            self.toast.emit(f'{len(reply.get("songs", []))} songs added', False)
        self.api.host('spotify/import', {'links': lines}, done, lambda e: self.toast.emit(e, True), timeout_ms=60000)

    @Slot(str, str, str)
    def setSpotifyClip(self, track, start, seconds):
        """An audio question (or a sheet) playing a Spotify track instead of a file."""
        q = self._current()
        if q is None:
            return
        if not track.strip():
            q.pop('clip', None)
        else:
            try:
                q['clip'] = {'spotify': track.strip(), 'start': int(start or 0), 'seconds': int(seconds or 30)}
            except ValueError:
                return self.toast.emit('Give whole seconds', True)
            q.pop('media', None)
        self._touch()

    @Slot(str)
    def setItemAliases(self, text):
        """Sheet: other accepted answers for each part, one line per part, separated by |."""
        q = self._current()
        if q is not None:
            lines = text.split('\n')
            q['itemAliases'] = [[a.strip() for a in (lines[n] if n < len(lines) else '').split('|') if a.strip()] for n in range(len(q.get('items') or []))]
            self._touch()

    @Slot(str)
    def setType(self, kind):
        q = self._current()
        if q is not None and q.get('type') != kind:
            q['type'] = kind
            self._touch()

    @Slot(int)
    def addQuestion(self, r):
        rounds = self._draft.setdefault('rounds', [])
        if not rounds:
            rounds.append({'id': 'r' + secrets.token_hex(4), 'title': 'Round 1', 'questions': []})
            r = 0
        questions = rounds[r].setdefault('questions', [])
        questions.append({'id': 'q' + secrets.token_hex(4), 'type': 'text', 'text': '', 'answer': '', 'points': 1, 'seconds': 30})
        self._selected = (r, len(questions) - 1)
        self._touch()

    @Slot()
    def duplicateQuestion(self):
        q = self._current()
        if q is None:
            return
        r, i = self._selected
        copy_ = copy.deepcopy(q)
        copy_['id'] = 'q' + secrets.token_hex(4)
        self._draft['rounds'][r]['questions'].insert(i + 1, copy_)
        self._selected = (r, i + 1)
        self._touch()

    @Slot()
    def deleteQuestion(self):
        r, i = self._selected
        if self._current() is None:
            return
        del self._draft['rounds'][r]['questions'][i]
        self._selected = (-1, -1)
        self._touch()

    @Slot(int)
    def moveQuestion(self, step):
        r, i = self._selected
        questions = (self._draft or {}).get('rounds', [{}])[r].get('questions', []) if r >= 0 else []
        j = i + step
        if self._current() is None or not 0 <= j < len(questions):
            return
        questions[i], questions[j] = questions[j], questions[i]
        self._selected = (r, j)
        self._touch()

    @Slot()
    def addRound(self):
        rounds = self._draft.setdefault('rounds', [])
        rounds.append({'id': 'r' + secrets.token_hex(4), 'title': f'Round {len(rounds) + 1}', 'questions': []})
        self._touch()

    @Slot(int, str)
    def renameRound(self, r, title):
        if title.strip() and self._draft['rounds'][r].get('title') != title:
            self._draft['rounds'][r]['title'] = title.strip()
            self._touch()

    @Slot(int)
    def deleteRound(self, r):
        del self._draft['rounds'][r]
        self._selected = (-1, -1)
        self._touch()

    # ---- saving ----
    @Slot()
    def save(self):
        """Saved only if nobody else changed the quiz meanwhile (revision); the server checks every question."""
        if not self._dirty:
            return

        def saved(library):
            self._dirty = False
            self.received(library)
            self.toast.emit('Quiz saved', False)

        self.api.host('library/save', {'revision': (self._server or {}).get('revision', 0), 'quiz': self._draft}, saved,
                      lambda e: self.toast.emit(f'Not saved: {e}', True))

    @Slot()
    def revert(self):
        self._dirty = False
        self._draft = copy.deepcopy(self._server)
        self._selected = (-1, -1)
        self.changed.emit()

    @Slot(QUrl)
    def printSheets(self, url):
        """Blank answer sheets for a paper round or a team without phones, as the web desk's Print blank sheets: the
        quiz's questions with a line for each answer (choices listed, order items shuffled; formats that need a phone or
        the TV are left out), as a PDF that opens in the system's viewer for printing."""
        import html
        import random
        from PySide6.QtCore import QMarginsF
        from PySide6.QtGui import QDesktopServices, QPageLayout, QPageSize, QPdfWriter, QTextDocument
        quiz = self._server or {}
        line = '<p>Answer: __________________________________________________</p>'
        parts = [f'<h1>{html.escape(quiz.get("title", "Quiz"))}</h1>', '<p>Team name: __________________________________</p>']
        letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
        for rnd in quiz.get('rounds', []):
            parts.append(f'<h2>{html.escape(rnd.get("title", ""))}</h2>')
            for i, q in enumerate(rnd.get('questions', [])):
                kind = q.get('type')
                if kind == 'sheet':
                    parts.append(f'<h3>{html.escape(q.get("text", ""))}</h3>')
                    for n, item in enumerate(q.get('items') or []):
                        parts += [f'<p>{n + 1}. {html.escape(item)}</p>', line]
                elif kind in ('buzzer', 'bingo', 'musicbingo', 'pinpoint', 'clips', 'wordsnake', 'tiles'):
                    continue
                else:
                    parts.append(f'<p>{i + 1}. {html.escape(q.get("text", ""))}</p>')
                    if kind in ('choice', 'vote', 'multi'):
                        parts.append('<p>' + '&nbsp;&nbsp;&nbsp;&nbsp;'.join(f'{letters[n]}. {html.escape(o)}' for n, o in enumerate(q.get('options') or [])) + '</p>')
                    if kind == 'sequence':
                        items = list(q.get('items') or [])
                        random.shuffle(items)
                        parts.append('<p>Put in order: ' + ' · '.join(map(html.escape, items)) + '</p>')
                    parts.append(line)
        path = Path(url.toLocalFile() if isinstance(url, QUrl) else str(url))
        writer = QPdfWriter(str(path))
        writer.setResolution(96)   # the text is laid out at screen resolution; the PDF's default (1200 dpi) shrinks it
        writer.setPageLayout(QPageLayout(QPageSize(QPageSize.PageSizeId.A4), QPageLayout.Orientation.Portrait, QMarginsF(15, 15, 15, 15), QPageLayout.Unit.Millimeter))
        writer.setTitle(f'{quiz.get("title", "Quiz")} — answer sheet')
        doc = QTextDocument()
        doc.setDefaultStyleSheet('h1 { font-size: 20pt; } h2 { font-size: 15pt; margin-top: 14pt; } p { font-size: 11pt; }')
        doc.setHtml('\n'.join(parts))
        doc.setPageSize(writer.pageLayout().paintRectPixels(writer.resolution()).size().toSizeF())
        doc.print_(writer)
        self.toast.emit(f'Answer sheets saved to {path.name}: print them from the viewer', False)
        QDesktopServices.openUrl(QUrl.fromLocalFile(str(path)))
        return str(path)

    @Slot(QUrl, bool)
    def export(self, url, with_media=True):
        """The quiz as a BeerMat quiz file, as the web desk's Download quiz. With its media, every picture and sound is
        put inside the file (as data: URLs), so it loads on another laptop; Load quiz file unpacks them again."""
        path = Path(url.toLocalFile() if isinstance(url, QUrl) else str(url))
        quiz = copy.deepcopy({k: v for k, v in (self._server or {}).items() if k != 'revision'})
        if with_media and self.media_dir:
            kinds = {'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav'}
            holders = [q for r in quiz.get('rounds', []) for q in r.get('questions', [])]
            holders += [item for q in list(holders) for item in [*(q.get('clips') or []), *(q.get('songs') or [])]]
            for holder in holders:
                media = holder.get('media')
                if isinstance(media, str) and media.startswith('/media/'):
                    file = Path(self.media_dir) / Path(media).name
                    if file.suffix.lower() in kinds and file.exists():
                        holder['media'] = f'data:{kinds[file.suffix.lower()]};base64,' + base64.b64encode(file.read_bytes()).decode()
        try:
            path.write_text(json.dumps(quiz, indent=2, ensure_ascii=False), encoding='utf-8')
            self.toast.emit(f'Quiz saved to {path.name}' + (' with its pictures and sounds' if with_media else ''), False)
        except OSError as e:
            self.toast.emit(f'Could not write {path.name}: {e}', True)
