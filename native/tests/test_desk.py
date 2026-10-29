"""BeerMat Desk end to end, with no screen (Qt's offscreen platform): the real quiz server (desktop/server-host.js) and
the real QML window. Loads the rehearsal quiz, teams join and answer over HTTP as phones do, the desk runs a question
from open to reveal, the server is killed mid-quiz and comes back with nothing lost, and closing stops it.

    cd native && python -m unittest discover -s tests          (BEERMAT_SHOTS=<folder> also saves screenshots)
"""
import json
import os
import shutil
import subprocess
import tempfile
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path

os.environ.setdefault('QT_QPA_PLATFORM', 'offscreen')
os.environ.setdefault('BEERMAT_MUTE', '1')   # tests make the TV's sounds without playing them aloud

from PySide6.QtCore import QObject, QSettings, QUrl                           # noqa: E402
from PySide6.QtGui import QFontDatabase, QGuiApplication           # noqa: E402
from PySide6.QtQml import QQmlApplicationEngine                    # noqa: E402
from PySide6.QtQuickControls2 import QQuickStyle                   # noqa: E402

from beermat_desk import gradients                                 # noqa: E402
from beermat_desk.desk import Desk                                 # noqa: E402
from beermat_desk.screens import Screens                           # noqa: E402
from beermat_desk.server import ROOT                               # noqa: E402

HERE = Path(__file__).resolve().parents[1] / 'beermat_desk'
app = QGuiApplication.instance() or QGuiApplication(['test'])
# Tests keep their own preferences (screens, sound output, first run), away from the real desk's.
app.setOrganizationName('BeerMat-test')
QQuickStyle.setStyle('Basic')
for font in ('fredoka.woff2', 'fredoka-regular.ttf', 'fredoka-medium.ttf', 'fredoka-semibold.ttf', 'fredoka-bold.ttf'):
    QFontDatabase.addApplicationFont(str(ROOT / 'brand' / font))


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
    first_run = False

    def setUp(self):
        QSettings().setValue('welcomed', not self.first_run)
        self.dir = tempfile.TemporaryDirectory()
        self.quiz_file = Path(self.dir.name) / 'test-quiz.json'
        subprocess.run(['node', str(ROOT / 'scripts' / 'load-test-quiz.mjs'), '--json', str(self.quiz_file)], check=True, capture_output=True)
        # Halloween installed from the theme library (it isn't shipped): the looks test uses it.
        shutil.copytree(ROOT / 'library' / 'halloween', Path(self.dir.name) / 'data' / 'my-themes' / 'halloween')
        self.desk = Desk(Path(self.dir.name) / 'data', 'native-test-key-0123456789', port=0, laptop=False)
        self.engine = QQmlApplicationEngine()
        gradients.install(self.engine)
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


class ClosingTest(DeskCase):
    def test_closing_the_desk_ends_beermat_even_with_the_tv_open(self):
        """In Qt 6 a quit asks each window first, and the TV window refuses (its ✕ only hides it): closing the desk with
        the TV open used to leave BeerMat running unseen. The event loop must really end."""
        from PySide6.QtCore import QTimer
        tv = self.window.findChild(QObject, 'tv')
        self.screens.setOpen(True)
        wait(lambda: tv.property('visible'), what='the TV window')
        QTimer.singleShot(200, self.window.close)
        QTimer.singleShot(4000, lambda: app.exit(99))     # still running: the bug
        self.assertEqual(app.exec(), 0, 'closing the desk ended BeerMat')


class BackTest(DeskCase):
    def test_back_takes_a_question_back_and_reopens_answers(self):
        desk = self.desk
        desk.start()
        wait(lambda: desk.connected and desk.view.get('phase'), what='the server')
        desk.loadQuizConfirmed(str(self.quiz_file))
        wait(lambda: desk.view.get('title') == 'Test quiz', timeout=30, what='the quiz', log=self.toasts)
        self.assertIsNone(desk.view.get('back'), 'nothing to go back to yet')
        desk.next()
        wait(lambda: (desk.view.get('back') or {}).get('kind') == 'start', what='a question to take back', log=self.toasts)
        desk.back()
        wait(lambda: desk.view.get('back') is None and desk.view['next']['label'] == 'Start next question', what='the question taken back', log=self.toasts)
        desk.next()
        wait(lambda: (desk.view.get('back') or {}).get('kind') == 'start', what='the question again')
        # With answers in (the server counts them; tests/hosting.test.js covers that), Back asks first.
        asked = []
        desk.confirmBack.connect(asked.append)
        desk._state['back'] = {**desk._state['back'], 'answers': 1}
        desk.back()
        self.assertEqual(asked, ['1 team has answered; those answers are thrown away.'])
        desk.refresh()
        # Closing answers goes back to answers open.
        desk.closeAnswers()
        wait(lambda: (desk.view.get('back') or {}).get('kind') == 'close', what='answers closed', log=self.toasts)
        desk.back()
        wait(lambda: desk.view.get('canClose') and (desk.view.get('back') or {}).get('kind') == 'start', what='answers reopened', log=self.toasts)


class QuizzesPageTest(DeskCase):
    def test_loading_a_quiz_replaces_the_quizzes_page(self):
        desk, lib = self.desk, self.desk.quizzes
        desk.start()
        wait(lambda: desk.connected and desk.view.get('phase'), what='the server')
        desk.loadQuizConfirmed(str(self.quiz_file))
        wait(lambda: lib.title == 'Test quiz' and lib.outline, timeout=30, what='the quiz on the Quizzes page', log=self.toasts)
        first = next(r for r in lib.outline if r['kind'] == 'question')
        lib.select(first['round'], first['question'])
        # Clicking into a box and out again, nothing typed: nothing changed, so nothing is unsaved.
        lib.setField('text', lib.question['text'])
        lib.setField('answerNote', lib.question.get('answerNote') or '')
        self.assertFalse(lib.dirty)
        second = json.loads(self.quiz_file.read_text())
        second['title'], second['rounds'] = 'Second quiz', second['rounds'][:1]
        path = Path(self.dir.name) / 'second.json'
        path.write_text(json.dumps(second))
        desk.loadQuizConfirmed(str(path))
        wait(lambda: lib.title == 'Second quiz', timeout=30, what='the second quiz on the Quizzes page', log=self.toasts)
        # A real unsaved edit: loading asks first, then the loaded quiz replaces it.
        lib.select(0, 0)
        lib.setField('text', 'An edit nobody saved')
        self.assertTrue(lib.dirty)
        asked = []
        desk.confirmLoad.connect(asked.append)
        desk.loadQuiz(str(self.quiz_file))
        self.assertEqual(asked, [str(self.quiz_file)])
        desk.loadQuizConfirmed(str(self.quiz_file))
        wait(lambda: lib.title == 'Test quiz' and not lib.dirty, timeout=30, what='the loaded quiz to replace the unsaved edit', log=self.toasts)
        self.assertNotIn('An edit nobody saved', [r['text'] for r in lib.outline])


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
        # Format options, a picture upload, and the pinpoint target, saved and checked by the server.
        lib.select(first['round'], first['question'])
        evil = next(o for o in lib.question['options_'] if o['key'] == 'evil')
        self.assertFalse(evil['value'])
        lib.setOption('evil', 'true')
        lib.setOption('speedBonus', '5')
        picture = Path(self.dir.name) / 'red.png'
        picture.write_bytes(bytes.fromhex('89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c4944415408d763f8cfc000000301010018dd8db00000000049454e44ae426082'))
        lib.uploadMedia('media', QUrl.fromLocalFile(str(picture)))
        wait(lambda: str(lib.question.get('media', '')).startswith('/media/'), what='the uploaded picture', log=self.toasts)
        lib.save()
        wait(lambda: not lib.dirty, what='the options to save', log=self.toasts)
        saved = http(desk.server.info['port'], 'host/library', {}, desk.api.session)['rounds'][first['round']]['questions'][first['question']]
        self.assertEqual((saved['evil'], saved['speedBonus'], saved['media'][:7]), (True, 5, '/media/'))
        pin = next(r for r in lib.outline if r['kind'] == 'question' and r['type'] == 'Pinpoint')
        lib.select(pin['round'], pin['question'])
        lib.setTarget(0.25, 0.75)
        self.assertEqual((lib.question['target']['x'], lib.question['target']['y']), (0.25, 0.75))
        clips = next(r for r in lib.outline if r['kind'] == 'question' and r['type'] == 'Sound clips')
        lib.select(clips['round'], clips['question'])
        lib.setTargetClip(0)
        lib.save()
        wait(lambda: not lib.dirty, what='the target and clip to save', log=self.toasts)
        # Saved as a file with its media inside, it loads again with the picture unpacked.
        packed = Path(self.dir.name) / 'packed.json'
        lib.export(QUrl.fromLocalFile(str(packed)), True)
        quiz_file = json.loads(packed.read_text())
        self.assertTrue(quiz_file['rounds'][first['round']]['questions'][first['question']]['media'].startswith('data:image/png;base64,'))
        # Blank answer sheets, as a PDF: questions with answer lines; formats needing a phone or the TV left out.
        from unittest import mock
        with mock.patch('PySide6.QtGui.QDesktopServices.openUrl'):
            sheets = Path(lib.printSheets(QUrl.fromLocalFile(str(Path(self.dir.name) / 'sheets.pdf'))))
        data = sheets.read_bytes()
        self.assertTrue(data.startswith(b'%PDF') and len(data) > 2000)
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
        # Looks: the question's look recolours the native TV, as look.css does the web TV.
        prefs.setLook('halloween')
        wait(lambda: desk.tv.get('look') == 'halloween', what='the Halloween look', log=self.toasts)
        self.assertEqual(desk.lookPalettes['halloween']['gold'], '#ff7a1a')
        prefs.setLook('@type')
        prefs.setThemeFor('choice', '')
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


class FirstRunAndRestoreTest(DeskCase):
    first_run = True

    def test_welcome_then_restore(self):
        desk = self.desk
        desk.start()
        wait(lambda: desk.connected and desk.view.get('phase'), what='the desk')
        welcome = self.window.findChild(QObject, 'welcome')
        wait(lambda: welcome.property('visible'), what='the first-run welcome')
        self.shot('welcome')
        desk.welcomed('lan')
        wait(lambda: desk.view['settings'].get('joinMode') == 'lan', what='players joining on the venue network', log=self.toasts)
        self.assertTrue(QSettings().value('welcomed', False, bool))

        # A backup of this quiz, a change, then the backup restored: the change is gone and the server is back.
        backups = Path(self.dir.name) / 'mine'
        backups.mkdir()
        desk.backup(QUrl.fromLocalFile(str(backups)))
        wait(lambda: list(backups.glob('*.sqlite')), what='the backup', log=self.toasts)
        port, session = desk.server.info['port'], desk.api.session
        http(port, 'host/settings', {'title': 'Changed after the backup'}, session)
        wait(lambda: desk.view['settings'].get('title') == 'Changed after the backup', what='the change')
        desk.restore(QUrl.fromLocalFile(str(next(backups.glob('*.sqlite')))))
        wait(lambda: desk.connected and desk.view.get('settings', {}).get('title') not in (None, 'Changed after the backup'), timeout=30, what='the restored quiz', log=self.toasts)
        # A file that isn't a backup is refused, and the quiz carries on.
        bad = Path(self.dir.name) / 'bad.sqlite'
        bad.write_text('not a database')
        desk.restore(QUrl.fromLocalFile(str(bad)))
        wait(lambda: any(e and 'could not be restored' in m for m, e in self.toasts), what='a bad backup refused')
        wait(lambda: desk.connected, timeout=30, what='the server back after a refused restore')


if __name__ == '__main__':
    unittest.main()
