"""BeerMat as a TV screen: the computer wired to the TVs shows the Qt TV, while the quizmaster's laptop runs the quiz.

It finds the laptop's quiz server as BeerMat TV on Android does (tv/TvFinder.kt): the last address that worked,
BeerMat's quiz Wi-Fi (Linux 10.42.0.1, Windows 192.168.137.1), then every address on this computer's own networks at
the desk's port, each asked /api/hello. The TV page answers on the venue's Wi-Fi as well as the quiz Wi-Fi, so either
works, and there's nothing to sign in to: a TV only shows what the room sees.

It plays all the TV's sound here: the moments (tvsound.py follows the TV's state) and the desk's own playback (sound
clips, music bingo songs, an audio question played again), which the desk sends through the quiz server while a TV
screen is connected. Looks the laptop installed from the theme library come from its quiz server too."""
import json
import time
from pathlib import Path

from PySide6.QtCore import Property, QObject, QSettings, QStandardPaths, QSysInfo, QTimer, QUrl, Signal, Slot
from PySide6.QtNetwork import QHostAddress, QNetworkAccessManager, QNetworkInterface, QNetworkRequest, QAbstractSocket

from . import looks
from .tvsound import TvSound

ROOT = Path(__file__).resolve().parents[2]
DESK_PORT = 3000
HOTSPOTS = ['10.42.0.1', '192.168.137.1']


def normalise(address):
    """'10.42.0.1', '10.42.0.1:3000' or 'http://…' as the quiz server's base URL ('' if it isn't one)."""
    address = (address or '').strip().rstrip('/')
    if not address:
        return ''
    if not address.startswith(('http://', 'https://')):
        address = 'http://' + address
    host = address.split('://', 1)[1]
    return address if ':' in host else f'{address}:{DESK_PORT}'


def neighbours(own, port=DESK_PORT):
    """Every other address on own's /24, at the desk's port."""
    parts = own.split('.')
    if len(parts) != 4 or not all(p.isdigit() for p in parts):
        return []
    prefix = '.'.join(parts[:3])
    return [f'http://{prefix}.{i}:{port}' for i in range(1, 255) if str(i) != parts[3]]


def own_addresses():
    """This computer's IPv4 addresses on its networks (not loopback, not link-local)."""
    out = []
    for address in QNetworkInterface.allAddresses():
        if address.protocol() == QAbstractSocket.NetworkLayerProtocol.IPv4Protocol and not address.isLoopback() \
                and not address.isInSubnet(QHostAddress('169.254.0.0'), 16):
            out.append(address.toString())
    return out


def image_paths(value):
    """Every 'image' a tv.json names (its scene's pictures), relative to the theme's folder."""
    if isinstance(value, dict):
        return [p for k, v in value.items() for p in ([v] if k == 'image' and isinstance(v, str) else image_paths(v))]
    if isinstance(value, list):
        return [p for v in value for p in image_paths(v)]
    return []


class TvScreen(QObject):
    tvChanged = Signal()
    statusChanged = Signal()
    looksChanged = Signal()
    roleRequested = Signal(str)     # 'desk': this computer becomes the quizmaster desk (__main__.py opens it again)
    quitRequested = Signal()

    def __init__(self, cache=None, parent=None):
        super().__init__(parent)
        self._prefs = QSettings()
        self._net = QNetworkAccessManager(self)
        self.sound = TvSound(self)
        self.sound.on = True
        self.sound.tvOnScreen = True          # the TV's own HDMI sound, when 'automatic'
        self._base = ''
        self._title = ''
        self._tv = {}
        self._found = []
        self._searching = False
        self._search = None
        self._stream = None
        self._buffer = b''
        self._connected = False
        self._fetching = False
        self._again = False
        self._retry = QTimer(self, singleShot=True, interval=2000, timeout=self._open_stream)
        # Looks: BeerMat's own (shipped here), then the laptop's colours and the scenery of its installed themes.
        self._palettes = looks.load(ROOT / 'themes')
        self._scenes = looks.scenes(ROOT / 'themes')
        self._cache = Path(cache or QStandardPaths.writableLocation(QStandardPaths.StandardLocation.CacheLocation)) / 'tv-screen-themes'
        self._asked_looks = set()
        self.name = QSysInfo.machineHostName() or 'TV screen'

    # ---- what QML shows ----
    @Property('QVariantMap', notify=tvChanged)
    def tv(self):
        return self._tv

    @Property(str, notify=statusChanged)
    def serverUrl(self):
        return self._base

    @Property(bool, notify=statusChanged)
    def connected(self):
        return self._connected

    @Property(bool, notify=statusChanged)
    def searching(self):
        return self._searching

    @Property('QVariantList', notify=statusChanged)
    def found(self):
        return self._found

    @Property(str, notify=statusChanged)
    def title(self):
        return self._title

    @Property(str, notify=statusChanged)
    def address(self):
        return self._base.split('://', 1)[-1]

    @Property(str, notify=statusChanged)
    def savedAddress(self):
        return self._prefs.value('tvScreen/address', '', str)

    @Property('QVariantMap', notify=looksChanged)
    def lookPalettes(self):
        return self._palettes

    @Property('QVariantMap', notify=looksChanged)
    def lookScenes(self):
        return self._scenes

    @Slot()
    def becomeDesk(self):
        self.roleRequested.emit('desk')

    @Slot()
    def quit(self):
        self.quitRequested.emit()

    # ---- finding the quiz ----
    @Slot()
    def search(self):
        """Asks every likely address for /api/hello; connects by itself to the last quiz, or the only one found."""
        saved = normalise(self.savedAddress)
        places = list(dict.fromkeys([p for p in [saved, *(normalise(h) for h in HOTSPOTS)] if p]
                                    + [n for own in own_addresses() for n in neighbours(own)]))
        run = self._search = {'left': len(places), 'found': []}
        self._found, self._searching = [], True
        self.statusChanged.emit()
        for base in places:
            request = QNetworkRequest(QUrl(f'{base}/api/hello'))
            request.setTransferTimeout(2500)
            reply = self._net.get(request)
            reply.finished.connect(lambda reply=reply, base=base: self._heard(run, base, reply))

    def _heard(self, run, base, reply):
        try:
            hello = json.loads(bytes(reply.readAll()) or b'{}')
        except ValueError:
            hello = {}
        reply.deleteLater()
        if run is not self._search:
            return
        run['left'] -= 1
        if hello.get('app') == 'BeerMat':
            run['found'].append({'address': base.split('://', 1)[1], 'title': hello.get('title') or 'BeerMat'})
            self._found = list(run['found'])
            self.statusChanged.emit()
            if normalise(self.savedAddress) == base and not self._connected:
                return self.connectTo(base)
        if run['left'] == 0:
            self._searching = False
            self.statusChanged.emit()
            if not self._connected and len(self._found) == 1:
                self.connectTo(self._found[0]['address'])

    @Slot(str)
    def connectTo(self, address):
        base = normalise(address)
        if not base:
            return
        self._search = None
        self._searching = False
        self._base = base
        self.sound.base = base
        self._prefs.setValue('tvScreen/address', base.split('://', 1)[1])
        self._load_palettes()
        self._open_stream()
        self.refresh()
        self.statusChanged.emit()

    @Slot()
    def forget(self):
        """Back to the list of quizzes (another laptop, say)."""
        self._base, self._connected, self._tv = '', False, {}
        if self._stream:
            self._stream.abort()
        self.sound.stop_all()
        self.tvChanged.emit()
        self.statusChanged.emit()
        self.search()

    # ---- following the TV ----
    def _open_stream(self):
        if not self._base:
            return
        if self._stream:
            self._stream.abort()
        request = QNetworkRequest(QUrl(f'{self._base}/api/events?screen={QUrl.toPercentEncoding(self.name).data().decode()}'))
        request.setRawHeader(b'Accept', b'text/event-stream')
        self._buffer = b''
        stream = self._stream = self._net.get(request)
        stream.readyRead.connect(lambda: self._read(stream))
        stream.finished.connect(lambda: self._ended(stream))

    def _read(self, stream):
        if stream is not self._stream:
            return
        self._buffer += bytes(stream.readAll())
        *events, self._buffer = self._buffer.split(b'\n\n')
        if any(b'data:' in e for e in events):
            self.refresh()

    def _ended(self, stream):
        if stream is self._stream:
            self._stream = None
            if self._connected:
                self._connected = False
                self.statusChanged.emit()
            self._retry.start()
        stream.deleteLater()

    @Slot()
    def refresh(self):
        if not self._base:
            return
        if self._fetching:
            self._again = True
            return
        self._fetching = True
        request = QNetworkRequest(QUrl(f'{self._base}/api/leaderboard'))
        request.setTransferTimeout(8000)
        reply = self._net.get(request)

        def done():
            self._fetching = False
            try:
                state = json.loads(bytes(reply.readAll()) or b'null')
            except ValueError:
                state = None
            reply.deleteLater()
            if isinstance(state, dict) and 'view' in state:
                self._show(state)
            if self._again:
                self._again = False
                self.refresh()
        reply.finished.connect(done)

    def _show(self, state):
        now = time.time() * 1000
        state['offset'] = state.get('serverTime', now) - now
        self._tv = state
        self._title = (state.get('settings') or {}).get('title') or self._title
        if not self._connected:
            self._connected = True
            self.statusChanged.emit()
        self.tvChanged.emit()
        self.sound.follow(state)
        self.sound.follow_playback(state.get('playback'), now + state['offset'])
        look = state.get('look')
        if look and look not in self._scenes and look not in self._asked_looks:
            self._fetch_scene(look)

    # ---- looks from the laptop ----
    def _load_palettes(self):
        """Every look's colours as the laptop has them (its installed themes too), from its /themes.css."""
        reply = self._net.get(QNetworkRequest(QUrl(f'{self._base}/themes.css')))

        def done():
            text = bytes(reply.readAll()).decode(errors='replace')
            reply.deleteLater()
            found = looks.palettes_from_css(text)
            if found:
                self._palettes = {**self._palettes, **found}
                self.looksChanged.emit()
        reply.finished.connect(done)

    def _fetch_scene(self, look):
        """An installed theme's tv.json and its pictures, kept in the cache, then drawn as on the laptop."""
        self._asked_looks.add(look)
        folder = self._cache / look
        reply = self._net.get(QNetworkRequest(QUrl(f'{self._base}/themes/{look}/tv.json')))

        def got_json():
            raw = bytes(reply.readAll())
            ok = reply.error() == reply.NetworkError.NoError
            reply.deleteLater()
            try:
                data = json.loads(raw) if ok else None
            except ValueError:
                data = None
            if not isinstance(data, dict):
                return
            folder.mkdir(parents=True, exist_ok=True)
            (folder / 'tv.json').write_bytes(raw)
            pictures = [p for p in dict.fromkeys(image_paths(data)) if '..' not in Path(p).parts and not p.startswith('/')]
            left = {'n': len(pictures)}
            if not pictures:
                return self._use_cached_scenes()
            for picture in pictures:
                r = self._net.get(QNetworkRequest(QUrl(f'{self._base}/themes/{look}/{picture}')))

                def saved(r=r, picture=picture):
                    if r.error() == r.NetworkError.NoError:
                        target = folder / picture
                        target.parent.mkdir(parents=True, exist_ok=True)
                        target.write_bytes(bytes(r.readAll()))
                    r.deleteLater()
                    left['n'] -= 1
                    if left['n'] == 0:
                        self._use_cached_scenes()
                r.finished.connect(saved)
        reply.finished.connect(got_json)

    def _use_cached_scenes(self):
        self._scenes = {**self._scenes, **looks.scenes(self._cache)}
        self.looksChanged.emit()
