"""The quiz server's desk API (/api/host/…), the same one the web desk uses, over Qt's own networking so nothing blocks
the window. Live updates come from /api/events: the server sends a version number whenever anything changes, and
the desk then fetches the whole state again."""
import json

from PySide6.QtCore import QObject, QTimer, QUrl, Signal
from PySide6.QtNetwork import QNetworkAccessManager, QNetworkReply, QNetworkRequest


class DeskApi(QObject):
    changed = Signal()            # the quiz changed: fetch the state again
    connection = Signal(bool)     # the live-update stream is (or isn't) connected

    def __init__(self, parent=None):
        super().__init__(parent)
        self.base = None
        self.session = None
        self._net = QNetworkAccessManager(self)
        self._stream = None
        self._stream_buffer = b''
        self._retry = QTimer(self, singleShot=True, interval=1000, timeout=self._open_stream)

    def use(self, port):
        self.base = f'http://127.0.0.1:{port}'

    def call(self, route, body=None, done=None, failed=None, timeout_ms=15000):
        """POST /api/<route> with the desk session; done(json) or failed(message) on the UI thread."""
        request = QNetworkRequest(QUrl(f'{self.base}/api/{route}'))
        request.setHeader(QNetworkRequest.KnownHeaders.ContentTypeHeader, 'application/json')
        # The server only accepts desk calls from its own origin (or none), like the web desk's.
        request.setRawHeader(b'Origin', self.base.encode())
        if self.session:
            request.setRawHeader(b'Authorization', f'Bearer {self.session}'.encode())
        request.setTransferTimeout(timeout_ms)
        reply = self._net.post(request, json.dumps(body or {}).encode())

        def finished():
            raw = bytes(reply.readAll())
            status = reply.attribute(QNetworkRequest.Attribute.HttpStatusCodeAttribute) or 0
            try:
                data = json.loads(raw) if raw else {}
            except ValueError:
                data = {}
            if reply.error() == QNetworkReply.NetworkError.NoError and 200 <= status < 300:
                if done:
                    done(data)
            elif failed:
                failed(data.get('error') or (reply.errorString() if not status else f'The quiz server said {status}'))
            reply.deleteLater()
        reply.finished.connect(finished)
        return reply

    def get(self, route, done=None, failed=None, timeout_ms=10000):
        """GET /api/<route> (no session needed: the TV's public state)."""
        request = QNetworkRequest(QUrl(f'{self.base}/api/{route}'))
        request.setTransferTimeout(timeout_ms)
        reply = self._net.get(request)

        def finished():
            try:
                data = json.loads(bytes(reply.readAll()) or b'{}')
            except ValueError:
                data = {}
            if reply.error() == QNetworkReply.NetworkError.NoError:
                if done:
                    done(data)
            elif failed:
                failed(data.get('error') or reply.errorString())
            reply.deleteLater()
        reply.finished.connect(finished)
        return reply

    def upload(self, data, name, done, failed):
        """A picture or sound for the quiz (/api/host/media): done('/media/<file>')."""
        request = QNetworkRequest(QUrl(f'{self.base}/api/host/media?name={name}'))
        request.setHeader(QNetworkRequest.KnownHeaders.ContentTypeHeader, 'application/octet-stream')
        request.setRawHeader(b'Authorization', f'Bearer {self.session}'.encode())
        request.setTransferTimeout(60000)
        reply = self._net.post(request, data)

        def finished():
            try:
                body = json.loads(bytes(reply.readAll()) or b'{}')
            except ValueError:
                body = {}
            if reply.error() == QNetworkReply.NetworkError.NoError and body.get('media'):
                done(body['media'])
            else:
                failed(body.get('error') or reply.errorString())
            reply.deleteLater()
        reply.finished.connect(finished)

    def host(self, route, body=None, done=None, failed=None, timeout_ms=15000):
        return self.call('host/' + route, body, done, failed, timeout_ms)

    def login_with_ticket(self, ticket, done, failed):
        def logged_in(data):
            self.session = data['key']
            self._open_stream()
            done()
        self.call('login', {'ticket': ticket}, logged_in, failed)

    # ---- live updates ----
    def _open_stream(self):
        if not self.session:
            return
        if self._stream:
            self._stream.abort()
        request = QNetworkRequest(QUrl(f'{self.base}/api/events?key={self.session}'))
        request.setRawHeader(b'Accept', b'text/event-stream')
        self._stream_buffer = b''
        stream = self._stream = self._net.get(request)
        stream.readyRead.connect(lambda: self._read_stream(stream))
        stream.finished.connect(lambda: self._stream_ended(stream))

    def _read_stream(self, stream):
        if stream is not self._stream:
            return
        self.connection.emit(True)
        self._stream_buffer += bytes(stream.readAll())
        *events, self._stream_buffer = self._stream_buffer.split(b'\n\n')
        if any(b'data:' in event for event in events):
            self.changed.emit()

    def _stream_ended(self, stream):
        if stream is self._stream:
            self._stream = None
            self.connection.emit(False)
            self._retry.start()
        stream.deleteLater()

    def close(self):
        self._retry.stop()
        if self._stream:
            stream, self._stream = self._stream, None
            stream.abort()
