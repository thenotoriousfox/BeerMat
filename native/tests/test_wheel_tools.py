"""Tools → Spin the wheel on the desk: a long list of entries scrolls in its own box (the Tools window took the mouse
wheel)."""
import os
import sys
import unittest
from pathlib import Path

os.environ.setdefault('QT_QPA_PLATFORM', 'offscreen')
os.environ.setdefault('BEERMAT_MUTE', '1')
sys.path.insert(0, str(Path(__file__).resolve().parent))
from PySide6.QtCore import QObject, QMetaObject, QPoint, QPointF, Qt   # noqa: E402
from PySide6.QtGui import QGuiApplication, QWheelEvent                 # noqa: E402
from test_desk import DeskCase, wait               # noqa: E402
from test_settings_layout import pump              # noqa: E402


class WheelToolsTest(DeskCase):
    def test_a_long_wheel_list_scrolls(self):
        desk, w = self.desk, self.window
        desk.start()
        wait(lambda: desk.connected and desk.view.get('phase'), what='the server')
        tools = w.findChild(QObject, 'toolsPopup')
        self.assertIsNotNone(tools, 'the Tools popup')
        QMetaObject.invokeMethod(tools, 'open')
        pump(20)
        items = w.findChild(QObject, 'wheelItems')
        items.setProperty('text', '\n'.join(f'Prize {n}' for n in range(1, 41)))
        pump(10)
        box = w.findChild(QObject, 'wheelItemsBox')
        flick = box.property('contentItem')
        self.assertGreater(items.property('height'), box.property('height') + 100, 'forty lines run past the box')
        self.assertLessEqual(box.property('height'), 130, 'the box keeps its size')
        # The mouse wheel over the list moves the list, not the Tools window around it.
        middle = box.mapToScene(QPointF(box.property('width') / 2, box.property('height') / 2))
        for _ in range(4):
            QGuiApplication.sendEvent(w, QWheelEvent(middle, w.mapToGlobal(middle), QPoint(), QPoint(0, -120), Qt.NoButton, Qt.NoModifier, Qt.NoScrollPhase, False))
            pump(5)
        pump(20)
        self.assertGreater(flick.property('contentY'), 50, 'the mouse wheel scrolls the list')


if __name__ == '__main__':
    unittest.main()
