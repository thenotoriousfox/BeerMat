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
# The TV page imports QtMultimedia. Loaded here, on this thread: loaded by the QML loader's thread instead, its first
# warning (e.g. no PipeWire, on GitHub's machines) waits for Python's lock in the message handler below while this
# thread holds it waiting for the loader, and the tests hang.
from PySide6 import QtMultimedia                                                      # noqa: E402,F401

from beermat_desk import gradients, looks, svgmotion                                            # noqa: E402
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
# A real picture: the test TV has no quiz server, so a path on this computer stands in for /media/….
PICTURE = str(ROOT / 'brand' / 'logo-email.png')


def question(**over):
    q = {'id': next(_ids), 'type': 'choice', 'round': 'Round 1', 'text': 'Which planet is red?', 'options': ['Venus', 'Mars'], 'points': 1, 'seconds': 30,
         'deadline': time.time() * 1000 + 20000, 'remaining': 20000, 'open': True, 'live': True, 'paused': False, 'revealed': False, 'revealing': False}
    q.update(over)
    return q


def state(view='question', q=None, **over):
    s = {'protocol': 1, 'serverTime': time.time() * 1000, 'offset': 0, 'settings': SETTINGS, 'teams': TEAMS, 'view': view, 'question': q, 'look': 'stage', 'rehearsal': False}
    s.update(over)
    return s


def items(item):
    """Every item under this one; PySide now and then hands back a stale wrapper, which is skipped."""
    yield item
    try:
        children = item.childItems()
    except (TypeError, AttributeError):
        return
    for child in children:
        yield from items(child)


def safe_name(o):
    try:
        return o.objectName()
    except (TypeError, AttributeError):
        return ''


CASES = {
    'join': state('join'),
    'choice-open': state(q=question()),
    'pinpoint-places': state(q=question(type='pinpoint', text='Tap Paris, Rome and Berlin.', options=[], media=PICTURE, open=False, live=False, revealed=True,
        targets=[{'x': 0.2, 'y': 0.2, 'r': 0.05}, {'x': 0.5, 'y': 0.5, 'r': 0.05}, {'x': 0.8, 'y': 0.3, 'r': 0.05}], scorers=[], correctCount=0)),
    'clues': state(q=question(type='clues', text='Who am I?', options=[], clues=['Born on Christmas Day, 1642.', 'Master of the Royal Mint.'], clueCount=4, cluesShown=2, cluePoints=3)),
    'list-revealed': state(q=question(type='list', text='Name the countries of the UK.', options=[], slots=4, open=False, live=False, revealed=True, accepted=['England', 'Scotland', 'Wales | Cymru', 'Northern Ireland'], scorers=[], correctCount=0)),
    'pairs': state(q=question(type='pairs', text='Match each capital to its country.', options=[], left=['Canberra', 'Ottawa', 'Wellington'], right=['New Zealand', 'Australia', 'Canada'])),
    'sort-revealed': state(q=question(type='sort', text='Fruit or vegetable?', options=[], categories=['Fruit', 'Vegetable'], sortItems=['Tomato', 'Carrot', 'Pumpkin'], open=False, live=False, revealed=True, sorting=[['Tomato', 'Fruit'], ['Carrot', 'Vegetable'], ['Pumpkin', 'Fruit']], scorers=[], correctCount=0)),
    'links': state(q=question(type='links', text='Find the three groups, and what links each.', options=[], groupCount=3, linkItems=['Rook', 'Mercury', 'Delta', 'Bishop', 'Venus', 'Sigma', 'Mars', 'Omega', 'Knight'])),
    'survey-revealed': state(q=question(type='survey', text='Name something you find in a kitchen.', options=[], open=False, live=False, revealed=True, survey=[['Kettle', 4], ['Fridge | Refrigerator', 3], ['Toaster', 1]], scorers=[], correctCount=0)),
    'video': state(q=question(type='video', text='Which colour came second?', options=[], media='/media/missing.mp4', videoCue={'seq': 0, 'action': 'play'})),
    'true-or-false': state(q=question(text='True or false: the Great Wall can be seen from the Moon.', pair='trueFalse', options=['True', 'False']), settings={**SETTINGS, 'language': 'fr'}),
    'choice-revealed': state(q=question(open=False, live=False, revealed=True, answer='Mars', tally={'Venus': 1, 'Mars': 3},
                                        scorers=[{'name': 'Bears', 'ms': 2100, 'points': 1}], first={'kind': 'fastest', 'name': 'Bears', 'ms': 2100, 'photo': None})),
    'sequence': state(q=question(type='sequence', options=[], items=['One', 'Two', 'Three'], order=[2, 0, 1])),
    'tiles': state(q=question(type='tiles', options=[], pieces=['BI', 'G', 'BE', 'N'], wordLengths=[3, 3])),
    'wordsnake': state(q=question(type='wordsnake', options=[], grid={'size': 3, 'letters': list('LONDXQWEN')}, revealed=True, snakePath=[0, 1, 2, 3])),
    'buzzer': state(q=question(type='buzzer', options=[], buzz={'active': {'name': 'Owls'}, 'queue': [{'team': 'b', 'name': 'Bears', 'status': 'queued'}], 'agreeOpen': False})),
    'bingo': state(q=question(type='bingo', options=[], bingo={'count': 12, 'last': 42, 'called': [1, 5, 42], 'winners': [], 'board': True, 'music': False})),
    'clips': state(q=question(type='clips', options=[], clipGame={'playing': 2, 'count': 5, 'taps': 3, 'played': [1, 2, 4]})),
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
    # After a secret round: an Risk It question with how each team did, then the round's results.
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
    # Send Question: waiting for Send, the TV gets nothing to read (server.js): the room listens, its clock not started.
    'held': state(q=question(held=True, open=False, paused=True, remaining=30000, text='', options=[])),
    'picture-tiles': state(q=question(type='picture', options=[], media=PICTURE, reveal='tiles')),
    'picture-blur': state(q=question(type='picture', options=[], media=PICTURE, reveal='blur')),
    'reactions': state(q=question(type='musicbingo', options=[], bingo={'played': 3, 'titles': [], 'winners': [], 'board': False, 'music': True},
                                  reactionTable={'song': 3, 'now': [{'name': 'Owls', 'ms': 1800}, {'name': 'Bears', 'ms': 2600}], 'leaders': [{'name': 'Owls', 'songs': 2}]})),
    'groups': state('leaderboard', groups=[{'name': 'Sales', 'teams': 2, 'average': 10.5, 'rank': 1}, {'name': 'Tech', 'teams': 1, 'average': 7, 'rank': 2}]),
    'slides': state('slides', slides=[{'media': PICTURE, 'seconds': 5}, {'media': PICTURE, 'seconds': 5}]),
    'wheel-rollover': state('wheel', wheel={'id': 'w2', 'items': ['🏆 £30', 'Roll over', 'Roll over'], 'result': 2, 'spun': 0, 'title': 'Jackpot', 'note': 'The jackpot rolls over to £40'}),
    'french': state('join', settings={**SETTINGS, 'language': 'fr'}),
    'spanish-question': state(q=question(), settings={**SETTINGS, 'language': 'es'}),
}


class TvStageTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.engine = QQmlApplicationEngine()
        gradients.install(cls.engine)
        svgmotion.install(cls.engine)
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

    def test_send_question_and_fast_track(self):
        texts = lambda: [o.property('text') for o in self.stage.findChildren(QObject) if isinstance(o.property('text'), str) and o.property('visible')]
        self.show(CASES['held'])
        self.assertIn('Get ready: the question is on its way', texts())
        self.assertTrue(any('Listen to the quizmaster' in t for t in texts()), 'the room listens while it is read out')
        spotlight = self.stage.findChild(QObject, 'spotlight')
        self.show(state(q=question()))
        spotlight.setProperty('shown', None)
        self.show(state(q=question(), fastTrack={'id': 7, 'name': 'Foxes', 'photo': None, 'points': 6, 'at': time.time() * 1000}))
        self.assertEqual(spotlight.property('shown').property('kind').toString(), '🚀 FAST TRACK')
        self.assertEqual(spotlight.property('shown').property('names').toString(), 'Foxes')

    def test_var_check_shows_then_the_decision(self):
        """A VAR Check ruling fills the TV: VAR CHECK while it's checked, then the decision (only one seen happening)."""
        spotlight = self.stage.findChild(QObject, 'spotlight')
        self.show(state(q=question()))
        spotlight.setProperty('shown', None)
        self.show(state(q=question(), varCheck={'id': 3, 'team': 'Owls', 'status': 'overturned', 'points': 2, 'decided': time.time() * 1000}))
        self.assertEqual(spotlight.property('shown').property('kind').toString(), '📺 VAR CHECK')
        self.assertEqual(spotlight.property('shown').property('names').toString(), 'Owls')
        deadline = time.time() + 6
        while spotlight.property('shown').property('kind').toString() != 'OVERTURNED' and time.time() < deadline:
            app.processEvents(); time.sleep(0.05)
        self.assertEqual(spotlight.property('shown').property('detail').toString(), '+2 points')
        self.show(state(q=question(), varCheck={'id': 3, 'team': 'Owls', 'status': 'overturned', 'points': 2, 'decided': time.time() * 1000}), 'var-check')

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
        bats = [o for o in items(self.stage) if o.metaObject().className().startswith('QQuickAnimatedSprite') and o.property('running')]
        self.assertEqual(len(bats), 4, 'the four bats flap')
        self.assertTrue(all(o.property('visible') and o.property('frameCount') == 13 for o in bats))

    def test_updates_in_the_same_look_leave_its_scenery_alone(self):
        from shiboken6 import getCppPointer

        def items(item):
            yield item
            for child in item.childItems():
                yield from items(child)
        def drawn():
            return sorted(getCppPointer(o)[0] for o in items(self.stage) if o.metaObject().className().startswith(('ThemeScene', 'GlowText', 'QQuickImage')))
        # From a settled screen: what the last test showed has gone before counting.
        self.show(state(q=question(), look='halloween'))
        for _ in range(40):
            app.processEvents(); time.sleep(0.02)
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
        self.assertIn('✗ Owls  −2', texts, 'Risk It shows the points lost')
        self.assertIn('✗ Foxes', texts)
        self.assertIn('Question 2 of 3', texts)
        self.show(CASES['recap-results'], 'recap-results')
        results = self.stage.findChild(QObject, 'recapResults')
        self.assertTrue(results.property('visible'))
        rows = [o for o in items(results) if o.property('text') == 'Team 11']
        self.assertTrue(rows and inside(rows[0]), 'the last team’s row on the screen')

    def test_put_in_order_sorts_itself_on_the_reveal(self):
        """Shown shuffled; revealed, each item slides to its right place, numbered, and the box only says who got it right."""
        def rows():
            out = []
            for row in self.stage.findChild(QObject, 'sequenceList').childItems():
                try:
                    if row.objectName() == 'sequenceItem' and row.property('visible'):
                        out.append((row.property('y'), row.childItems()[0].property('text')))
                except (TypeError, AttributeError, IndexError):
                    continue
            return sorted(out, key=lambda r: r[0])
        q = question(type='sequence', options=[], items=['One', 'Two', 'Three'], order=[2, 0, 1])
        self.show(state(q=q))
        self.assertEqual([text for _, text in rows()], ['•  Three', '•  One', '•  Two'])
        # Before the answer's reveal they never slide: a change in the space (the window, the answer box) puts them
        # straight in their new places.
        lst = self.stage.findChild(QObject, 'sequenceList')
        before = lst.property('row')
        self.stage.setProperty('tv', state(q={**q, 'text': 'Put these in order, smallest first, as they were measured at the time, by the people whose job it was. ' * 2}))
        for _ in range(8):     # the layout settles; a slide (700 ms or more) would still be on its way
            app.processEvents(); time.sleep(0.01)
        self.assertNotEqual(lst.property('row'), before, 'the rows got smaller')
        self.assertEqual([round(y) for y, _ in rows()], [round(i * lst.property('row')) for i in range(3)])
        self.show(state(q=q))
        # A new state for the same question (each update brings new arrays) keeps the rows, so they can slide.
        revealed = state(q={**q, 'open': False, 'live': False, 'revealed': True, 'order': [2, 0, 1], 'scorers': [{'name': 'Bears', 'ms': 4100, 'points': 2}]})
        self.show(revealed)
        moving = rows()
        for _ in range(80):
            app.processEvents(); time.sleep(0.02)
        self.assertEqual([text for _, text in rows()], ['1.  One', '2.  Two', '3.  Three'])
        self.assertNotEqual([y for y, _ in moving], [y for y, _ in rows()], 'the rows were still on their way when first drawn')
        self.show(revealed, 'sequence-revealed')
        box = self.stage.findChild(QObject, 'revealContent')
        texts = [o.property('text') for o in box.findChildren(QObject) if isinstance(o.property('text'), str) and o.property('visible')]
        self.assertNotIn('ANSWER', texts)
        self.assertFalse(any('→' in t for t in texts), texts)
        self.assertIn('1 team scored', texts)

    def test_the_next_question_opens_at_its_full_size(self):
        """After a revealed question, the next one's rows are their full size as it opens, not growing into the space
        the answer box leaves."""
        lst = self.stage.findChild(QObject, 'sequenceList')
        q = lambda **over: question(type='sequence', options=[], items=['One', 'Two', 'Three'], order=[2, 0, 1], **over)
        self.show(state(q=q(open=False, live=False, revealed=True, scorers=[{'name': 'Bears', 'ms': 4100, 'points': 2}])))
        for _ in range(40):
            app.processEvents(); time.sleep(0.02)
        self.stage.setProperty('tv', state(q=q()))
        for _ in range(5):
            app.processEvents(); time.sleep(0.02)
        opening = lst.property('row')
        for _ in range(50):
            app.processEvents(); time.sleep(0.02)
        self.assertEqual(opening, lst.property('row'))

    def test_the_clip_playing_is_lit(self):
        """Sound clips: a disc for every clip, the one playing lit (also when the quizmaster plays one again)."""
        self.show(CASES['clips'])
        discs = [o for o in self.stage.findChildren(QObject, 'clipDisc') if o.property('visible')]
        if not discs:   # Repeater delegates may not be QObject children: walk the items
            discs = [o for o in items(self.stage) if safe_name(o) == 'clipDisc']
        self.assertEqual(len(discs), 5)
        self.assertEqual([d.property('playing') for d in discs], [False, True, False, False, False])
        self.assertEqual([d.property('played') for d in discs], [True, True, False, True, False])

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

    def test_a_team_photo_in_the_spotlight_is_round(self):
        # A plain red photo: inside the ring it shows; at its square's corners (outside the circle) it mustn't.
        import tempfile
        from PySide6.QtGui import QImage, QColor
        folder = tempfile.mkdtemp()
        photo = QImage(800, 600, QImage.Format_RGB32); photo.fill(QColor('#ff0000')); photo.save(folder + '/red.png')
        self.stage.setProperty('serverUrl', QUrl.fromLocalFile(folder).toString())
        try:
            teams = [{'name': 'Bears', 'rank': 1, 'score': 12, 'photo': '/red.png'}, {'name': 'Owls', 'rank': 2, 'score': 9}]
            self.show(state('leaderboard', teams=teams, reveal={'question': 77, 'shown': 1, 'rest': 0, 'leader': False, 'done': False, 'hidden': ['Bears']}))
            self.show(state('leaderboard', teams=teams, reveal={'question': 77, 'shown': 2, 'rest': 0, 'leader': True, 'done': True, 'hidden': []}), 'spotlight-photo')
            for _ in range(60):
                app.processEvents(); time.sleep(0.02)
            discs = [o for o in items(self.stage) if o.objectName() == 'spotlightDisc' and o.isVisible()]
            self.assertEqual(len(discs), 1, 'the leader in the spotlight')
            disc = discs[0]
            size = disc.property('width')
            frame = self.window.grabWindow()
            def colour(x, y):
                point = disc.mapToItem(None, x, y)
                return frame.pixelColor(int(point.x()), int(point.y()))
            red = lambda c: c.red() > 200 and c.green() < 60 and c.blue() < 60
            self.assertTrue(red(colour(size / 2, size / 2)), 'the photo shows in the ring')
            self.assertTrue(red(colour(size / 2, 0.06 * size)), 'filling it to the top (cropped from its middle)')
            for x, y in ((0.1, 0.1), (0.9, 0.1), (0.1, 0.9), (0.9, 0.9)):
                self.assertFalse(red(colour(x * size, y * size)), f'no photo outside the circle at {x}, {y}')
        finally:
            self.stage.setProperty('serverUrl', '')
            self.stage.findChild(QObject, 'spotlight').setProperty('shown', None)

    def test_joint_leaders_names_stay_on_the_screen(self):
        teams = [{'name': n, 'rank': 1, 'score': 6} for n in ['Agatha Quiztie', 'Les Quizerables', 'Tequila Mockingbird']] + [{'name': 'Owls', 'rank': 4, 'score': 2}]
        self.show(state('leaderboard', teams=teams, reveal={'question': 99, 'shown': 1, 'rest': 0, 'leader': False, 'done': False, 'hidden': [t['name'] for t in teams[:3]]}))
        self.show(state('leaderboard', teams=teams, reveal={'question': 99, 'shown': 4, 'rest': 0, 'leader': True, 'done': True, 'hidden': []}), 'spotlight-tie')
        for _ in range(40):
            app.processEvents(); time.sleep(0.02)
        names = self.stage.findChild(QObject, 'spotlightNames')
        self.assertIn('Tequila Mockingbird', names.property('text'))
        left = names.mapToItem(self.stage, 0, 0).x()
        self.assertGreaterEqual(left, 0)
        self.assertLessEqual(left + names.property('width'), 1920)
        self.assertLessEqual(names.property('contentWidth'), names.property('width') + 1, 'the names wrap rather than run off the screen')
        spotlight = self.stage.findChild(QObject, 'spotlight')
        spotlight.setProperty('shown', None); spotlight.setProperty('armedFor', None)

    def test_answers_are_solid_colour_blocks(self):
        """Options are the phones' solid colour blocks (as the web TV draws them), not tinted outlines: the middle of
        answer A is bright red and of B bright blue, as style.css's .opt.o0 and .o1."""
        self.show(state(q=question()))
        for _ in range(30):
            app.processEvents(); time.sleep(0.02)
        image = self.window.grabWindow()
        def items(item):
            yield item
            for child in item.childItems():
                yield from items(child)
        tiles = sorted([t for t in items(self.stage) if t.objectName() == 'optionTile' and t.property('visible')], key=lambda t: t.property('index'))
        self.assertGreaterEqual(len(tiles), 2)
        scale = image.width() / self.window.width()
        def middle(tile):
            p = tile.mapToItem(self.window.contentItem(), tile.property('width') / 2, tile.property('height') / 3)
            return image.pixelColor(int(p.x() * scale), int(p.y() * scale))
        red, blue = middle(tiles[0]), middle(tiles[1])
        self.assertTrue(red.red() > 200 and red.green() < 140 and red.blue() < 140, f'A is solid red: {red.name()}')
        self.assertTrue(blue.blue() > 200 and blue.red() < 120, f'B is solid blue: {blue.name()}')

    def test_music_bingo_with_a_long_question_doesnt_overlap(self):
        """A two-line question over music bingo's song, its last title and the reaction table: each line below the
        other, none drawn over another, all on the screen (as on the website's screenshot)."""
        names = ['Agatha Quiztie', 'Quiz Team Aguilera', 'Tequila Mockingbird', 'The Quizzly Bears', 'Universally Challenged']
        self.show(state(q=question(type='musicbingo', options=[], text='Music bingo: dab each song as soon as you know it', round='Music bingo',
                                   bingo={'played': 7, 'titles': ['Darts Final'], 'winners': [], 'board': False, 'music': True},
                                   reactionTable={'song': 7, 'now': [{'name': n, 'ms': 700 * (i + 1)} for i, n in enumerate(names)],
                                                  'leaders': [{'name': 'Agatha Quiztie', 'songs': 1}]})), 'reactions-long')
        for _ in range(30):
            app.processEvents(); time.sleep(0.02)
        def items(item):
            yield item
            for child in item.childItems():
                yield from items(child)
        wanted = ['Song 7', 'Last revealed: Darts Final', 'Reactions · song 7', 'Universally Challenged']
        boxes = {}
        for item in items(self.stage):
            text = item.property('text')
            if isinstance(text, str) and item.property('visible') and item.property('opacity') and any(w in text for w in wanted):
                # Both corners on the stage (what's inside is scaled to fit the screen).
                p, q = item.mapToItem(self.stage, 0, 0), item.mapToItem(self.stage, item.property('contentWidth'), item.property('height'))
                boxes[next(w for w in wanted if w in text)] = (p.x(), p.y(), q.x(), q.y())
        self.assertEqual(sorted(boxes), sorted(wanted))
        def apart(a, b):
            return a[2] <= b[0] + 1 or b[2] <= a[0] + 1 or a[3] <= b[1] + 1 or b[3] <= a[1] + 1
        for i, a in enumerate(wanted):
            for b in wanted[i + 1:]:
                self.assertTrue(apart(boxes[a], boxes[b]), f'{a} {boxes[a]} drawn over {b} {boxes[b]}')
        self.assertLessEqual(max(b[3] for b in boxes.values()), 1080, 'all of it on the screen')

    def test_a_long_question_leaves_every_round_on_the_screen(self):
        """Every round format with a question long enough to take two or three lines: nothing that shows runs off the
        bottom of the TV."""
        long = 'In which year did the first team to win the competition three times in a row finally lift the trophy at home?'
        def items(item):
            yield item
            for child in item.childItems():
                yield from items(child)
        for name, s in CASES.items():
            q = s.get('question')
            if not q or s.get('view') not in (None, 'question'):
                continue
            self.show({**s, 'question': {**q, 'text': long}})
            for _ in range(20):
                app.processEvents(); time.sleep(0.02)
            view = next(i for i in items(self.stage) if i.objectName() == 'questionView')
            over = []
            for item in items(view):
                text = item.property('text')
                try:
                    shows = item.property('visible') and item.property('opacity') and item.property('height') > 0
                except TypeError:
                    continue
                if shows and isinstance(text, str) and text.strip():
                    bottom = item.mapToItem(self.stage, 0, item.property('height')).y()
                    if bottom > 1080 + 1:
                        over.append((text[:30], round(bottom)))
            self.assertEqual(over, [], f'{name}: past the bottom of the TV')

    def test_put_in_order_reveal_shows_the_whole_answer_and_who_scored(self):
        """The most a put-in-order can have (8 items), a long question and ten teams scoring: at the reveal the question
        steps back, and every item of the answer and the box of who scored are on the screen, clear of each other."""
        items8 = ['Mercury', 'Venus', 'Earth', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune']
        q = question(type='sequence', options=[], items=items8, order=[3, 1, 7, 4, 0, 6, 2, 5], round='Round 2 · In order',
                     text='Put these planets in order, from the one nearest to the Sun to the one furthest away from it, as they were known in 2006')
        self.show(state(q=q))
        scorers = [{'name': f'Team number {i + 1}', 'ms': 2000 + 700 * i, 'points': 2} for i in range(10)]
        self.show(state(q={**q, 'open': False, 'live': False, 'revealed': True, 'scorers': scorers}))
        for _ in range(150):     # the slide into order, and the box of who scored coming up
            app.processEvents(); time.sleep(0.02)
        self.show(state(q={**q, 'open': False, 'live': False, 'revealed': True, 'scorers': scorers}), 'sequence-revealed-long')
        def items(item):
            yield item
            for child in item.childItems():
                yield from items(child)
        def box(item):
            p, r = item.mapToItem(self.stage, 0, 0), item.mapToItem(self.stage, item.property('width'), item.property('height'))
            return p.y(), r.y()
        rows = sorted(box(i) for i in items(self.stage) if i.objectName() == 'sequenceItem' and i.property('visible'))
        scored = self.stage.findChild(QObject, 'reveal')
        self.assertEqual(len(rows), 8)
        top, bottom = box(scored)
        self.assertLessEqual(rows[-1][1], top + 1, 'the last item of the answer is above who scored')
        self.assertLessEqual(bottom, 1080 + 1, 'who scored is on the screen')
        # Measured on the stage, where what's inside is scaled to fit: a row is at least as tall as a name in who scored.
        self.assertGreaterEqual(min(b - a for a, b in rows), 25, 'every item is big enough to read')

    def test_the_buzzer_queue_goes_once_answers_close(self):
        """Teams still queued to buzz are shown while the question is open, not once it has closed."""
        def texts():
            out = []
            def walk(item):
                for c in item.childItems():
                    t = c.property('text')
                    if isinstance(t, str) and c.property('visible'):
                        out.append(t)
                    walk(c)
            walk(self.stage)
            return out
        buzz = {'variation': 'classic', 'queue': [{'team': 'a', 'name': 'Owls', 'status': 'active'}, {'team': 'b', 'name': 'Bears', 'status': 'queued'}],
                'active': {'team': 'a', 'name': 'Owls'}, 'announced': '', 'agreeOpen': False, 'agreeCount': 0}
        q = question(type='buzzer', options=[], buzz=buzz)
        self.show(state(q=q))
        self.assertIn('Bears', texts())
        self.show(state(q={**q, 'open': False, 'live': False, 'buzz': {**buzz, 'active': None}}))
        self.assertNotIn('Bears', texts())

    def test_hidden_wording_tells_the_room_to_listen(self):
        """A question whose wording is hidden (hideText: the server sends no text before the reveal) asks the room to
        listen to the quizmaster rather than leaving a blank; with wording, the wording."""
        def heading():
            def walk(item):
                for c in item.childItems():
                    if c.objectName() == 'questionText':
                        return c
                    found = walk(c)
                    if found:
                        return found
            return walk(self.stage).property('text')
        self.show(state(q=question(text='')), 'hidden-wording')
        self.assertIn('Listen to the quizmaster', heading())
        self.show(state(q=question()))
        self.assertEqual(heading(), 'Which planet is red?')

    def test_risk_it_and_wipeout_are_told_while_the_question_is_up(self):
        """Risk It and Wipeout say what a wrong answer costs while teams answer; a plain question says nothing, and the
        reveal takes it away."""
        def note():
            def walk(item):
                for c in item.childItems():
                    if c.objectName() == 'riskNote':
                        return c
                    found = walk(c)
                    if found:
                        return found
            item = walk(self.stage)
            return item.property('text') if item.property('visible') else ''
        self.show(state(q=question(evil=True)), 'risk-it')
        self.assertIn('Risk It', note())
        self.show(state(q=question(type='multi', wipeout=True)))
        self.assertIn('Wipeout', note())
        self.show(state(q=question()))
        self.assertEqual(note(), '')
        self.show(state(q=question(evil=True, open=False, revealed=True)))
        self.assertEqual(note(), '')

    def test_a_picture_revealed_over_its_first_seconds_is_whole_after_them(self):
        """revealSeconds: twenty seconds into a 30-second question, a picture revealed over its first 15 has every tile
        off; revealed over the whole time, a third of them are still on."""
        def tiles_on():
            on = []
            def walk(item):
                for c in item.childItems():
                    if c.objectName() == 'revealTile' and c.property('opacity') > 0.5:
                        on.append(c)
                    walk(c)
            walk(self.stage)
            return len(on)
        now = time.time() * 1000
        for over, expected in ((15, 0), (None, 4)):
            q = question(type='picture', options=[], media=PICTURE, reveal='tiles', seconds=30, deadline=now + 10000, remaining=10000, **({'revealSeconds': over} if over else {}))
            self.show(state(q=q))
            for _ in range(40):     # the tiles fade
                app.processEvents(); time.sleep(0.02)
            self.assertEqual(tiles_on(), expected, f'revealed over {over or 30}s')

    def test_a_new_tiled_picture_starts_covered(self):
        """After a picture shown whole (its tiles all off), the next tiled picture is covered from its first frame: the
        tiles don't fade back in over the picture."""
        def tiles_on():
            out = []
            def walk(item):
                for c in item.childItems():
                    if c.objectName() == 'revealTile' and c.property('opacity') > 0.95:
                        out.append(c)
                    walk(c)
            walk(self.stage)
            return len(out)
        self.show(state(q=question(type='picture', options=[], media=PICTURE, reveal='tiles', open=False, live=False, revealed=True)))
        for _ in range(40):
            app.processEvents(); time.sleep(0.02)
        self.assertEqual(tiles_on(), 0, 'the last picture whole')
        self.stage.setProperty('tv', state(q=question(type='picture', options=[], media=PICTURE, reveal='tiles', deadline=time.time() * 1000 + 30000, remaining=30000)))
        for _ in range(3):
            app.processEvents(); time.sleep(0.01)
        self.assertEqual(tiles_on(), 12, 'covered from the first frames')

    def test_the_blur_sharpens_smoothly(self):
        """Halfway between two blur sizes, the next one is half faded in over the last: no jumps between steps."""
        now = time.time() * 1000
        # 30 s question, 14.25 s gone: 47.5% shown, blur level 9.5 of 20.
        self.show(state(q=question(type='picture', options=[], media=PICTURE, reveal='blur', seconds=30, deadline=now + 15750, remaining=15750)))
        def find(item, name):
            for c in item.childItems():
                if c.objectName() == name:
                    return c
                found = find(c, name)
                if found:
                    return found
        nxt = find(self.stage, 'blurNext')
        base = nxt.parentItem()
        level = base.property('blurLevel')     # about 9.5: a little more, as time passes while the screen settles
        self.assertTrue(9.3 < level < 10.5, level)
        widths = [round(6 * 40 ** (k / 20)) for k in range(21)]
        self.assertEqual(base.property('sourceSize').width(), widths[int(level)])
        self.assertEqual(nxt.property('sourceSize').width(), widths[int(level) + 1])
        self.assertAlmostEqual(nxt.property('opacity'), level - int(level), delta=0.05, msg='the next size fades in by how far between them')

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
