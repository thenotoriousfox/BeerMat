#!/usr/bin/env python3
"""The website's desk and TV screenshots (site/public/shots), taken from BeerMat Desk, the native (Qt) app: a quiz
server with the rehearsal quiz (load-test-quiz.mjs) on BeerMat Pro, six made-up teams joining and answering over the
quiz API, the real desk and its TV. Run it again whenever the desk or TV changes:

    python3 scripts/site-screenshots-native.py

The phone shots and og.png come from scripts/site-screenshots.mjs (players play in the browser). Needs PySide6 (as the
desk), Node.js, ffmpeg (WebP), numpy and Pillow. Captured at 2x: <name>@2x.webp at full size and <name>.webp at half, as the
website's srcset expects."""
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image

os.environ.setdefault('QT_QPA_PLATFORM', 'offscreen')
os.environ['QT_SCALE_FACTOR'] = '2'
os.environ['BEERMAT_MUTE'] = '1'
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'native'))
from PySide6.QtCore import QObject, QSettings, QUrl, Signal                       # noqa: E402
from PySide6.QtGui import QFontDatabase, QGuiApplication               # noqa: E402
from PySide6.QtQml import QQmlApplicationEngine                        # noqa: E402
from PySide6.QtQuick import QQuickWindow                               # noqa: E402,F401  (window type)
from PySide6.QtQuickControls2 import QQuickStyle                       # noqa: E402

from beermat_desk import desk as desk_module, gradients               # noqa: E402
from beermat_desk.screens import Screens                               # noqa: E402

OUT, KEY, TICKET = ROOT / 'site' / 'public' / 'shots', 'screenshot-quiz-key-0123', 'screenshot-desk-ticket-0123'
TEAMS = ['Agatha Quiztie', 'Les Quizerables', 'Quiz Team Aguilera', 'Tequila Mockingbird', 'The Quizzly Bears', 'Universally Challenged']
app = QGuiApplication(sys.argv)
app.setOrganizationName('BeerMat-shots')     # its own preferences, not the real desk's
QQuickStyle.setStyle('Basic')
for font in ('fredoka.woff2', 'fredoka-regular.ttf', 'fredoka-medium.ttf', 'fredoka-semibold.ttf', 'fredoka-bold.ttf'):
    QFontDatabase.addApplicationFont(str(ROOT / 'brand' / font))
QSettings().setValue('welcomed', True)   # past the first-run question


def pump(seconds):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        app.processEvents()
        time.sleep(0.02)


def wait(condition, what, seconds=30):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        app.processEvents()
        if condition():
            return
        time.sleep(0.02)
    sys.exit(f'Timed out waiting for {what}')


# A Pro quiz server, as scripts/site-screenshots.mjs uses, with a one-time ticket that unlocks the desk.
folder = Path(tempfile.mkdtemp(prefix='beermat-native-shots-'))
server = subprocess.Popen(['node', '--input-type=module', '-e', f'''
import {{createQuiz}} from {json.dumps(str(ROOT / "server" / "server.js"))};
const quiz = createQuiz({{hostKey: {json.dumps(KEY)}, deskTicket: {json.dumps(TICKET)}, plan: 'pro', database: {json.dumps(str(folder / "quiz.sqlite"))}, mediaDir: {json.dumps(str(folder / "media"))}}});
quiz.server.listen(0, '127.0.0.1', () => console.log(JSON.stringify({{port: quiz.server.address().port}})));
'''], stdout=subprocess.PIPE, text=True)
port = json.loads(server.stdout.readline())['port']
base = f'http://127.0.0.1:{port}'
subprocess.run(['node', str(ROOT / 'scripts' / 'load-test-quiz.mjs'), base], env={**os.environ, 'HOST_KEY': KEY}, check=True, capture_output=True)


def post(route, body=None, key=''):
    request = urllib.request.Request(f'{base}/api/{route}', json.dumps(body or {}).encode(), {'Content-Type': 'application/json', 'Authorization': f'Bearer {key}'})
    with urllib.request.urlopen(request, timeout=10) as reply:
        return json.loads(reply.read())


host = post('login', {'key': KEY})['key']
post('host/settings', {'title': 'Tuesday Quiz Night', 'waitingRoom': False, 'teamPhotos': False}, host)


class ExistingServer(QObject):
    """Stands in for the desk's own quiz server (server.py): the one above, already running."""
    ready, failed, stopped, message, log = Signal(dict), Signal(str), Signal(int), Signal(dict), Signal(str)

    def __init__(self, data_dir, host_key, port=3000, laptop=True, parent=None):
        super().__init__(parent)
        self.data_dir, self.host_key, self.info = Path(data_dir), KEY, None

    def start(self):
        self.info = {'port': port, 'publicPort': port, 'database': str(folder / 'quiz.sqlite'), 'prepared': True}
        self.ready.emit(self.info)

    def send(self, message):
        if message.get('type') == 'ticket':
            self.message.emit({'type': 'ticket', 'id': message.get('id'), 'ticket': TICKET})

    def stop(self, *_args, **_kwargs):
        pass


desk_module.QuizServer = ExistingServer
desk = desk_module.Desk(folder / 'desk', KEY, port=port, laptop=False)
screens = Screens()
engine = QQmlApplicationEngine()
gradients.install(engine)
qml = ROOT / 'native' / 'beermat_desk' / 'qml'
for name, value in (('desk', desk), ('screens', screens), ('brand', QUrl.fromLocalFile(str(ROOT / 'brand') + '/'))):
    engine.rootContext().setContextProperty(name, value)
engine.addImportPath(str(qml))
engine.load(QUrl.fromLocalFile(str(qml / 'Main.qml')))
window = engine.rootObjects()[0]
window.setProperty('width', 1600)
window.setProperty('height', 1000)
# The TV as the room sees it, at 1600x900 (the TV window itself shows the same stage, full screen).
tv_engine = QQmlApplicationEngine()
gradients.install(tv_engine)
tv_engine.rootContext().setContextProperty('desk', desk)
tv_engine.rootContext().setContextProperty('brand', QUrl.fromLocalFile(str(ROOT / 'brand') + '/'))
tv_engine.addImportPath(str(qml))
tv_engine.loadData(b'import QtQuick\nimport QtQuick.Window\nWindow { width: 1600; height: 900; visible: true; color: "black"\n'
                   b'    TvStage { anchors.fill: parent; tv: desk.tv; serverUrl: desk.serverUrl } }', QUrl.fromLocalFile(str(qml / 'Shots.qml')))
tv = tv_engine.rootObjects()[0]
OUT.mkdir(parents=True, exist_ok=True)


def half(png, out):
    """The 2x capture at half size, each 2x2 block averaged exactly and rounded by a 4x4 ordered pattern, so the
    desk's and TV's smooth gradients stay smooth (plain rounding brings their colour steps back as bands)."""
    rgb = np.asarray(Image.open(png).convert('RGB'), dtype=np.float32)
    h, w = rgb.shape[0] // 2 * 2, rgb.shape[1] // 2 * 2
    mean = rgb[:h, :w].reshape(h // 2, 2, w // 2, 2, 3).mean(axis=(1, 3))
    bayer = (np.array([[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]], dtype=np.float32) + 0.5) / 16
    nudge = np.tile(bayer, (mean.shape[0] // 4 + 1, mean.shape[1] // 4 + 1))[:mean.shape[0], :mean.shape[1], None]
    Image.fromarray(np.clip(np.floor(mean + nudge), 0, 255).astype(np.uint8)).save(out)


def shot(win, name):
    pump(0.8)
    png = folder / f'{name}.png'
    win.grabWindow().save(str(png))
    half(png, folder / f'{name}-1x.png')
    # Lossless: lossy WebP stores colour coarsely and puts the bands straight back into dark gradients.
    for file, source in ((f'{name}@2x.webp', png), (f'{name}.webp', folder / f'{name}-1x.png')):
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(source), '-c:v', 'libwebp', '-lossless', '1', '-compression_level', '6', str(OUT / file)], check=True)
    print('Saved', name)


try:
    desk.start()
    wait(lambda: desk.connected and desk.view.get('phase'), 'the desk')
    teams = [post('join', {'name': name}) for name in TEAMS]
    wait(lambda: len(desk.view.get('teams') or []) == len(TEAMS), 'the teams')
    shot(tv, 'tv-join')
    # The first question, mid-flow: some teams in, the desk and the TV as the room sees them.
    desk.next()
    wait(lambda: desk.view.get('canClose'), 'the first question')
    question = post('state', {}, teams[0]['secret'])['question']
    pump(2.3)    # teams take a moment to read it
    for i, value in ((0, 'Mars'), (1, 'Mars'), (3, 'Venus')):
        post('answer', {'question': question['id'], 'value': value}, teams[i]['secret'])
        pump(0.6)
    wait(lambda: desk.view.get('answers') == 3, 'the answers')
    pump(1.5)    # past the "Next question opened" note
    shot(window, 'desk')
    shot(tv, 'tv-question')
    # The answer revealed on the TV, then the leaderboard.
    desk.closeAnswers()
    wait(lambda: desk.view.get('canReveal'), 'answers closed')
    post('host/reveal', {'question': question['id'], 'revealed': True, 'delay': 0}, host)
    pump(2.5)
    shot(tv, 'tv-reveal')
    post('host/settings', {'displayMode': 'leaderboard'}, host)
    pump(2.5)
    shot(tv, 'tv-leaderboard')
    # Ways to play: a picture under tiles part-way through, music bingo's reaction table, and Fast Track.
    post('host/settings', {'displayMode': 'auto'}, host)
    saved = [q for r in post('host/library', {}, host)['rounds'] for q in r['questions']]
    picture = next(q for q in saved if q['type'] == 'picture')
    post('host/open', {'text': 'What shape is under the tiles?', 'type': 'picture', 'media': picture['media'], 'answer': picture['answer'], 'round': 'Pictures', 'seconds': 30, 'points': 1, 'reveal': 'tiles'}, host)
    pump(13)     # over a third of the time gone: some tiles off, most still on
    shot(tv, 'tv-reveal-tiles')
    post('host/close', {}, host)
    songs = next(q for q in saved if q['type'] == 'musicbingo')['songs']
    post('host/open', {'text': 'Music bingo: dab each song as soon as you know it', 'type': 'musicbingo', 'mode': 'line', 'songs': songs, 'round': 'Music bingo',
                       'seconds': 1800, 'points': 3, 'reactions': True, 'reactionPoints': 1}, host)
    music = post('host/state', {}, host)['question']
    cards = {}
    # Songs until one is on most teams' tickets, so the table has a few teams on it.
    for _ in range(20):
        post('host/bingo', {'question': music['id']}, host)
        title = post('host/state', {}, host)['question']['bingo']['current']['title']
        cards = {team['secret']: [t for row in post('state', {}, team['secret'])['question']['bingo']['card'] for t in row] for team in teams}
        if sum(title in card for card in cards.values()) >= 4:
            break
    for team in teams:
        pump(0.7)    # teams know it at different speeds
        if title in cards[team['secret']]:
            post('react', {'question': music['id'], 'title': title}, team['secret'])
    pump(2)
    shot(tv, 'tv-reactions')
    post('host/close', {}, host)
    post('host/settings', {'displayMode': 'leaderboard'}, host)
    pump(2.5)
    post('host/fasttrack', {'team': teams[3]['id'], 'action': 'first'}, host)
    pump(1.5)
    shot(tv, 'tv-fasttrack')
    # Ways to play on the Round formats page (site/src/formats.ts): Send Question, a question on the fly, VAR Check,
    # a tie-breaker, team groups, slides between rounds and a secret round.
    post('host/settings', {'displayMode': 'auto', 'sendQuestion': True}, host)
    post('host/open', {'text': 'Which planet has the most moons?', 'type': 'choice', 'options': ['Jupiter', 'Saturn', 'Uranus', 'Neptune'], 'answer': 'Saturn',
                       'round': 'General knowledge', 'seconds': 30, 'points': 1}, host)
    pump(2)
    shot(tv, 'tv-sendquestion')
    post('host/close', {}, host)
    post('host/settings', {'sendQuestion': False}, host)
    post('host/fly', {'type': 'number', 'text': 'How many pints were pulled at the bar in the last round?', 'seconds': 30, 'points': 1}, host)
    fly = post('host/state', {}, host)['question']
    for i, value in enumerate(['42', '37', '50', '45']):
        post('answer', {'question': fly['id'], 'value': value}, teams[i]['secret'])
    post('host/close', {}, host)
    pump(2.5)
    shot(window, 'desk-fly')
    post('host/fly/answer', {'question': fly['id'], 'answer': '44'}, host)
    # VAR Check: a team's answer marked wrong, its appeal, and the decision on the TV.
    post('host/open', {'text': 'Who painted the Mona Lisa?', 'type': 'text', 'answer': 'Leonardo da Vinci', 'round': 'Art', 'seconds': 30, 'points': 1}, host)
    var_q = post('host/state', {}, host)['question']
    post('answer', {'question': var_q['id'], 'value': 'Da Vinci'}, teams[2]['secret'])
    post('answer', {'question': var_q['id'], 'value': 'Leonardo da Vinci'}, teams[0]['secret'])
    post('host/close', {}, host)
    post('host/reveal', {'question': var_q['id'], 'revealed': True, 'delay': 0}, host)
    pump(1)
    post('team/var', {'question': var_q['id']}, teams[2]['secret'])
    appeal = post('host/state', {}, host)['varChecks'][0]
    post('host/var', {'id': appeal['id'], 'decision': 'overturned'}, host)
    pump(4.5)     # past the drum roll, to the decision
    shot(tv, 'tv-var')
    # A tie-breaker's reveal: the closest team fills the TV.
    post('host/open', {'text': 'Tie-breaker: how tall is the Eiffel Tower, in metres?', 'type': 'nearest', 'answer': '330', 'tieBreaker': True, 'round': 'Tie-breaker', 'seconds': 30, 'points': 0}, host)
    tie = post('host/state', {}, host)['question']
    for i, value in ((1, '300'), (4, '324'), (5, '350')):
        post('answer', {'question': tie['id'], 'value': value}, teams[i]['secret'])
        pump(0.3)
    post('host/close', {}, host)
    post('host/reveal', {'question': tie['id'], 'revealed': True, 'delay': 0}, host)
    pump(2.5)
    shot(tv, 'tv-tiebreaker')
    # Team groups: each group's average above the leaderboard.
    for i, team in enumerate(teams):
        post('host/team', {'id': team['id'], 'action': 'group', 'group': ['Sales', 'Accounts', 'Warehouse'][i % 3]}, host)
    post('host/settings', {'groupBoard': True, 'displayMode': 'leaderboard'}, host)
    pump(2.5)
    shot(tv, 'tv-groups')
    post('host/settings', {'groupBoard': False}, host)
    # Slides between rounds: a venue's own picture (drawn here).
    slide = Image.new('RGB', (1600, 900), (38, 20, 76))
    from PIL import ImageDraw, ImageFont
    draw = ImageDraw.Draw(slide)
    big, small = ImageFont.truetype(str(ROOT / 'brand' / 'fredoka-bold.ttf'), 120), ImageFont.truetype(str(ROOT / 'brand' / 'fredoka-medium.ttf'), 64)
    draw.text((800, 330), 'Pie & a pint £12', font=big, fill=(255, 196, 61), anchor='mm')
    draw.text((800, 520), 'Every Tuesday, quiz night', font=small, fill=(255, 243, 214), anchor='mm')
    draw.text((800, 620), 'Ask at the bar', font=small, fill=(255, 243, 214), anchor='mm')
    slide.save(folder / 'slide.png')
    upload = urllib.request.Request(f'{base}/api/host/media?name=slide.png', (folder / 'slide.png').read_bytes(), {'Authorization': f'Bearer {host}'})
    with urllib.request.urlopen(upload, timeout=10) as reply:
        media = json.loads(reply.read())['media']
    post('host/slides', {'slides': [{'media': media, 'seconds': 30}]}, host)
    post('host/settings', {'displayMode': 'slides'}, host)
    pump(2.5)
    shot(tv, 'tv-slides')
    # A secret round: the reveal shows nothing until the quiz ends.
    post('host/settings', {'displayMode': 'auto'}, host)
    revision = post('host/library', {}, host)['revision']
    post('host/library/save', {'revision': revision, 'quiz': {'title': 'Tuesday Quiz Night', 'rounds': [{'id': 'r-final', 'title': 'The Final', 'secret': True, 'questions': [
        {'id': 'secret-1', 'type': 'text', 'text': 'Which river flows through Paris?', 'answer': 'Seine', 'seconds': 30, 'points': 2}]}]}}, host)
    post('host/start', {'id': 'secret-1', 'expectedQuestion': post('host/state', {}, host)['question']['id']}, host)
    secret = post('host/state', {}, host)['question']
    for i in range(4):
        post('answer', {'question': secret['id'], 'value': ['Seine', 'Thames', 'Seine', 'Loire'][i]}, teams[i]['secret'])
    post('host/close', {}, host)
    post('host/reveal', {'question': secret['id'], 'revealed': True, 'delay': 0}, host)
    pump(2.5)
    shot(tv, 'tv-secret')
    # Library → Quizzes, with example quizzes as the library shows them (the shot doesn't depend on what's in the real
    # library today).
    desk.prefs.searchQuizzes = desk.prefs.searchLibrary = desk.prefs.searchThemes = lambda q: None
    outline = lambda *rounds: [{'title': t, 'questions': n} for t, n in rounds]
    desk.prefs._quizzes = {'pro': True, 'query': '', 'downloaded': ['q-2'], 'current': {}, 'shared': [], 'quizzes': [
        {'id': 'q-1', 'title': 'Halloween Special', 'by': 'BeerMat', 'rounds': 5, 'questions': 40, 'description': 'Spooky films, monster music and a pumpkin picture round, with a secret round to finish.',
         'formats': ['Multiple choice', 'Picture', 'Audio', 'Nearest wins', 'Buzzer'], 'outline': outline(('Fright night films', 8), ('Monster mash', 8), ('Pumpkin pictures', 8), ('Creepy creatures', 8), ('The witching hour', 8))},
        {'id': 'q-2', 'title': 'Tuesday Classics', 'by': 'The Crown & Anchor', 'rounds': 6, 'questions': 48, 'description': 'A proper pub quiz: general knowledge, sport, music and a picture round.',
         'formats': ['Typed answer', 'Multiple choice', 'Picture', 'Letter keypad'], 'outline': outline(('General knowledge', 8), ('Sport', 8), ('On the map', 8), ('Name that tune', 8), ('Pictures', 8), ('Wipeout', 8))},
        {'id': 'q-3', 'title': 'Music Bingo: Party Anthems', 'by': 'BeerMat', 'rounds': 2, 'questions': 2, 'description': 'Two full games of music bingo, ninety seconds of every song.',
         'formats': ['Music bingo'], 'outline': outline(('Game one', 1), ('Game two', 1))},
        {'id': 'q-4', 'title': 'Around the World in 40 Questions', 'by': 'The Old Bell', 'rounds': 4, 'questions': 40, 'description': 'Capitals, flags, landmarks and a pinpoint round on the map.',
         'formats': ['Typed answer', 'Picture', 'Pinpoint', 'Put in order'], 'outline': outline(('Capitals', 10), ('Flags', 10), ('Landmarks', 10), ('Where in the world?', 10))},
    ]}
    desk.prefs.quizzesChanged.emit()
    window.setProperty('workspace', 5)
    window.findChild(QObject, 'library').setProperty('tab', 0)
    pump(1)
    shot(window, 'library')
finally:
    server.terminate()
print('Screenshots saved in', OUT)
