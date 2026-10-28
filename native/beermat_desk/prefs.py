"""Settings that live on the quiz server, as the web desk's Settings tab: the quiz room (name, team limit, language,
the desk on the online link, sharing results), the sound pack (a sound for each moment, extra buzzer sounds), the
bingo calls, and Spotify for music rounds (Spotify Connect: the Spotify app on this laptop plays, the server tells it
what; private quizzes only, see the warning on the panel)."""
import json
from pathlib import Path

from PySide6.QtCore import Property, QObject, QUrl, Signal, Slot
from PySide6.QtGui import QDesktopServices

# The moments a sound pack covers (web/soundnames.js slotFiles), with the desk's names for them.
SLOTS = [('startRound', 'Start of a round'), ('questionStart', 'Question starts'), ('timerMusic', 'Music while answering'),
         ('countdown', 'Final countdown (10 s)'), ('timeUp', "Time's up"), ('reveal', 'Drum roll before the answer'),
         ('correct', 'Right'), ('wrong', 'Wrong'), ('endRound', 'End of a round'), ('bingoCall', 'Bingo number called'),
         ('bingo', 'Someone shouts bingo'), ('applause', 'Applause for the winner')]
VALUES = {'title', 'maxTeams', 'language', 'deskOnline', 'shareResults'}
AUDIO = {'.mp3', '.ogg', '.wav'}


class Prefs(QObject):
    spotifyChanged = Signal()

    def __init__(self, desk):
        super().__init__(desk)
        self.desk, self.api = desk, desk.api
        self._spotify = {}

    def _fail(self, error):
        self.desk.toast.emit(error, True)

    def _done(self, text):
        return lambda _: (self.desk.toast.emit(text, False), self.desk.refresh())

    # ---- the quiz room ----
    @Slot(str, 'QVariant')
    def set(self, key, value):
        if key in VALUES:
            if key == 'maxTeams':
                value = int(value)
            self.api.host('settings', {key: value}, self._done('Saved'), self._fail)

    # ---- sound pack ----
    @Property('QVariantList', constant=True)
    def slots(self):
        return [{'slot': s, 'label': label} for s, label in SLOTS]

    def _upload(self, url, then):
        path = Path(url.toLocalFile() if isinstance(url, QUrl) else str(url))
        if path.suffix.lower() not in AUDIO:
            return self._fail('Choose an MP3, Ogg or WAV file')
        try:
            data = path.read_bytes()
        except OSError as e:
            return self._fail(f'Could not read {path.name}: {e}')
        self.api.upload(data, f'sound{path.suffix.lower()}', lambda media: then(media, path.stem), self._fail)

    @Slot(str, QUrl)
    def setSound(self, slot, url):
        self._upload(url, lambda media, _: self.api.host('sounds', {'slots': {slot: media}}, self._done('Sound saved'), self._fail))

    @Slot(str)
    def clearSound(self, slot):
        self.api.host('sounds', {'slots': {slot: None}}, self._done('Sound removed'), self._fail)

    @Slot(str, QUrl)
    def addBuzzer(self, name, url):
        buzzers = list(((self.desk._state or {}).get('sounds') or {}).get('buzzers') or [])
        self._upload(url, lambda media, stem: self.api.host('sounds', {'buzzers': buzzers + [{'name': (name or stem)[:60], 'media': media}]},
                                                           self._done('Buzzer sound added'), self._fail))

    @Slot(int)
    def removeBuzzer(self, index):
        buzzers = list(((self.desk._state or {}).get('sounds') or {}).get('buzzers') or [])
        if 0 <= index < len(buzzers):
            del buzzers[index]
            self.api.host('sounds', {'buzzers': buzzers}, self._done('Buzzer sound removed'), self._fail)

    @Slot(str)
    def preview(self, media):
        """Hear a sound on the TV's output."""
        self.desk.tvSound.play_file(media) if self.desk.tvSound.enabled else self._preview_anyway(media)

    def _preview_anyway(self, media):
        on = self.desk.tvSound.enabled
        self.desk.tvSound.enabled = True
        self.desk.tvSound.play_file(media)
        self.desk.tvSound.enabled = on

    # ---- bingo calls ----
    @Slot(QUrl)
    def importCalls(self, url):
        """90 calls, one per line (or a JSON list of 90); an empty line keeps the built-in call for that number."""
        path = Path(url.toLocalFile() if isinstance(url, QUrl) else str(url))
        try:
            text = path.read_text(encoding='utf-8-sig')
            calls = json.loads(text) if text.lstrip().startswith('[') else text.splitlines()
        except (OSError, ValueError) as e:
            return self._fail(f'Could not read {path.name}: {e}')
        if len(calls) != 90 or not all(isinstance(c, str) for c in calls):
            return self._fail(f'Bingo calls need 90 lines; {path.name} has {len(calls)}')
        self.api.host('bingo-calls', {'calls': calls}, self._done(f'{sum(1 for c in calls if c.strip())} bingo calls imported'), self._fail)

    @Slot()
    def defaultCalls(self):
        self.api.host('bingo-calls', {'calls': None}, self._done('Back to the built-in bingo calls'), self._fail)

    # ---- Spotify (Spotify Connect) ----
    @Property('QVariantMap', notify=spotifyChanged)
    def spotify(self):
        return self._spotify

    @Slot()
    def loadSpotify(self):
        if self.api.session:
            self.api.host('spotify/status', {}, lambda s: (setattr(self, '_spotify', s), self.spotifyChanged.emit()),
                          lambda e: (setattr(self, '_spotify', {'error': e}), self.spotifyChanged.emit()), timeout_ms=20000)

    @Slot(str)
    def connectSpotify(self, client_id):
        """Spotify's sign-in opens in the browser and returns to this quiz server (its redirect address)."""
        self.api.host('spotify/connect', {'clientId': client_id.strip()}, lambda r: QDesktopServices.openUrl(QUrl(r['url'])), self._fail)

    @Slot()
    def disconnectSpotify(self):
        self.api.host('spotify/disconnect', {}, lambda _: (self.desk.toast.emit('Spotify disconnected', False), self.loadSpotify()), self._fail)

    @Slot(str)
    def chooseSpotifyDevice(self, device):
        self.api.host('spotify/device', {'id': device}, lambda _: self.loadSpotify(), self._fail)
