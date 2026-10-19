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
if __name__ == '__main__':
    unittest.main()
