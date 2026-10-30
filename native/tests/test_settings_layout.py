"""The desk in a window that isn't full screen: every panel grows to fit its wrapped text, so no button spills out
of the bottom of its panel (Desk/Panel.qml fitHeight), at a narrow window, a laptop's and a full HD one's width; and
nothing on any page (the editor on every format, Live with every format running) runs past its panel's right edge."""
import os
import sys
import time
import unittest
from pathlib import Path

os.environ.setdefault('QT_QPA_PLATFORM', 'offscreen')
os.environ.setdefault('BEERMAT_MUTE', '1')
sys.path.insert(0, str(Path(__file__).resolve().parent))
from PySide6.QtCore import QObject             # noqa: E402
from test_desk import DeskCase, app, http, wait     # noqa: E402


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


def walk_named(item, name):
    for c in children(item):
        try:
            if c.objectName() == name:
                yield c
        except (TypeError, AttributeError):
            continue
        yield from walk_named(c, name)


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
        # Each keyboard shortcut's key fits its chip (⌫ Backspace once ran into its description).
        keys = [k for k in walk_named(w.contentItem(), 'shortcutKey')]
        self.assertGreaterEqual(len(keys), 9)
        for k in keys:
            self.assertLessEqual(k.property('implicitWidth') + 8, k.parentItem().property('width'), k.property('text'))

    def test_question_options_fit_beside_their_controls(self):
        """The editor's options: each label wraps beside its control rather than under it, at every width; and the
        picture reveal is offered only for a picture question."""
        desk, w = self.desk, self.window
        desk.start()
        wait(lambda: desk.connected and desk.view.get('phase'), what='the server')
        desk.prefs.loadQuizFile(str(Path(__file__).resolve().parents[2] / 'examples' / 'example-quiz.json'))
        wait(lambda: desk.view.get('questions') == 18, what='the example quiz', log=self.toasts)
        w.setProperty('workspace', 2)
        w.findChild(QObject, 'quizzes').setProperty('editing', True)
        desk.quizzes.select(1, 0)     # Round 2's picture question
        for width in (1000, 1280, 1920):
            w.setProperty('width', width)
            w.setProperty('height', 760)
            pump(30)
            # Nothing in the editor runs past its right edge.
            column = next(walk_named(w.contentItem(), 'questionBasics')).parentItem()
            over = []
            for c in walk_all(column):
                try:
                    if c.property('visible') and c.property('width') > 0 and c.mapToItem(column, c.boundingRect().topRight()).x() > column.property('width') + 1:
                        over.append((c.metaObject().className()[:20], c.property('text') if isinstance(c.property('text'), str) else '', round(c.mapToItem(column, c.boundingRect().topRight()).x())))
                except (TypeError, AttributeError):
                    continue
            self.assertEqual(over, [], f'{width} wide: past the editor\'s edge ({column.property("width")})')
            rows = [r for r in walk_named(w.contentItem(), 'option-reveal')]
            if self.shots and rows:     # scrolled down to the options for the picture
                view = rows[0]
                while view is not None and view.property('contentHeight') is None:
                    view = view.parentItem()
                if view is not None:
                    view.setProperty('contentY', max(0, view.property('contentHeight') - view.property('height')))
                self.shot(f'editor-options-{width}')
            self.assertTrue(rows, 'the picture reveal is offered')
            for row in [c for c in walk_all(w.contentItem()) if safe_name(c).startswith('option-') and c.property('visible')]:
                label = next(c for c in children(row) if safe_name(c) == 'optionLabel')
                right = label.property('x') + label.property('width')
                for control in children(row):
                    if control is not label and control.property('visible') and control.property('x') > label.property('x'):
                        self.assertLessEqual(right, control.property('x') + 1, f'{width} wide: {safe_name(row)}')
        desk.quizzes.select(0, 0)     # a multiple choice question
        pump(20)
        self.assertFalse([r for r in walk_named(w.contentItem(), 'option-reveal') if r.property('visible')], 'no picture reveal for a choice question')

    def test_nothing_runs_past_its_panel(self):
        """Every page at a narrow window: no control, label or list runs past the right edge of its panel. The editor
        is checked on every format of the example quiz, and Live with each format running in a rehearsal."""
        desk, w = self.desk, self.window
        desk.start()
        wait(lambda: desk.connected and desk.view.get('phase'), what='the server')
        desk.prefs.loadQuizFile(str(Path(__file__).resolve().parents[2] / 'examples' / 'example-quiz.json'))
        wait(lambda: desk.view.get('questions') == 18, what='the example quiz', log=self.toasts)
        found = set()
        look = lambda where: found.update((where, *f) for f in past_the_edge(w))
        w.setProperty('width', 1000); w.setProperty('height', 760)
        w.setProperty('workspace', 2)
        w.findChild(QObject, 'quizzes').setProperty('editing', True)
        for r, rnd in enumerate(desk._library['rounds']):
            for i, q in enumerate(rnd['questions']):
                desk.quizzes.select(r, i)
                pump(12)
                look(f'editor {q["type"]}')
        w.findChild(QObject, 'quizzes').setProperty('editing', False)
        port, session = desk.server.info['port'], desk.api.session
        desk.startRehearsalWith({'teams': 2, 'auto': False})
        wait(lambda: len(desk.view.get('sims', [])) == 2, timeout=20, what='two simulated teams', log=self.toasts)
        w.setProperty('workspace', 0)
        current = None
        for rnd in desk._library['rounds']:
            for q in rnd['questions']:
                http(port, 'host/start', {'id': q['id'], 'expectedQuestion': current}, session)
                wait(lambda: desk.view.get('typeCode') == q['type'] and desk.view['raw'].get('live'), what=f'the {q["type"]} question')
                current = desk.view['raw']['id']
                pump(12)
                look(f'live {q["type"]}')
                if q['type'] == 'sheet':
                    w.setProperty('workspace', 3); pump(12); look('teams, marking a sheet'); w.setProperty('workspace', 0)
                http(port, 'host/close', {'expectedQuestion': current}, session)
        for workspace in range(9):
            for width in (1000, 1280):
                w.setProperty('workspace', workspace); w.setProperty('width', width); pump(20)
                look(f'page {workspace} at {width}')
                self.shot(f'page-{workspace}-{width}')
        self.assertEqual(sorted(found), [])


def past_the_edge(window):
    """(panel, item, its text, how far over) for everything visible that runs past its panel's right edge (a scrolling
    list counts its own box, and what's inside it counts against that)."""
    right = lambda c: c.mapToScene(c.boundingRect().topRight()).x()
    found = []

    def inside(item, edge, title):
        for c in children(item):
            try:
                if not c.property('visible') or c.property('width') <= 0 or c.property('opacity') == 0:
                    continue
                kind = c.metaObject().className()
                if right(c) > edge + 1 and kind.split('_')[0] not in ('QQuickItem', 'QQuickLoader', 'QQuickRepeater'):
                    found.append((title, kind.split('_')[0], (c.property('text') if isinstance(c.property('text'), str) else '')[:40], round(right(c) - edge)))
                if any(k in kind for k in ('Flickable', 'ScrollView', 'ListView')):
                    inside(c, min(edge, right(c)), title)
                    continue
            except (TypeError, AttributeError):
                continue
            inside(c, edge, title)

    def walk(item):
        for c in children(item):
            try:
                if 'Panel' in c.metaObject().className() and c.property('visible'):
                    inside(c, right(c), c.property('title'))
                    continue
            except (TypeError, AttributeError):
                pass
            walk(c)
    walk(window.contentItem())
    return found


def safe_name(item):
    try:
        return item.objectName()
    except (TypeError, AttributeError):
        return ''


def walk_all(item):
    for c in children(item):
        yield c
        yield from walk_all(c)


if __name__ == '__main__':
    unittest.main()
