"""The banding-free gradients (beermat_desk/gradients.py): every pixel within one level of the exact colour, and each
4x4 block averaging to it, so dark colours a few levels apart change smoothly rather than in stripes."""
import os
import sys
import unittest
from pathlib import Path

os.environ.setdefault('QT_QPA_PLATFORM', 'offscreen')
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from PySide6.QtGui import QGuiApplication                         # noqa: E402

from beermat_desk.gradients import colour_at, stops_of, strip      # noqa: E402

app = QGuiApplication.instance() or QGuiApplication(['test'])


class GradientTest(unittest.TestCase):
    def test_smooth_and_true_to_its_colours(self):
        stops = stops_of('0d0720@0,140b2e@1')       # the desk's background: 7 to 14 levels over the whole height
        image = strip(1000, stops)
        self.assertEqual((image.width(), image.height()), (4, 1000))
        blue = [[image.pixelColor(x, y).blue() for x in range(4)] for y in range(1000)]
        exact = [colour_at(stops, y / 999)[2] for y in range(1000)]
        self.assertLessEqual(max(abs(v - exact[y]) for y in range(1000) for v in blue[y]), 1, 'no pixel more than a level off')
        blocks = [sum(sum(blue[y + i]) for i in range(4)) / 16 for y in range(0, 1000, 4)]
        truth = [sum(exact[y:y + 4]) / 4 for y in range(0, 1000, 4)]
        self.assertLess(max(abs(a - b) for a, b in zip(blocks, truth)), 0.2, 'each block averages to the true colour')
        self.assertLess(max(abs(a - b) for a, b in zip(blocks, blocks[1:])), 0.2, 'no step from one block to the next')

    def test_stops_in_between(self):
        stops = stops_of('000000@0,ff0000@0.5,ff0000@1')
        self.assertEqual(colour_at(stops, 0.25), (127.5, 0, 0))
        self.assertEqual(colour_at(stops, 0.9), (255, 0, 0))


if __name__ == '__main__':
    unittest.main()
