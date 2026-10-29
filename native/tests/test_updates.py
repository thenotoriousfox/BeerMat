"""The desk's updater (beermat_desk/updates.py): what kind of install it is, a newer version found by the quiz server
(a stand-in here; the server's side has its own tests, tests/updates.test.js), installed only when no question is
open, and the AppImage swapped in place. The Settings panel shows it."""
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path

os.environ.setdefault('QT_QPA_PLATFORM', 'offscreen')
os.environ.setdefault('BEERMAT_MUTE', '1')
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from PySide6.QtGui import QGuiApplication                # noqa: E402

from beermat_desk import updates as updates_module       # noqa: E402

app = QGuiApplication.instance() or QGuiApplication(['test'])


class FakeApi:
    def __init__(self, check, download=None):
        self.check, self.download, self.calls = check, download, []

    def host(self, route, body, ok, fail=None, timeout_ms=0):
        self.calls.append((route, body))
        reply = self.check if route == 'update/check' else self.download
        ok(reply) if not isinstance(reply, str) else fail(reply)


NEWER = {'current': '0.5.5', 'latest': '0.5.6', 'available': True, 'file': {'name': 'BeerMat-Desk-0.5.6-linux-x64.AppImage', 'size': 5}, 'page': 'https://beermatquiz.co.uk/download/'}


class UpdatesTest(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        self.addCleanup(lambda: __import__('shutil').rmtree(self.dir, ignore_errors=True))
        self.started = []
        saved = updates_module.QProcess
        updates_module.QProcess = type('Process', (), {'startDetached': staticmethod(lambda *args: (self.started.append(args), (True, 1))[1])})
        self.addCleanup(lambda: setattr(updates_module, 'QProcess', saved))

    def test_from_source_it_only_says_so(self):
        self.assertIsNone(updates_module.install_kind(), 'run from source: no install of its own')
        updates = updates_module.Updates(FakeApi(NEWER), lambda: '', kind=None)
        updates.check(True)
        self.assertEqual((updates.latest, updates.canInstall), ('0.5.6', False))
        self.assertIn('Download it from the BeerMat website', updates.message)

    def test_up_to_date_and_offline(self):
        toasts = []
        updates = updates_module.Updates(FakeApi({'current': '0.5.5', 'latest': '0.5.5', 'available': False, 'file': None}), lambda: '', kind='linux-appimage')
        updates.toast.connect(lambda message, error: toasts.append(message))
        updates.checkNow()
        self.assertEqual((updates.latest, updates.canInstall), ('', False))
        self.assertEqual(toasts, ['BeerMat Desk 0.5.5 is the latest version.'])
        # No internet: quiet when it checks by itself.
        offline = updates_module.Updates(FakeApi({'current': '0.5.5', 'error': 'fetch failed'}), lambda: '', kind='linux-appimage')
        offline.check(True)
        self.assertEqual((offline.latest, offline.message), ('', ''))

    def test_the_appimage_updates_itself_but_not_mid_question(self):
        appimage, new = self.dir / 'BeerMat-Desk.AppImage', self.dir / 'updates' / 'BeerMat-Desk-0.5.6-linux-x64.AppImage'
        appimage.write_text('old'); new.parent.mkdir(); new.write_text('new')
        os.environ['APPIMAGE'] = str(appimage)
        self.addCleanup(lambda: os.environ.pop('APPIMAGE', None))
        busy = ['Finish this question first: updating restarts the desk']
        api = FakeApi(NEWER, {'version': '0.5.6', 'path': str(new), 'name': new.name})
        updates = updates_module.Updates(api, lambda: busy[0], kind='linux-appimage')
        restarts, toasts = [], []
        updates.restart.connect(lambda: restarts.append(1))
        updates.toast.connect(lambda message, error: toasts.append(message))
        updates.check(True)
        self.assertTrue(updates.canInstall)
        updates.install()
        self.assertEqual(toasts, busy)
        self.assertNotIn('update/download', [route for route, _ in api.calls], 'nothing downloaded mid-question')
        busy[0] = ''
        updates.install()
        self.assertEqual(appimage.read_text(), 'new', 'the new AppImage in the old one’s place')
        self.assertTrue(os.access(appimage, os.X_OK))
        self.assertFalse(new.exists())
        self.assertEqual(restarts, [1])
        self.assertEqual(self.started[0][1][-1], str(appimage), 'started again once this desk has gone')

    def test_windows_runs_the_installer_silently(self):
        api = FakeApi({**NEWER, 'file': {'name': 'BeerMat-Desk-Setup-0.5.6.exe', 'size': 5}}, {'version': '0.5.6', 'path': 'C:/updates/BeerMat-Desk-Setup-0.5.6.exe'})
        updates = updates_module.Updates(api, lambda: '', kind='windows-installer')
        restarts = []
        updates.restart.connect(lambda: restarts.append(1))
        updates.check(True)
        updates.install()
        self.assertEqual(self.started, [('C:/updates/BeerMat-Desk-Setup-0.5.6.exe', ['/SILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/CLOSEAPPLICATIONS', '/UPDATE=1'])])
        self.assertEqual(restarts, [1])

    def test_a_failed_download_keeps_the_desk(self):
        api = FakeApi(NEWER, 'The download doesn’t match what BeerMat released: not updating')
        updates = updates_module.Updates(api, lambda: '', kind='linux-appimage')
        restarts = []
        updates.restart.connect(lambda: restarts.append(1))
        updates.check(True)
        updates.install()
        self.assertEqual((restarts, updates.state), ([], ''))
        self.assertIn('didn’t download', updates.message)


if __name__ == '__main__':
    unittest.main()
