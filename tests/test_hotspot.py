import importlib.util
import unittest
from unittest.mock import patch
spec = importlib.util.spec_from_file_location('hotspot', 'scripts/hotspot.py')
hotspot = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hotspot)
card = lambda name, connected=False, ap=True: {'name': name, 'ap': ap, 'connected': connected, 'network': 'Home' if connected else '', 'hosting': False}
class HotspotTests(unittest.TestCase):
    def setUp(self):
        # One free card that can host, unless a test says otherwise; no real nmcli.
        cards = patch.object(hotspot, 'cards', return_value=[card('wlan0')])
        cards.start(); self.addCleanup(cards.stop)
    def test_plan_is_dedicated_and_not_autoconnecting(self):
        cmd = hotspot.commands('wlan0', 'Pub Quiz')
        self.assertIn('manual', cmd[1])
        self.assertIn('disabled', cmd[1])
        self.assertNotIn('shared', cmd[1])
        self.assertIn('connection.autoconnect', cmd[1])
    def test_config(self):
        self.assertIn('address=/#/10.42.0.1', hotspot.dns_config('wlan0'))
        self.assertIn('iifname "wlan0" drop', hotspot.nft_config('wlan0'))
        self.assertIn('redirect to :3000', hotspot.nft_config('wlan0'))
        self.assertIn('redirect to :3005', hotspot.nft_config('wlan0', 3005))
        with self.assertRaises(ValueError):
            hotspot.nft_config('wlan0', 70000)
    def test_injection_rejected(self):
        with self.assertRaises(ValueError):
            hotspot.commands('wlan0; rm', 'PubQuiz')
    def test_default_makes_no_changes(self):
        with patch('sys.argv', ['hotspot.py', 'up']), patch.object(hotspot, 'run') as run, patch('builtins.print'):
            hotspot.main()
            run.assert_not_called()
    def test_down_continues_after_a_failed_step(self):
        results = iter([0, 1, 0, 0, 0, 0])
        with patch('sys.argv', ['hotspot.py', 'down', '--apply']), patch('os.geteuid', return_value=0), patch.object(hotspot.Path, 'exists', return_value=False), \
                patch('subprocess.run', side_effect=lambda cmd, **kw: type('R', (), {'returncode': next(results), 'stdout': 'PubQuiz-offline\n'})) as run, patch('builtins.print'):
            hotspot.main()
            self.assertEqual(run.call_count, 6)  # profile lookup + five teardown steps
    def test_apply_runs_every_step_in_order(self):
        calls = []
        def fake(cmd, **kw):
            calls.append(cmd)
            out = {('nmcli', '-g', 'WIFI-PROPERTIES.AP'): 'yes\n', ('nmcli', '-g', 'NAME'): 'Home WiFi\ndocker0\n', ('nft', 'list', 'tables'): 'table inet filter\n'}
            return type('R', (), {'stdout': out.get(tuple(cmd[:3]), ''), 'returncode': 0})
        with patch('sys.argv', ['hotspot.py', 'up', '--interface', 'wlan0', '--apply']), patch('os.geteuid', return_value=0), \
                patch.object(hotspot, 'run', side_effect=fake), patch.object(hotspot.Path, 'mkdir'), patch.object(hotspot.Path, 'write_text'), patch('builtins.print'):
            hotspot.main()
        self.assertIn(['nmcli', '-g', 'NAME', 'connection', 'show'], calls)
        self.assertEqual([c[:3] for c in calls if c[0] == 'nmcli' and c[1] == 'connection'], [['nmcli', 'connection', 'add'], ['nmcli', 'connection', 'modify'], ['nmcli', 'connection', 'up']])
        self.assertTrue(any(c[0] == 'systemd-run' for c in calls))
    def test_dnsmasq_stays_off_loopback(self):
        self.assertIn('except-interface=lo', hotspot.dns_config('wlan0'))
    def keep_wifi_run(self, link, extra=()):
        calls = []
        def fake(cmd, **kw):
            calls.append(cmd)
            out = {('nmcli', '-g', 'WIFI-PROPERTIES.AP'): 'yes\n', ('nmcli', '-g', 'NAME'): 'BTB\n', ('nft', 'list', 'tables'): '', ('iw', 'dev', 'wlan0'): link,
                   ('nmcli', '-g', 'GENERAL.CONNECTION'): 'BTB-6QFMFC\n'}
            return type('R', (), {'stdout': out.get(tuple(cmd[:3]), ''), 'returncode': 0})
        def exists(path):
            return str(path).endswith('wlan0/address')
        with patch('sys.argv', ['hotspot.py', 'up', '--interface', 'wlan0', '--keep-wifi', '--apply', *extra]), patch('os.geteuid', return_value=0), \
                patch.object(hotspot, 'run', side_effect=fake), patch.object(hotspot.Path, 'mkdir'), patch.object(hotspot.Path, 'write_text'), \
                patch.object(hotspot.Path, 'exists', exists), patch.object(hotspot.Path, 'read_text', return_value='9c:67:d6:d7:ae:4c\n'), \
                patch('subprocess.run', side_effect=lambda cmd, **kw: type('R', (), {'returncode': 3 if 'is-active' in cmd else 0, 'stdout': 'type AP\n\tssid PubQuiz\n'})), patch('builtins.print'):
            hotspot.main()
        return calls
    def test_keep_wifi_hosts_on_a_virtual_interface_on_the_home_channel(self):
        calls = self.keep_wifi_run('Connected to aa:bb\n\tfreq: 2437.0\n')
        self.assertIn(['iw', 'dev', 'wlan0', 'interface', 'add', 'pq0', 'type', '__ap'], calls)
        self.assertIn(['ip', 'link', 'set', 'pq0', 'address', '9e:67:d6:d7:ae:4d'], calls)
        self.assertIn(['ip', 'addr', 'add', '10.42.0.1/24', 'dev', 'pq0'], calls)
        # NetworkManager cannot run a second interface on this kind of card, so wpa_supplicant hosts it.
        self.assertFalse(any(c[:3] == ['nmcli', 'connection', 'add'] for c in calls))
        ap = next(c for c in calls if c[0] == 'systemd-run' and '--unit=pubquiz-ap.service' in c)
        self.assertEqual(ap[-6:-1], ['-D', 'nl80211', '-i', 'pq0', '-c'])
    def test_ap_config_is_open_on_the_home_channel(self):
        conf = hotspot.ap_config('Pub "Quiz"', 6)
        self.assertIn('ssid=' + 'Pub "Quiz"'.encode().hex(), conf); self.assertIn('frequency=2437', conf)
        self.assertIn('mode=2', conf); self.assertIn('key_mgmt=NONE', conf)
    def test_keep_wifi_refuses_5ghz_with_instructions(self):
        with self.assertRaises(SystemExit), patch('sys.stderr') as err:
            self.keep_wifi_run('Connected to aa:bb\n\tfreq: 5180\n')
        self.assertIn("802-11-wireless.band bg", ''.join(c.args[0] for c in err.write.call_args_list))
    def test_channel_mapping(self):
        self.assertEqual([hotspot.channel_of(f) for f in (2412, 2437, 2472, 2484, 5180)], [1, 6, 13, 14, None])
    def test_leftovers_are_named_with_the_down_command(self):
        def fake(cmd, **kw):
            out = {('nmcli', '-g', 'WIFI-PROPERTIES.AP'): 'yes\n', ('nmcli', '-g', 'NAME'): 'BTB\nPubQuiz-offline\n', ('nft', 'list', 'tables'): 'table inet pubquiz\n'}
            return type('R', (), {'stdout': out.get(tuple(cmd[:3]), ''), 'returncode': 0})
        with patch('sys.argv', ['hotspot.py', 'up', '--apply']), patch('os.geteuid', return_value=0), patch.object(hotspot, 'run', side_effect=fake), \
                patch('subprocess.run', return_value=type('R', (), {'returncode': 0})), patch.object(hotspot.Path, 'exists', return_value=False), \
                self.assertRaises(SystemExit), patch('sys.stderr') as err:
            hotspot.main()
        message = ''.join(c.args[0] for c in err.write.call_args_list)
        self.assertIn('Wi-Fi profile PubQuiz-offline, firewall table inet pubquiz, pubquiz-dnsmasq service', message)
        self.assertIn('hotspot.py down --interface wlan0 --apply', message)
    def test_pick_prefers_a_free_card_and_shares_only_when_it_must(self):
        self.assertEqual(hotspot.pick([card('wlan0', True), card('wlan1')]), {'interface': 'wlan1', 'keepWifi': False})
        self.assertEqual(hotspot.pick([card('wlan0'), card('wlan1', True)]), {'interface': 'wlan0', 'keepWifi': False})
        self.assertEqual(hotspot.pick([card('wlan0', True), card('wlan1', ap=False)]), {'interface': 'wlan0', 'keepWifi': True})
        self.assertEqual(hotspot.pick([card('wlan0', True)], offline=True), {'interface': 'wlan0', 'keepWifi': False})
        self.assertEqual(hotspot.pick([card('wlan0', True), card('wlan1')], 'wlan0'), {'interface': 'wlan0', 'keepWifi': True})
        self.assertIsNone(hotspot.pick([card('wlan0', ap=False)]))
    def test_status_is_read_only_json(self):
        with patch('sys.argv', ['hotspot.py', 'status']), patch.object(hotspot, 'cards', return_value=[card('wlan0', True), card('wlan1')]), \
                patch.object(hotspot, 'ask', return_value='enabled'), patch.object(hotspot, 'running', return_value=None), \
                patch.object(hotspot, 'run') as run, patch('builtins.print') as out:
            hotspot.main()
        run.assert_not_called()
        status = hotspot.json.loads(out.call_args.args[0])
        self.assertEqual((status['wifiOn'], status['pick'], len(status['cards'])), (True, {'interface': 'wlan1', 'keepWifi': False}, 2))
    def test_replace_takes_leftovers_down_and_carries_on(self):
        def fake(cmd, **kw):
            out = {('nmcli', '-g', 'WIFI-PROPERTIES.AP'): 'yes\n', ('nmcli', '-g', 'NAME'): 'PubQuiz-offline\n', ('nft', 'list', 'tables'): ''}
            return type('R', (), {'stdout': out.get(tuple(cmd[:3]), ''), 'returncode': 0})
        with patch('sys.argv', ['hotspot.py', 'up', '--apply', '--replace']), patch('os.geteuid', return_value=0), patch.object(hotspot, 'run', side_effect=fake) as run, \
                patch('subprocess.run', return_value=type('R', (), {'returncode': 3})), patch.object(hotspot, 'take_down', return_value=[]) as down, \
                patch.object(hotspot.Path, 'mkdir'), patch.object(hotspot.Path, 'write_text'), patch('builtins.print'):
            hotspot.main()
        down.assert_called_once()
        self.assertTrue(any(c.args[0][:3] == ['nmcli', 'connection', 'up'] for c in run.call_args_list))
if __name__ == '__main__':
    unittest.main()
