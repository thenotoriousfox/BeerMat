"""The EGL to GLX fallback (beermat_desk/__main__.py): an all-black first frame means OpenGL drew nothing, any other
frame (even the desk's own near-black background) means it works."""
import os
import sys
import unittest
from pathlib import Path

os.environ.setdefault('QT_QPA_PLATFORM', 'offscreen')
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from PySide6.QtGui import QColor, QGuiApplication, QImage       # noqa: E402

from beermat_desk.__main__ import drew_nothing                  # noqa: E402

app = QGuiApplication.instance() or QGuiApplication(['test'])


def frame(colour, dot=None):
    image = QImage(1600, 1000, QImage.Format.Format_ARGB32)
    image.fill(QColor(colour))
    if dot:
        image.setPixelColor(800, 500, QColor(dot))
    return image


class GlFallbackTest(unittest.TestCase):
    def test_all_black_drew_nothing(self):
        self.assertTrue(drew_nothing(frame('#000000')))

    def test_desk_background_drew_something(self):
        self.assertFalse(drew_nothing(frame('#0d0720')))
        self.assertFalse(drew_nothing(frame('#000000', dot='#ffffff')))

    def test_no_frame_is_not_a_failure(self):
        self.assertFalse(drew_nothing(QImage()))


if __name__ == '__main__':
    unittest.main()
