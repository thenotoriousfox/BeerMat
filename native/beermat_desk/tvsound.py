"""The TV's sound, played natively: the quizmaster's sound pack (a sound for each moment), the music while answering,
the final countdown timed to end at the deadline, the drum roll before a reveal, buzzer sounds, bingo chimes and the
spoken caller, applause for the winner, and the desk's own playback (sound clips, music bingo songs, audio questions).
Everything goes to one output, the TV's sound (chosen in Settings), as Electron's TV window does.

The moments follow soundCues() in web/client.js exactly, so a native TV and a web TV sound the same."""
import math
import struct
import tempfile
import wave
from pathlib import Path

from PySide6.QtCore import Property, QObject, QSettings, QTimer, QUrl, Signal, Slot
from PySide6.QtMultimedia import QAudioOutput, QMediaDevices, QMediaPlayer

# The synthesised buzzers (web/app.js `sounds`): name, wave, notes (0 is a rest), each note 0.13 s apart.
SYNTH = [('Classic buzz', 'square', [330, 495]), ('Doorbell', 'sine', [660, 523]), ('Siren', 'sawtooth', [440, 660, 440]),
         ('Beep beep', 'square', [880, 0, 880]), ('Low horn', 'sawtooth', [147, 147]), ('Chime', 'triangle', [784, 988, 1175]),
         ('Laser', 'square', [1200, 600, 300]), ('Boing', 'sine', [220, 440])]
FANFARE = [(523, 0), (659, 0.15), (784, 0.3), (1047, 0.45), (784, 0.7), (1047, 0.85)]
QUIET_TYPES = {'audio', 'clips', 'musicbingo', 'buzzer', 'bingo'}
AUDIO_FILE = ('.mp3', '.ogg', '.wav')


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


class TvSound(QObject):
    outputsChanged = Signal()
    played = Signal(str)      # which moment sounded (tests and the desk's log)

    def __init__(self, parent=None):
        super().__init__(parent)
        self._prefs = QSettings('BeerMat', 'BeerMat Desk')
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
        return self._prefs.value('tvSound', '', str)

    @Slot(str)
    def chooseOutput(self, device_id):
        self._prefs.setValue('tvSound', device_id)
        self._apply_output()
        self.outputsChanged.emit()

    def _device(self):
        chosen = self.output
        return next((d for d in QMediaDevices.audioOutputs() if bytes(d.id()).decode(errors='replace') == chosen), QMediaDevices.defaultAudioOutput())

    def _apply_output(self):
        device = self._device()
        for _, out in self._players.values():
            out.setDevice(device)

    # ---- playing ----
    def _url(self, src):
        return QUrl(src) if src.startswith(('http:', 'https:', 'file:')) else QUrl(self.base + src)

    def _player(self, src):
        if src not in self._players:
            player, out = QMediaPlayer(self), QAudioOutput(self)
            out.setDevice(self._device())
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
            'view': s.get('view'), 'boardDone': (s.get('reveal') or {}).get('question') if (s.get('reveal') or {}).get('done') else None,
            'winner': ' & '.join(t['name'] for t in s.get('teams', []) if t.get('rank') == 1) if s.get('view') == 'winner' else ''}
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
        if q and q.get('id') != before['id'] and q.get('live'):
            if not (q.get('round') and q['round'] != before['round'] and self.play('startRound')):
                self.play('questionStart')
        if not q or q.get('id') != before['id']:
            return
        if heard['leader'] and heard['leader'] != before['leader']:
            active = q['buzz']['active']
            self.buzz(active.get('name', ''), active.get('sound'))
        if before['open'] and not heard['open'] and q['type'] not in ('buzzer', 'bingo', 'musicbingo', 'clips') and self._countdown_for != q['id']:
            self.play('timeUp')
        if heard['revealing'] and not before['revealing']:
            self.play('reveal')
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
