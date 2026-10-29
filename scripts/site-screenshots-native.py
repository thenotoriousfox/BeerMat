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
