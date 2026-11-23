"""Settings → Spotify: the switch for playing clips at the Spotify app's full volume, against the real quiz server."""
import os
import sys
import unittest
from pathlib import Path

os.environ.setdefault('QT_QPA_PLATFORM', 'offscreen')
os.environ.setdefault('BEERMAT_MUTE', '1')
sys.path.insert(0, str(Path(__file__).resolve().parent))
from PySide6.QtCore import QObject             # noqa: E402
from test_desk import DeskCase, wait           # noqa: E402
from test_settings_layout import pump          # noqa: E402


class SpotifyFullVolumeTest(DeskCase):
    def test_the_full_volume_switch(self):
        desk, w = self.desk, self.window
        desk.start()
        wait(lambda: desk.connected and desk.view.get('phase'), what='the server')
        # Spotify's settings as a connected Pro desk sees them (no sign-in here); the switch tells the server.
        sent = []
        desk.prefs.api.host = lambda route, body, ok, fail=None, timeout_ms=0: sent.append((route, body))
        desk.prefs._spotify = {'connected': True, 'locked': False, 'fullVolume': True}
        desk.prefs.spotifyChanged.emit()
        w.setProperty('workspace', 6)
        pump(20)
        box = w.findChild(QObject, 'spotifyFullVolume')
        self.assertTrue(box.property('visible') and box.property('checked'), 'shown, and on')
        desk.prefs.setSpotifyFullVolume(False)
        self.assertIn(('spotify/full-volume', {'on': False}), sent)
        desk.prefs._spotify = {**desk.prefs.spotify, 'fullVolume': False}
        desk.prefs.spotifyChanged.emit()
        pump(10)
        self.assertFalse(box.property('checked'))
        desk.prefs._spotify = {'connected': False, 'locked': False, 'fullVolume': True}
        desk.prefs.spotifyChanged.emit()
        pump(10)
        self.assertFalse(box.property('visible'), 'hidden until Spotify is connected')

if __name__ == '__main__':
    unittest.main()
