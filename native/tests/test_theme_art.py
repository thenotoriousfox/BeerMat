"""Every picture a theme's TV scenery uses (tv.json) draws on BeerMat Desk's Qt TV. Qt's SVG renderer doesn't run SVG
animation, so a shape drawn only by an <animate> (Halloween's flapping bat once was) is invisible there, while a
browser shows it: each picture must draw something without its animation. BeerMat's themes and the library's."""
import json
import os
import sys
import unittest
from pathlib import Path

os.environ.setdefault('QT_QPA_PLATFORM', 'offscreen')
from PySide6.QtCore import Qt                       # noqa: E402
from PySide6.QtGui import QGuiApplication, QImage, QPainter   # noqa: E402
from PySide6.QtSvg import QSvgRenderer              # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
app = QGuiApplication.instance() or QGuiApplication(['test'])


def drawn(path):
    """How many of a picture's pixels Qt draws (at a 200×200 size, every second pixel)."""
    image = QImage(200, 200, QImage.Format.Format_ARGB32)
    image.fill(Qt.GlobalColor.transparent)
    painter = QPainter(image)
    if path.suffix == '.svg':
        QSvgRenderer(str(path)).render(painter)
    else:
        painter.drawImage(image.rect(), QImage(str(path)))
    painter.end()
    return sum(1 for x in range(0, 200, 2) for y in range(0, 200, 2) if image.pixelColor(x, y).alpha() > 0)


class ThemeArtTest(unittest.TestCase):
    def test_every_scene_picture_draws_on_the_qt_tv(self):
        checked = 0
        for tv in sorted([*(ROOT / 'themes').glob('*/tv.json'), *(ROOT / 'library').glob('*/tv.json')]):
            data = json.loads(tv.read_text())
            pictures = {layer['image'] for part in (data, data.get('phone') or {}) for layer in part.get('scene', []) if layer.get('image')}
            for picture in sorted(pictures):
                with self.subTest(theme=tv.parent.name, picture=picture):
                    self.assertGreater(drawn(tv.parent / picture), 20, f'{tv.parent.name}/{picture} draws (nothing only animation draws)')
                    checked += 1
        self.assertGreater(checked, 0)


if __name__ == '__main__':
    unittest.main()
