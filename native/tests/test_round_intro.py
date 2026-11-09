"""A round's intro: typed in the editor, saved with the quiz, and shown on the Live page for the quizmaster to read out
before the round starts (the TV doesn't show it)."""
import os
import sys
import unittest
from pathlib import Path

os.environ.setdefault('QT_QPA_PLATFORM', 'offscreen')
os.environ.setdefault('BEERMAT_MUTE', '1')
sys.path.insert(0, str(Path(__file__).resolve().parent))
from PySide6.QtCore import QObject             # noqa: E402
from test_desk import DeskCase, wait           # noqa: E402
from test_settings_layout import pump          # noqa: E402

INTRO = 'Every question here has a picture. The fastest right answer gets 3 bonus points.'


class RoundIntroTest(DeskCase):
    def test_a_round_intro_is_saved_and_shown_before_the_round(self):
        desk, w = self.desk, self.window
        desk.start()
        wait(lambda: desk.connected and desk.view.get('phase'), what='the server')
        desk.prefs.loadQuizFile(str(Path(__file__).resolve().parents[2] / 'examples' / 'example-quiz.json'))
        wait(lambda: desk.view.get('title') == 'BeerMat Example Quiz' and desk.view.get('questions'), what='the example quiz', log=self.toasts)
        lib = desk.quizzes
        w.setProperty('workspace', 2)
        w.findChild(QObject, 'quizzes').setProperty('editing', True)
        lib.select(0, 0)
        pump(10)
        self.assertTrue(w.findChild(QObject, 'roundIntro').property('visible'), 'the editor offers it')
        lib.setRoundIntro(0, f'  {INTRO}  ')
        self.assertEqual(lib.property('question')['roundIntro'], INTRO)
        lib.save()
        wait(lambda: not lib.property('dirty') and (desk.view.get('nextRound') or {}).get('intro') == INTRO, what='the intro saved and offered', log=self.toasts)
        w.setProperty('workspace', 0)
        pump(20)
        banner = w.findChild(QObject, 'nextRoundIntro')
        self.assertTrue(banner.property('visible'))
        self.assertEqual(w.findChild(QObject, 'nextRoundIntroText').property('text'), INTRO)
        self.shot('round-intro')
        desk.next()
        wait(lambda: desk.view.get('question'), what='the first question', log=self.toasts)
        wait(lambda: not desk.view.get('nextRound'), what='the intro gone once the round starts', log=self.toasts)
        pump(10)
        self.assertFalse(banner.property('visible'))
        lib.setRoundIntro(0, '')
        self.assertNotIn('intro', lib._draft['rounds'][0], 'cleared')


if __name__ == '__main__':
    unittest.main()
