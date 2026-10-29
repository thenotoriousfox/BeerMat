"""Settings in a window that isn't full screen: every panel grows to fit its wrapped text, so no button spills out
of the bottom of its panel (Desk/Panel.qml fitHeight), at a narrow window, a laptop's and a full HD one's width."""
import os
import sys
import time
import unittest
from pathlib import Path

os.environ.setdefault('QT_QPA_PLATFORM', 'offscreen')
os.environ.setdefault('BEERMAT_MUTE', '1')
sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_desk import DeskCase, app, wait     # noqa: E402


def pump(n=30):
    for _ in range(n):
        app.processEvents()
        time.sleep(0.03)


def children(item):
    try:
        return item.childItems()
    except (TypeError, AttributeError):      # PySide now and then hands back a stale wrapper for an item
        return []


def buttons_outside_panels(root):
    """(panel, button text, how far below the panel's bottom) for every visible button below its panel's bottom."""
    spilled = []

    def inside(panel, item, bottom):
        for c in children(item):
            try:
                if c.property('visible') and 'DeskButton' in c.metaObject().className():
                    below = c.mapToScene(c.boundingRect().bottomLeft()).y() - bottom
                    if below > 1:
                        spilled.append((panel.property('title'), c.property('text'), round(below)))
            except (TypeError, AttributeError):
                continue
            inside(panel, c, bottom)

    def walk(item):
        for c in children(item):
            try:
                if 'Panel' in c.metaObject().className() and c.property('visible'):
                    inside(c, c, c.mapToScene(c.boundingRect().bottomLeft()).y())
            except (TypeError, AttributeError):
                pass
            walk(c)
    walk(root)
    return spilled


class SettingsLayoutTest(DeskCase):
    def test_nothing_spills_out_of_its_panel(self):
        self.desk.start()
        wait(lambda: self.desk.connected and self.desk.view.get('phase'), what='the server')
        w = self.window
        w.setProperty('workspace', 6)
        for width in (1000, 1280, 1920):
            w.setProperty('width', width)
            w.setProperty('height', 760)
            pump(40)
            self.assertEqual(buttons_outside_panels(w.contentItem()), [], f'{width} wide')


if __name__ == '__main__':
    unittest.main()
