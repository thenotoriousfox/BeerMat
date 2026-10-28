"""The desk's live controls against the real server (offscreen): buzzer verdicts, bingo calls, the sound clips game
played through the TV's sound, the wheel, the TV countdown, what the TV shows, and the room's switches. A Free laptop
rehearses, so manual simulated teams stand in for phones."""
import unittest

from test_desk import DeskCase, http, wait


class LiveControlsTest(DeskCase):
    def start(self, kind):
        """Opens the test quiz's first question of a format (as the web desk's Start on a question)."""
        q = next(item for r in self.desk._library['rounds'] for item in r['questions'] if item['type'] == kind)
        current = (self.desk._state or {}).get('question')
        if current and current.get('live'):
            http(self.port, 'host/close', {'expectedQuestion': current['id']}, self.session)
        http(self.port, 'host/start', {'id': q['id'], 'expectedQuestion': current['id'] if current else None}, self.session)
        wait(lambda: self.desk.view.get('typeCode') == kind and self.desk.view['raw'].get('live'), what=f'the {kind} question to open')
        return self.desk.view['raw']

    def test_live_controls(self):
        desk = self.desk
        desk.start()
        wait(lambda: desk.connected and desk.view.get('phase'), what='the desk')
        desk.loadQuizConfirmed(str(self.quiz_file))
        wait(lambda: desk.view.get('title') == 'Test quiz', timeout=30, what='the quiz to load', log=self.toasts)
        self.port, self.session = desk.server.info['port'], desk.api.session
        desk.startRehearsalWith({'teams': 2, 'auto': False})
        wait(lambda: len(desk.view.get('sims', [])) == 2 and all(t['connected'] for t in desk.view['sims']), timeout=20, what='two simulated teams', log=self.toasts)
        bears = desk.view['sims'][0]['name']

        # Buzzer: a team buzzes, the desk rules it correct.
        self.start('buzzer')
        http(self.port, 'host/rehearsal/team', {'name': bears, 'action': 'buzz'}, self.session)
        wait(lambda: (desk.view['raw'].get('buzz') or {}).get('active'), what='the buzz')
        self.shot('live-buzzer')
        desk.live.buzz('correct', 'Oasis')
        wait(lambda: any(b['status'] == 'correct' for b in desk.view['raw']['buzz']['queue']), what='the verdict', log=self.toasts)

        # Bingo: the desk calls numbers.
        self.start('bingo')
        desk.live.callNumber()
        wait(lambda: (desk.view['raw'].get('bingo') or {}).get('count') == 1, what='a called number', log=self.toasts)
        desk.live.callNumber()
        wait(lambda: desk.view['raw']['bingo']['count'] == 2, what='a second number', log=self.toasts)
        self.shot('live-bingo')

        # Sound clips: played in order through the TV's sound; the server hears when each starts.
        self.screens.setOpen(True)
        wait(lambda: desk.sound.on, what='the TV sound to switch on')
        self.start('clips')
        desk.live.playClips()
        wait(lambda: (desk.view['raw'].get('clipGame') or {}).get('playing') == 1, timeout=20, what='the first clip to play', log=self.toasts)
        self.shot('live-clips')
        desk.live.stopClips()
        wait(lambda: not (desk.view['raw'].get('clipGame') or {}).get('playing'), what='the clips to stop')

        # The wheel, on the TV.
        desk.live.spinWheel('Red\nBlue\nGreen')
        wait(lambda: (desk.tv.get('wheel') or {}).get('items') == ['Red', 'Blue', 'Green'], what='the wheel', log=self.toasts)

        # A countdown on the TV: start, pause, remove.
        desk.live.startTimer(90, 'Hand in your sheets')
        wait(lambda: (desk.tv.get('timer') or {}).get('label') == 'Hand in your sheets', what='the countdown')
        desk.live.toggleTimer()
        wait(lambda: desk.tv['timer'].get('endsAt') is None, what='the countdown to pause')
        desk.live.stopTimer()
        wait(lambda: not desk.tv.get('timer'), what='the countdown to go')

        # What the TV shows, and the room's switches.
        desk.live.setDisplayMode('leaderboard')
        wait(lambda: desk.tv.get('view') == 'leaderboard', what='the leaderboard on the TV')
        desk.live.setDisplayMode('auto')
        desk.live.setSwitch('registrationOpen', False)
        wait(lambda: desk.tv['settings']['registrationOpen'] is False, what='registration to close')
        desk.live.setSwitch('notASetting', True)   # ignored: only known switches are sent
        self.screens.setOpen(False)


if __name__ == '__main__':
    unittest.main()
