"""The TV's sound, played natively: the quizmaster's sound pack (a sound for each moment), the music while answering,
the final countdown timed to end at the deadline, the drum roll before a reveal, buzzer sounds, bingo chimes and the
spoken caller, applause for the winner, and the desk's own playback (sound clips, music bingo songs, audio questions).
Everything goes to one output, the TV's sound (chosen in Settings), as Electron's TV window does.

The moments follow soundCues() in web/client.js exactly, so a native TV and a web TV sound the same."""
import math
import os
import re
import struct
import tempfile
import wave
from pathlib import Path

from PySide6.QtCore import Property, QObject, QSettings, QTimer, QUrl, Signal, Slot
from PySide6.QtMultimedia import QAudioOutput, QMediaDevices, QMediaPlayer, QSoundEffect

# The synthesised buzzers (web/app.js `sounds`): name, wave, notes (0 is a rest), each note 0.13 s apart.
SYNTH = [('Classic buzz', 'square', [330, 495]), ('Doorbell', 'sine', [660, 523]), ('Siren', 'sawtooth', [440, 660, 440]),
         ('Beep beep', 'square', [880, 0, 880]), ('Low horn', 'sawtooth', [147, 147]), ('Chime', 'triangle', [784, 988, 1175]),
         ('Laser', 'square', [1200, 600, 300]), ('Boing', 'sine', [220, 440])]
FANFARE = [(523, 0), (659, 0.15), (784, 0.3), (1047, 0.45), (784, 0.7), (1047, 0.85)]
# The wheel (web/client.js): six seconds on this cubic-bezier, which the native TV's spin uses too.
WHEEL_MS, WHEEL_EASING = 6000, (0.12, 0.6, 0.15, 1)
QUIET_TYPES = {'audio', 'clips', 'musicbingo', 'buzzer', 'bingo'}
AUDIO_FILE = ('.mp3', '.ogg', '.wav')
# BEERMAT_MUTE=1 (the tests): everything plays as usual, silently.
MUTED = os.environ.get('BEERMAT_MUTE') == '1'
# A TV's own sound: the output on its HDMI or DisplayPort cable (desktop/sound.js pickOutput).
TV_OUTPUT = re.compile(r'HDMI|DisplayPort|\bDP\b', re.I)


def synth(path, notes, shape, gain=0.12, length=0.22):
    """Writes a short tone sequence as a WAV file: each note decays exponentially, as the Web Audio version does."""
    rate = 44100
    total = int(rate * (max(start for _, start in notes) + length + 0.05))
    samples = [0.0] * total
    for freq, start in notes:
        if not freq:
            continue
        first = int(start * rate)
        for i in range(int(length * rate)):
            t = i / rate
            phase = (freq * t) % 1.0
            value = {'sine': math.sin(2 * math.pi * phase), 'square': 1.0 if phase < 0.5 else -1.0,
                     'sawtooth': 2 * phase - 1, 'triangle': 4 * abs(phase - 0.5) - 1}[shape]
            if first + i < total:
                samples[first + i] += value * gain * (0.001 / gain) ** (t / length)
    with wave.open(str(path), 'wb') as out:
        out.setnchannels(1); out.setsampwidth(2); out.setframerate(rate)
        out.writeframes(b''.join(struct.pack('<h', int(max(-1, min(1, s)) * 32767)) for s in samples))


def wheel_crossings(start, end, slice_):
    """When (ms into the spin) each segment edge passes the pointer, as wheelCrossings() in web/client.js: edges sit
    at whole multiples of `slice_` degrees of turn, and the turn follows the spin's cubic-bezier."""
    x1, y1, x2, y2 = WHEEL_EASING
    curve = lambda u, a, b: 3 * a * u * (1 - u) ** 2 + 3 * b * u * u * (1 - u) + u ** 3
    times, last_time, last_turn = [], 0.0, start
    for i in range(1, 4001):
        u = i / 4000
        time, turn = curve(u, x1, x2), start + (end - start) * curve(u, y1, y2)
        k = math.floor(last_turn / slice_) + 1
        while k * slice_ <= turn:
            times.append((last_time + (time - last_time) * (k * slice_ - last_turn) / (turn - last_turn)) * WHEEL_MS)
            k += 1
        last_time, last_turn = time, turn
    return times


def tick_file(path):
    """The wheel's peg: a short wooden knock (noise and a 1800 Hz ping, both dying away fast), as web/app.js makes."""
    import random
    rate = 44100
    samples = [(random.uniform(-1, 1) * math.exp(-i / (rate * 0.003)) + math.sin(i / rate * 2 * math.pi * 1800) * math.exp(-i / (rate * 0.006)) * 0.6) * 0.5
               for i in range(int(rate * 0.03))]
    with wave.open(str(path), 'wb') as out:
        out.setnchannels(1); out.setsampwidth(2); out.setframerate(rate)
        out.writeframes(b''.join(struct.pack('<h', int(max(-1, min(1, x)) * 32767)) for x in samples))


class TvSound(QObject):
    outputsChanged = Signal()
    played = Signal(str)      # which moment sounded (tests and the desk's log)

    def __init__(self, parent=None):
        super().__init__(parent)
        self._prefs = QSettings()
        self._devices = QMediaDevices(self)
        self._devices.audioOutputsChanged.connect(self._apply_output)
        self._devices.audioOutputsChanged.connect(self.outputsChanged)
        self.base = ''
        self._pack = {'slots': {}, 'buzzers': []}
        self._players = {}            # url -> (QMediaPlayer, QAudioOutput)
        self._heard = None
        self._music = False
        self._countdown_for = None
        self._state = None
        self._offset = 0
        self._cache = Path(tempfile.gettempdir()) / 'beermat-desk-sounds'
        self._cache.mkdir(exist_ok=True)
        self.enabled = False      # sounds play while the TV is open (as Electron's TV window), see Main.qml
        self._tick = QTimer(self, interval=200, timeout=self._countdown_cue)
        self._tick.start()
        self._wheel_id, self._wheel_turn, self._wheel_timers = None, 0.0, []
        self._pegs, self._peg = [], 0
        self._tv_on_screen = False
        # TV screens (BeerMat on the computer wired to the TVs, tvscreen.py): the desk's own playback is sent there
        # (relay(action, src, position_ms), through the quiz server) and plays here silently, so the desk still knows
        # when a clip or song ends. screens: how many are connected.
        self.screens = 0
        self.relay = None
        self._followed = None     # the last relayed playback this TV screen acted on

    onChanged = Signal()

    def _get_on(self):
        return self.enabled

    def _set_on(self, on):
        if on != self.enabled:
            self.enabled = on
            if not on:
                self.stop_all(); self._music = False
            self.onChanged.emit()

    on = Property(bool, _get_on, _set_on, notify=onChanged)

    # ---- output device ----
    @Property('QVariantList', notify=outputsChanged)
    def outputs(self):
        return [{'id': bytes(d.id()).decode(errors='replace'), 'name': d.description()} for d in QMediaDevices.audioOutputs()]

    @Property(str, notify=outputsChanged)
    def output(self):
        """'auto' (the default, as the Electron app): the TV's own HDMI or DisplayPort sound while the TV is full screen on
        its screen, otherwise the system's default; 'laptop': always the system's default; or one output's id."""
        chosen = self._prefs.value('tvSound', 'auto', str)
        return 'laptop' if chosen == '' else chosen

    tvOnScreenChanged = Signal()

    def _get_tv_on_screen(self):
        return self._tv_on_screen

    def _set_tv_on_screen(self, on):
        if on != self._tv_on_screen:
            self._tv_on_screen = on
            self._apply_output()
            self.tvOnScreenChanged.emit()
            self.outputsChanged.emit()

    tvOnScreen = Property(bool, _get_tv_on_screen, _set_tv_on_screen, notify=tvOnScreenChanged)

    @Property(str, notify=outputsChanged)
    def activeOutput(self):
        """The output's name sounds go to now, for the desk."""
        return self._device().description()

    @Slot(str)
    def chooseOutput(self, device_id):
        self._prefs.setValue('tvSound', device_id)
        self._apply_output()
        self.outputsChanged.emit()

    def _device(self):
        chosen, outputs = self.output, QMediaDevices.audioOutputs()
        if chosen == 'auto':
            tv = next((d for d in outputs if TV_OUTPUT.search(d.description()) or TV_OUTPUT.search(bytes(d.id()).decode(errors='replace'))), None) if self._tv_on_screen else None
            return tv or QMediaDevices.defaultAudioOutput()
        return next((d for d in outputs if bytes(d.id()).decode(errors='replace') == chosen), QMediaDevices.defaultAudioOutput())

    def _apply_output(self):
        device = self._device()
        for _, out in self._players.values():
            out.setDevice(device)
        # QSoundEffect takes its device when made: the wheel's pegs are made again for the new output.
        self._pegs = []

    @Slot()
    def test(self):
        """The desk's Test sound button: a short chime on the TV's output, even with the TV closed."""
        was, self.enabled = self.enabled, True
        self.play_file(self._synth_file('test-chime', [(784, 0), (988, 0.15), (1175, 0.3)], 'triangle', 0.15, 0.3))
        self.enabled = was

    # ---- playing ----
    def _url(self, src):
        return QUrl(src) if src.startswith(('http:', 'https:', 'file:')) else QUrl(self.base + src)

    def _player(self, src):
        if src not in self._players:
            player, out = QMediaPlayer(self), QAudioOutput(self)
            out.setDevice(self._device())
            out.setMuted(MUTED)
            player.setAudioOutput(out)
            player.setSource(self._url(src))
            self._players[src] = (player, out)
        return self._players[src][0]

    def play_file(self, src, loop=False, position_ms=0):
        if not self.enabled or not src:
            return None
        player = self._player(src)
        player.setLoops(QMediaPlayer.Loops.Infinite if loop else 1)
        player.setPosition(position_ms)
        player.play()
        return player

    # ---- the desk's own playback: sound clips, music bingo songs, an audio question played again ----
    def _relaying(self):
        return bool(self.screens and self.relay)

    def desk_play(self, src, position_ms=0):
        """Plays one of the quiz's files for the desk: on the TV screens when there are any (silently here, to keep
        time), otherwise here, as any other sound."""
        if not src:
            return None
        if not self._relaying():
            if src in self._players:
                self._players[src][1].setMuted(MUTED)
            return self.play_file(src, position_ms=position_ms)
        player = self._player(src)
        self._players[src][1].setMuted(True)
        player.setLoops(1)
        player.setPosition(position_ms)
        player.play()
        self.relay('play', src, position_ms)
        return player

    def desk_pause(self, src):
        player = self._players.get(src, (None,))[0]
        if player:
            player.pause()
            if self._relaying():
                self.relay('pause', src, player.position())

    def desk_resume(self, src):
        player = self._players.get(src, (None,))[0]
        if player:
            player.play()
            if self._relaying():
                self.relay('resume', src, player.position())

    def desk_stop(self, src):
        player = self._players.get(src, (None,))[0]
        if player:
            player.stop()
            if self._relaying():
                self.relay('stop', src, 0)

    def follow_playback(self, playback, now_ms):
        """A TV screen: plays what the desk relayed (once each), from where it would be by now."""
        if not playback:
            # Nothing relayed yet: whatever comes next is new.
            if self._followed is None:
                self._followed = 0
            return
        if playback.get('seq') == self._followed:
            return
        # What was relayed before this screen connected has been and gone: only new playback plays.
        first = self._followed is None
        self._followed = playback.get('seq')
        src, action = playback.get('media') or '', playback.get('action')
        if action == 'play' and not first:
            self.play_file(src, position_ms=int(playback.get('position', 0) + max(0, now_ms - playback.get('at', now_ms))))
        elif action == 'resume' and not first and src in self._players:
            player = self._players[src][0]
            player.setPosition(int(playback.get('position', 0)))
            player.play()
        elif action in ('pause', 'stop') and src in self._players:
            self._players[src][0].pause() if action == 'pause' else self._players[src][0].stop()

    def play(self, slot, loop=False):
        src = self._pack.get('slots', {}).get(slot)
        if not src or not self.enabled:
            return False
        self.play_file(src, loop)
        self.played.emit(slot)
        return True

    def stop(self, slot):
        src = self._pack.get('slots', {}).get(slot)
        if src in self._players:
            self._players[src][0].stop()

    def stop_all(self):
        for player, _ in self._players.values():
            player.stop()
        self.stop_wheel()

    def _synth_file(self, key, notes, shape, gain=0.12, length=0.22):
        path = self._cache / f'{key}.wav'
        if not path.exists():
            synth(path, notes, shape, gain, length)
        return QUrl.fromLocalFile(str(path)).toString()

    def buzz(self, name='', sound=None):
        """A team's buzzer: one of the synthesised eight (by choice, or picked from its name) or a pack's file."""
        if sound is not None and sound >= len(SYNTH):
            custom = (self._pack.get('buzzers') or [])[sound - len(SYNTH):][:1]
            if custom:
                self.play_file(custom[0].get('media'))
            return
        label, shape, notes = SYNTH[sound if sound is not None else sum(ord(c) for c in name) % len(SYNTH)]
        self.play_file(self._synth_file(f'buzzer-{label}', [(f, i * 0.13) for i, f in enumerate(notes)], shape))
        self.played.emit('buzzer')

    def fanfare(self):
        if not self.play('applause'):
            self.play_file(self._synth_file('fanfare', FANFARE, 'triangle', 0.15, 0.3))
            self.played.emit('fanfare')

    # ---- the wheel's pegs ----
    def _peg_sounds(self):
        if not self._pegs:
            path = self._cache / 'wheel-tick.wav'
            if not path.exists():
                tick_file(path)
            for _ in range(3):   # a few, taking turns, so quick ticks don't cut each other off
                effect = QSoundEffect(self._device(), self)
                effect.setSource(QUrl.fromLocalFile(str(path)))
                effect.setVolume(0.6)
                effect.setMuted(MUTED)
                self._pegs.append(effect)
        return self._pegs

    def _knock(self):
        if not self.enabled:
            return
        pegs = self._peg_sounds()
        pegs[self._peg % len(pegs)].play()
        self._peg += 1
        self.played.emit('wheelTick')

    def stop_wheel(self):
        for timer in self._wheel_timers:
            timer.stop()
        self._wheel_timers = []

    def _follow_wheel(self, s, first):
        """A new spin seen happening ticks as the native TV's wheel turns; one already shown when the TV opens doesn't."""
        wheel = s.get('wheel')
        if s.get('view') != 'wheel':
            self.stop_wheel()
        if not wheel or wheel.get('id') == self._wheel_id or not wheel.get('items'):
            return
        slice_ = 360 / len(wheel['items'])
        target = 360 - (wheel['result'] + 0.5) * slice_
        fresh = not first and self._now() - wheel.get('spun', 0) < 3000
        self._wheel_id = wheel['id']
        if not fresh:
            self._wheel_turn = target
            return
        start = self._wheel_turn
        end = start - (start % 360) + 360 * 6 + target
        self._wheel_turn = end
        self.stop_wheel()
        for ms in wheel_crossings(start, end, slice_):
            timer = QTimer(self, singleShot=True, interval=int(ms), timeout=self._knock)
            timer.start()
            self._wheel_timers.append(timer)

    def duration_ms(self, slot):
        """How long a moment's sound is (0 until it has loaded): the reveal waits for the drum roll."""
        src = self._pack.get('slots', {}).get(slot)
        return self._player(src).duration() if src else 0

    # ---- following the quiz (soundCues in web/client.js) ----
    @staticmethod
    def _quiet(q):
        return q['type'] in QUIET_TYPES or q.get('playsSong') or str(q.get('media') or '').lower().endswith(AUDIO_FILE)

    def follow(self, s):
        """Called with every new public state (the TV's): plays what changed since the last one."""
        self._state, self._offset = s, s.get('offset', 0)
        if s.get('sounds'):
            self._pack = s['sounds']
            # The final countdown's length must be known before it's due.
            if self._pack.get('slots', {}).get('countdown'):
                self._player(self._pack['slots']['countdown'])
            if self._pack.get('slots', {}).get('reveal'):
                self._player(self._pack['slots']['reveal'])
        q, before = s.get('question'), self._heard
        bingo = (q or {}).get('bingo') or {}
        self._heard = heard = {
            'id': (q or {}).get('id'), 'round': (q or {}).get('round'), 'open': bool((q or {}).get('open')),
            'revealing': bool((q or {}).get('revealing')), 'revealed': bool((q or {}).get('revealed')), 'calls': bingo.get('count', 0),
            'shouts': {x['id']: x['status'] for x in bingo.get('shouts') or []},
            'buzz': {b['team']: b['status'] for b in ((q or {}).get('buzz') or {}).get('queue') or []},
            'leader': (((q or {}).get('buzz') or {}).get('active') or {}).get('name', ''),
            'fastTrack': (s.get('fastTrack') or {}).get('id'), 'varCheck': (s.get('varCheck') or {}).get('id'),
            'view': s.get('view'), 'boardLeader': (s.get('reveal') or {}).get('question') if (s.get('reveal') or {}).get('leader') else None,
            'winner': ' & '.join(t['name'] for t in s.get('teams', []) if t.get('rank') == 1) if s.get('view') == 'winner' else ''}
        self._follow_wheel(s, before is None)
        music = bool(q and q.get('open') and not q.get('paused') and not self._quiet(q) and self._countdown_for != q.get('id'))
        if music != self._music:
            self._music = music
            self.play('timerMusic', True) if music else self.stop('timerMusic')
        if before is None:
            return
        if s.get('view') == 'leaderboard' and before['view'] == 'question' and s.get('settings', {}).get('displayMode') == 'auto':
            self.play('endRound')
        if heard['winner'] and heard['winner'] != before['winner']:
            self.fanfare()
        # The spotlights (TvStage's) play the team's own buzzer, as the browser TV: first place in the leaderboard
        # reveal (joint leaders one after another), and a Fast Track into first place.
        if heard['boardLeader'] and heard['boardLeader'] != before['boardLeader']:
            for i, team in enumerate([t for t in s.get('teams') or [] if t.get('rank') == 1][:4]):
                QTimer.singleShot(600 + i * 2500, lambda team=team: self.buzz(team.get('name', ''), team.get('sound')))
        if heard['fastTrack'] is not None and heard['fastTrack'] != before['fastTrack']:
            self.buzz(s['fastTrack'].get('name', ''), s['fastTrack'].get('sound'))
        # VAR Check: a drum roll while it's checked, then the decision (TvStage's spotlight shows the same).
        if heard['varCheck'] is not None and heard['varCheck'] != before['varCheck']:
            self.play('reveal')
            overturned = s['varCheck'].get('status') == 'overturned'
            QTimer.singleShot(3000, lambda: self.play('correct' if overturned else 'wrong'))
        jingle = ''
        if q and q.get('id') != before['id'] and q.get('live'):
            if q.get('round') and q['round'] != before['round'] and self.play('startRound'):
                jingle = 'startRound'
            elif self.play('questionStart'):
                jingle = 'questionStart'
        # An audio question's sound plays as the question opens (or is sent), once its jingle has finished.
        media = str((q or {}).get('media') or '')
        if q and media.lower().endswith(AUDIO_FILE) and heard['open'] and (q.get('id') != before['id'] or not before['open']):
            QTimer.singleShot(min(4000, self.duration_ms(jingle) if jingle else 0), lambda: self.play_file(media))
        if not q or q.get('id') != before['id']:
            return
        if heard['leader'] and heard['leader'] != before['leader']:
            active = q['buzz']['active']
            self.buzz(active.get('name', ''), active.get('sound'))
        if before['open'] and not heard['open'] and q['type'] not in ('buzzer', 'bingo', 'musicbingo', 'clips') and self._countdown_for != q['id']:
            self.play('timeUp')
        if heard['revealing'] and not before['revealing']:
            self.play('reveal')
        # The fastest (or closest) team's spotlight at the reveal.
        if heard['revealed'] and not before['revealed'] and q.get('first'):
            self.buzz(q['first'].get('name', ''), q['first'].get('sound'))
        for team, status in heard['buzz'].items():
            if status != before['buzz'].get(team):
                if status == 'correct':
                    self.play('correct')
                if status == 'wrong':
                    self.play('wrong')
        if q['type'] == 'bingo' and heard['calls'] > before['calls']:
            self.play('bingoCall')
            if bingo.get('voice'):
                QTimer.singleShot(250, lambda voice=bingo['voice']: self.play_file(voice))
        for shout, status in heard['shouts'].items():
            if status != before['shouts'].get(shout):
                if status == 'pending':
                    self.play('bingo')
                else:
                    self.stop('bingo')
                    self.play('correct' if status == 'correct' else 'wrong')

    def _countdown_cue(self):
        """The final countdown is started so that it ends at the deadline; the answering music stops as it starts."""
        s = self._state or {}
        q = s.get('question')
        timed = bool(q and q.get('open') and not q.get('paused') and not self._quiet(q))
        src = self._pack.get('slots', {}).get('countdown')
        if not timed:
            if self._countdown_for is not None:
                left = (q or {}).get('deadline', 0) - self._now() if q else 0
                if not q or q.get('paused') or left > 300:
                    self.stop('countdown')
                self._countdown_for = None
            return
        left = q['deadline'] - self._now()
        if self._countdown_for == q['id'] or not src or left <= 300:
            return
        player = self._player(src)
        zero = min(10000, player.duration()) if player.duration() > 0 else 0
        if zero and left <= zero:
            self._countdown_for = q['id']
            self.stop('timerMusic'); self._music = False
            self.play_file(src, position_ms=int(max(0, zero - left)))
            self.played.emit('countdown')

    def _now(self):
        import time
        return time.time() * 1000 + self._offset
