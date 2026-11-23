"""BeerMat as a TV screen: the computer wired to the TVs shows the Qt TV, while the quizmaster's laptop runs the quiz.

It finds the quizmaster's laptop through the BeerMat account, not the network (venue Wi-Fi often keeps devices apart):
it signs in once by QR code (a phone signed in approves it, BeerMat Online's /connect) or as the desk that became this
TV (link.py), and keeps a TV device token. Each time, BeerMat Online says which of the account's laptops is running a
quiz, where it can be reached (its addresses, its quizmaster link: a Cloudflare tunnel) and gives a ticket for it, which
the laptop swaps for a TV key (/api/tv/login). On BeerMat's own quiz Wi-Fi (Linux 10.42.0.1, Windows 192.168.137.1)
it needs none of that: the laptop is the Wi-Fi there, and it connects straight away, internet or not.

It plays all the TV's sound here: the moments (tvsound.py follows the TV's state) and the desk's own playback (sound
clips, music bingo songs, an audio question played again), which the desk sends through the quiz server while a TV
screen is connected. Looks the laptop installed from the theme library come from its quiz server too."""
import json
import os
import time
from pathlib import Path

from PySide6.QtCore import Property, QObject, QSettings, QStandardPaths, QSysInfo, QTimer, QUrl, Signal, Slot
from PySide6.QtNetwork import QNetworkAccessManager, QNetworkRequest
from PySide6.QtWebSockets import QWebSocket

from . import looks
from .tvsound import TvSound

ROOT = Path(__file__).resolve().parents[2]
DESK_PORT = 3000
HOTSPOTS = ['10.42.0.1', '192.168.137.1']
ONLINE = 'https://online.beermatquiz.co.uk'


def normalise(address):
    """'10.42.0.1', '10.42.0.1:3000' or 'http://…' as the quiz server's base URL ('' if it isn't one)."""
    address = (address or '').strip().rstrip('/')
    if not address:
        return ''
    if not address.startswith(('http://', 'https://')):
        address = 'http://' + address
    host = address.split('://', 1)[1]
    return address if ':' in host else f'{address}:{DESK_PORT}'


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
        self._socket = None
        self._buffer = b''
        self._key = ''              # this TV's key on the laptop (signed in through the account)
        self._pair_url = ''         # the QR code's address, while this TV signs in
        self._message = ''
        self._lost = 0              # stream retries since it last connected
        self._connected = False
        self._fetching = False
        self._again = False
        self._retry = QTimer(self, singleShot=True, interval=2000, timeout=self._open_stream)
        self._wait = QTimer(self, singleShot=True, timeout=lambda: self._next and self._next())
        self._next = None
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

    @Property(str, notify=statusChanged)
    def pairUrl(self):
        """While this TV signs in: the address in its QR code, for a phone signed in to the account."""
        return self._pair_url

    @Property(bool, notify=statusChanged)
    def signedIn(self):
        """Signed in to a BeerMat account (a TV device token)."""
        return bool(self._prefs.value('tvDevice', '', str))

    @Property(str, notify=statusChanged)
    def message(self):
        return self._message

    def online(self):
        return (os.environ.get('BEERMAT_ONLINE') or self._prefs.value('onlineService', '', str) or ONLINE).rstrip('/')

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
    def _later(self, fn, ms):
        self._next = fn
        self._wait.start(ms)

    def _say(self, message):
        self._message = message
        self.statusChanged.emit()

    def _online(self, method, route, body, done, failed):
        """BeerMat Online's API: done(json), or failed(message, status)."""
        request = QNetworkRequest(QUrl(self.online() + route))
        request.setHeader(QNetworkRequest.KnownHeaders.ContentTypeHeader, 'application/json')
        request.setTransferTimeout(15000)
        reply = self._net.sendCustomRequest(request, method.encode(), json.dumps(body).encode() if body is not None else b'')

        def finished():
            status = reply.attribute(QNetworkRequest.Attribute.HttpStatusCodeAttribute) or 0
            try:
                data = json.loads(bytes(reply.readAll()) or b'{}')
            except ValueError:
                data = {}
            reply.deleteLater()
            if 200 <= status < 300:
                done(data)
            else:
                failed(data.get('error') or 'BeerMat Online can’t be reached. Is this computer on the internet?', status)
        reply.finished.connect(finished)

    @Slot()
    def search(self):
        """An address typed here before, and the quiz Wi-Fi (no internet needed there), then the account."""
        self._found, self._searching, self._pair_url = [], True, ''
        self._say('Looking for the quiz…')
        places = list(dict.fromkeys(p for p in [normalise(self.savedAddress), *(normalise(h) for h in HOTSPOTS)] if p))
        left = {'n': len(places), 'done': False}
        for base in places:
            request = QNetworkRequest(QUrl(f'{base}/api/hello'))
            request.setTransferTimeout(2000)
            reply = self._net.get(request)

            def heard(reply=reply, base=base):
                try:
                    hello = json.loads(bytes(reply.readAll()) or b'{}')
                except ValueError:
                    hello = {}
                reply.deleteLater()
                left['n'] -= 1
                if left['done']:
                    return
                if hello.get('app') == 'BeerMat':
                    left['done'] = True
                    return self.connectTo(base)
                if left['n'] == 0:
                    left['done'] = True
                    self._account()
            reply.finished.connect(heard)

    def _account(self):
        device = self._prefs.value('tvDevice', '', str)
        if not device:
            return self._pair()
        self._say('Asking BeerMat Online where the quiz is…')

        def found(reply):
            laptops = reply.get('desks') or []
            self._searching = False
            if not laptops:
                self._found = []
                self._say(f'No quiz laptop is open on {reply.get("account") or "this"} account. Open BeerMat on the laptop, signed in to BeerMat Online.')
                return self._later(self._account, 10000)
            wanted = self._prefs.value('tvLaptop', '', str)
            pick = next((l for l in laptops if l.get('venueKey') == wanted), laptops[0] if len(laptops) == 1 else None)
            self._found = [{'name': l.get('name', ''), 'title': l.get('title') or 'BeerMat', 'venueKey': l.get('venueKey', ''), 'address': l.get('name', '')} for l in laptops]
            self._laptops = laptops
            if pick:
                return self._open(pick)
            self._say('Choose the quiz to show on the TV.')

        def failed(message, status):
            self._searching = False
            if status == 401:
                self._prefs.remove('tvDevice')
                return self._pair()
            self._say(message)
            self._later(self._account, 10000)
        self._online('POST', '/v1/tv/connect', {'device': device}, found, failed)

    @Slot(str)
    def choose(self, venue_key):
        laptop = next((l for l in getattr(self, '_laptops', []) if l.get('venueKey') == venue_key), None)
        if laptop:
            self._prefs.setValue('tvLaptop', venue_key)
            self._open(laptop)

    def _open(self, laptop):
        """The laptop's address on this network if it answers, else its quizmaster link; then its TV key."""
        from .link import reachable
        self._say(f'Opening {laptop.get("title") or "the quiz"} on {laptop.get("name")}…')

        def at(base):
            if not base:
                self._say(f'{laptop.get("name")} can’t be reached: it has no quizmaster link yet. Check it’s on the internet.')
                return self._later(self._account, 10000)
            request = QNetworkRequest(QUrl(base + '/api/tv/login'))
            request.setHeader(QNetworkRequest.KnownHeaders.ContentTypeHeader, 'application/json')
            request.setTransferTimeout(15000)
            reply = self._net.post(request, json.dumps({'ticket': laptop.get('ticket'), 'name': self.name[:40]}).encode())

            def signed_in():
                try:
                    data = json.loads(bytes(reply.readAll()) or b'{}')
                except ValueError:
                    data = {}
                reply.deleteLater()
                if not data.get('key'):
                    self._say(data.get('error') or f'{laptop.get("name")} didn’t answer')
                    return self._later(self._account, 10000)
                self.connectTo(base, data['key'])
            reply.finished.connect(signed_in)
        reachable(self._net, laptop.get('addresses'), laptop.get('link'), at)

    def _pair(self):
        """Sign this TV in: a QR code for a phone signed in to the account; then this TV keeps a device token."""
        self._searching = False

        def made(reply):
            code = reply.get('code', '')
            self._pair_url = f'{self.online()}/connect#tv={code}'
            self._say('Scan the code with your phone and sign in with the BeerMat account your quiz laptop uses.')
            self._later(lambda: poll(code), 2000)

        def poll(code):
            def got(reply):
                if reply.get('device'):
                    self._prefs.setValue('tvDevice', reply['device'])
                    self._pair_url = ''
                    return self._account()
                self._later(lambda: poll(code), 2000)
            self._online('GET', f'/v1/tv-pairings/{code}', None, got, lambda message, status: self._pair() if status == 404 else self._later(lambda: poll(code), 5000))
        self._online('POST', '/v1/tv-pairings', {'name': self.name[:60]}, made,
                     lambda message, status: (self._say(message + ' On the quiz Wi-Fi, type the laptop’s address instead.'), self._later(self._pair, 10000)))

    @Slot()
    def signOut(self):
        """Forget this TV's sign-in (another account, say): it shows a new QR code."""
        self._prefs.remove('tvDevice')
        self._prefs.remove('tvLaptop')
        self.forget()

    @Slot(str)
    def connectTo(self, address, key=''):
        base = address if address.startswith('https://') else normalise(address)
        if not base:
            return
        self._wait.stop()
        self._search = None
        self._searching = False
        self._key, self._lost, self._pair_url = key, 0, ''
        self._base = base
        self.sound.base = base
        if not key:
            self._prefs.setValue('tvScreen/address', base.split('://', 1)[1])
        self._load_palettes()
        self._open_stream()
        self.refresh()
        self.statusChanged.emit()

    @Slot()
    def forget(self):
        """Back to the list of quizzes (another laptop, say)."""
        self._base, self._connected, self._tv, self._key = '', False, {}, ''
        if self._stream:
            self._stream.abort()
        if self._socket:
            self._socket.abort()
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
        # Through the account a TV key goes too; through a quizmaster link (https) a WebSocket: the tunnel holds
        # server-sent events back.
        address = f'{self._base}/api/events?screen={QUrl.toPercentEncoding(self.name).data().decode()}' + (f'&tv={self._key}' if self._key else '')
        if self._base.startswith('https:'):
            return self._open_socket(address.replace('https:', 'wss:', 1))
        request = QNetworkRequest(QUrl(address))
        request.setRawHeader(b'Accept', b'text/event-stream')
        self._buffer = b''
        stream = self._stream = self._net.get(request)
        stream.readyRead.connect(lambda: self._read(stream))
        stream.finished.connect(lambda: self._ended(stream))

    def _open_socket(self, address):
        if self._socket:
            self._socket.abort()
        socket = self._socket = QWebSocket('', parent=self)
        socket.textMessageReceived.connect(lambda _: socket is self._socket and self.refresh())

        def ended():
            if socket is self._socket:
                self._socket = None
                self._lost_link()
            socket.deleteLater()
        socket.disconnected.connect(ended)
        request = QNetworkRequest(QUrl(address))
        request.setRawHeader(b'Origin', self._base.encode())
        socket.open(request)

    def _lost_link(self):
        if self._connected:
            self._connected = False
            self.statusChanged.emit()
        self._lost += 1
        # Half a minute without the laptop, signed in through the account: its link may have changed (it restarted),
        # so BeerMat Online is asked again where it is.
        if self._key and self._lost >= 15:
            base, self._base = self._base, ''
            return self._account()
        self._retry.start()

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
            self._lost_link()
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
        if self._key:
            request.setRawHeader(b'Authorization', f'Bearer {self._key}'.encode())
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
        self._lost = 0
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
