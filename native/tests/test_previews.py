"""The theme library's TV and app pictures, drawn without a screen as BeerMat Online draws them
(beermat_desk/previews.py): Halloween on the TV at 1600x900 and in the app at 780x1688, in the theme's own colours."""
import base64
import json
import os
import subprocess
import sys
import unittest
from pathlib import Path

from PySide6.QtGui import QGuiApplication, QImage

ROOT = Path(__file__).resolve().parents[2]


class PreviewsTest(unittest.TestCase):
    def test_draws_a_theme_on_the_tv_and_in_the_app(self):
        # Its own process, as BeerMat Online runs it.
        out = subprocess.run([sys.executable, '-m', 'beermat_desk.previews', str(ROOT / 'themes'), 'halloween', 'Halloween Pub Quiz'], cwd=ROOT / 'native',
                             capture_output=True, text=True, timeout=120, env={**os.environ, 'QT_QPA_PLATFORM': 'offscreen'})
        self.assertEqual(out.returncode, 0, out.stderr)
        pictures = json.loads(out.stdout)
        QGuiApplication.instance() or QGuiApplication([])
        for kind, size in (('tv', (1600, 900)), ('app', (780, 1688))):
            image = QImage.fromData(base64.b64decode(pictures[kind]), 'JPEG')
            self.assertEqual((image.width(), image.height()), size, kind)
            # Halloween's pumpkin orange somewhere (its title on the TV, its button in the app), not a blank picture.
            orange = sum(1 for x in range(0, image.width(), 8) for y in range(0, image.height(), 8)
                         if (c := image.pixelColor(x, y)).red() > 200 and 80 < c.green() < 170 and c.blue() < 80)
            self.assertGreater(orange, 50, f'{kind}: the theme’s colours')


if __name__ == '__main__':
    unittest.main()
