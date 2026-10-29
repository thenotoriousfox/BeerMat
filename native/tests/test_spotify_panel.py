"""The desk's Spotify panel follows a sign-in that finishes in the browser, and a failed check keeps its buttons.
The quiz server is a stand-in here; the server's Spotify code has its own tests (tests/spotify.test.js)."""
import os
import sys
import time
import unittest
from pathlib import Path

os.environ.setdefault('QT_QPA_PLATFORM', 'offscreen')
os.environ.setdefault('BEERMAT_MUTE', '1')   # tests make the TV's sounds without playing them aloud
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from PySide6.QtCore import QObject, Signal                # noqa: E402
from PySide6.QtGui import QGuiApplication                # noqa: E402

from beermat_desk import prefs as prefs_module           # noqa: E402

app = QGuiApplication.instance() or QGuiApplication(['test'])


class FakeApi:
    session = 'desk-session'

    def __init__(self):
        self.statuses, self.calls = [], []

    def host(self, route, body, ok, fail=None, timeout_ms=0):
        self.calls.append(route)
        if route == 'spotify/connect':
            ok({'url': 'https://accounts.spotify.com/authorize?client_id=x'})
        elif route == 'spotify/status':
            reply = self.statuses.pop(0) if self.statuses else {'connected': True, 'user': 'Dan'}
            ok(reply) if not isinstance(reply, str) else fail(reply)


class FakeDesk(QObject):
    toast = Signal(str, bool)

    def __init__(self):
        super().__init__()
        self.api = FakeApi()


class SpotifyPanelTest(unittest.TestCase):
    def setUp(self):
        self.opened = []
        saved = prefs_module.QDesktopServices
        prefs_module.QDesktopServices = type('Services', (), {'openUrl': staticmethod(lambda url: self.opened.append(url.toString()))})
        self.addCleanup(lambda: setattr(prefs_module, 'QDesktopServices', saved))
        self.desk = FakeDesk()
        self.toasts = []
        self.desk.toast.connect(lambda message, error: self.toasts.append(message))
        self.prefs = prefs_module.Prefs(self.desk)
        self.prefs._waiting.setInterval(50)

    def wait(self, condition, seconds=5):
        end = time.monotonic() + seconds
        while time.monotonic() < end and not condition():
            app.processEvents(); time.sleep(0.01)
        return condition()

    def test_a_sign_in_finished_in_the_browser_shows_as_connected(self):
        api = self.desk.api
        api.statuses = [{'connected': False}, {'connected': False}, {'connected': True, 'user': 'Dan', 'devices': [{'id': 'pc', 'name': 'main-pc'}]}]
        self.prefs.loadSpotify()
        self.assertFalse(self.prefs.spotify.get('connected'))
        self.prefs.connectSpotify(' client-id ')
        self.assertEqual(self.opened, ['https://accounts.spotify.com/authorize?client_id=x'])
        self.assertTrue(self.wait(lambda: self.prefs.spotify.get('connected')), 'the desk notices the sign-in by itself')
        self.assertIn('Spotify connected as Dan', self.toasts)
        checks = api.calls.count('spotify/status')
        time.sleep(0.2); app.processEvents()
        self.assertEqual(api.calls.count('spotify/status'), checks, 'and stops asking once connected')

    def test_a_failed_check_keeps_what_was_known(self):
        self.desk.api.statuses = [{'connected': True, 'user': 'Dan', 'clientId': 'abc'}, 'Spotify did not answer']
        self.prefs.loadSpotify()
        self.prefs.loadSpotify()
        self.assertEqual(self.prefs.spotify.get('error'), 'Spotify did not answer')
        self.assertEqual(self.prefs.spotify.get('clientId'), 'abc')
        self.desk.api.statuses = [{'connected': True, 'user': 'Dan'}]
        self.prefs.loadSpotify()
        self.assertNotIn('error', self.prefs.spotify)


if __name__ == '__main__':
    unittest.main()
