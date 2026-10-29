"""The quiz library in the desk (Library → Quizzes): each quiz with who shared it, its description, rounds and formats;
Download and load puts it on the desk as Load quiz file does; Share sends the quiz on the desk once the right to share
is ticked; quizzes this laptop shared show where they've got to. The library's contents are made up here;
tests/quiz-library.test.js runs the real round trip through BeerMat Online."""
import os
import sys
import time
import unittest
from pathlib import Path

os.environ.setdefault('QT_QPA_PLATFORM', 'offscreen')
os.environ.setdefault('BEERMAT_MUTE', '1')
sys.path.insert(0, str(Path(__file__).resolve().parent))
from PySide6.QtCore import QObject, qInstallMessageHandler, QtMsgType   # noqa: E402

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


class QuizLibraryTest(DeskCase):
    def test_browse_download_and_share(self):
        desk, w = self.desk, self.window
        desk.start()
        wait(lambda: desk.connected and desk.view.get('phase'), what='the server')
        desk.prefs.searchQuizzes = lambda q: None
        desk.prefs._quizzes = {'pro': True, 'query': '', 'downloaded': [], 'current': {'title': 'My quiz', 'rounds': 2, 'questions': 12},
                               'quizzes': [{'id': 'q-0123456789', 'title': 'Pub Classics', 'by': 'The Red Lion', 'description': 'Six easy rounds for a Tuesday.',
                                            'rounds': 2, 'questions': 3, 'formats': ['Multiple choice', 'Picture'],
                                            'outline': [{'title': 'General knowledge', 'questions': 2}, {'title': 'Flags', 'questions': 1}]}],
                               'shared': [{'id': 'q-1111111111', 'title': 'Old quiz', 'status': 'rejected', 'note': 'Answers are wrong.'}]}
        desk.prefs.quizzesChanged.emit()
        problems.clear()
        # Library (left rail), Quizzes: the first tab.
        w.setProperty('workspace', 5)
        library = w.findChild(QObject, 'library')
        library.setProperty('tab', 0)
        pump(40)
        page = next(o for o in w.findChildren(QObject) if o.metaObject().className().startswith('QuizLibrary'))
        self.shot('2-library-quizzes')
        shown = lambda: [o.property('text') for o in items(page) if isinstance(o.property('text'), str) and o.property('visible')]
        for text in ('Pub Classics', 'Six easy rounds for a Tuesday.', 'By The Red Lion · 2 rounds · 3 questions', 'General knowledge (2)  ·  Flags (1)', 'Picture', 'Download and load'):
            self.assertIn(text, shown())

        # Download and load: the quiz file the server saved is loaded, as Load quiz file does.
        calls, real = [], desk.prefs.api.host

        def host(route, body=None, ok=None, fail=None, timeout_ms=15000):
            if route.startswith('quiz-library/'):
                calls.append((route, body))
                return ok({'id': body.get('id'), 'title': 'Test quiz', 'path': str(self.quiz_file)}) if route == 'quiz-library/download' else ok({'title': 'My quiz'})
            return real(route, body, ok, fail, timeout_ms)
        desk.prefs.api.host = host
        button = next(o for o in items(page) if o.property('text') == 'Download and load' and o.property('visible'))
        button.clicked.emit()
        wait(lambda: any('Quiz loaded: Test quiz' in m for m, _ in self.toasts), what='the downloaded quiz loaded', log=self.toasts)
        self.assertEqual(calls[0], ('quiz-library/download', {'id': 'q-0123456789'}))

        # Share yours: only once the right to share is ticked; quizzes shared from here show where they've got to.
        page.setProperty('tab', 1)
        pump(20)
        self.assertIn('Turned down: Answers are wrong.', shown())
        share = page.findChild(QObject, 'shareQuiz')
        self.assertFalse(share.property('enabled'))
        page.findChild(QObject, 'quizDescription').setProperty('text', 'A spooky one')
        page.findChild(QObject, 'quizRights').setProperty('checked', True)
        pump(5)
        self.assertTrue(share.property('enabled'))
        share.clicked.emit()
        wait(lambda: any(r == 'quiz-library/share' for r, _ in calls), what='the share')
        self.assertEqual(next(b for r, b in calls if r == 'quiz-library/share'), {'description': 'A spooky one', 'rights': True})
        self.assertEqual(problems, [])


if __name__ == '__main__':
    unittest.main()
