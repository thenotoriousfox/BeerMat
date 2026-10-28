"""The live controls beyond Next/close/reveal, as the web desk's Tonight tab has them: the buzzer game's verdicts, bingo
calls and shouts, music bingo songs, the sound clips game, the wheel, the TV countdown, what the TV shows, the
tie-breaker, and the room's switches (registration, scores, scrambled keypads, waiting room, bingo extras).

The quiz server decides everything; this sends the quizmaster's choices and plays the desk's own audio (clips, songs,
audio questions) through the TV's sound (tvsound.py), telling the server when each clip starts and ends."""
from PySide6.QtCore import QObject, QTimer, Signal, Slot
from PySide6.QtMultimedia import QMediaPlayer

# Settings the desk may switch (each a boolean on the server's settings).
SWITCHES = {'registrationOpen', 'leaderboardVisible', 'showScores', 'scrambleKeypads', 'waitingRoom', 'bingoPhrases', 'bingoVoice',
            'bingoBoard', 'teamPhotos', 'onlineAfterJoin'}
DISPLAY_MODES = ['auto', 'join', 'question', 'leaderboard', 'wheel', 'winner', 'blank']


class LiveTools(QObject):
    clipsChanged = Signal()

    def __init__(self, desk):
        super().__init__(desk)
        self.desk, self.api, self.sound = desk, desk.api, desk.tvSound
        self._clips = None          # {'question', 'index', 'spotify'} while the clips game plays
        self._clip_player = None
        self._song_timer = QTimer(self, singleShot=True)
        self._song_run = 0

    # ---- helpers ----
    def _q(self):
        return (self.desk._state or {}).get('question')

    def _call(self, route, body, done_text=None, then=None):
        def done(reply):
            if done_text:
                self.desk.toast.emit(done_text if isinstance(done_text, str) else done_text(reply), False)
            if then:
                then(reply)
            self.desk.refresh()
        self.api.host(route, body, done, lambda e: (self.desk.toast.emit(e, True), self.desk.refresh()))

    # ---- buzzer game ----
    @Slot(str, str)
    def buzz(self, action, announced=''):
        """correct, wrong, pass (to the next buzzer) or agree (start the agree countdown with what the team said)."""
        q = self._q()
        if q and q.get('type') == 'buzzer':
            text = {'correct': 'Marked correct', 'wrong': 'Marked wrong', 'pass': 'Passed to the next buzzer', 'agree': 'Agree countdown started'}.get(action, action)
            self._call('buzz', {'question': q['id'], 'action': action, 'announced': announced}, text)

    # ---- bingo and music bingo ----
    @Slot()
    def callNumber(self):
        q = self._q()
        if not q or q.get('type') not in ('bingo', 'musicbingo'):
            return
        self._stop_song()

        def called(reply):
            number, warning = reply.get('number'), reply.get('warning')
            if q['type'] != 'musicbingo':
                self.desk.toast.emit(f'Called {number}', False)
                return
            song = (q.get('songs') or [])[number - 1]
            played = ((q.get('bingo') or {}).get('played') or 0) + 1
            if song.get('spotify'):
                self.desk.toast.emit(f'Song {played}: {song.get("title")}' + (f' — ⚠ {warning}' if warning else ' — playing on Spotify'), bool(warning))
                if not warning:
                    self._time_song(q, song)
                return
            if song.get('media'):
                start = song.get('start', q.get('startAt')) or 0
                self.sound.play_file(song['media'], position_ms=int(start * 1000))
                self._time_song(q, song)
            self.desk.toast.emit(f'Song {played}: {song.get("title")}' + ('' if song.get('media') else ' — play it from your own music player'), False)
        self.api.host('bingo', {'question': q['id']}, lambda r: (called(r), self.desk.refresh()), lambda e: self.desk.toast.emit(e, True))

    def _time_song(self, q, song):
        """A song plays for its time, then stops; with auto-next the next one is called, unless something happened."""
        seconds = song.get('seconds', q.get('songSeconds'))
        if not seconds:
            return
        run, claims = self._song_run, ((q.get('bingo') or {}).get('claims') or 0)

        def ended():
            if run != self._song_run:
                return
            self._stop_song(keep_run=True)
            live = self._q()
            b = (live or {}).get('bingo') or {}
            if (q.get('autoNext') and live and live.get('id') == q['id'] and live.get('live') and not live.get('paused') and not b.get('over')
                    and (b.get('claims') or 0) <= claims and not b.get('pending') and (b.get('played') or 0) < len(q.get('songs') or [])):
                self.callNumber()
        try:
            self._song_timer.timeout.disconnect()
        except (RuntimeError, TypeError):
            pass
        self._song_timer.timeout.connect(ended)
        self._song_timer.start(int(seconds * 1000))

    def _stop_song(self, keep_run=False):
        self._song_timer.stop()
        if not keep_run:
            self._song_run += 1
        q = self._q() or {}
        for song in q.get('songs') or []:
            if song.get('media') in self.sound._players:
                self.sound._players[song['media']][0].stop()
            if song.get('spotify'):
                self.api.host('spotify/pause', {})
                break

    @Slot(int, bool)
    def bingoVerdict(self, shout, correct):
        self._call('bingo-verdict', {'shout': shout, 'correct': correct}, 'Bingo confirmed' if correct else 'Not a bingo')

    # ---- sound clips game ----
    @Slot()
    def playClips(self):
        q = self._q()
        if q and q.get('type') == 'clips' and q.get('live'):
            self._play_clip(q, 0)

    @Slot()
    def stopClips(self):
        run, self._clips = self._clips, None
        if self._clip_player:
            self._clip_player.stop()
        if run:
            if run.get('spotify'):
                self.api.host('spotify/pause', {})
            self.api.host('clip', {'question': run['question'], 'clip': -1})
        self.clipsChanged.emit()

    def _play_clip(self, q, i):
        live = self._q()
        clips = q.get('clips') or []
        if not live or live.get('id') != q['id'] or not live.get('live') or i >= len(clips):
            return self.stopClips()
        clip = clips[i]
        run = self._clips = {'question': q['id'], 'index': i, 'spotify': bool(clip.get('spotify'))}
        self.clipsChanged.emit()

        def finished():
            if self._clips is not run:
                return
            self.api.host('clip', {'question': q['id'], 'clip': -1}, lambda _: QTimer.singleShot(1500, lambda: self._clips is run and self._play_clip(q, i + 1)))

        if clip.get('spotify'):
            # A Spotify clip plays on the laptop's Spotify app (Spotify Connect) for the clip's length; the server logs it.
            def started(_):
                QTimer.singleShot(int((clip.get('seconds') or q.get('clipSeconds') or 10) * 1000),
                                  lambda: self._clips is run and self.api.host('spotify/pause', {}, lambda _: finished(), lambda _: finished()))
            self.api.host('spotify/play', {'question': q['id'], 'clip': i}, started, lambda e: (self.desk.toast.emit(e, True), self.stopClips()))
            return
        player = self.sound.play_file(clip.get('media'))
        if player is None:
            self.desk.toast.emit('Open the TV to play the clips through its sound', True)
            return self.stopClips()
        self._clip_player = player
        announced = {'done': False}

        def status(state):
            if self._clips is not run:
                return
            if state == QMediaPlayer.MediaStatus.BufferedMedia and not announced['done']:
                announced['done'] = True
                self.api.host('clip', {'question': q['id'], 'clip': i}, None, lambda e: self.desk.toast.emit(e, True))
            if state == QMediaPlayer.MediaStatus.EndOfMedia:
                player.mediaStatusChanged.disconnect(status)
                finished()
            if state == QMediaPlayer.MediaStatus.InvalidMedia:
                self.desk.toast.emit(f'Clip {i + 1} could not be played', True)
                player.mediaStatusChanged.disconnect(status)
                finished()
        player.mediaStatusChanged.connect(status)
        if player.mediaStatus() == QMediaPlayer.MediaStatus.BufferedMedia:
            status(QMediaPlayer.MediaStatus.BufferedMedia)

    def clipsRunning(self):
        return self._clips

    # ---- audio question (an uploaded sound plays through the TV) ----
    @Slot()
    def playAudio(self):
        q = self._q()
        media = (q or {}).get('media') or ''
        if not media.lower().endswith(('.mp3', '.ogg', '.wav')):
            return
        player = self.sound._players.get(media, (None,))[0]
        if player and player.playbackState() == QMediaPlayer.PlaybackState.PlayingState:
            player.pause()
        elif not self.sound.play_file(media, position_ms=player.position() if player else 0):
            self.desk.toast.emit('Open the TV to play the sound through it', True)

    # ---- wheel, countdown, TV mode, tie-breaker ----
    @Slot(str)
    def spinWheel(self, items_text):
        items = [line.strip() for line in items_text.split('\n') if line.strip()]
        mode = ((self.desk._state or {}).get('settings') or {}).get('displayMode')

        def spin(_=None):
            self._call('wheel', {'items': items} if items else {},
                       'Wheel spinning on the TV' + (' — Auto carries on once the result has shown' if mode == 'auto' else ' — set the TV back to Auto when you are done'))
        if mode not in ('auto', 'wheel'):
            self.api.host('settings', {'displayMode': 'wheel'}, spin, lambda e: self.desk.toast.emit(e, True))
        else:
            spin()

    @Slot(int, str)
    def startTimer(self, seconds, label):
        self._call('timer', {'action': 'start', 'seconds': seconds, 'label': label}, 'Countdown on the TV')

    @Slot()
    def toggleTimer(self):
        # The desk's state or the TV's, whichever arrived last has it (they refresh together).
        timer = (self.desk._state or {}).get('timer') or self.desk._tv.get('timer')
        if timer:
            self._call('timer', {'action': 'resume' if timer.get('endsAt') is None else 'pause'}, 'Countdown updated')

    @Slot()
    def stopTimer(self):
        self._call('timer', {'action': 'stop'}, 'Countdown removed from the TV')

    @Slot(str)
    def setDisplayMode(self, mode):
        if mode in DISPLAY_MODES:
            self._call('settings', {'displayMode': mode}, 'The TV follows the quiz' if mode == 'auto' else 'TV changed')

    @Slot(str, bool)
    def setSwitch(self, name, on):
        if name in SWITCHES:
            self._call('settings', {name: on})

    @Slot()
    def playTieBreaker(self):
        tie = (self.desk._state or {}).get('tie') or {}
        q = self._q()
        if tie.get('breaker'):
            self._call('start', {'id': tie['breaker']['id'], 'expectedQuestion': q['id'] if q else None}, 'Tie-breaker opened')
