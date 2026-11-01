"""The phone deck on the Qt desk, against a real quiz server: the desk shows a code, a phone signs in with it and is
listed, the desk plays what the phone asks for (only the desk plays clips and songs), and Disconnect takes it off."""
import json
import os
import sys
import unittest
import urllib.error
import urllib.request
from pathlib import Path

os.environ.setdefault('QT_QPA_PLATFORM', 'offscreen')
os.environ.setdefault('BEERMAT_MUTE', '1')
sys.path.insert(0, str(Path(__file__).resolve().parent))
from PySide6.QtCore import QObject                                         # noqa: E402

from test_desk import DeskCase, wait                                       # noqa: E402


def post(base, route, body=None, token=None):
    request = urllib.request.Request(base + route, json.dumps(body or {}).encode(), {'Content-Type': 'application/json', **({'Authorization': 'Bearer ' + token} if token else {})})
    try:
        with urllib.request.urlopen(request, timeout=10) as reply:
            return reply.status, json.loads(reply.read() or b'{}')
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read() or b'{}')


class PhoneDeckTest(DeskCase):
    def test_a_phone_signs_in_with_the_code_and_the_desk_plays_what_it_asks(self):
        desk = self.desk
        desk.start()
        wait(lambda: desk.connected and desk.view.get('phase'), what='the desk')
        base = f"http://127.0.0.1:{desk.server.info['port']}"
        asked = []
        desk.liveTools.playClips = lambda: asked.append('all')
        desk.liveTools.playClip = lambda i: asked.append(i)

        self.window.findChild(QObject, 'deckCodeButton').clicked.emit()
        wait(lambda: desk.deck.get('code'), what='a code')
        status, phone = post(base, '/api/deck/login', {'code': desk.deck['code'], 'name': 'Dan’s phone'})
        self.assertEqual(status, 200, phone)
        wait(lambda: [d['name'] for d in desk.view.get('decks', [])] == ['Dan’s phone'], what='the phone listed')

        # The desk's own stream is the desk: the phone's commands reach it and it plays them.
        wait(lambda: post(base, '/api/host/state', token=phone['key'])[1].get('deskConnected'), what='the desk seen as open')
        self.assertEqual(post(base, '/api/host/deck-command', {'action': 'playClips'}, phone['key'])[0], 200)
        wait(lambda: asked == ['all'], what='the clips played')
        self.assertEqual(post(base, '/api/host/deck-command', {'action': 'playClip', 'value': 2}, phone['key'])[0], 200)
        wait(lambda: asked == ['all', 2], what='one clip played')
        self.assertIn('Dan’s phone: play a clip', [m for m, _ in self.toasts])

        desk.disconnectDeck(desk.view['decks'][0]['id'])
        wait(lambda: not desk.view.get('decks'), what='the phone taken off')
        self.assertEqual(post(base, '/api/host/state', token=phone['key'])[0], 403)


if __name__ == '__main__':
    unittest.main()
