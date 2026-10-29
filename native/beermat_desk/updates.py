"""Updates for BeerMat Desk. The quiz server checks BeerMat's signed manifest and downloads the new version's file,
checked (server/updates.js); this installs it and restarts:

* installed on Windows (Inno Setup, beermat-desk.iss): the new installer runs silently, closes this desk and starts
  the new one;
* the Linux AppImage: the new AppImage takes the old one's place (the same path, so menu entries keep working) and
  starts;
* anything else (the Windows zip, the Linux tar.gz, run from source): the desk says a new version is out and opens the
  download page.

It checks when the desk starts and twice a day, quietly (no internet, no fuss), and on Check for updates in Settings.
Never in the middle of a question: the quiz is saved, but a restart would cut teams off while they answer."""
import os
import shutil
import sys
from pathlib import Path

from PySide6.QtCore import Property, QObject, QProcess, QTimer, QUrl, Signal, Slot
from PySide6.QtGui import QDesktopServices

INSTALLS_ITSELF = ('windows-installer', 'linux-appimage')


def install_kind():
    """Which file of a release updates this desk: None when it runs from source."""
    if not getattr(sys, 'frozen', False):
        return None
    if sys.platform == 'win32':
        return 'windows-installer' if any(Path(sys.executable).parent.glob('unins*.exe')) else 'windows-zip'
    return 'linux-appimage' if os.environ.get('APPIMAGE') else 'linux-tar'


def replace_appimage(new, appimage):
    """The new AppImage in the old one's place: copied beside it, then renamed over it (a running AppImage can be
    replaced on Linux; it keeps running from the old file until it exits)."""
    appimage = Path(appimage)
    staging = appimage.with_name(f'.{appimage.name}.new')
    shutil.copyfile(new, staging)
    staging.chmod(0o755)
    os.replace(staging, appimage)
    Path(new).unlink(missing_ok=True)


class Updates(QObject):
    changed = Signal()
    toast = Signal(str, bool)
    restart = Signal()          # the new version is on its way: close this desk

    def __init__(self, api, busy, parent=None, kind=...):
        super().__init__(parent)
        self.api, self.busy = api, busy          # busy(): why not now ('' when it's fine)
        self.kind = install_kind() if kind is ... else kind
        self._info, self._state, self._message = {}, '', ''
        self._timer = QTimer(self, interval=12 * 3600 * 1000, timeout=lambda: self.check(True))

    def start(self):
        """The desk is unlocked: check now, quietly, and twice a day."""
        self.check(True)
        self._timer.start()

    # ---- for QML ----
    @Property(str, notify=changed)
    def current(self):
        return self._info.get('current', '')

    @Property(str, notify=changed)
    def latest(self):
        return self._info.get('latest', '') if self._info.get('available') else ''

    @Property(bool, notify=changed)
    def canInstall(self):
        """A newer version this desk installs itself (otherwise: the download page)."""
        return bool(self._info.get('available') and self._info.get('file') and self.kind in INSTALLS_ITSELF)

    @Property(str, notify=changed)
    def state(self):
        return self._state       # '', 'checking', 'downloading', 'installing'

    @Property(str, notify=changed)
    def message(self):
        return self._message

    def _set(self, state, message=None):
        self._state = state
        if message is not None:
            self._message = message
        self.changed.emit()

    @Slot()
    def checkNow(self):
        self.check(False)

    def check(self, quiet):
        if self._state in ('downloading', 'installing'):
            return
        self._set('checking', 'Checking for updates…' if not quiet else None)

        def done(info):
            self._info = info
            if info.get('error'):
                self._set('', '' if quiet else f'Couldn’t check for updates: {info["error"]}')
                if not quiet:
                    self.toast.emit(self._message, True)
            elif info.get('available'):
                how = 'Update and restart when you’re ready.' if self.canInstall else 'Download it from the BeerMat website.'
                self._set('', f'BeerMat Desk {info["latest"]} is out. {how}')
            else:
                self._set('', f'BeerMat Desk {info.get("current", "")} is the latest version.')
                if not quiet:
                    self.toast.emit(self._message, False)

        def failed(message):
            self._set('', '' if quiet else f'Couldn’t check for updates: {message}')
        self.api.host('update/check', {'kind': self.kind}, done, failed, timeout_ms=30000)

    @Slot()
    def openDownloads(self):
        QDesktopServices.openUrl(QUrl(self._info.get('page') or 'https://beermatquiz.co.uk/download/'))

    @Slot()
    def install(self):
        if not self.canInstall or self._state:
            return
        why = self.busy()
        if why:
            self.toast.emit(why, True)
            return
        self._set('downloading', f'Downloading BeerMat Desk {self.latest}…')

        def downloaded(info):
            why = self.busy()
            if why:
                self._set('', f'BeerMat Desk {info["version"]} is downloaded: {why[0].lower() + why[1:]}')
                self.toast.emit(why, True)
                return
            self._set('installing', f'Installing BeerMat Desk {info["version"]}…')
            try:
                self.apply(info['path'])
            except OSError as error:
                self._set('', f'The update couldn’t be installed: {error}')
                self.toast.emit(self._message, True)
                return
            self.restart.emit()

        def failed(message):
            self._set('', f'The update didn’t download: {message}')
            self.toast.emit(self._message, True)
        self.api.host('update/download', {'kind': self.kind}, downloaded, failed, timeout_ms=30 * 60 * 1000)

    def apply(self, path):
        """Start the new version's install; the desk closes straight after."""
        if self.kind == 'windows-installer':
            # /UPDATE=1: the installer starts the new desk when it's done (beermat-desk.iss).
            started, _pid = QProcess.startDetached(path, ['/SILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/CLOSEAPPLICATIONS', '/UPDATE=1'])
            if not started:
                raise OSError('the installer didn’t start')
        elif self.kind == 'linux-appimage':
            appimage = os.environ['APPIMAGE']
            replace_appimage(path, appimage)
            # Started once this desk has gone (one desk at a time: a second one would only bring this one forward).
            QProcess.startDetached('/bin/sh', ['-c', 'while kill -0 "$1" 2>/dev/null; do sleep 0.3; done; exec "$2"', 'sh', str(os.getpid()), appimage])
