"""The desk's shared buzzer library (BeerMat Online through the quiz server, as the web desk's): search, play, add,
report, take out and share. The quiz server is a stand-in here; the server's side has its own tests."""
import base64
import os
import sys
import tempfile
import unittest
from pathlib import Path

os.environ.setdefault('QT_QPA_PLATFORM', 'offscreen')
os.environ.setdefault('BEERMAT_MUTE', '1')   # tests make the TV's sounds without playing them aloud
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from PySide6.QtCore import QObject, QUrl, Signal         # noqa: E402
from PySide6.QtGui import QGuiApplication                # noqa: E402

from beermat_desk import prefs as prefs_module           # noqa: E402

app = QGuiApplication.instance() or QGuiApplication(['test'])
LIBRARY = {'buzzers': [{'id': 'b1', 'name': 'Air horn', 'seconds': 2}, {'id': 'b2', 'name': 'Duck', 'seconds': 1}], 'pro': True, 'shared': ['b2']}


class FakeApi:
    session = 'desk-session'

    def __init__(self):
        self.calls, self.uploads = [], []

    def host(self, route, body, ok, fail=None, timeout_ms=0):
        self.calls.append((route, body))
        replies = {'buzzer-library': LIBRARY, 'buzzer-library/play': {'name': 'Air horn', 'audio': base64.b64encode(b'ID3 not really').decode()},
                   'buzzer-library/add': {'name': 'Air horn (2)'}, 'buzzer-library/report': {'ok': True}, 'buzzer-library/remove': {'removed': True},
                   'buzzer-library/share': {'name': 'Our klaxon'}}
        ok(replies[route])

    def upload(self, data, name, ok, fail):
        self.uploads.append(name)
        ok('/media/uploaded.mp3')


class FakeSound:
    enabled = False

    def __init__(self):
        self.played = []

    def play_file(self, src, *_):
        self.played.append(src)


class FakeDesk(QObject):
    toast = Signal(str, bool)

    def __init__(self):
        super().__init__()
        self.api, self.tvSound, self._state, self.refreshed = FakeApi(), FakeSound(), {}, 0

    def refresh(self):
        self.refreshed += 1


class BuzzerLibraryTest(unittest.TestCase):
    def setUp(self):
        self.desk = FakeDesk()
        self.toasts = []
        self.desk.toast.connect(lambda message, error: self.toasts.append((message, error)))
        self.prefs = prefs_module.Prefs(self.desk)

    def test_search_play_add_report_and_take_out(self):
        self.prefs.searchLibrary('horn')
        self.assertEqual(self.desk.api.calls[-1], ('buzzer-library', {'q': 'horn'}))
        self.assertEqual([b['name'] for b in self.prefs.library['buzzers']], ['Air horn', 'Duck'])
        self.assertEqual((self.prefs.library['query'], self.prefs.library['loading']), ('horn', False))
        self.prefs.playLibraryBuzzer('b1')
        self.assertTrue(self.desk.tvSound.played[-1].endswith('beermat-library-b1.mp3'), 'heard from a copy of the clip')
        self.prefs.addLibraryBuzzer('b1')
        self.assertIn(('“Air horn (2)” added: teams can pick it in their phone menu', False), self.toasts)
        self.assertEqual(self.desk.refreshed, 1, 'the desk shows the new buzzer sound')
        self.prefs.reportLibraryBuzzer('b1', '   ')
        self.assertNotEqual(self.desk.api.calls[-1][0], 'buzzer-library/report', 'no empty reports')
        self.prefs.reportLibraryBuzzer('b1', 'Copied from a film')
        self.assertEqual(self.desk.api.calls[-1], ('buzzer-library/report', {'id': 'b1', 'reason': 'Copied from a film'}))
        self.prefs.removeLibraryBuzzer('b2')
        self.assertEqual([c[0] for c in self.desk.api.calls[-2:]], ['buzzer-library/remove', 'buzzer-library'], 'taken out, then the list again')

    def test_sharing_needs_the_right_to_share_and_a_short_clip(self):
        with tempfile.TemporaryDirectory() as folder:
            clip = Path(folder) / 'our_klaxon.mp3'
            clip.write_bytes(b'ID3' + b'\0' * 100)
            self.prefs.shareLibraryBuzzer(QUrl.fromLocalFile(str(clip)), 'Our klaxon', False)
            self.assertEqual(self.toasts[-1], ('Tick that you have the right to share this clip', True))
            self.prefs.shareLibraryBuzzer(QUrl.fromLocalFile(str(clip)), '', True)
            self.assertEqual(self.desk.api.calls[-2], ('buzzer-library/share', {'name': 'our_klaxon', 'media': '/media/uploaded.mp3', 'rights': True}))
            big = Path(folder) / 'long.mp3'
            big.write_bytes(b'\0' * (2 * 1024 * 1024 + 1))
            self.prefs.shareLibraryBuzzer(QUrl.fromLocalFile(str(big)), 'Long', True)
            self.assertEqual(self.toasts[-1], ('Clips up to 2 MB can be shared: use a shorter one', True))


if __name__ == '__main__':
    unittest.main()
