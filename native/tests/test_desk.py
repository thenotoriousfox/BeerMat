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
import urllib.error
import urllib.request
from pathlib import Path

os.environ.setdefault('QT_QPA_PLATFORM', 'offscreen')

from PySide6.QtCore import QObject, QUrl                           # noqa: E402
from PySide6.QtGui import QFontDatabase, QGuiApplication           # noqa: E402
from PySide6.QtQml import QQmlApplicationEngine                    # noqa: E402
from PySide6.QtQuickControls2 import QQuickStyle                   # noqa: E402

from beermat_desk.desk import Desk                                 # noqa: E402
from beermat_desk.screens import Screens                           # noqa: E402
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


class DeskCase(unittest.TestCase):
    """The real server and the QML desk, offscreen; shared by the desk tests."""
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.quiz_file = Path(self.dir.name) / 'test-quiz.json'
        subprocess.run(['node', str(ROOT / 'scripts' / 'load-test-quiz.mjs'), '--json', str(self.quiz_file)], check=True, capture_output=True)
        self.desk = Desk(Path(self.dir.name) / 'data', 'native-test-key-0123456789', port=0, laptop=False)
        self.engine = QQmlApplicationEngine()
        self.screens = Screens()
        self.engine.rootContext().setContextProperty('desk', self.desk)
        self.engine.rootContext().setContextProperty('screens', self.screens)
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

    def shot(self, name, window=None):
        if self.shots:
            for _ in range(10):
                app.processEvents()
                time.sleep(0.03)
            (window or self.window).grabWindow().save(str(Path(self.shots) / f'native-{name}.png'))


class DeskTest(DeskCase):
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

        # Quizzes: edit a question and save it through the server, which checks it; a bad edit is refused, not saved.
        lib = desk.quizzes
        wait(lambda: lib.outline, what='the quiz outline')
        first = next(r for r in lib.outline if r['kind'] == 'question')
        lib.select(first['round'], first['question'])
        self.assertEqual(lib.question['type'], 'choice')
        lib.setField('answerNote', 'Rust, mostly.')
        self.assertTrue(lib.dirty)
        lib.save()
        wait(lambda: not lib.dirty, what='the quiz to save', log=self.toasts)
        saved = http(desk.server.info['port'], 'host/library', {}, desk.api.session)
        self.assertEqual(saved['rounds'][first['round']]['questions'][first['question']]['answerNote'], 'Rust, mostly.')
        lib.setField('options', 'Only one')
        lib.save()
        wait(lambda: any(e and m.startswith('Not saved') for m, e in self.toasts), what='the server to refuse a bad question')
        self.assertTrue(lib.dirty)
        lib.revert()
        self.window.setProperty('workspace', 2)
        lib.select(first['round'], first['question'])
        self.shot('2-quizzes')
        self.window.setProperty('workspace', 0)

        # A Free laptop rehearses: simulated teams play, and real phones join only as test devices.
        self.assertEqual(desk.view['mode'], 'rehearsal')
        self.assertFalse(desk.view['canGoLive'])
        port, session = desk.server.info['port'], desk.api.session
        desk.startRehearsal(2)
        wait(lambda: len(desk.view.get('teams', [])) == 2 and all(t['connected'] for t in desk.view['sims']), timeout=20, what='two simulated teams', log=self.toasts)
        player = desk.view['sims'][0]['name']
        http(port, 'host/rehearsal/team', {'name': player, 'manual': True}, session)
        phone = http(port, 'join', {'name': 'Dave\'s phone'})
        self.assertTrue(phone.get('rehearsal'))
        wait(lambda: [d['name'] for d in desk.view.get('devices', [])] == ["Dave's phone"], what='the test phone, listed apart')
        self.assertNotIn("Dave's phone", [t['name'] for t in desk.view['teams']])
        # The native TV reads the same public state as the web TV: the join screen until the first question.
        wait(lambda: desk.tv.get('view') == 'join' and desk.tv.get('protocol') == 1 and desk.tv.get('rehearsal') is True, what='the TV state')
        tv = self.window.findChild(QObject, 'tv')
        self.assertIsNotNone(tv, 'the TV window exists')
        self.screens.setOpen(True)
        wait(lambda: tv.isVisible(), what='the TV window to open')
        self.shot('tv-join', tv)
        self.shot('2-loaded')
        self.window.setProperty('workspace', 1)
        self.shot('2-rehearsal')
        # Venue & network: the server's addresses, and the venue-network join mode set through the desk.
        self.window.setProperty('workspace', 4)
        wait(lambda: desk.network.get('port') == port, what='the network details')
        lan = next((a['address'] for a in desk.network['addresses'] if a['kind'] != 'hotspot'), None)
        if lan:
            desk.useLan(lan, 'Pub Guest')
            wait(lambda: desk.network['joinMode'] == 'lan' and desk.tv['settings']['joinUrl'] == f'http://{lan}:{port}', what='the TV to show the venue address', log=self.toasts)
        self.shot('2-venue')
        # Settings on the server: the quiz room, a sound for a moment, a buzzer sound, bingo calls; Spotify is Pro.
        prefs = desk.prefs
        prefs.set('maxTeams', 20)
        wait(lambda: desk.view['settings'].get('maxTeams') == 20, what='the team limit', log=self.toasts)
        sound = Path(self.dir.name) / 'ding.wav'
        from beermat_desk.tvsound import synth
        synth(sound, [(660, 0)], 'sine')
        prefs.setSound('correct', QUrl.fromLocalFile(str(sound)))
        wait(lambda: str(desk.tv.get('sounds', {}).get('slots', {}).get('correct', '')).startswith('/media/'), what='the uploaded sound', log=self.toasts)
        buzzers = len(desk.tv['sounds']['buzzers'])
        prefs.addBuzzer('Ding', QUrl.fromLocalFile(str(sound)))
        wait(lambda: len(desk.tv['sounds']['buzzers']) == buzzers + 1, what='the buzzer sound', log=self.toasts)
        calls = Path(self.dir.name) / 'calls.txt'
        calls.write_text('\n'.join(f'Number {n}' for n in range(1, 91)))
        prefs.importCalls(QUrl.fromLocalFile(str(calls)))
        wait(lambda: any('90 bingo calls imported' in m for m, _ in self.toasts), what='the bingo calls', log=self.toasts)
        calls.write_text('too short')
        prefs.importCalls(QUrl.fromLocalFile(str(calls)))
        wait(lambda: any(e and 'need 90 lines' in m for m, e in self.toasts), what='short calls refused')
        prefs.loadSpotify()
        wait(lambda: prefs.spotify.get('locked') is True, what='Spotify locked on Free', log=self.toasts)
        self.window.setProperty('workspace', 5)
        self.shot('2-settings')
        self.window.setProperty('workspace', 0)

        desk.next()
        wait(lambda: desk.view.get('question') and desk.view['phase'] == 'Live', what='the first question to open')
        q = desk.view['question']
        self.assertEqual((q['text'], q['type'], len(q['options']), q['answer']), ('Which planet is known as the Red Planet?', 'Multiple choice', 4, 'Mars'))
        self.assertTrue(desk.view['canClose'] and not desk.view['canReveal'] and not desk.view['next']['enabled'])
        # The server, not the desk, keeps the test phone out of the game.
        with self.assertRaises(urllib.error.HTTPError) as refused:
            http(port, 'answer', {'question': 1, 'value': 'Mars'}, phone['secret'])
        self.assertEqual(refused.exception.code, 403)
        result = http(port, 'host/rehearsal/team', {'name': player, 'action': 'right'}, session)
        self.assertTrue(result['result']['ok'], result)
        wait(lambda: desk.view.get('answers', 0) >= 1, what='the answer to arrive')
        self.assertEqual(desk.tv['view'], 'question')
        self.assertNotIn('answer', desk.tv['question'], 'the TV never gets the answer before the reveal')
        self.shot('tv-question', tv)
        self.shot('3-live')

        desk.closeAnswers()
        wait(lambda: desk.view['phase'] == 'Answers closed' and desk.view['canReveal'], what='answers to close')
        desk.reveal()
        wait(lambda: desk.view['question']['revealed'], timeout=20, what='the reveal (after the drum roll)', log=lambda: (self.toasts, desk.view['phase'], {k: desk._state['question'].get(k) for k in ('open', 'live', 'revealing', 'revealed')}))
        self.assertEqual(next(t for t in desk.view['teams'] if t['name'] == player)['score'], 1)
        # Teams & marking: the answers to the closed question, marked by hand and corrected (the server keeps score).
        row = next(r for r in desk.view['answerRows'] if r['team'] == player)
        self.assertEqual((row['value'], row['points']), ('Mars', 1))
        self.assertTrue(desk.view['canMark'])
        other = next(t['id'] for t in desk.view['allTeams'] if t['name'] != player)
        desk.mark(other, 2)
        wait(lambda: next(t for t in desk.view['allTeams'] if t['id'] == other)['score'] == 2, what='a hand mark', log=self.toasts)
        desk.adjust(other, -2, 'Marked by mistake')
        wait(lambda: next(t for t in desk.view['allTeams'] if t['id'] == other)['score'] == 0, what='a score correction', log=self.toasts)
        desk.teamNote(other, 'Table 4')
        wait(lambda: next(t for t in desk.view['allTeams'] if t['id'] == other)['note'] == 'Table 4', what='a team note', log=self.toasts)
        desk.setBlockedWords('rude\nworse')
        wait(lambda: desk.view['blockedWords'] == 'rude\nworse', what='blocked names', log=self.toasts)
        with self.assertRaises(urllib.error.HTTPError):
            http(port, 'join', {'name': 'Rude Dudes'})
        # Reviewing the question on now is the same as marking it (a past one is reviewed in test_live).
        desk.review(desk.view['history'][0]['id'])
        wait(lambda: desk.view['marking']['id'] == desk.view['history'][0]['id'], what='the review')
        desk.review(0)
        self.window.setProperty('workspace', 3)
        self.shot('2-teams')
        self.window.setProperty('workspace', 0)
        wait(lambda: desk.tv['question'].get('revealed') and desk.tv['question'].get('answer') == 'Mars', what='the TV to get the revealed answer')
        self.shot('tv-revealed', tv)
        self.screens.setBlank(True)
        self.assertTrue(self.screens.blanked)
        self.screens.setOpen(False)
        wait(lambda: not tv.isVisible() and not self.screens.blanked, what='the TV to close (and unblank)')
        self.shot('4-revealed')

        # The server dies mid-quiz: the desk starts it again and the quiz is exactly where it was.
        desk.server._process.kill()
        wait(lambda: not desk.connected, what='the desk to notice')
        wait(lambda: desk.connected and desk.view.get('question'), timeout=20, what='the server to come back')
        self.assertEqual(desk.view['question']['text'], 'Which planet is known as the Red Planet?')
        self.assertEqual(next(t for t in desk.view['teams'] if t['name'] == player)['score'], 1)

        desk.next()
        wait(lambda: desk.view['question']['text'] == 'Tick every prime number', what='the next question')
        self.shot('5-next')

        process = desk.server._process
        desk.stop()
        self.assertEqual(process.state().name, 'NotRunning', 'closing the desk stops the quiz server')


if __name__ == '__main__':
    unittest.main()
