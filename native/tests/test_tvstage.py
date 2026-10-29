"""The native TV picture with crafted public states, one per view and format: each must draw without a QML error
(warnings are collected and fail the test), and the first-place spotlight must show only for a reveal seen happening.
BEERMAT_SHOTS=<dir> saves a screenshot of each."""
import os
import sys
import time
import unittest
from pathlib import Path

os.environ.setdefault('QT_QPA_PLATFORM', 'offscreen')
os.environ.setdefault('BEERMAT_MUTE', '1')   # tests make the TV's sounds without playing them aloud
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from PySide6.QtCore import QObject, Property, QUrl, qInstallMessageHandler, QtMsgType   # noqa: E402
from PySide6.QtGui import QGuiApplication                                             # noqa: E402
from PySide6.QtQml import QQmlApplicationEngine                                       # noqa: E402
from PySide6.QtQuick import QQuickWindow                                              # noqa: E402,F401  (window type)

from beermat_desk import gradients, looks                                              # noqa: E402
from beermat_desk.server import ROOT                                                   # noqa: E402

app = QGuiApplication.instance() or QGuiApplication(sys.argv)
app.setOrganizationName('BeerMat-test')
QML = ROOT / 'native' / 'beermat_desk' / 'qml'
problems = []
qInstallMessageHandler(lambda kind, _context, message: problems.append(message) if kind in (QtMsgType.QtWarningMsg, QtMsgType.QtCriticalMsg) and 'qml' in message.lower() or 'TypeError' in message else None)


class FakeDesk(QObject):
    def __init__(self):
        super().__init__()
        # BeerMat's own looks and the library's (Halloween), as a laptop that installed it has.
        self._palettes = {**looks.load(ROOT / 'library'), **looks.load(ROOT / 'themes')}
        self._scenes = {**looks.scenes(ROOT / 'library'), **looks.scenes(ROOT / 'themes')}

    @Property('QVariantMap', constant=True)
    def lookPalettes(self):
        return self._palettes

    @Property('QVariantMap', constant=True)
    def lookScenes(self):
        return self._scenes


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
    # Five teams tied for first, with long names, and a crowd behind them: it all stays on the screen.
    'winner-tie': state('winner', teams=[{'name': n, 'rank': 1, 'score': 21} for n in ['Quiz Team Aguilera', 'Les Quizerables', 'The Pun Intended', 'Universally Challenged', 'Agatha Quiztie']]
                        + [{'name': n, 'rank': 6 if i else 2, 'score': 18} for i, n in enumerate(['Tequila Mockingbird', 'The Quizzly Bears', 'Owls'])]),
    # After a secret round: an Evil Mode question with how each team did, then the round's results.
    'recap-question': state('recap', recap={'round': 'The Final', 'count': 3, 'shown': 1, 'done': False, 'question': {
        'id': 9, 'type': 'text', 'text': 'Capital of Ireland?', 'answer': 'Dublin', 'answerNote': 'Baile Átha Cliath', 'itemAnswers': [], 'options': [], 'points': 2, 'evil': True,
        'teams': [{'name': 'Bears', 'points': 2, 'outcome': 'right'}, {'name': 'Owls', 'points': -2, 'outcome': 'lost'}, {'name': 'Foxes', 'points': 0, 'outcome': 'wrong'}]}}),
    'recap-results': state('recap', recap={'round': 'The Final', 'count': 3, 'shown': 3, 'done': True,
        'results': [{'name': f'Team {i}', 'points': 12 - i} for i in range(12)]}),
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
        gradients.install(cls.engine)
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

    def test_a_looks_tv_json_styles_the_tv(self):
        def items(item):
            yield item
            for child in item.childItems():
                yield from items(child)
        def shown(kind):
            return [o for o in items(self.stage) if o.metaObject().className().startswith(kind) and o.property('visible')]
        self.show(state(q=question()), 'look-stage')
        self.assertEqual(shown('GlowText'), [], 'the default look: plain lettering')
        self.show(state(q=question(), look='halloween'), 'look-halloween')
        self.assertEqual(sorted(o.property('text') for o in shown('GlowText')), ['QUIZ NIGHT', 'Quiz night'], 'its eyebrow and title')
        scene = [o for o in items(self.stage) if o.metaObject().className().startswith('ThemeScene')]
        self.assertEqual(len(scene), 1)
        self.assertEqual(len(scene[0].property('layers')), 14, 'moon, hill, four bats, two fogs, web, spider, four embers')

    def test_updates_in_the_same_look_leave_its_scenery_alone(self):
        from shiboken6 import getCppPointer

        def items(item):
            yield item
            for child in item.childItems():
                yield from items(child)
        def drawn():
            return sorted(getCppPointer(o)[0] for o in items(self.stage) if o.metaObject().className().startswith(('ThemeScene', 'GlowText', 'QQuickImage')))
        self.show(state(q=question(), look='halloween'))
        before = drawn()
        painted = []
        background = self.stage.findChild(QObject, 'lookBackground')
        background.paint.connect(lambda *_: painted.append(1))
        for _ in range(3):   # the server's updates: new objects, the same look
            self.show(state(q=question(), look='halloween', serverTime=time.time() * 1000))
        self.assertEqual(drawn(), before, 'the scenery and lettering are the same items, not rebuilt')
        self.assertEqual(painted, [], 'the background is not repainted')

    def test_joint_winners_and_the_recap_stay_on_the_screen(self):
        def items(item):
            yield item
            for child in item.childItems():
                yield from items(child)
        def inside(item):
            top_left = item.mapToItem(self.stage, 0, 0)
            return top_left.x() >= -1 and top_left.y() >= -1 and top_left.x() + item.width() <= 1920 + 1 and top_left.y() + item.height() <= 1080 + 1
        self.show(CASES['winner-tie'], 'winner-tie')
        for _ in range(60):
            app.processEvents(); time.sleep(0.02)
        names, podium = self.stage.findChild(QObject, 'winnerNames'), self.stage.findChild(QObject, 'winnerPodium')
        self.assertIn('Agatha Quiztie', names.property('text'))
        self.assertLessEqual(names.property('contentWidth'), names.property('width') + 1)
        self.assertTrue(inside(names) and inside(podium), 'every winner’s name on the screen')
        self.show(CASES['recap-question'], 'recap-question')
        texts = [o.property('text') for o in items(self.stage.findChild(QObject, 'recapView')) if isinstance(o.property('text'), str) and o.property('visible')]
        self.assertIn('Answer: Dublin', texts)
        self.assertIn('✓ Bears  +2', texts)
        self.assertIn('✗ Owls  −2', texts, 'Evil Mode shows the points lost')
        self.assertIn('✗ Foxes', texts)
        self.assertIn('Question 2 of 3', texts)
        self.show(CASES['recap-results'], 'recap-results')
        results = self.stage.findChild(QObject, 'recapResults')
        self.assertTrue(results.property('visible'))
        rows = [o for o in items(results) if o.property('text') == 'Team 11']
        self.assertTrue(rows and inside(rows[0]), 'the last team’s row on the screen')

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

    def test_the_leaderboard_shows_and_reveals_from_the_bottom(self):
        teams = [{'name': n, 'rank': i + 1, 'score': 10 - i} for i, n in enumerate(['Bears', 'Owls', 'Foxes', 'Cats'])]

        def items(item):
            yield item
            for child in item.childItems():
                yield from items(child)

        def shown():
            for _ in range(40):     # rows fade in
                app.processEvents(); time.sleep(0.02)
            board = self.stage.findChild(QObject, 'boardView')
            rows = [o for o in items(board) if o.metaObject().className().startswith('QQuickRectangle') and o.property('radius') == 18]
            return [next(c.property('text') for c in items(r) if c.property('text') in [t['name'] for t in teams]) for r in rows if r.property('opacity') > 0.9]
        self.show(state('leaderboard', teams=teams))
        self.assertEqual(shown(), ['Bears', 'Owls', 'Foxes', 'Cats'], 'no reveal: the whole board')
        # The server's steps (boardReveal): bottom up to third, then the leader, then second place and the full board.
        spotlight = self.stage.findChild(QObject, 'spotlight')
        for hidden, expected in ((['Bears', 'Owls', 'Foxes', 'Cats'], []), (['Bears', 'Owls', 'Foxes'], ['Cats']), (['Bears', 'Owls'], ['Foxes', 'Cats'])):
            self.show(state('leaderboard', teams=teams, reveal={'question': 1, 'shown': 4 - len(hidden), 'rest': 2, 'leader': False, 'done': False, 'hidden': hidden}))
            self.assertEqual(shown(), expected)
        self.show(state('leaderboard', teams=teams, reveal={'question': 1, 'shown': 3, 'rest': 2, 'leader': True, 'second': True, 'done': False, 'hidden': ['Owls']}))
        self.assertEqual(shown(), ['Bears', 'Foxes', 'Cats'], 'the leader before second place')
        self.assertEqual(spotlight.property('shown').property('kind').toString(), 'IN FIRST PLACE')
        self.show(state('leaderboard', teams=teams, reveal={'question': 1, 'shown': 4, 'rest': 2, 'leader': True, 'done': True, 'hidden': []}))
        self.assertEqual(shown(), ['Bears', 'Owls', 'Foxes', 'Cats'], 'then the full board')

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
