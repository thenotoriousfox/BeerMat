"""The native TV's sound cues follow soundCues() in web/client.js: each moment sounds once, when it happens, never on
first load. Driven with crafted public states; files are generated WAVs, so nothing needs the quiz server."""
import os
import sys
import tempfile
import unittest
from pathlib import Path

os.environ.setdefault('QT_QPA_PLATFORM', 'offscreen')
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from PySide6.QtCore import QUrl                        # noqa: E402
from PySide6.QtGui import QGuiApplication              # noqa: E402

from beermat_desk.tvsound import TvSound, synth        # noqa: E402

app = QGuiApplication.instance() or QGuiApplication(sys.argv)
SLOTS = ['startRound', 'questionStart', 'timerMusic', 'countdown', 'timeUp', 'endRound', 'correct', 'wrong', 'reveal', 'bingoCall', 'bingo', 'applause']


def question(**over):
    q = {'id': 1, 'type': 'choice', 'round': 'Round 1', 'open': True, 'live': True, 'paused': False, 'revealing': False, 'revealed': False, 'deadline': 10 ** 13}
    q.update(over)
    return q


class TvSoundTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        files = {}
        for slot in SLOTS:
            path = Path(self.dir.name) / f'{slot}.wav'
            synth(path, [(440, 0)], 'sine')
            files[slot] = QUrl.fromLocalFile(str(path)).toString()
        self.sound = TvSound()
        self.sound.on = True
        self.heard = []
        self.sound.played.connect(self.heard.append)
        self.pack = {'slots': files, 'buzzers': []}

    def tearDown(self):
        self.sound.stop_all()
        self.dir.cleanup()

    def state(self, q=None, view='question', **over):
        s = {'sounds': self.pack, 'question': q, 'view': view, 'teams': [], 'settings': {'displayMode': 'auto'}, 'offset': 0}
        s.update(over)
        return s

    def step(self, s):
        self.heard.clear()
        self.sound.follow(s)
        return list(self.heard)

    def test_moments(self):
        self.assertEqual(self.step(self.state(question())), ['timerMusic'], 'first load: only the music, no moments')
        self.assertEqual(self.step(self.state(question(id=2, round='Round 2'))), ['startRound'])
        self.assertEqual(self.step(self.state(question(id=3, round='Round 2'))), ['questionStart'])
        self.assertEqual(self.step(self.state(question(id=3, round='Round 2', open=False))), ['timeUp'])
        self.assertEqual(self.step(self.state(question(id=3, round='Round 2', open=False, revealing=True))), ['reveal'])
        self.assertEqual(self.step(self.state(None, view='leaderboard')), ['endRound'])
        self.assertEqual(self.step(self.state(None, view='winner', teams=[{'name': 'Bears', 'rank': 1}])), ['applause'])
        self.assertEqual(self.step(self.state(None, view='winner', teams=[{'name': 'Bears', 'rank': 1}])), [], 'once only')

    def test_buzzers_and_bingo(self):
        buzz = lambda active, status: question(type='buzzer', buzz={'active': {'name': active} if active else None, 'queue': [{'team': 't', 'status': status}]})
        self.step(self.state(buzz(None, 'queued')))
        self.assertEqual(self.step(self.state(buzz('Bears', 'active'))), ['buzzer'])
        self.assertEqual(self.step(self.state(buzz('Bears', 'correct'))), ['correct'])
        bingo = lambda count, shouts: question(id=9, type='bingo', bingo={'count': count, 'shouts': shouts})
        self.step(self.state(bingo(0, [])))
        self.assertEqual(self.step(self.state(bingo(1, []))), ['bingoCall'])
        self.assertEqual(self.step(self.state(bingo(1, [{'id': 's', 'status': 'pending'}]))), ['bingo'])
        self.assertEqual(self.step(self.state(bingo(1, [{'id': 's', 'status': 'wrong'}]))), ['wrong'])

    def test_quiet_questions_have_no_music(self):
        self.assertEqual(self.step(self.state(question(type='audio'))), [])
        self.assertEqual(self.step(self.state(question(media='/media/song.mp3'))), [])

    def test_silent_while_tv_closed(self):
        self.sound.on = False
        self.step(self.state(question()))
        self.assertEqual(self.step(self.state(question(id=2, round='Round 2'))), [])


if __name__ == '__main__':
    unittest.main()
