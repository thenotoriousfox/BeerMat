"""The native TV's sound cues follow soundCues() in web/client.js: each moment sounds once, when it happens, never on
first load. Driven with crafted public states; files are generated WAVs, so nothing needs the quiz server."""
import os
import sys
import tempfile
import unittest
from pathlib import Path

os.environ.setdefault('QT_QPA_PLATFORM', 'offscreen')
os.environ.setdefault('BEERMAT_MUTE', '1')   # tests make the TV's sounds without playing them aloud
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from PySide6.QtCore import QUrl                        # noqa: E402
from PySide6.QtGui import QGuiApplication              # noqa: E402

from beermat_desk.tvsound import TvSound, synth        # noqa: E402

app = QGuiApplication.instance() or QGuiApplication(sys.argv)
app.setOrganizationName('BeerMat-test')
SLOTS = ['startRound', 'questionStart', 'timerMusic', 'countdown', 'timeUp', 'endRound', 'correct', 'wrong', 'reveal', 'bingoCall', 'bingo', 'applause']


def question(**over):
    q = {'id': 1, 'type': 'choice', 'round': 'Round 1', 'open': True, 'live': True, 'paused': False, 'revealing': False, 'revealed': False, 'deadline': 10 ** 13}
    q.update(over)
    return q


class TvSoundTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        files = {}
        for slot in SLOTS:
            path = Path(self.dir.name) / f'{slot}.wav'
            synth(path, [(440, 0)], 'sine')
            files[slot] = QUrl.fromLocalFile(str(path)).toString()
        self.sound = TvSound()
        self.sound.on = True
        self.heard = []
        self.sound.played.connect(self.heard.append)
        self.pack = {'slots': files, 'buzzers': []}

    def tearDown(self):
        self.sound.stop_all()
        self.dir.cleanup()

    def state(self, q=None, view='question', **over):
        s = {'sounds': self.pack, 'question': q, 'view': view, 'teams': [], 'settings': {'displayMode': 'auto'}, 'offset': 0}
        s.update(over)
        return s

    def step(self, s):
        self.heard.clear()
        self.sound.follow(s)
        return [h for h in self.heard if h != 'wheelTick']

    def test_moments(self):
        self.assertEqual(self.step(self.state(question())), ['timerMusic'], 'first load: only the music, no moments')
        self.assertEqual(self.step(self.state(question(id=2, round='Round 2'))), ['startRound'])
        self.assertEqual(self.step(self.state(question(id=3, round='Round 2'))), ['questionStart'])
        self.assertEqual(self.step(self.state(question(id=3, round='Round 2', open=False))), ['timeUp'])
        self.assertEqual(self.step(self.state(question(id=3, round='Round 2', open=False, revealing=True))), ['reveal'])
        self.assertEqual(self.step(self.state(None, view='leaderboard')), ['endRound'])
        self.assertEqual(self.step(self.state(None, view='winner', teams=[{'name': 'Bears', 'rank': 1}])), ['applause'])
        self.assertEqual(self.step(self.state(None, view='winner', teams=[{'name': 'Bears', 'rank': 1}])), [], 'once only')

    def test_buzzers_and_bingo(self):
        buzz = lambda active, status: question(type='buzzer', buzz={'active': {'name': active} if active else None, 'queue': [{'team': 't', 'status': status}]})
        self.step(self.state(buzz(None, 'queued')))
        self.assertEqual(self.step(self.state(buzz('Bears', 'active'))), ['buzzer'])
        self.assertEqual(self.step(self.state(buzz('Bears', 'correct'))), ['correct'])
        bingo = lambda count, shouts: question(id=9, type='bingo', bingo={'count': count, 'shouts': shouts})
        self.step(self.state(bingo(0, [])))
        self.assertEqual(self.step(self.state(bingo(1, []))), ['bingoCall'])
        self.assertEqual(self.step(self.state(bingo(1, [{'id': 's', 'status': 'pending'}]))), ['bingo'])
        self.assertEqual(self.step(self.state(bingo(1, [{'id': 's', 'status': 'wrong'}]))), ['wrong'])

    def test_quiet_questions_have_no_music(self):
        self.assertEqual(self.step(self.state(question(type='audio'))), [])
        self.assertEqual(self.step(self.state(question(media='/media/song.mp3'))), [])

    def test_wheel_ticks_only_for_a_spin_seen_happening(self):
        import time
        wheel = lambda i, spun: {'id': f'w{i}', 'items': ['Red', 'Blue', 'Green'], 'result': 1, 'spun': spun}
        self.step(self.state(None, view='wheel', wheel=wheel(1, 0)))
        self.assertEqual(self.sound._wheel_timers, [], 'a wheel already shown when the TV opens is silent')
        now = time.time() * 1000
        self.step(self.state(None, view='wheel', wheel=wheel(2, now)))
        self.assertGreater(len(self.sound._wheel_timers), 10, 'a fresh spin ticks at each segment edge')
        end = time.time() + 0.6
        while time.time() < end and 'wheelTick' not in self.heard:
            app.processEvents(); time.sleep(0.01)
        self.assertIn('wheelTick', self.heard)
        self.step(self.state(None, view='leaderboard'))
        self.assertEqual(self.sound._wheel_timers, [], 'leaving the wheel stops its ticks')

    def test_the_first_wheel_ever_ticks_and_a_refresh_does_not_spin_it_again(self):
        import time
        self.step(self.state(question()))       # the TV is open, no wheel yet
        wheel = {'id': 1, 'items': ['Red', 'Blue', 'Green'], 'result': 1, 'spun': time.time() * 1000}
        self.step(self.state(None, view='wheel', wheel=dict(wheel)))
        timers = list(self.sound._wheel_timers)
        self.assertGreater(len(timers), 10, 'the first spin ticks too')
        # Every refresh brings the same wheel as a new object: it carries on, not starting over.
        self.step(self.state(None, view='wheel', wheel=dict(wheel)))
        self.assertEqual(self.sound._wheel_timers, timers)

    def test_automatic_output_is_the_tvs_own_while_it_is_full_screen(self):
        from beermat_desk import tvsound

        class Device:
            def __init__(self, name, ident):
                self.name, self.ident = name, ident

            def description(self):
                return self.name

            def id(self):
                return self.ident.encode()
        laptop, hdmi = Device('Laptop speakers', 'alsa_output.pci-analog'), Device('TU104 HD Audio Controller Digital Stereo (HDMI)', 'alsa_output.pci-hdmi-stereo')
        usb = Device('USB Audio Speakers', 'alsa_output.usb-speaker')
        saved = tvsound.QMediaDevices
        tvsound.QMediaDevices = type('Devices', (), {'audioOutputs': staticmethod(lambda: [laptop, hdmi, usb]), 'defaultAudioOutput': staticmethod(lambda: laptop)})
        try:
            self.sound._prefs.remove('tvSound')
            self.assertEqual(self.sound.output, 'auto')
            self.assertIs(self.sound._device(), laptop, 'TV in a window: the laptop')
            self.sound.tvOnScreen = True
            self.assertIs(self.sound._device(), hdmi, 'TV full screen: its HDMI sound')
            self.assertEqual(self.sound.activeOutput, hdmi.name)
            self.sound._prefs.setValue('tvSound', 'laptop')
            self.assertIs(self.sound._device(), laptop)
            self.sound._prefs.setValue('tvSound', 'alsa_output.usb-speaker')
            self.assertIs(self.sound._device(), usb, 'a chosen output wins')
            self.sound._prefs.setValue('tvSound', '')
            self.assertEqual(self.sound.output, 'laptop', 'the old "system default" setting')
        finally:
            tvsound.QMediaDevices = saved
            self.sound._prefs.remove('tvSound')
            self.sound.tvOnScreen = False

    def test_silent_while_tv_closed(self):
        self.sound.on = False
        self.step(self.state(question()))
        self.assertEqual(self.step(self.state(question(id=2, round='Round 2'))), [])


if __name__ == '__main__':
    unittest.main()
