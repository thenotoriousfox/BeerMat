"""SVG shape animation on the native TV (beermat_desk/svgmotion.py): Halloween's bat flaps from its own <animate>, the
frames run from wings up to down and back as a browser draws them, and an SVG it can't run is left still."""
import os
import sys
import unittest
from pathlib import Path

os.environ.setdefault('QT_QPA_PLATFORM', 'offscreen')
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from PySide6.QtGui import QGuiApplication                      # noqa: E402

from beermat_desk import looks                                  # noqa: E402
from beermat_desk.svgmotion import d_at, motion_of, parse, strip  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
BAT = ROOT / 'library' / 'halloween' / 'art' / 'bat.svg'
app = QGuiApplication.instance() or QGuiApplication(['test'])


def ink(image, frame, width):
    return sum(1 for x in range(frame * width, (frame + 1) * width, 2) for y in range(0, image.height(), 2) if image.pixelColor(x, y).alpha() > 0)


class SvgMotionTest(unittest.TestCase):
    def test_the_bat_flaps(self):
        self.assertEqual(motion_of(BAT), {'frames': 13, 'duration': 420})
        image = strip(BAT.read_text(), 13, 120, 80)
        drawn = [ink(image, i, 120) for i in range(13)]
        self.assertTrue(all(n > 100 for n in drawn), drawn)
        self.assertGreater(max(drawn), drawn[0] * 1.5, 'the wings sweep down, then back up')
        self.assertAlmostEqual(drawn[1], drawn[12], delta=drawn[0] * 0.05, msg='and the beat loops smoothly')

    def test_in_between_values_ease_along_the_keysplines(self):
        _, _, _, _, values, times, splines = parse(BAT.read_text())
        self.assertEqual(d_at(values, times, splines, 0).split()[:3], ['M', '0.000', '-6.000'])
        start, middle = d_at(values, times, splines, 0.05), d_at(values, times, None, 0.05)
        self.assertNotEqual(start, middle, 'eased, not a straight line in time')
        self.assertEqual(d_at(values, times, splines, 0.5), d_at(values, times, None, 0.5), 'the down beat lands on its value')

    def test_what_it_cannot_run_stays_still(self):
        svg = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L{}"><animate attributeName="d" dur="1s" values="{}"/></path></svg>'
        self.assertIsNone(parse(svg.format('1 1', 'M0 0L1 1;M0 0L1 1L2 2')), 'values of different shapes')
        self.assertIsNone(parse(svg.format('1 1', 'M0 0L1 1')), 'one value')
        self.assertIsNone(parse('<svg'), 'not SVG')
        self.assertIsNone(motion_of(ROOT / 'library' / 'halloween' / 'art' / 'moon.svg'))

    def test_the_tv_scene_marks_the_bats(self):
        scene = looks.scenes(ROOT / 'library')['halloween']['scene']
        moving = [layer['image'] for layer in scene if layer.get('shapeMotion')]
        self.assertEqual(moving, ['art/bat.svg'] * 4)


if __name__ == '__main__':
    unittest.main()
