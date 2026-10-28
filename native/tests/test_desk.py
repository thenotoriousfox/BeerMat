"""BeerMat Desk end to end, with no screen (Qt's offscreen platform): the real quiz server (desktop/server-host.js) and
the real QML window. Loads the rehearsal quiz, teams join and answer over HTTP as phones do, the desk runs a question
from open to reveal, the server is killed mid-quiz and comes back with nothing lost, and closing stops it.

    cd native && python -m unittest discover -s tests          (BEERMAT_SHOTS=<folder> also saves screenshots)
"""
import json
import os
import subprocess
import tempfile
import time
import unittest
import urllib.request
from pathlib import Path

os.environ.setdefault('QT_QPA_PLATFORM', 'offscreen')

from PySide6.QtCore import QUrl                                    # noqa: E402
from PySide6.QtGui import QFontDatabase, QGuiApplication           # noqa: E402
from PySide6.QtQml import QQmlApplicationEngine                    # noqa: E402
from PySide6.QtQuickControls2 import QQuickStyle                   # noqa: E402

from beermat_desk.desk import Desk                                 # noqa: E402
from beermat_desk.server import ROOT                               # noqa: E402

HERE = Path(__file__).resolve().parents[1] / 'beermat_desk'
app = QGuiApplication.instance() or QGuiApplication(['test'])
QQuickStyle.setStyle('Basic')
QFontDatabase.addApplicationFont(str(ROOT / 'brand' / 'fredoka.woff2'))


def wait(condition, timeout=15, what='condition', log=None):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        app.processEvents()
        if condition():
            return
        time.sleep(0.02)
    raise AssertionError(f'Timed out waiting for {what}' + (f'; the desk said: {log() if callable(log) else log}' if log else ''))


def http(port, route, body, key=''):
    request = urllib.request.Request(f'http://127.0.0.1:{port}/api/{route}', json.dumps(body).encode(),
                                     {'Content-Type': 'application/json', 'Authorization': f'Bearer {key}'})
    with urllib.request.urlopen(request, timeout=10) as reply:
        return json.loads(reply.read())


class DeskTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.quiz_file = Path(self.dir.name) / 'test-quiz.json'
        subprocess.run(['node', str(ROOT / 'scripts' / 'load-test-quiz.mjs'), '--json', str(self.quiz_file)], check=True, capture_output=True)
        self.desk = Desk(Path(self.dir.name) / 'data', 'native-test-key-0123456789', port=0, laptop=False)
        self.engine = QQmlApplicationEngine()
        self.engine.rootContext().setContextProperty('desk', self.desk)
        self.engine.rootContext().setContextProperty('brand', QUrl.fromLocalFile(str(ROOT / 'brand') + '/'))
        self.engine.addImportPath(str(HERE / 'qml'))
        self.engine.load(QUrl.fromLocalFile(str(HERE / 'qml' / 'Main.qml')))
        self.assertTrue(self.engine.rootObjects(), 'the QML desk loads')
        self.window = self.engine.rootObjects()[0]
        self.shots = os.environ.get('BEERMAT_SHOTS')
        self.toasts = []
        self.desk.toast.connect(lambda message, error: self.toasts.append((message, error)))

    def tearDown(self):
        self.desk.stop()
        del self.engine
        app.processEvents()
        self.dir.cleanup()

    def shot(self, name):
        if self.shots:
            for _ in range(10):
                app.processEvents()
                time.sleep(0.03)
            self.window.grabWindow().save(str(Path(self.shots) / f'native-{name}.png'))

    def test_runs_a_question_and_survives_a_server_crash(self):
        desk = self.desk
        desk.start()
        wait(lambda: desk.connected and desk.view.get('phase'), what='the server, the desk session and live updates')
        self.assertEqual(desk.view['phase'], 'Preparing')
        self.shot('1-empty')

        desk.loadQuizConfirmed(str(self.quiz_file))
        wait(lambda: desk.view.get('title') == 'Test quiz', timeout=30, what='the quiz to load', log=self.toasts)
        self.assertGreater(len(desk.view['upcoming']), 15)
        self.assertEqual(desk.view['next']['label'], 'Start next question')

        port, session = desk.server.info['port'], desk.api.session
        http(port, 'host/settings', {'waitingRoom': False}, session)
        bears = http(port, 'join', {'name': 'The Quizzly Bears'})
        http(port, 'join', {'name': 'Les Quizerables'})
        wait(lambda: len(desk.view.get('teams', [])) == 2, what='two teams in the room')
        self.shot('2-loaded')

        desk.next()
        wait(lambda: desk.view.get('question') and desk.view['phase'] == 'Live', what='the first question to open')
        q = desk.view['question']
        self.assertEqual((q['text'], q['type'], len(q['options']), q['answer']), ('Which planet is known as the Red Planet?', 'Multiple choice', 4, 'Mars'))
        self.assertTrue(desk.view['canClose'] and not desk.view['canReveal'] and not desk.view['next']['enabled'])
        secret = bears.get('secret') or bears.get('code') or bears.get('key')
        http(port, 'answer', {'question': 1, 'value': 'Mars'}, secret)
        wait(lambda: desk.view.get('answers') == 1, what='the answer to arrive')
        self.shot('3-live')

        desk.closeAnswers()
        wait(lambda: desk.view['phase'] == 'Answers closed' and desk.view['canReveal'], what='answers to close')
        desk.reveal()
        wait(lambda: desk.view['question']['revealed'], timeout=20, what='the reveal (after the drum roll)', log=lambda: (self.toasts, desk.view['phase'], {k: desk._state['question'].get(k) for k in ('open', 'live', 'revealing', 'revealed')}))
        self.assertEqual(next(t for t in desk.view['teams'] if t['name'] == 'The Quizzly Bears')['score'], 1)
        self.shot('4-revealed')

        # The server dies mid-quiz: the desk starts it again and the quiz is exactly where it was.
        desk.server._process.kill()
        wait(lambda: not desk.connected, what='the desk to notice')
        wait(lambda: desk.connected and desk.view.get('question'), timeout=20, what='the server to come back')
        self.assertEqual(desk.view['question']['text'], 'Which planet is known as the Red Planet?')
        self.assertEqual(next(t for t in desk.view['teams'] if t['name'] == 'The Quizzly Bears')['score'], 1)

        desk.next()
        wait(lambda: desk.view['question']['text'] == 'Tick every prime number', what='the next question')
        self.shot('5-next')

        process = desk.server._process
        desk.stop()
        self.assertEqual(process.state().name, 'NotRunning', 'closing the desk stops the quiz server')


if __name__ == '__main__':
    unittest.main()
