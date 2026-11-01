#!/usr/bin/env python3
"""The website's short videos of the TV and the desk (site/public/clips), recorded from BeerMat Desk (the Qt desk and
TV) as a quiz runs: made-up teams join and answer over the quiz API while the windows are grabbed frame by frame. Run it
again whenever the desk or TV changes:

    python3 scripts/site-videos-native.py

Each clip is written as AV1 (10-bit, so the dark gradients stay smooth) and H.264 for browsers without AV1, with a
poster frame (lossless WebP). Needs PySide6 (as the desk), Node.js and ffmpeg with libsvtav1 and libx264."""
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

os.environ.setdefault('QT_QPA_PLATFORM', 'offscreen')
os.environ['BEERMAT_MUTE'] = '1'
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'native'))
from PySide6.QtCore import QObject, QSettings, QUrl, Signal                       # noqa: E402
from PySide6.QtGui import QFontDatabase, QGuiApplication               # noqa: E402
from PySide6.QtQuickControls2 import QQuickStyle                       # noqa: E402
from PySide6.QtQml import QQmlApplicationEngine                        # noqa: E402

from beermat_desk import desk as desk_module, gradients               # noqa: E402
from beermat_desk.screens import Screens                               # noqa: E402

OUT, KEY, TICKET = ROOT / 'site' / 'public' / 'clips', 'video-quiz-key-0123456', 'video-desk-ticket-0123456'
TEAMS = ['Agatha Quiztie', 'Les Quizerables', 'Quiz Team Aguilera', 'Tequila Mockingbird', 'The Quizzly Bears', 'Universally Challenged']
WIDTH, HEIGHT, FPS = 1280, 720, 30
app = QGuiApplication(sys.argv)
app.setOrganizationName('BeerMat-shots')     # its own preferences, not the real desk's
QQuickStyle.setStyle('Basic')
for font in ('fredoka.woff2', 'fredoka-regular.ttf', 'fredoka-medium.ttf', 'fredoka-semibold.ttf', 'fredoka-bold.ttf'):
    QFontDatabase.addApplicationFont(str(ROOT / 'brand' / font))
QSettings().setValue('welcomed', True)


def pump(seconds):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        app.processEvents()
        time.sleep(0.01)


def wait(condition, what, seconds=30):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        app.processEvents()
        if condition():
            return
        time.sleep(0.02)
    sys.exit(f'Timed out waiting for {what}')


folder = Path(tempfile.mkdtemp(prefix='beermat-videos-'))
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
qml = ROOT / 'native' / 'beermat_desk' / 'qml'
tv_engine = QQmlApplicationEngine()
gradients.install(tv_engine)
tv_engine.rootContext().setContextProperty('desk', desk)
tv_engine.rootContext().setContextProperty('brand', QUrl.fromLocalFile(str(ROOT / 'brand') + '/'))
tv_engine.addImportPath(str(qml))
tv_engine.loadData(f'import QtQuick\nimport QtQuick.Window\nWindow {{ width: {WIDTH}; height: {HEIGHT}; visible: true; color: "black"\n'
                   '    TvStage { anchors.fill: parent; tv: desk.tv; serverUrl: desk.serverUrl } }'.encode(), QUrl.fromLocalFile(str(qml / 'Clips.qml')))
tv = tv_engine.rootObjects()[0]
# The quizmaster's desk, as on the laptop.
desk_engine = QQmlApplicationEngine()
gradients.install(desk_engine)
screens = Screens()
for name, value in (('desk', desk), ('screens', screens), ('brand', QUrl.fromLocalFile(str(ROOT / 'brand') + '/'))):
    desk_engine.rootContext().setContextProperty(name, value)
desk_engine.addImportPath(str(qml))
desk_engine.load(QUrl.fromLocalFile(str(qml / 'Main.qml')))
desk_window = desk_engine.rootObjects()[0]
desk_window.setProperty('width', 1440)
desk_window.setProperty('height', 900)
OUT.mkdir(parents=True, exist_ok=True)


def record(windows, seconds, events=()):
    """Grabs each window ({clip name: window}) as fast as it can for `seconds`, running each (time, action) in `events`
    as its time comes, then writes each clip at a steady FPS (each grab lasts until the next). Returns each clip's
    grabs, for its poster."""
    todo, start = sorted(events, key=lambda e: e[0]), time.monotonic()
    shots = {name: [] for name in windows}
    for name in windows:
        (folder / name).mkdir()
    while (now := time.monotonic() - start) < seconds:
        while todo and todo[0][0] <= now:
            todo.pop(0)[1]()
        app.processEvents()
        for name, window in windows.items():
            file = folder / name / f'{len(shots[name]):05d}.png'
            window.grabWindow().save(str(file))
            shots[name].append((time.monotonic() - start, file))
    for name, grabs in shots.items():
        encode(name, grabs, seconds)
    return shots


def encode(name, shots, seconds):
    listing = folder / name / 'frames.txt'
    with listing.open('w') as f:
        for (at, file), (after, _) in zip(shots, shots[1:] + [(seconds, None)]):
            f.write(f"file '{file}'\nduration {after - at:.4f}\n")
        f.write(f"file '{shots[-1][1]}'\n")
    print(f'{name}: {len(shots)} grabs in {seconds}s')
    concat = ['ffmpeg', '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', str(listing), '-vf', f'fps={FPS}', '-an']
    # AV1, 10-bit: smooth gradients at a small size. H.264 for older browsers (8-bit, a little grain hides the steps).
    subprocess.run(concat + ['-c:v', 'libsvtav1', '-pix_fmt', 'yuv420p10le', '-crf', '30', '-preset', '6', '-svtav1-params', 'tune=0:film-grain=4',
                             str(OUT / f'{name}.webm')], check=True)
    subprocess.run(concat + ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '21', '-preset', 'slow', '-tune', 'grain', '-movflags', '+faststart',
                             str(OUT / f'{name}.mp4')], check=True)


def poster(shots, at, name):
    frame = min(shots, key=lambda s: abs(s[0] - at))[1]
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(frame), '-c:v', 'libwebp', '-lossless', '1', '-compression_level', '6', str(OUT / f'{name}.webp')], check=True)


def answer(team, value):
    return lambda: post('answer', {'question': current()['id'], 'value': value}, team['secret'])


def current():
    return post('host/state', {}, host)['question']


try:
    desk.start()
    wait(lambda: desk.connected and desk.view.get('phase'), 'the desk')
    teams = [post('join', {'name': name}) for name in TEAMS]
    wait(lambda: len(desk.view.get('teams') or []) == len(TEAMS), 'the teams')
    pump(2)

    # 1. A question on the TV: it opens, the teams answer, it closes, a drum roll, the answer.
    picks = ['Mars', 'Mars', 'Venus', 'Mars', 'Jupiter', 'Mars']
    shots = record({'tv-question': tv, 'desk-question': desk_window}, 15, [(0.6, desk.next)]
                   + [(3.5 + i * 0.9, answer(t, v)) for i, (t, v) in enumerate(zip(teams, picks))]
                   + [(9.2, desk.closeAnswers),
                      (10.0, lambda: post('host/reveal', {'question': current()['id'], 'revealed': True, 'delay': 1800}, host))])
    poster(shots['tv-question'], 7.5, 'tv-question')
    poster(shots['desk-question'], 8.5, 'desk-question')

    # Two more questions, answered off camera, so the scores differ.
    for values in ((['2', '7', '11'], ['2', '7'], ['2', '7', '11'], ['2', '7', '11'], ['4', '9'], ['2', '11']),):
        post('host/next', {'expectedQuestion': current()['id']}, host)
        for team, value in zip(teams, values):
            post('answer', {'question': current()['id'], 'value': value}, team['secret'])
        post('host/close', {'expectedQuestion': current()['id']}, host)
        post('host/reveal', {'question': current()['id'], 'revealed': True, 'delay': 0}, host)
        pump(1)
    # Skip ahead to Put in order.
    while (q := current()) and q['type'] != 'sequence':
        post('host/close', {'expectedQuestion': q['id']}, host)
        post('host/next', {'expectedQuestion': q['id']}, host)
    pump(1)
    seq = current()
    orders = [[0, 1, 2, 3], [0, 1, 2, 3], [1, 0, 2, 3], [0, 2, 1, 3], [0, 1, 2, 3], [3, 2, 1, 0]]
    for team, order in zip(teams, orders):
        post('answer', {'question': seq['id'], 'value': order}, team['secret'])
    post('host/close', {'expectedQuestion': seq['id']}, host)
    pump(1.5)

    # 2. Put in order: the reveal puts the items in the right order.
    shots = record({'tv-order': tv}, 7, [(0.8, lambda: post('host/reveal', {'question': seq['id'], 'revealed': True, 'delay': 0}, host))])
    poster(shots['tv-order'], 6.5, 'tv-order')

    # 3. The leaderboard, revealed a place at a time.
    post('host/board', {'action': 'show'}, host)
    pump(0.3)
    def board_next():
        if desk.view.get('next', {}).get('step') in ('reveal', 'revealFirst', 'revealSecond'):
            post('host/board', {'action': 'next'}, host)
    # Sixth to third a place at a time, then the leader's spotlight, then second place and the full board.
    steps = [(1.0 + i * 1.3, board_next) for i in range(4)] + [(6.6, board_next), (12.5, board_next)]
    shots = record({'tv-leaderboard': tv}, 15, steps)
    poster(shots['tv-leaderboard'], 14.5, 'tv-leaderboard')

    # 4. A picture under tiles, coming off one by one as the clock runs down.
    saved = [q for r in post('host/library', {}, host)['rounds'] for q in r['questions']]
    picture = next(q for q in saved if q['type'] == 'picture')
    current_id = current()['id']
    post('host/close', {'expectedQuestion': current_id}, host)
    shots = record({'tv-reveal-tiles': tv}, 13, [(0.5, lambda: post('host/open', {'text': 'What shape is under the tiles?', 'type': 'picture', 'media': picture['media'],
                                                                              'answer': picture['answer'], 'round': 'Pictures', 'seconds': 12, 'points': 1, 'reveal': 'tiles'}, host))])
    poster(shots['tv-reveal-tiles'], 7.5, 'tv-reveal-tiles')

    # 5. Buzzers: the first team in takes the TV; a wrong answer passes it to the next.
    post('host/close', {'expectedQuestion': current()['id']}, host)
    def buzz(team):
        return lambda: post('buzz', {'question': current()['id']}, team['secret'])
    def verdict(action):
        return lambda: post('host/buzz', {'question': current()['id'], 'action': action}, host)
    shots = record({'tv-buzzer': tv}, 13, [(0.5, lambda: post('host/open', {'text': 'Fingers on buzzers: what is the capital of Australia?', 'type': 'buzzer',
                                                                          'answer': 'Canberra', 'round': 'Buzzer round', 'seconds': 60, 'points': 2}, host)),
                                           (2.6, buzz(teams[3])), (2.9, buzz(teams[0])), (3.3, buzz(teams[4])),
                                           (6.0, verdict('wrong')), (8.6, verdict('correct')),
                                           (9.0, lambda: post('host/reveal', {'question': current()['id'], 'revealed': True, 'delay': 0}, host))])
    poster(shots['tv-buzzer'], 4.5, 'tv-buzzer')
finally:
    server.terminate()
print('Clips saved in', OUT)
