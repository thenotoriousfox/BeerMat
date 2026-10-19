import importlib.util
import unittest
from unittest.mock import patch
spec = importlib.util.spec_from_file_location('hotspot', 'scripts/hotspot.py')
hotspot = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hotspot)
class HotspotTests(unittest.TestCase):
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
    def test_injection_rejected(self):
        with self.assertRaises(ValueError):
            hotspot.commands('wlan0; rm', 'PubQuiz')
    def test_default_makes_no_changes(self):
        with patch('sys.argv', ['hotspot.py', 'up']), patch.object(hotspot, 'run') as run, patch('builtins.print'):
            hotspot.main()
            run.assert_not_called()
    def test_down_continues_after_a_failed_step(self):
        results = iter([1, 0, 0, 0])
        with patch('sys.argv', ['hotspot.py', 'down', '--apply']), patch('os.geteuid', return_value=0), \
                patch('subprocess.run', side_effect=lambda cmd, check: type('R', (), {'returncode': next(results)})) as run, patch('builtins.print'):
            hotspot.main()
            self.assertEqual(run.call_count, 4)
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
if __name__ == '__main__':
    unittest.main()
