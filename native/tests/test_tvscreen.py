"""BeerMat as a TV screen (tvscreen.py) against a real desk and quiz server: it finds the quiz at the address it last
used, the desk sees it connected, it shows the TV, and the desk's own playback (a sound clip) plays on the screen, not
the laptop. An installed look's scenery comes from the laptop. The window asks for the quiz until it has one."""
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path

os.environ.setdefault('QT_QPA_PLATFORM', 'offscreen')
os.environ.setdefault('BEERMAT_MUTE', '1')
sys.path.insert(0, str(Path(__file__).resolve().parent))
from PySide6.QtCore import QObject, QSettings, QUrl                       # noqa: E402
from PySide6.QtQml import QQmlApplicationEngine                            # noqa: E402

from test_desk import DeskCase, HERE, ROOT, app, wait                      # noqa: E402
from beermat_desk import gradients, svgmotion                              # noqa: E402
from beermat_desk.tvscreen import TvScreen, normalise                      # noqa: E402


class AddressesTest(unittest.TestCase):
    def test_addresses(self):
        self.assertEqual(normalise('10.42.0.1'), 'http://10.42.0.1:3000')
        self.assertEqual(normalise(' http://192.168.1.20:3001/ '), 'http://192.168.1.20:3001')
        self.assertEqual(normalise(''), '')


class TvScreenTest(DeskCase):
    def test_the_tv_screen_follows_the_laptop_and_plays_its_sound(self):
        desk = self.desk
        desk.start()
        wait(lambda: desk.connected and desk.view.get('phase'), what='the desk')
        port = desk.server.info['port']
        cache = tempfile.TemporaryDirectory()
        self.addCleanup(cache.cleanup)
        QSettings().setValue('tvScreen/address', f'127.0.0.1:{port}')
        screen = TvScreen(cache.name)
        screen.name = 'Bar TV'
        played = []
        screen.sound.play_file = lambda src, *a, **k: played.append(src)

        # The window: the quiz to find, then the TV.
        engine = QQmlApplicationEngine()
        gradients.install(engine)
        svgmotion.install(engine)
        for name, value in (('desk', screen), ('tvScreen', screen), ('brand', QUrl.fromLocalFile(str(ROOT / 'brand') + '/'))):
            engine.rootContext().setContextProperty(name, value)
        engine.addImportPath(str(HERE / 'qml'))
        engine.load(QUrl.fromLocalFile(str(HERE / 'qml' / 'TvScreen.qml')))
        window = engine.rootObjects()[0]
        self.assertTrue(window.findChild(QObject, 'findQuiz').property('visible'), 'it asks for the quiz first')

        # It finds the quiz where it last was (the rest of the search may find nothing here) and follows its TV.
        screen.search()
        wait(lambda: screen.connected and screen.tv.get('view'), what='the TV screen to connect', timeout=20)
        self.assertFalse(window.findChild(QObject, 'findQuiz').property('visible'))
        desk.refresh()
        wait(lambda: desk.view.get('tvScreens') == ['Bar TV'], what='the desk to see the TV screen')
        self.assertEqual(desk.tvSound.screens, 1)

        # The desk's own playback plays on the screen.
        desk.tvSound.desk_play('/media/clip.mp3', 1200)
        wait(lambda: '/media/clip.mp3' in played, what='the clip on the TV screen')

        # An installed look (Halloween, from the laptop's theme library): its scenery comes from the laptop.
        self.assertNotIn('halloween', screen.lookScenes)
        desk.prefs.setLook('halloween')
        wait(lambda: 'halloween' in screen.lookScenes, what='Halloween’s scenery from the laptop', timeout=20, log=lambda: (screen.tv.get('look'), sorted(screen._asked_looks), desk.view.get('settings', {}).get('look'), self.toasts))
        self.assertTrue((Path(cache.name) / 'tv-screen-themes' / 'halloween' / 'tv.json').exists())
        self.assertIn('halloween', screen.lookPalettes)
        if self.shots:
            for _ in range(20):
                app.processEvents(); time.sleep(0.03)
            window.grabWindow().save(str(Path(self.shots) / 'native-tv-screen.png'))
        engine.deleteLater()


if __name__ == '__main__':
    unittest.main()
