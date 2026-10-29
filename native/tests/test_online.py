"""The desk's BeerMat Online tab against a real BeerMat Online (tests/fixtures/online.mjs) through the real quiz server:
create the operator's account, see the venue once it's linked, edit it and its quiz nights, publish and cancel a quiz
night, and register this laptop."""
import json
import subprocess
import time
import unittest

from test_desk import ROOT, DeskCase, http, wait


class OnlineVenueTest(DeskCase):
    def setUp(self):
        super().setUp()
        self.service = subprocess.Popen(['node', '--disable-warning=ExperimentalWarning', str(ROOT / 'tests' / 'fixtures' / 'online.mjs')],
                                        stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
        self.online = f'http://127.0.0.1:{json.loads(self.service.stdout.readline())["port"]}'

    def tearDown(self):
        self.service.stdin.close()
        self.service.wait(10)
        super().tearDown()

    def command(self, line):
        self.service.stdin.write(line + '\n'); self.service.stdin.flush()
        self.service.stdout.readline()

    def test_venue(self):
        desk, online = self.desk, self.desk.online
        desk.start()
        wait(lambda: desk.connected and desk.view.get('phase'), what='the desk')
        http(desk.server.info['port'], 'host/settings', {'onlineService': self.online}, desk.api.session)
        online.load()
        wait(lambda: online.account.get('service') == self.online and not online.account.get('signedIn'), what='the account state')

        online.signUp('landlord@example.com', 'correct horse battery', 'Lou')
        wait(lambda: online.account.get('signedIn') and online.account.get('name') == 'Lou', what='the new account', log=self.toasts)
        self.assertFalse(online.venue, 'no venue until BeerMat links one')
        self.command('link landlord@example.com red-lion-bristol')
        online.load()
        wait(lambda: online.venue.get('id') == 'red-lion-bristol', what='the linked venue', log=self.toasts)
        self.assertFalse(online.venue['registered'])

        nights = [{**n, 'on': n['day'] == 'thursday', 'time': '20:30'} for n in online.venue['nights']]
        online.save({'name': 'The Red Lion', 'town': 'Bristol', 'postcode': 'BS1 4DJ', 'address': '1 King St', 'website': '', 'lat': '', 'lon': '', 'nights': nights})
        wait(lambda: [n['day'] for n in online.venue.get('nights', []) if n['on']] == ['thursday'], what='the regular night', log=self.toasts)
        self.assertEqual(online.venue['address'], '1 King St')

        online.publish('Halloween special', (time.time() + 7 * 86400) * 1000, '£2', '6 rounds', 'Fancy dress')
        wait(lambda: any(e['title'] == 'Halloween special' for e in online.venue.get('events', [])), what='the published night', log=self.toasts)
        special = next(e for e in online.venue['events'] if e['title'] == 'Halloween special')
        online.cancel(special['id'])
        wait(lambda: not any(e['title'] == 'Halloween special' for e in online.venue.get('events', [])), what='the cancelled night', log=self.toasts)

        online.register()
        wait(lambda: online.venue.get('registered'), what='this laptop registered', log=self.toasts)
        self.window.setProperty('workspace', 4)
        from PySide6.QtCore import QObject
        self.window.findChild(QObject, 'venue').setProperty('tab', 1)
        self.shot('venue-online')

        online.signOut()
        wait(lambda: not online.account.get('signedIn'), what='signing out')


if __name__ == '__main__':
    unittest.main()
