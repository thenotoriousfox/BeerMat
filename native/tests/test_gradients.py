"""The banding-free gradients (beermat_desk/gradients.py): every pixel within one level of the exact colour, and each
4x4 block averaging to it, so dark colours a few levels apart change smoothly rather than in stripes."""
import os
import subprocess
import sys
import unittest
from pathlib import Path

os.environ.setdefault('QT_QPA_PLATFORM', 'offscreen')
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from PySide6.QtGui import QGuiApplication, QImage                 # noqa: E402

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

    def test_fills_the_window_at_every_display_scale(self):
        """At 125%, 150% and 200% display scaling it once stopped part-way down the window, a hard line across the
        desk's side bar. Drawn in a window of its own (the scale is fixed when Qt starts), red behind it."""
        script = (
            "import sys; from PySide6.QtGui import QGuiApplication; from PySide6.QtQml import QQmlApplicationEngine;"
            "from PySide6.QtCore import QTimer; from beermat_desk import gradients;"
            "app = QGuiApplication([]); e = QQmlApplicationEngine(); gradients.install(e); e.addImportPath('beermat_desk/qml');"
            "e.loadData(b'import QtQuick\\nimport Desk\\nWindow { width: 300; height: 400; visible: true; color: \"red\";"
            " SmoothGradient { anchors.fill: parent; stops: [[0, \"#140b2e\"], [1, \"#0d0720\"]] } }');"
            "w = e.rootObjects()[0]; QTimer.singleShot(500, lambda: (w.grabWindow().save(sys.argv[1]), app.quit())); app.exec()")
        out = Path(__file__).resolve().parent / '.gradient-scale.png'
        self.addCleanup(lambda: out.unlink(missing_ok=True))
        for scale in ('1', '1.25', '1.5', '2'):
            with self.subTest(scale=scale):
                subprocess.run([sys.executable, '-c', script, str(out)], cwd=Path(__file__).resolve().parents[1], check=True, timeout=60,
                               env={**os.environ, 'QT_QPA_PLATFORM': 'offscreen', 'QT_SCALE_FACTOR': scale})
                image = QImage(str(out))
                rows = [image.pixelColor(image.width() // 2, y) for y in range(image.height())]
                self.assertFalse([y for y, c in enumerate(rows) if c.red() > 100], 'nothing uncovered')
                self.assertLessEqual(abs(rows[-1].blue() - 0x20), 1, 'it reaches the bottom colour at the bottom')
                self.assertLessEqual(max(abs(a.blue() - b.blue()) for a, b in zip(rows, rows[1:])), 2, 'no line part-way down')


if __name__ == '__main__':
    unittest.main()
