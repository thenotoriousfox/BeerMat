"""Quizmaster devices found through the account (link.py, tvscreen.py, server.js's quizmaster link), against a real
BeerMat Online and another quiz laptop, "the bar" (tests/fixtures/link.mjs): this desk, signed in to the same account,
is asked what it's for; as the desk it runs the bar's quiz (and what it plays is heard at the bar) until the bar takes
its desk back; as the TV, BeerMat finds the bar through the account; a TV signs in by QR code; and when another desk
takes over this laptop's desk, the desk here says so and can take it back."""
import json
import os
import socket
import subprocess
import sys
import tempfile
import unittest
import urllib.request
from pathlib import Path

os.environ.setdefault('QT_QPA_PLATFORM', 'offscreen')
os.environ.setdefault('BEERMAT_MUTE', '1')
sys.path.insert(0, str(Path(__file__).resolve().parent))
from PySide6.QtCore import QObject, QSettings, QUrl                        # noqa: E402
from PySide6.QtQml import QQmlApplicationEngine                            # noqa: E402

from test_desk import DeskCase, HERE, ROOT, app, wait                               # noqa: E402
from beermat_desk import gradients, svgmotion                              # noqa: E402
from beermat_desk.tvscreen import TvScreen                                 # noqa: E402


def call(url, body=None, key='', method=None):
    request = urllib.request.Request(url, json.dumps(body).encode() if body is not None else None,
                                     {'Content-Type': 'application/json', **({'Authorization': f'Bearer {key}'} if key else {})}, method=method)
    try:
        with urllib.request.urlopen(request, timeout=10) as reply:
            return reply.status, json.loads(reply.read() or b'{}')
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b'{}')


class LinkCase(DeskCase):
    def setUp(self):
        super().setUp()
        for key in ('tvDevice', 'tvLaptop', 'onlineService', 'tvScreen/address'):
            QSettings().remove(key)
        self.fixture = subprocess.Popen(['node', str(ROOT / 'tests' / 'fixtures' / 'link.mjs')], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
        self.addCleanup(lambda: (self.fixture.stdin.close(), self.fixture.wait(10)))
        self.info = json.loads(self.fixture.stdout.readline())
        self.bar = self.info['bar']

    def ask(self, line):
        self.fixture.stdin.write(line + '\n'); self.fixture.stdin.flush()
        return json.loads(self.fixture.stdout.readline())

    def signed_in_desk(self):
        desk = self.desk
        desk.start()
        wait(lambda: desk.connected and desk.view.get('phase'), what='the desk')
        port = desk.server.info['port']
        self.assertEqual(call(f'http://127.0.0.1:{port}/api/host/settings', {'onlineService': self.info['online']}, desk.api.session)[0], 200)
        desk.onlineVenue.signIn(self.info['email'], self.info['password'])
        wait(lambda: desk.onlineVenue.account.get('signedIn'), what='signed in to BeerMat Online', log=lambda: self.toasts)
        return desk


class AnotherDeskTest(LinkCase):
    def test_this_desk_runs_the_bars_quiz_until_the_bar_takes_it_back(self):
        desk = self.signed_in_desk()
        prompt = self.window.findChild(QObject, 'otherDesk')
        wait(lambda: prompt.property('visible'), what='the question: what is this device for?', log=lambda: (desk.link.other, (desk._state or {}).get('link')))
        self.assertEqual(desk.link.other.get('title'), self.bar['title'])
        self.shot('another-desk-open')
        own_title = desk.view.get('event')

        desk.link.useAsDesk()
        wait(lambda: desk.link.remote.get('name') and desk.view.get('event') == self.bar['title'], what='the bar’s quiz on this desk', log=lambda: (self.toasts, desk.link.remote))
        self.assertFalse(prompt.property('visible'))
        self.assertEqual(self.ask('away?')['away'], socket.gethostname()[:40], 'the bar shows its desk is here')
        self.assertTrue(self.window.findChild(QObject, 'remotePill').property('visible'))
        # What this desk plays (a clip, say) is heard at the bar, not here.
        desk.tvSound.desk_play('/media/clip.mp3', 500)
        wait(lambda: (call(self.bar['base'] + '/api/leaderboard', method='GET')[1].get('playback') or {}).get('media') == '/media/clip.mp3', what='the clip relayed to the bar')

        # Closing BeerMat here would hand the desk back too; that's checked last. First the bar takes it back: this
        # desk is back on its own quiz.
        call(self.bar['base'] + '/api/host/handover/end', {}, self.bar['host'])
        desk.refresh()
        wait(lambda: not desk.link.remote and desk.view.get('event') == own_title, what='back on this laptop’s quiz', log=lambda: self.toasts)
        self.assertIn((f'{socket.gethostname()} took its desk back', False), self.toasts)

    def test_the_bar_restarting_mid_quiz_this_desk_finds_it_again(self):
        desk = self.signed_in_desk()
        wait(lambda: desk.link.other.get('name'), what='the bar')
        desk.link.useAsDesk()
        wait(lambda: desk.link.remote.get('name') and desk.view.get('event') == self.bar['title'], what='the bar’s quiz on this desk', log=lambda: self.toasts)
        before = desk.serverUrl
        self.ask('restart')
        wait(lambda: desk.link.lost, what='this desk noticing the bar has gone', timeout=30)
        self.assertTrue(self.window.findChild(QObject, 'remotePill').property('text').startswith('Finding '))
        wait(lambda: not desk.link.lost and desk.serverUrl != before, what='the bar found again at its new address', timeout=45, log=lambda: (self.toasts, desk.serverUrl))
        wait(lambda: self.ask('away?')['away'], what='the bar showing its desk is here again')
        wait(lambda: desk.view.get('event') == self.bar['title'], what='the bar’s quiz on this desk again')

    def test_closing_this_desk_hands_the_bar_its_desk_back(self):
        desk = self.signed_in_desk()
        wait(lambda: desk.link.other.get('name'), what='the bar')
        desk.link.useAsDesk()
        wait(lambda: desk.link.remote.get('name'), what='the bar’s quiz on this desk', log=lambda: self.toasts)
        wait(lambda: self.ask('away?')['away'], what='the bar showing its desk is here')
        desk.stop()
        self.assertIsNone(self.ask('away?')['away'], 'the bar has its desk back')

    def test_this_device_becomes_the_bars_tv(self):
        desk = self.signed_in_desk()
        wait(lambda: desk.link.other.get('name'), what='the bar')
        asked = []
        desk.roleRequested.connect(asked.append)
        desk.link.useAsTv()
        wait(lambda: asked == ['tv'], what='BeerMat to open again as a TV screen', log=lambda: self.toasts)
        self.assertTrue(QSettings().value('tvDevice', '', str), 'signed in as a TV')
        desk.stop()
        # BeerMat as a TV screen: the quiz Wi-Fi isn't here, so the account says where the bar is.
        cache = tempfile.TemporaryDirectory()
        self.addCleanup(cache.cleanup)
        screen = TvScreen(cache.name)
        screen.search()
        wait(lambda: screen.connected and screen.tv.get('view'), what='the bar’s TV', timeout=25, log=lambda: screen.message)
        self.assertEqual(screen.title, self.bar['title'])


class TvSignInTest(LinkCase):
    def test_a_tv_signs_in_by_qr_code(self):
        QSettings().setValue('onlineService', self.info['online'])
        cache = tempfile.TemporaryDirectory()
        self.addCleanup(cache.cleanup)
        screen = TvScreen(cache.name)
        screen.search()
        engine = QQmlApplicationEngine()
        gradients.install(engine)
        svgmotion.install(engine)
        for name, value in (('desk', screen), ('tvScreen', screen), ('brand', QUrl.fromLocalFile(str(ROOT / 'brand') + '/'))):
            engine.rootContext().setContextProperty(name, value)
        engine.addImportPath(str(HERE / 'qml'))
        engine.load(QUrl.fromLocalFile(str(HERE / 'qml' / 'TvScreen.qml')))
        window = engine.rootObjects()[0]
        self.addCleanup(engine.deleteLater)
        wait(lambda: screen.pairUrl, what='the QR code', timeout=20, log=lambda: screen.message)
        self.assertTrue(screen.pairUrl.startswith(self.info['online'] + '/connect#tv='))
        qr = window.findChild(QObject, 'tvSignInQr')
        self.assertTrue(qr.property('visible') and qr.property('text') == screen.pairUrl, 'the QR code on the screen')
        self.shot('tv-sign-in', window)
        code = screen.pairUrl.split('#tv=')[1]
        token = call(self.info['online'] + '/v1/sessions', {'email': self.info['email'], 'password': self.info['password']})[1]['token']
        self.assertEqual(call(f'{self.info["online"]}/v1/tv-pairings/{code}/approve', {}, token)[0], 200)
        wait(lambda: screen.connected and screen.tv.get('view'), what='the bar’s TV after the phone approved', timeout=25, log=lambda: screen.message)
        self.assertEqual(screen.title, self.bar['title'])


class DeskAwayTest(LinkCase):
    def test_this_laptops_desk_on_another_device_and_back(self):
        """Another desk took this laptop's desk (server.js: deskAway; tests/account-link.test.js has the real handover):
        the desk here says so, keeps playing what that desk plays, and takes the desk back."""
        desk = self.desk
        desk.start()
        wait(lambda: desk.connected and desk.view.get('phase'), what='the desk')
        played = []
        desk.tvSound.play_file = lambda src, *a, **k: played.append(src)
        # Held still: the server's own state (no desk away) would replace this one at the next refresh.
        desk.api.close(); desk._poll.stop()
        wait(lambda: not desk._refreshing, what='the last refresh')
        app.processEvents()
        desk._state['deskAway'] = {'name': 'Office laptop', 'since': 0}
        desk.link.follow(desk._state)
        away = self.window.findChild(QObject, 'deskAway')
        wait(lambda: away.property('visible'), what='the desk saying it’s elsewhere')
        self.shot('desk-away')
        self.assertIn('Office laptop', ' '.join(str(o.property('text')) for o in away.findChildren(QObject) if isinstance(o.property('text'), str)))
        desk.tvSound.follow_playback(None, 0)
        desk.tvSound.follow_playback({'seq': 7, 'action': 'play', 'media': '/media/clip.mp3', 'position': 0, 'at': 0}, 0)
        self.assertEqual(played, ['/media/clip.mp3'], 'what the other desk plays is heard here')
        desk.link.takeBack()
        wait(lambda: not away.property('visible'), what='the desk back here')


if __name__ == '__main__':
    unittest.main()
