"""Settings that live on the quiz server, as the web desk's Settings tab: the quiz room (name, team limit, language,
the desk on the online link, sharing results), the sound pack (a sound for each moment, extra buzzer sounds), the
bingo calls, and Spotify for music rounds (Spotify Connect: the Spotify app on this laptop plays, the server tells it
what; private quizzes only, see the warning on the panel)."""
import json
from pathlib import Path

from PySide6.QtCore import Property, QObject, QTimer, QUrl, Signal, Slot
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
    libraryChanged = Signal()
    themesChanged = Signal()
    quizzesChanged = Signal()
    myQuizzesChanged = Signal()

    def __init__(self, desk):
        super().__init__(desk)
        self.desk, self.api = desk, desk.api
        self._spotify = {}
        self._library = {}
        self._themes = {}
        self._quizzes = {}
        self._my_quizzes = {}
        # After "Connect Spotify" the sign-in finishes in the browser, which the desk can't see: it asks the server every
        # two seconds until Spotify says connected (or three minutes pass).
        self._waiting = QTimer(self, interval=2000)
        self._waiting.timeout.connect(self._check_connected)
        self._wait_until = 0

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

    # ---- looks and sound themes (themes/<id>/: colours for the TV and phones, and a set of sounds) ----
    @Slot(str)
    def setLook(self, look):
        """One look for every question, '@type' (each format its own) or '@random'."""
        self.api.host('settings', {'look': look}, self._done('Look saved'), self._fail)

    @Slot(str, str)
    def setLookFor(self, kind, look):
        self.api.host('settings', {'lookByType': {kind: look}}, self._done('Look saved'), self._fail)

    @Slot(str)
    def setSoundTheme(self, theme):
        """'' (the pack's own sounds), a theme, '@type' or '@random'. Choosing one puts every moment back to its sounds."""
        self.api.host('settings', {'soundTheme': theme}, self._done('Sound theme saved'), self._fail)

    @Slot(str, str)
    def setThemeFor(self, kind, theme):
        self.api.host('settings', {'soundThemeByType': {kind: theme}}, self._done('Sound theme saved'), self._fail)

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

    # ---- the shared buzzer library (BeerMat Online), as the web desk's: everyone sees what's in it; BeerMat Pro
    # plays, adds and shares clips. The server talks to BeerMat Online. ----
    @Property('QVariantMap', notify=libraryChanged)
    def library(self):
        return self._library

    @Slot(str)
    def searchLibrary(self, query):
        self._library = {**self._library, 'loading': True, 'query': query}
        self.libraryChanged.emit()

        def got(reply):
            self._library = {**reply, 'query': query, 'loading': False}
            self.libraryChanged.emit()

        def failed(error):
            self._library = {**self._library, 'loading': False, 'error': error}
            self.libraryChanged.emit()
        self.api.host('buzzer-library', {'q': query}, got, failed, timeout_ms=20000)

    @Slot(str)
    def playLibraryBuzzer(self, buzzer):
        """Heard on the TV's output (as the desk's other previews), from a temporary copy of the clip."""
        import base64
        import tempfile

        def got(clip):
            path = Path(tempfile.gettempdir()) / f'beermat-library-{buzzer}.mp3'
            path.write_bytes(base64.b64decode(clip['audio']))
            self._preview_anyway(QUrl.fromLocalFile(str(path)).toString())
        self.api.host('buzzer-library/play', {'id': buzzer}, got, self._fail, timeout_ms=20000)

    @Slot(str)
    def addLibraryBuzzer(self, buzzer):
        self.api.host('buzzer-library/add', {'id': buzzer},
                      lambda r: (self.desk.toast.emit(f'“{r["name"]}” added: teams can pick it in their phone menu', False), self.desk.refresh()), self._fail, timeout_ms=20000)

    @Slot(str, str)
    def reportLibraryBuzzer(self, buzzer, reason):
        if reason.strip():
            self.api.host('buzzer-library/report', {'id': buzzer, 'reason': reason.strip()},
                          lambda _: self.desk.toast.emit('Reported: thanks. BeerMat will look at it.', False), self._fail, timeout_ms=20000)

    @Slot(str)
    def removeLibraryBuzzer(self, buzzer):
        self.api.host('buzzer-library/remove', {'id': buzzer},
                      lambda _: (self.desk.toast.emit('Taken out of the library', False), self.searchLibrary(self._library.get('query', ''))), self._fail, timeout_ms=20000)

    @Slot(QUrl, str, bool)
    def shareLibraryBuzzer(self, url, name, rights):
        path = Path(url.toLocalFile() if isinstance(url, QUrl) else str(url))
        if not rights:
            return self._fail('Tick that you have the right to share this clip')
        try:
            if path.stat().st_size > 2 * 1024 * 1024:
                return self._fail('Clips up to 2 MB can be shared: use a shorter one')
        except OSError as e:
            return self._fail(f'Could not read {path.name}: {e}')
        self._upload(url, lambda media, stem: self.api.host(
            'buzzer-library/share', {'name': (name.strip() or stem)[:60], 'media': media, 'rights': True},
            lambda r: (self.desk.toast.emit(f'“{r["name"]}” shared with other BeerMat venues', False), self.searchLibrary(self._library.get('query', ''))),
            self._fail, timeout_ms=30000))

    # ---- the theme library (BeerMat Online), and this laptop's own themes (my-themes/ in its data folder) ----
    @Property('QVariantMap', notify=themesChanged)
    def themes(self):
        return self._themes

    @Slot(str)
    def searchThemes(self, query):
        self._themes = {**self._themes, 'loading': True, 'query': query, 'error': ''}
        self.themesChanged.emit()

        def got(reply):
            self._themes = {**reply, 'query': query, 'loading': False, 'error': ''}
            self.themesChanged.emit()

        def failed(error):
            self._themes = {**self._themes, 'loading': False, 'error': error}
            self.themesChanged.emit()
        self.api.host('theme-library', {'q': query}, got, failed, timeout_ms=30000)

    def _themes_changed(self, message):
        """After installing or removing: the desk's looks (the TV's colours and scenery) and the list, read again."""
        self.desk.toast.emit(message, False)
        self.desk.reload_looks()
        self.desk.refresh()
        self.searchThemes(self._themes.get('query', ''))

    @Slot(str)
    def installTheme(self, theme):
        self.api.host('theme-library/install', {'id': theme}, lambda r: self._themes_changed(f'“{r["name"]}” installed: choose it under Looks'), self._fail, timeout_ms=90000)

    @Slot(str)
    def uninstallTheme(self, theme):
        self.api.host('theme-library/uninstall', {'id': theme}, lambda _: self._themes_changed('Theme removed from this laptop'), self._fail)

    @Slot(str, result=str)
    def previewFile(self, kind):
        """Where the share dialog saves its picture of a theme (a JPEG in the temporary folder)."""
        import tempfile
        return str(Path(tempfile.gettempdir()) / f'beermat-theme-preview-{kind}.jpg')

    @Slot(str, bool, str, str)
    def shareTheme(self, theme, rights, tv, app):
        """Shares one of this laptop's themes, with the pictures the share dialog drew of it (the TV, the app)."""
        import base64
        previews = {}
        for kind, path in (('tv', tv), ('app', app)):
            try:
                previews[kind] = base64.b64encode(Path(path).read_bytes()).decode()
            except OSError:
                pass
        self.api.host('theme-library/share', {'id': theme, 'rights': rights, 'previews': previews},
                      lambda r: (self.desk.toast.emit(f'“{r["name"]}” sent: BeerMat looks at every theme before it’s in the library', False), self.searchThemes(self._themes.get('query', ''))),
                      self._fail, timeout_ms=150000)

    @Slot(str)
    def removeSharedTheme(self, theme):
        self.api.host('theme-library/remove', {'id': theme}, lambda _: (self.desk.toast.emit('Taken out of the library', False), self.searchThemes(self._themes.get('query', ''))), self._fail)

    @Slot(str, str)
    def reportTheme(self, theme, reason):
        if reason.strip():
            self.api.host('theme-library/report', {'id': theme, 'reason': reason.strip()},
                          lambda _: self.desk.toast.emit('Reported: thanks. BeerMat will look at it.', False), self._fail, timeout_ms=20000)

    @Slot()
    def openMyThemes(self):
        """The My themes folder, made if it isn't there yet, in the file manager."""
        folder = Path(self._themes.get('folder') or (self.desk.server.data_dir / 'my-themes'))
        folder.mkdir(parents=True, exist_ok=True)
        QDesktopServices.openUrl(QUrl.fromLocalFile(str(folder)))

    @Slot()
    def reloadThemes(self):
        """After editing a theme in My themes by hand: the server and the desk read it again."""
        self.api.host('theme-library', {'q': self._themes.get('query', ''), 'reload': True}, lambda r: (self._themes.update(r), self.desk.reload_looks(), self.themesChanged.emit()), self._fail)

    # ---- my quizzes: kept on this laptop (my-quizzes/), and downloaded from the quiz library (quiz-library/) ----
    @Property('QVariantMap', notify=myQuizzesChanged)
    def myQuizzes(self):
        return self._my_quizzes

    @Slot()
    def loadMyQuizzes(self):
        if not self.api.base:        # not connected to the quiz server yet
            return

        def got(reply):
            self._my_quizzes = reply
            self.myQuizzesChanged.emit()
        self.api.host('my-quizzes', {}, got, self._fail)

    @Slot(str, str)
    def deleteMyQuiz(self, kind, file):
        self.api.host('my-quizzes/delete', {'kind': kind, 'file': file}, lambda _: (self.desk.toast.emit('Quiz deleted from this laptop', False), self.loadMyQuizzes()), self._fail)

    @Slot(str)
    def loadQuizFile(self, path):
        self.desk.loadQuiz(QUrl.fromLocalFile(path))

    @Slot()
    def openMyQuizzes(self):
        folder = Path(self._my_quizzes.get('folder') or (self.desk.server.data_dir / 'my-quizzes'))
        folder.mkdir(parents=True, exist_ok=True)
        QDesktopServices.openUrl(QUrl.fromLocalFile(str(folder)))

    # ---- the quiz library (BeerMat Online) ----
    @Property('QVariantMap', notify=quizzesChanged)
    def quizzes(self):
        return self._quizzes

    @Slot(str)
    def searchQuizzes(self, query):
        self._quizzes = {**self._quizzes, 'loading': True, 'query': query, 'error': ''}
        self.quizzesChanged.emit()

        def got(reply):
            self._quizzes = {**reply, 'query': query, 'loading': False, 'error': ''}
            self.quizzesChanged.emit()

        def failed(error):
            self._quizzes = {**self._quizzes, 'loading': False, 'error': error}
            self.quizzesChanged.emit()
        self.api.host('quiz-library', {'q': query}, got, failed, timeout_ms=30000)

    def _quizzes_again(self):
        self.searchQuizzes(self._quizzes.get('query', ''))

    @Slot(str)
    def downloadQuiz(self, quiz):
        """Downloads a quiz to this laptop (quiz-library/ in its data folder) and loads it, as Load quiz file does: the
        desk asks first if a quiz is under way or has unsaved changes."""
        def got(reply):
            self._quizzes_again()
            self.desk.loadQuiz(QUrl.fromLocalFile(reply['path']))
        self.desk.toast.emit('Downloading the quiz…', False)
        self.api.host('quiz-library/download', {'id': quiz}, got, self._fail, timeout_ms=150000)

    @Slot(str, bool)
    def shareQuiz(self, description, rights):
        """Shares the quiz on this desk (the saved one, with its pictures and sounds)."""
        self.desk.toast.emit('Sending the quiz…', False)
        self.api.host('quiz-library/share', {'description': description, 'rights': rights},
                      lambda r: (self.desk.toast.emit(f'“{r["title"]}” sent: BeerMat looks at every quiz before it’s in the library', False), self._quizzes_again()),
                      self._fail, timeout_ms=200000)

    @Slot(str)
    def removeSharedQuiz(self, quiz):
        self.api.host('quiz-library/remove', {'id': quiz}, lambda _: (self.desk.toast.emit('Taken out of the library', False), self._quizzes_again()), self._fail)

    @Slot(str, str)
    def reportQuiz(self, quiz, reason):
        if reason.strip():
            self.api.host('quiz-library/report', {'id': quiz, 'reason': reason.strip()},
                          lambda _: self.desk.toast.emit('Reported: thanks. BeerMat will look at it.', False), self._fail, timeout_ms=20000)

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
            # A failed check keeps what was known (and the panel's buttons), with the error beside it.
            self.api.host('spotify/status', {}, self._got_spotify,
                          lambda e: self._got_spotify({**{k: v for k, v in self._spotify.items() if k != 'error'}, 'error': e}), timeout_ms=20000)

    def _got_spotify(self, status):
        was = bool(self._spotify.get('connected'))
        self._spotify = status
        self.spotifyChanged.emit()
        if status.get('connected') and self._waiting.isActive():
            self._waiting.stop()
            if not was:
                self.desk.toast.emit(f'Spotify connected{" as " + status["user"] if status.get("user") else ""}', False)

    def _check_connected(self):
        import time
        if time.monotonic() > self._wait_until:
            self._waiting.stop()
        else:
            self.loadSpotify()

    @Slot(str)
    def connectSpotify(self, client_id):
        """Spotify's sign-in opens in the browser and returns to this quiz server (its redirect address)."""
        import time

        def opened(reply):
            QDesktopServices.openUrl(QUrl(reply['url']))
            self._wait_until = time.monotonic() + 180
            self._waiting.start()
        self.api.host('spotify/connect', {'clientId': client_id.strip()}, opened, self._fail)

    @Slot()
    def disconnectSpotify(self):
        self.api.host('spotify/disconnect', {}, lambda _: (self.desk.toast.emit('Spotify disconnected', False), self.loadSpotify()), self._fail)

    @Slot(str)
    def chooseSpotifyDevice(self, device):
        self.api.host('spotify/device', {'id': device}, lambda _: self.loadSpotify(), self._fail)
