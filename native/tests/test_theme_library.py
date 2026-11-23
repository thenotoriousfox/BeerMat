"""The theme library in the desk (Settings → Looks → Theme library…): the library with each theme's pictures and
whether it's installed, My themes with where each shared one has got to, and sharing, which draws the theme on the TV
and in the app and sends those pictures. The library's contents are made up here; tests/theme-library.test.js runs the
real round trip through BeerMat Online."""
import os
import sys
import time
import unittest
from pathlib import Path

os.environ.setdefault('QT_QPA_PLATFORM', 'offscreen')
os.environ.setdefault('BEERMAT_MUTE', '1')   # tests make the TV's sounds without playing them aloud
sys.path.insert(0, str(Path(__file__).resolve().parent))
from PySide6.QtCore import QObject, qInstallMessageHandler, QtMsgType   # noqa: E402
from PySide6.QtGui import QImage                                        # noqa: E402

from test_desk import DeskCase, app, wait                               # noqa: E402

problems = []
qInstallMessageHandler(lambda kind, _c, message: problems.append(message) if kind in (QtMsgType.QtWarningMsg, QtMsgType.QtCriticalMsg) and ('qml' in message.lower() or 'TypeError' in message) else None)


def pump(n=30):
    for _ in range(n):
        app.processEvents()
        time.sleep(0.03)


def items(item):
    yield item
    for child in item.childItems():
        yield from items(child)


class ThemeLibraryTest(DeskCase):
    def test_browse_my_themes_and_share_with_pictures(self):
        desk, w = self.desk, self.window
        desk.start()
        wait(lambda: desk.connected and desk.view.get('phase'), what='the server')
        desk.prefs.searchThemes = lambda q: None
        desk.prefs._themes = {'pro': True, 'previews': 'file:///nowhere/', 'folder': '/my-themes', 'query': '',
                              'themes': [{'id': 's-0123456789', 'name': 'Haunted Hill', 'look': True, 'tv': True, 'sounds': False, 'previews': []}],
                              'installed': [{'id': 's-0123456789', 'name': 'Haunted Hill'}],
                              'mine': [{'id': 'halloween', 'name': 'My Halloween', 'builtIn': False}],
                              'shared': [{'id': 's-1111111111', 'local': 'halloween', 'name': 'My Halloween', 'status': 'rejected', 'note': 'Too spooky.'}]}
        desk.prefs.themesChanged.emit()
        problems.clear()
        # Library (left rail), Themes.
        w.setProperty('workspace', 5)
        library = w.findChild(QObject, 'library')
        library.setProperty('tab', 2)
        pump(40)
        dialog = next(o for o in w.findChildren(QObject) if o.metaObject().className().startswith('ThemeLibrary'))
        self.shot('2-library-themes')
        shown = lambda: [o.property('text') for o in items(dialog) if isinstance(o.property('text'), str) and o.property('visible')]
        self.assertIn('Haunted Hill', shown())
        self.assertIn('✓ Installed', shown())
        dialog.setProperty('tab', 1)
        pump()
        self.assertIn('Shared, and turned down: Too spooky.', shown())
        # Sharing draws the theme on the TV and in the app, and sends both pictures, full size.
        dialog.setProperty('sharing', 'halloween')
        share = dialog.findChild(QObject, 'shareTheme')
        share.metaObject().invokeMethod(share, 'open')
        pump(60)
        inside = list(items(share.property('contentItem')))
        sent = []
        desk.prefs.shareTheme = lambda *a: sent.append(a)
        button = next(o for o in inside if o.property('text') == 'Share' and 'DeskButton' in o.metaObject().className())
        self.assertFalse(button.property('enabled'), 'only once the right to share is ticked')
        next(o for o in inside if 'CheckBox' in o.metaObject().className()).setProperty('checked', True)
        pump(5)
        button.clicked.emit()
        wait(lambda: sent, what='the share')
        theme, rights, tv, phone = sent[0]
        self.assertEqual((theme, rights), ('halloween', True))
        self.assertEqual((QImage(tv).width(), QImage(tv).height()), (1600, 900))
        self.assertEqual((QImage(phone).width(), QImage(phone).height()), (780, 1688))
        self.assertEqual(problems, [])


if __name__ == '__main__':
    unittest.main()
