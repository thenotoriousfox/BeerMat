"""Which screen is the TV and when it opens by itself, with the screens Qt reports replaced by a test's list."""
import os
import sys
import unittest
from pathlib import Path

os.environ.setdefault('QT_QPA_PLATFORM', 'offscreen')
os.environ.setdefault('BEERMAT_MUTE', '1')   # tests make the TV's sounds without playing them aloud
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from PySide6.QtCore import QSettings                     # noqa: E402
from PySide6.QtGui import QGuiApplication                # noqa: E402

from beermat_desk import screens as screens_module       # noqa: E402

app = QGuiApplication.instance() or QGuiApplication(['test'])
app.setOrganizationName('BeerMat-test')


class FakeScreen:
    def __init__(self, name):
        self._name = name

    def name(self):
        return self._name


class StartTest(unittest.TestCase):
    def setUp(self):
        QSettings().remove('audience'); QSettings().remove('autoOpen')
        self.desk, self.tv = FakeScreen('DP-1'), FakeScreen('HDMI-A-5')
        self.connected = [self.desk]
        saved = screens_module.QGuiApplication

        class Fake:
            instance = staticmethod(saved.instance)
            screens = staticmethod(lambda: list(self.connected))
            primaryScreen = staticmethod(lambda: self.desk)
        screens_module.QGuiApplication = Fake
        self.addCleanup(lambda: setattr(screens_module, 'QGuiApplication', saved))

    def test_the_tv_opens_at_startup_when_its_screen_is_connected(self):
        self.connected.append(self.tv)
        s = screens_module.Screens()
        s.start()
        self.assertTrue(s.open)
        self.assertTrue(s.fullScreen)

    def test_one_screen_or_opening_by_itself_off_leaves_it_closed(self):
        s = screens_module.Screens()
        s.start()
        self.assertFalse(s.open, 'only the desk screen')
        self.connected.append(self.tv)
        QSettings().setValue('autoOpen', False)
        s = screens_module.Screens()
        s.start()
        self.assertFalse(s.open, 'the quizmaster turned it off')
        QSettings().remove('autoOpen')


if __name__ == '__main__':
    unittest.main()
