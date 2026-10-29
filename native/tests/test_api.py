"""The desk's client for the quiz server (beermat_desk/api.py): a request the server hung up on before answering (an
idle connection it had just timed out as the desk reused it, "Connection closed") is sent once more, not reported as
a failure; a second hang-up is."""
import os
import socket
import sys
import threading
import time
import unittest
from pathlib import Path

os.environ.setdefault('QT_QPA_PLATFORM', 'offscreen')
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from PySide6.QtCore import QCoreApplication                      # noqa: E402

from beermat_desk.api import DeskApi                             # noqa: E402

app = QCoreApplication.instance() or QCoreApplication(['test'])
kept = []          # Qt's network objects outlive each test: Python freeing them mid-run crashes Qt


def server(hang_ups):
    """A server that hangs up on the first `hang_ups` requests, then answers {"ok": true}. Returns (port, requests)."""
    listener = socket.socket()
    listener.bind(('127.0.0.1', 0)); listener.listen()
    requests = []

    def serve():
        while True:
            conn, _ = listener.accept()
            data = b''
            while b'\r\n\r\n' not in data:
                data += conn.recv(4096)
            head, _, body = data.partition(b'\r\n\r\n')
            length = int(next((l.split(b':')[1] for l in head.split(b'\r\n') if l.lower().startswith(b'content-length')), b'0'))
            while len(body) < length:
                body += conn.recv(4096)
            requests.append(body)
            if len(requests) > hang_ups:
                conn.sendall(b'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 12\r\nConnection: close\r\n\r\n{"ok": true}')
            conn.close()
    threading.Thread(target=serve, daemon=True).start()
    return listener.getsockname()[1], requests


def run(api, route, body):
    result = []
    api.call(route, body, lambda data: result.append(('done', data)), lambda message: result.append(('failed', message)))
    end = time.time() + 10
    while not result and time.time() < end:
        app.processEvents()
        time.sleep(0.01)
    return result


class ApiTest(unittest.TestCase):
    def test_a_hang_up_is_sent_again_once(self):
        port, requests = server(hang_ups=1)
        api = DeskApi(); api.use(port); kept.append(api)
        self.assertEqual(run(api, 'host/team-note', {'note': 'Table 4'}), [('done', {'ok': True})])
        self.assertEqual(requests, [b'{"note": "Table 4"}'] * 2, 'the same request, sent again')

    def test_hung_up_on_twice_it_fails(self):
        port, requests = server(hang_ups=2)
        api = DeskApi(); api.use(port); kept.append(api)
        [(outcome, message)] = run(api, 'host/team-note', {'note': 'Table 4'})
        self.assertEqual(outcome, 'failed')
        self.assertIn('closed', message.lower())
        self.assertEqual(len(requests), 2, 'once more, not for ever')


if __name__ == '__main__':
    unittest.main()
