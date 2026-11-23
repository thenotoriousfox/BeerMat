"""The Quizzes page (QuizShelf, QuizEditor): it opens on the quizzes on this laptop (the one on the desk, My quizzes,
downloads from the quiz library), or on the editor while a quiz is under way; Create a new quiz and Clear quiz keep a
copy of the old one in My quizzes; a kept quiz loads again; Share takes the quiz to the quiz library's Share yours, as
the banner at the end of a quiz does; and a theme's picture in the theme library opens large."""
import json
import os
import sys
import time
import unittest
from pathlib import Path

os.environ.setdefault('QT_QPA_PLATFORM', 'offscreen')
os.environ.setdefault('BEERMAT_MUTE', '1')
sys.path.insert(0, str(Path(__file__).resolve().parent))
from PySide6.QtCore import QObject, qInstallMessageHandler, QtMsgType, QUrl   # noqa: E402

from test_desk import DeskCase, app, wait                                     # noqa: E402

problems = []
qInstallMessageHandler(lambda kind, _c, message: problems.append(message) if kind in (QtMsgType.QtWarningMsg, QtMsgType.QtCriticalMsg) and ('qml' in message.lower() or 'TypeError' in message) else None)


def pump(n=30):
    for _ in range(n):
        app.processEvents()
        time.sleep(0.03)


def items(item):
    """Every item under this one; PySide now and then hands back a stale wrapper for an item, which is skipped."""
    yield item
    try:
        children = item.childItems()
    except (TypeError, AttributeError):
        return
    for child in children:
        yield from items(child)


def named(root, name):
    for o in items(root):
        try:
            if o.objectName() == name:
                yield o
        except (TypeError, AttributeError):
            continue


def text_of(root, name):
    return root.findChild(QObject, name).property('text')


def press(root, name):
    button = root.findChild(QObject, name)
    assert button is not None and button.property('visible'), name
    button.clicked.emit()


class QuizShelfTest(DeskCase):
    def test_the_quizzes_on_this_laptop(self):
        desk, w = self.desk, self.window
        desk.start()
        wait(lambda: desk.connected and desk.view.get('phase'), what='the server')
        page = w.findChild(QObject, 'quizzes')
        shelf = w.findChild(QObject, 'quizShelf')
        problems.clear()

        # Nothing on the desk: Create a new quiz goes straight to the editor.
        w.setProperty('workspace', 2)
        pump(20)
        self.assertFalse(page.property('editing'))
        self.assertEqual(text_of(shelf, 'shelfTitle'), 'No quiz yet')
        press(shelf, 'newQuiz')
        pump(5)
        self.assertTrue(page.property('editing'))
        press(w.findChild(QObject, 'quizEditor'), 'allQuizzes')
        pump(5)
        self.assertFalse(page.property('editing'))

        # A quiz loaded and saved: on the desk, and kept in My quizzes.
        desk.loadQuiz(QUrl.fromLocalFile(str(self.quiz_file)))
        wait(lambda: desk.view.get('questions'), what='the quiz', log=self.toasts)
        wait(lambda: desk.quizzes.title == desk.view.get('title'), what='the editor', log=self.toasts)
        desk.quizzes.setTitle('Test quiz')
        desk.quizzes.setTitle('Pub quiz')       # a change, so it saves
        desk.quizzes.save()
        wait(lambda: desk.view.get('title') == 'Pub quiz', what='the saved quiz', log=self.toasts)
        desk.prefs.loadMyQuizzes()
        wait(lambda: any(q['title'] == 'Pub quiz' for q in desk.prefs.myQuizzes.get('mine', [])), what='My quizzes', log=self.toasts)
        pump(20)
        self.assertEqual(text_of(shelf, 'shelfTitle'), 'Pub quiz')
        self.assertEqual(text_of(shelf, 'editQuiz'), 'Edit quiz')
        self.shot('2-quiz-shelf')

        # Share goes to the quiz library's Share yours.
        press(shelf, 'shareCurrent')
        pump(10)
        library = w.findChild(QObject, 'library')
        self.assertEqual((w.property('workspace'), library.property('tab'), library.property('quizTab')), (5, 0, 1))

        # Clear quiz (asked first): an empty desk; the quiz stays in My quizzes and loads again from there.
        w.setProperty('workspace', 2)
        pump(10)
        desk.clearQuiz()
        wait(lambda: desk.view.get('questions') == 0, what='the cleared quiz', log=self.toasts)
        wait(lambda: desk.prefs.myQuizzes.get('mine'), what='the kept quiz')
        kept = next(q for q in desk.prefs.myQuizzes['mine'] if q['title'] == 'Pub quiz')
        self.assertEqual(json.loads(Path(kept['path']).read_text())['title'], 'Pub quiz')
        desk.prefs.loadQuizFile(kept['path'])
        wait(lambda: desk.view.get('title') == 'Pub quiz' and desk.view.get('questions'), what='the kept quiz loaded', log=self.toasts)

        # A quiz under way opens on the editor; once it's finished, the Live page offers to share it.
        desk.next()
        wait(lambda: desk.view.get('running'), what='a question played', log=self.toasts)
        w.setProperty('workspace', 0)
        pump(5)
        w.setProperty('workspace', 2)
        pump(10)
        self.assertTrue(page.property('editing'))
        # A TV without a cable: the TV page's address (/tv on the join address) and how to open it.
        cable = w.findChild(QObject, 'cableFree')
        cable.metaObject().invokeMethod(cable, 'open')
        pump(10)
        # The laptop's address on the venue network (the TV's usual Wi-Fi); without one, the quiz Wi-Fi's.
        wait(lambda: desk.network.get('port'), what='the network')
        pump(5)
        venue = next((a for a in desk.network.get('addresses', []) if a.get('kind') == 'lan'), None)
        port = desk.network['port']
        expected = f"http://{venue['address']}:{port}/tv" if venue else (desk.tv.get('settings') or {}).get('joinUrl', '').rstrip('/') + '/tv'
        self.assertEqual(cable.property('address'), expected)
        self.assertEqual(cable.property('hotspot'), venue is None)
        self.shot('2-tv-without-cable')
        cable.metaObject().invokeMethod(cable, 'close')
        banner = w.findChild(QObject, 'shareFinished')
        self.assertFalse(banner.property('visible'))
        desk.finishConfirmed()
        wait(lambda: desk.view.get('phase') == 'Finished', what='the finished quiz', log=self.toasts)
        w.setProperty('workspace', 0)
        pump(10)
        self.assertTrue(banner.property('visible'))
        w.findChild(QObject, 'shareFinishedButton').clicked.emit()
        pump(5)
        self.assertEqual((w.property('workspace'), library.property('quizTab')), (5, 1))
        self.assertEqual(problems, [])

    def test_the_example_quiz(self):
        """The example quiz BeerMat comes with loads from the Quizzes page, pictures and sounds and all."""
        desk, w = self.desk, self.window
        desk.start()
        wait(lambda: desk.connected and desk.view.get('phase'), what='the server')
        shelf = w.findChild(QObject, 'quizShelf')
        w.setProperty('workspace', 2)
        wait(lambda: desk.prefs.myQuizzes.get('example'), what='the example quiz listed')
        pump(5)
        press(shelf, 'exampleQuiz')
        wait(lambda: desk.view.get('title') == 'BeerMat Example Quiz', what='the example quiz loaded', log=self.toasts)
        example = json.loads((Path(__file__).resolve().parents[2] / 'examples' / 'example-quiz.json').read_text(encoding='utf-8'))
        self.assertEqual(desk.view.get('questions'), sum(len(r['questions']) for r in example['rounds']))
        media = list((Path(self.dir.name) / 'data' / 'media').iterdir())
        self.assertEqual(len(media), 1 + 1 + 1 + 1 + 4 + 15, 'flag, speech, map, video, four clips and fifteen tunes')
        self.assertFalse([e for e in self.toasts if e[1]], self.toasts)
        # Saved as a quiz file with its media, the video goes inside it too.
        wait(lambda: (desk.library._server or {}).get('title') == 'BeerMat Example Quiz', what='the quiz in the editor')
        packed = Path(self.dir.name) / 'packed.json'
        desk.library.export(QUrl.fromLocalFile(str(packed)), True)
        saved = [q for r in json.loads(packed.read_text(encoding='utf-8'))['rounds'] for q in r['questions']]
        self.assertTrue(next(q for q in saved if q['type'] == 'video')['media'].startswith('data:video/mp4;base64,'))

    def test_a_google_drive_link_loads_from_the_quizzes_page(self):
        """The Drive link box is on the Quizzes page (beside Load quiz file), not in the editor; the quiz it fetches loads."""
        desk, w = self.desk, self.window
        desk.start()
        wait(lambda: desk.connected and desk.view.get('phase'), what='the server')
        shelf, editor = w.findChild(QObject, 'quizShelf'), w.findChild(QObject, 'quizEditor')
        w.setProperty('workspace', 2)
        pump(10)
        self.assertEqual(list(named(editor, 'driveLink')), [], 'not in the editor')
        field = shelf.findChild(QObject, 'driveLink')
        self.assertTrue(field.property('visible'))
        self.assertFalse(shelf.findChild(QObject, 'driveLoad').property('enabled'), 'nothing to load yet')
        asked, real = [], desk.api.host
        desk.api.host = lambda route, body, done=None, failed=None, **kw: asked.append((route, body, done)) if route == 'drive' else real(route, body, done, failed, **kw)
        try:
            field.setProperty('text', ' https://drive.google.com/file/d/abc/view ')
            pump(3)
            press(shelf, 'driveLoad')
            pump(3)
            self.assertEqual([(r, b) for r, b, _ in asked], [('drive', {'url': 'https://drive.google.com/file/d/abc/view'})])
            self.assertEqual(field.property('text'), '')
            quiz = {'title': 'From Drive', 'rounds': [{'id': 'r1', 'title': 'Round 1', 'questions': [{'id': 'q1', 'type': 'text', 'text': 'Capital of France?', 'seconds': 30, 'points': 1, 'answer': 'Paris'}]}]}
            asked[0][2]({'quiz': quiz})
            wait(lambda: desk.view.get('title') == 'From Drive', what='the Drive quiz loaded', log=self.toasts)
        finally:
            desk.api.host = real

    def test_a_theme_picture_opens_large(self):
        desk, w = self.desk, self.window
        desk.start()
        wait(lambda: desk.connected and desk.view.get('phase'), what='the server')
        picture = Path(self.dir.name) / 'previews' / 's-0123456789' / 'previews'
        picture.mkdir(parents=True)
        from PySide6.QtGui import QImage, QColor
        image = QImage(1600, 900, QImage.Format.Format_RGB32)
        image.fill(QColor('#ff7a1a'))
        image.save(str(picture / 'tv'), 'JPEG')
        desk.prefs.searchThemes = desk.prefs.searchQuizzes = desk.prefs.searchLibrary = lambda q: None
        desk.prefs._themes = {'pro': True, 'previews': QUrl.fromLocalFile(str(Path(self.dir.name) / 'previews')).toString() + '/', 'query': '',
                              'themes': [{'id': 's-0123456789', 'name': 'Pumpkin', 'look': True, 'tv': True, 'sounds': False, 'previews': ['tv']}],
                              'installed': [], 'mine': [], 'shared': []}
        desk.prefs.themesChanged.emit()
        w.setProperty('workspace', 5)
        w.findChild(QObject, 'library').setProperty('tab', 2)
        pump(40)
        enlarged = w.findChild(QObject, 'enlargedPreview')
        self.assertFalse(enlarged.property('visible'))
        page = next(o for o in w.findChildren(QObject) if o.metaObject().className().startswith('ThemeLibrary'))
        wait(lambda: any(o.property('enabled') for o in named(page, 'preview-tv')), what='the TV picture')
        area = next(o for o in named(page, 'preview-tv') if o.property('enabled'))
        from PySide6.QtCore import QPointF, Qt
        from PySide6.QtTest import QTest
        centre = area.mapToScene(QPointF(area.property('width') / 2, area.property('height') / 2))
        QTest.mouseClick(w, Qt.MouseButton.LeftButton, Qt.KeyboardModifier.NoModifier, centre.toPoint())
        pump(20)
        self.assertTrue(enlarged.property('visible'))
        self.assertTrue(enlarged.property('source').toString().endswith('/previews/tv'))
        self.assertGreater(enlarged.property('width'), 900)
        self.shot('2-theme-enlarged')


if __name__ == '__main__':
    unittest.main()
