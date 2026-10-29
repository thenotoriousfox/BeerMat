"""The native TV picture with crafted public states, one per view and format: each must draw without a QML error
(warnings are collected and fail the test), and the first-place spotlight must show only for a reveal seen happening.
BEERMAT_SHOTS=<dir> saves a screenshot of each."""
import os
import sys
import time
import unittest
from pathlib import Path

os.environ.setdefault('QT_QPA_PLATFORM', 'offscreen')
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from PySide6.QtCore import QObject, Property, QUrl, qInstallMessageHandler, QtMsgType   # noqa: E402
from PySide6.QtGui import QGuiApplication                                             # noqa: E402
from PySide6.QtQml import QQmlApplicationEngine                                       # noqa: E402
from PySide6.QtQuick import QQuickWindow                                              # noqa: E402,F401  (window type)

from beermat_desk import looks                                                         # noqa: E402
from beermat_desk.server import ROOT                                                   # noqa: E402

app = QGuiApplication.instance() or QGuiApplication(sys.argv)
app.setOrganizationName('BeerMat-test')
QML = ROOT / 'native' / 'beermat_desk' / 'qml'
problems = []
qInstallMessageHandler(lambda kind, _context, message: problems.append(message) if kind in (QtMsgType.QtWarningMsg, QtMsgType.QtCriticalMsg) and 'qml' in message.lower() or 'TypeError' in message else None)


class FakeDesk(QObject):
    def __init__(self):
        super().__init__()
        self._palettes = looks.load(ROOT / 'themes')

    @Property('QVariantMap', constant=True)
    def lookPalettes(self):
        return self._palettes


SETTINGS = {'title': 'Quiz night', 'joinUrl': 'http://10.42.0.1', 'joinSsid': 'BeerMat', 'registrationOpen': True, 'leaderboardVisible': True, 'displayMode': 'auto'}
TEAMS = [{'name': 'Bears', 'rank': 1, 'score': 12, 'photo': None}, {'name': 'Owls', 'rank': 2, 'score': 9}, {'name': 'Foxes', 'rank': 3, 'score': 7}]


_ids = iter(range(1, 1000))


def question(**over):
    q = {'id': next(_ids), 'type': 'choice', 'round': 'Round 1', 'text': 'Which planet is red?', 'options': ['Venus', 'Mars'], 'points': 1, 'seconds': 30,
         'deadline': time.time() * 1000 + 20000, 'remaining': 20000, 'open': True, 'live': True, 'paused': False, 'revealed': False, 'revealing': False}
    q.update(over)
    return q


def state(view='question', q=None, **over):
    s = {'protocol': 1, 'serverTime': time.time() * 1000, 'offset': 0, 'settings': SETTINGS, 'teams': TEAMS, 'view': view, 'question': q, 'look': 'stage', 'rehearsal': False}
    s.update(over)
    return s


CASES = {
    'join': state('join'),
    'choice-open': state(q=question()),
    'choice-revealed': state(q=question(open=False, live=False, revealed=True, answer='Mars', tally={'Venus': 1, 'Mars': 3},
                                        scorers=[{'name': 'Bears', 'ms': 2100, 'points': 1}], first={'kind': 'fastest', 'name': 'Bears', 'ms': 2100, 'photo': None})),
    'sequence': state(q=question(type='sequence', options=[], items=['One', 'Two', 'Three'], order=[2, 0, 1])),
    'tiles': state(q=question(type='tiles', options=[], pieces=['BI', 'G', 'BE', 'N'], wordLengths=[3, 3])),
    'wordsnake': state(q=question(type='wordsnake', options=[], grid={'size': 3, 'letters': list('LONDXQWEN')}, revealed=True, snakePath=[0, 1, 2, 3])),
    'buzzer': state(q=question(type='buzzer', options=[], buzz={'active': {'name': 'Owls'}, 'queue': [{'team': 'b', 'name': 'Bears', 'status': 'queued'}], 'agreeOpen': False})),
    'bingo': state(q=question(type='bingo', options=[], bingo={'count': 12, 'last': 42, 'called': [1, 5, 42], 'winners': [], 'board': True, 'music': False})),
    'clips': state(q=question(type='clips', options=[], clipGame={'playing': 2, 'count': 5, 'taps': 3})),
    # A long answer and note, and a full list of scorers with their times: everything must fit the box.
    'text-revealed-long': state(q=question(type='text', options=[], open=False, revealed=True,
        answer='The Treaty of Westphalia, signed in Osnabrück and Münster in 1648',
        answerNote='It ended the Thirty Years’ War and the Eighty Years’ War between Spain and the Dutch Republic, and is often seen as the start of the modern state system.',
        scorers=[{'name': n, 'ms': ms, 'points': p} for n, ms, p in [('Quiz Team Aguilera', 2310, 2), ('Les Quizerables', 3480, 1), ('The Pun Intended', 4020, 1), ('Bears', 5500, 1),
                 ('Universally Challenged', 7120, 1), ('Owls', 8800, 1), ('Foxes', 9100, 1), ('Agatha Quiztie', 11000, 1), ('Quizteama Aguilera', 12400, 1), ('Tequila Mockingbird', 15020, 1)]])),
    'nearest-revealed': state(q=question(type='nearest', options=[], open=False, revealed=True, answer='1912', scorers=[{'name': 'Bears', 'answer': '1912', 'ms': 4100, 'points': 2}, {'name': 'Owls', 'answer': '1910', 'ms': 6100, 'points': 1}])),
    'text-revealed': state(q=question(type='text', options=[], open=False, revealed=True, answer='Canberra', answerNote='Not Sydney', scorers=[])),
    'leaderboard': state('leaderboard', reveal={'question': 1, 'shown': 2, 'rest': 2, 'done': False}),
    'winner': state('winner'),
    'wheel': state('wheel', wheel={'id': 'w1', 'items': ['Red', 'Blue', 'Green'], 'result': 1, 'spun': 0}),
    'countdown': state('join', timer={'label': 'Sheets in', 'endsAt': time.time() * 1000 + 65000, 'remaining': 65000}),
    'halloween': state(q=question(), look='halloween'),
    'rehearsal': state('join', rehearsal=True),
    'blank': state('blank'),
    'french': state('join', settings={**SETTINGS, 'language': 'fr'}),
    'spanish-question': state(q=question(), settings={**SETTINGS, 'language': 'es'}),
}


class TvStageTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.engine = QQmlApplicationEngine()
        cls.desk = FakeDesk()
        cls.engine.rootContext().setContextProperty('desk', cls.desk)
        cls.engine.rootContext().setContextProperty('brand', QUrl.fromLocalFile(str(ROOT / 'brand') + '/'))
        cls.engine.addImportPath(str(QML))
        cls.engine.loadData(b'import QtQuick\nimport QtQuick.Window\nWindow { width: 1280; height: 720; visible: true; TvStage { objectName: "stage"; anchors.fill: parent } }',
                            QUrl.fromLocalFile(str(QML / 'test.qml')))
        cls.window = cls.engine.rootObjects()[0]
        cls.stage = cls.window.findChild(QObject, 'stage')

    def show(self, s, name=None):
        self.stage.setProperty('tv', s)
        for _ in range(12):
            app.processEvents(); time.sleep(0.02)
        if name and os.environ.get('BEERMAT_SHOTS'):
            self.window.grabWindow().save(str(Path(os.environ['BEERMAT_SHOTS']) / f'tv-{name}.png'))

    def test_every_view_draws(self):
        for name, s in CASES.items():
            problems.clear()
            self.show(s, name)
            self.assertEqual(problems, [], f'{name}: {problems}')

    def test_speaks_the_quiz_language(self):
        texts = lambda: [o.property('text') for o in self.stage.findChildren(QObject) if isinstance(o.property('text'), str) and o.property('visible')]
        self.show(CASES['french'], 'french')
        self.assertIn('Rejoignez le quiz sur votre téléphone', ' '.join(texts()))
        # A fresh deadline: the crafted states are made when the file loads, and other tests may run first.
        self.show(state(q=question(deadline=time.time() * 1000 + 20000), settings={**SETTINGS, 'language': 'es'}))
        self.assertTrue(any(t.startswith('quedan ') for t in texts()), texts())
        self.show(CASES['join'])
        self.assertIn('Join the quiz on your phone', ' '.join(texts()))

    def test_spotlight_only_for_a_reveal_seen_happening(self):
        spotlight = self.stage.findChild(QObject, 'spotlight')
        shown = lambda: spotlight.property('shown')
        self.show(state('join'))
        spotlight.setProperty('shown', None); spotlight.setProperty('armedFor', None)
        self.show(CASES['choice-revealed'])
        self.assertTrue(shown() is None or shown().isNull(), 'already revealed when first seen: no spotlight')
        opened = state(q=question(id=CASES['choice-revealed']['question']['id']))
        self.show(opened)
        self.show(CASES['choice-revealed'], 'spotlight')
        self.assertEqual(shown().property('kind').toString(), 'FASTEST FINGERS')

    def test_the_answer_box_fits_its_answer_note_and_scorers(self):
        reveal, content = self.stage.findChild(QObject, 'reveal'), self.stage.findChild(QObject, 'revealContent')
        for name in ('text-revealed-long', 'text-revealed', 'nearest-revealed', 'choice-revealed'):
            self.show(CASES[name])
            for _ in range(40):     # the box slides in
                app.processEvents(); time.sleep(0.02)
            self.assertLessEqual(content.property('implicitHeight') + 56, reveal.property('height') + 0.5, f'{name}: nothing in the box is cut off')
        self.show(CASES['text-revealed-long'])
        def items(item):
            yield item
            for child in item.childItems():
                yield from items(child)
        texts = [o.property('text') for o in items(reveal) if isinstance(o.property('text'), str)]
        self.assertIn('2.3s · +2', texts, 'the fastest team\'s time and points')
        self.assertIn('10 teams scored — fastest first', texts)

    def test_wheel_spins_once_for_a_spin_seen_happening(self):
        spin = self.stage.findChild(QObject, 'wheelSpin')
        self.show(state('join'))
        wheel = {'id': 7, 'items': ['Red', 'Blue', 'Green', 'Gold'], 'result': 2, 'spun': time.time() * 1000}
        self.show(state('wheel', wheel=dict(wheel)))
        self.assertTrue(spin.property('running'), 'the first wheel ever spins')
        to = spin.property('to')
        # Each refresh brings the same wheel (a new object, its id a number): the spin carries on, not starting again.
        for _ in range(3):
            self.show(state('wheel', wheel=dict(wheel)))
            self.assertEqual(spin.property('to'), to)
        self.assertTrue(spin.property('running'))
        spin.setProperty('running', False)


if __name__ == '__main__':
    unittest.main()
