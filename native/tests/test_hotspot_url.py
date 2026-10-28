"""Where phones on the quiz Wi-Fi open the quiz (as web/host.js works it out since #3): Linux's hotspot at
http://10.42.0.1, Windows' Mobile Hotspot at 192.168.137.1 with the quiz's port."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from beermat_desk.desk import Desk   # noqa: E402


class HotspotUrlTest(unittest.TestCase):
    def test_linux(self):
        self.assertEqual(Desk.hotspot_url({'platform': 'linux', 'wifi': {'address': '10.42.0.1'}}, 3000), 'http://10.42.0.1')
        self.assertEqual(Desk.hotspot_url({}, 3000), 'http://10.42.0.1')

    def test_windows(self):
        self.assertEqual(Desk.hotspot_url({'platform': 'windows', 'wifi': {'platform': 'windows', 'address': '192.168.137.1'}}, 3002), 'http://192.168.137.1:3002')
        self.assertEqual(Desk.hotspot_url({'platform': 'windows', 'wifi': {}}, None), 'http://192.168.137.1:3000')


if __name__ == '__main__':
    unittest.main()
