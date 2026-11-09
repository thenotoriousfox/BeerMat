"""The quiz editor's list of rounds and questions keeps its place: picking a question further down, or editing one,
rebuilds the list, and it once jumped back to the top each time."""
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


class OutlineScrollTest(DeskCase):
    def test_the_question_list_keeps_its_place(self):
        desk, w = self.desk, self.window
        desk.start()
        wait(lambda: desk.connected and desk.view.get('phase'), what='the server')
        desk.prefs.loadQuizFile(str(Path(__file__).resolve().parents[2] / 'examples' / 'example-quiz.json'))
        wait(lambda: desk.view.get('title') == 'BeerMat Example Quiz' and desk.view.get('questions'), what='the example quiz', log=self.toasts)
        w.setProperty('workspace', 2)
        w.setProperty('width', 1280)
        w.setProperty('height', 760)
        w.findChild(QObject, 'quizzes').setProperty('editing', True)
        pump(30)
        outline = w.findChild(QObject, 'outline')
        bottom = outline.property('contentHeight') - outline.property('height') + outline.property('originY')
        self.assertGreater(bottom, 200, 'the example quiz is longer than the list')
        outline.setProperty('contentY', bottom)
        pump(10)
        rows = desk.quizzes.property('outline')
        last = [r for r in rows if r['kind'] == 'question'][-1]
        desk.quizzes.select(last['round'], last['question'])     # what clicking the row does
        pump(20)
        self.assertAlmostEqual(outline.property('contentY'), bottom, delta=2, msg='picking a question')
        desk.quizzes.setField('text', 'An edited question')
        pump(20)
        self.assertAlmostEqual(outline.property('contentY'), bottom, delta=2, msg='editing it')


if __name__ == '__main__':
    unittest.main()
