"""Quizmaster devices found through the account, not the network (the quiz server's quizmaster link, server.js).

Venue Wi-Fi often keeps devices apart, so a laptop signed in to BeerMat Online tells it where it can be reached: its
addresses on its networks and its quizmaster link (a Cloudflare tunnel). When another laptop on the same account is
running a quiz, this desk asks once what this device is for:

  Use this device as the desk   this desk runs that laptop's quiz (BeerMat Online's ticket, then its address on this
                                network if it answers, else its link). That laptop keeps the quiz, its phones, its TV
                                and its sound, and shows that the desk is here; it can take the desk back.
  Use this device as the TV     BeerMat opens again as a TV screen (tvscreen.py), signed in with a TV device token.
  Ignore                        this desk keeps its own quiz.
"""
import json
import socket

from PySide6.QtCore import Property, QObject, QSettings, QTimer, QUrl, Signal, Slot
from PySide6.QtNetwork import QNetworkAccessManager, QNetworkReply, QNetworkRequest


def reachable(net, addresses, link, done, timeout_ms=1500):
    """done(base): the first of the laptop's addresses whose /api/hello answers, else its link ('' if it has none)."""
    remaining = list(addresses or [])

    def next_one():
        if not remaining:
            return done(link or '')
        address = remaining.pop(0)
        request = QNetworkRequest(QUrl(address + '/api/hello'))
        request.setTransferTimeout(timeout_ms)
        reply = net.get(request)

        def finished():
            ok = reply.error() == QNetworkReply.NetworkError.NoError and b'BeerMat' in bytes(reply.readAll())
            reply.deleteLater()
            done(address) if ok else next_one()
        reply.finished.connect(finished)
    next_one()


class DeskLink(QObject):
    changed = Signal()

    def __init__(self, desk):
        super().__init__(desk)
        self.desk, self.api = desk, desk.api
        self._net = QNetworkAccessManager(self)
        self._asked = False         # the question is asked once each time BeerMat opens
        self._other = {}            # the laptop it's asking about
        self._remote = {}           # running that laptop's quiz: {name, title, base}
        self._own = None            # this laptop's own server and session, to go back to
        self._away = {}             # this laptop's desk is on another device: {name, since}
        self._busy = False
        self._lost = False
        self._down = False
        self._rejoin = QTimer(self, singleShot=True, interval=15000, timeout=self._find_again)
        self.api.signedOut.connect(self._taken_back)
        self.api.connection.connect(self._connection)

    # ---- for QML ----
    @Property('QVariantMap', notify=changed)
    def other(self):
        """Another laptop on the account running a quiz, to ask about ({} once answered)."""
        return self._other

    @Property('QVariantMap', notify=changed)
    def remote(self):
        return {k: v for k, v in self._remote.items() if k in ('name', 'title')}

    @Property('QVariantMap', notify=changed)
    def away(self):
        return self._away

    @Property(bool, notify=changed)
    def busy(self):
        return self._busy

    def follow(self, state):
        """Each fresh desk state: the link's other laptops, and whether this laptop's desk is elsewhere."""
        away = state.get('deskAway') or {}
        if away != self._away:
            self._away = away
            self.changed.emit()
        if self._remote or self._asked:
            return
        others = [d for d in ((state.get('link') or {}).get('others') or []) if d.get('role') in ('desk', 'hosting')]
        if others:
            self._asked, self._other = True, others[0]
            self.changed.emit()

    def _set_busy(self, busy):
        self._busy = busy
        self.changed.emit()

    def _fail(self, message):
        self._set_busy(False)
        self.desk.toast.emit(message, True)

    @Slot()
    def ignore(self):
        self._other = {}
        self.changed.emit()

    def _own_host(self, route, body, done, failed, timeout_ms=30000):
        """This laptop's own quiz server, whichever quiz this desk is running (its own, or another laptop's)."""
        base, session = self._own if self._remote and self._own else (self.api.base, self.api.session)
        request = QNetworkRequest(QUrl(f'{base}/api/host/{route}'))
        request.setHeader(QNetworkRequest.KnownHeaders.ContentTypeHeader, 'application/json')
        request.setRawHeader(b'Origin', base.encode())
        request.setRawHeader(b'Authorization', f'Bearer {session}'.encode())
        request.setTransferTimeout(timeout_ms)
        reply = self._net.post(request, json.dumps(body).encode())

        def finished():
            try:
                data = json.loads(bytes(reply.readAll()) or b'{}')
            except ValueError:
                data = {}
            ok = reply.error() == QNetworkReply.NetworkError.NoError
            reply.deleteLater()
            done(data) if ok else failed(data.get('error') or reply.errorString())
        reply.finished.connect(finished)

    @Slot()
    def useAsDesk(self):
        """Run the other laptop's quiz from here."""
        other = self._other
        if not other or self._busy:
            return
        self._set_busy(True)
        self._join(other, self._joined, self._fail)

    def _join(self, other, done, failed):
        """BeerMat Online's ticket for that laptop (asked through this laptop's server, which knows where it is now),
        its address on this network if it answers, else its quizmaster link; then signed in there: done(base, key)."""
        def ticket(reply):
            reachable(self._net, reply.get('addresses'), reply.get('link'), lambda base: sign_in(base, reply['ticket']))

        def sign_in(base, ticket_):
            if not base:
                return failed(f'{other.get("name")} can’t be reached: it has no quizmaster link yet. Check it’s on the internet.')
            request = QNetworkRequest(QUrl(base + '/api/deck/login'))
            request.setHeader(QNetworkRequest.KnownHeaders.ContentTypeHeader, 'application/json')
            request.setRawHeader(b'Origin', base.encode())
            request.setTransferTimeout(15000)
            reply = self._net.post(request, json.dumps({'ticket': ticket_, 'name': socket.gethostname()[:40] or 'BeerMat desk'}).encode())

            def finished():
                try:
                    data = json.loads(bytes(reply.readAll()) or b'{}')
                except ValueError:
                    data = {}
                ok = reply.error() == QNetworkReply.NetworkError.NoError and data.get('key')
                reply.deleteLater()
                if not ok:
                    return failed(data.get('error') or f'{other.get("name")} didn’t answer: {reply.errorString()}')
                done(other, base, data['key'])
            reply.finished.connect(finished)
        # Where it is now: this laptop's server asks BeerMat Online afresh (/api/host/link), then for a ticket.
        self._own_host('link', {}, lambda _: self._own_host('link/ticket', {'venueKey': other['venueKey'], 'role': 'desk'}, ticket, failed), failed)

    def _joined(self, other, base, session):
        self._own = (self.api.base, self.api.session)
        # This laptop's own server: its desk is running another laptop's quiz (it isn't offered to TVs).
        self.api.host('link/role', {'role': 'remote'})
        self._remote = {'name': other.get('name', ''), 'title': other.get('title', ''), 'base': base, 'venueKey': other['venueKey']}
        self._other = {}
        self.api.point(base, session, remote=True)
        self.desk.tvSound.remote = True
        self.api.host('handover', {}, lambda _: (self._set_busy(False), self.desk.goneRemote()), lambda e: self._fail(e))

    # ---- the other laptop dropped out (it restarted, so its quizmaster link changed, or its network did) ----
    def _connection(self, up):
        if not self._remote:
            return
        if up:
            self._rejoin.stop()
            # Back after a drop: the laptop may have restarted and forgotten its desk is here.
            if self._down:
                self._down = False
                self.api.host('handover', {}, lambda _: None, lambda _e: None)
            if self._lost:
                self._lost = False
                self.changed.emit()
        else:
            self._down = True
            if not self._rejoin.isActive():
                self._rejoin.start()

    def _find_again(self):
        """Fifteen seconds without the other laptop: where is it now? Again every fifteen seconds until it answers."""
        if not self._remote:
            return
        if not self._lost:
            self._lost = True
            self.changed.emit()
        other = {'name': self._remote['name'], 'title': self._remote['title'], 'venueKey': self._remote['venueKey']}

        def back(_other, base, session):
            if not self._remote:
                return
            self._remote['base'] = base
            self._down = False
            self.api.point(base, session, remote=True)
            self.api.host('handover', {}, lambda _: (self.desk.goneRemote(), self.desk.toast.emit(f'Back on {other["name"]}', False)), lambda e: None)
        self._join(other, back, lambda _e: self._remote and self._rejoin.start())

    @Property(bool, notify=changed)
    def lost(self):
        """Running another laptop's quiz, and finding it again."""
        return self._lost

    @Slot()
    def useAsTv(self):
        """This computer becomes a TV screen, signed in with this account: BeerMat opens again as it."""
        if self._busy:
            return
        self._set_busy(True)

        def got(reply):
            settings = QSettings()
            settings.setValue('tvDevice', reply.get('device', ''))
            settings.setValue('tvLaptop', self._other.get('venueKey', ''))
            settings.setValue('onlineService', ((self.desk._state or {}).get('settings') or {}).get('onlineService', ''))
            self._set_busy(False)
            self.desk.roleRequested.emit('tv')
        self.api.host('link/tv-device', {}, got, self._fail, timeout_ms=30000)

    @Slot()
    def takeBack(self):
        """This laptop's desk was on another device: back here (that device's session ends)."""
        self.api.host('handover/end', {}, lambda _: self.desk.refresh(), self._fail)

    @Slot()
    def leave(self):
        """Stop running the other laptop's quiz: back to this laptop's own."""
        if self._remote:
            self.api.host('logout', {})
            QTimer.singleShot(300, self._back_home)

    def _taken_back(self):
        if self._remote:
            self.desk.toast.emit(f'{self._remote.get("name")} took its desk back', False)
            self._back_home()

    def _back_home(self):
        if not self._remote or not self._own:
            return
        self._remote = {}
        self._rejoin.stop()
        self._lost = False
        base, session = self._own
        self.api.point(base, session, remote=False)
        self.desk.tvSound.remote = False
        self.api.host('link/role', {'role': 'desk'})
        self.changed.emit()
        self.desk.goneRemote()
