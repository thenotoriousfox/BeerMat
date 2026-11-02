"""The live controls beyond Next/close/reveal, as the web desk's Tonight tab has them: the buzzer game's verdicts, bingo
calls and shouts, music bingo songs, the sound clips game, the wheel, the TV countdown, what the TV shows, the
tie-breaker, and the room's switches (registration, scores, scrambled keypads, waiting room, bingo extras).

The quiz server decides everything; this sends the quizmaster's choices and plays the desk's own audio (clips, songs,
audio questions) through the TV's sound (tvsound.py), telling the server when each clip starts and ends."""
from pathlib import Path

from PySide6.QtCore import QObject, QTimer, Signal, Slot
from PySide6.QtMultimedia import QMediaPlayer

# Settings the desk may switch (each a boolean on the server's settings).
SWITCHES = {'registrationOpen', 'leaderboardVisible', 'showScores', 'scrambleKeypads', 'waitingRoom', 'bingoPhrases', 'bingoVoice',
            'bingoBoard', 'teamPhotos', 'onlineAfterJoin', 'sendQuestion', 'fixedSix', 'groupBoard', 'askTable', 'simpleMode', 'slidesAuto', 'countQuizzes'}
DISPLAY_MODES = ['auto', 'join', 'question', 'leaderboard', 'wheel', 'winner', 'slides', 'blank']


class LiveTools(QObject):
    clipsChanged = Signal()

    def __init__(self, desk):
        super().__init__(desk)
        self.desk, self.api, self.sound = desk, desk.api, desk.tvSound
        self._clips = None          # {'question', 'index', 'spotify'} while the clips game plays
        # A question's own Spotify clip (audio or answer sheet): which question it was started for, whether it's playing,
        # and a count that cancels the stop timer of an earlier start.
        self._spotify_cued, self._spotify_playing, self._spotify_run = None, False, 0
        self._clip_player = None
        self._clip_media = None
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
                self.sound.desk_play(song['media'], position_ms=int(start * 1000))
                self._time_song(q, song)
            self.desk.toast.emit(f'Song {played}: {song.get("title")}' + ('' if song.get('media') else ' — play it from your own music player'), False)
        self.api.host('bingo', {'question': q['id']}, lambda r: (called(r), self.desk.refresh()), lambda e: self.desk.toast.emit(e, True))

    @Slot()
    def replaySong(self):
        """Music bingo: the song just called, again from its start (it isn't called again or logged), for its time."""
        q = self._q()
        current = ((q or {}).get('bingo') or {}).get('current') or {}
        song = next((s for s in (q or {}).get('songs') or [] if s.get('title') == current.get('title')), None)
        if not q or q.get('type') != 'musicbingo' or not song:
            return
        self._stop_song()
        start = song.get('start', q.get('startAt')) or 0
        if song.get('spotify'):
            self.api.host('spotify/preview', {'link': song['spotify'], 'start': start},
                          lambda _: (self.desk.toast.emit(f'Playing again: {song.get("title")}', False), self._time_song(dict(q, autoNext=False), song)),
                          lambda e: self.desk.toast.emit(e, True))
        elif song.get('media'):
            self.sound.desk_play(song['media'], position_ms=int(start * 1000))
            # A replay stops after its time; it doesn't move on to the next song by itself.
            self._time_song(dict(q, autoNext=False), song)
            self.desk.toast.emit(f'Playing again: {song.get("title")}', False)

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
                self.sound.desk_stop(song['media'])
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

    @Slot(int)
    def playClip(self, i):
        """Just one clip (to play it again, or out of order); Play clips plays them all."""
        q = self._q()
        if q and q.get('type') == 'clips' and q.get('live'):
            self.stopClips()
            self._play_clip(q, i, only=True)

    @Slot()
    def stopClips(self):
        run, self._clips = self._clips, None
        if self._clip_player:
            self.sound.desk_stop(self._clip_media)
        if run:
            if run.get('spotify'):
                self.api.host('spotify/pause', {})
            self.api.host('clip', {'question': run['question'], 'clip': -1})
        self.clipsChanged.emit()

    def _play_clip(self, q, i, only=False):
        live = self._q()
        clips = q.get('clips') or []
        if not live or live.get('id') != q['id'] or not live.get('live') or i >= len(clips):
            return self.stopClips()
        clip = clips[i]
        run = self._clips = {'question': q['id'], 'index': i, 'spotify': bool(clip.get('spotify'))}
        self.clipsChanged.emit()

        ended = {'done': False}

        def finished():
            if self._clips is not run or ended['done']:
                return
            ended['done'] = True
            if only:
                return self.stopClips()
            self.api.host('clip', {'question': q['id'], 'clip': -1}, lambda _: QTimer.singleShot(1500, lambda: self._clips is run and self._play_clip(q, i + 1)))

        if clip.get('spotify'):
            # A Spotify clip plays on the laptop's Spotify app (Spotify Connect) for the clip's length; the server logs it.
            def started(_):
                QTimer.singleShot(int((clip.get('seconds') or q.get('clipSeconds') or 10) * 1000),
                                  lambda: self._clips is run and self.api.host('spotify/pause', {}, lambda _: finished(), lambda _: finished()))
            self.api.host('spotify/play', {'question': q['id'], 'clip': i}, started, lambda e: (self.desk.toast.emit(e, True), self.stopClips()))
            return
        self._clip_media = clip.get('media')
        player = self.sound.desk_play(clip.get('media'))
        if player is None:
            self.desk.toast.emit('Open the TV to play the clips through its sound', True)
            return self.stopClips()
        self._clip_player = player
        announced = {'done': False}
        # An uploaded clip plays for the question's clip length too (or to its end, if that's sooner).
        QTimer.singleShot(int((q.get('clipSeconds') or 15) * 1000), lambda: self._clips is run and not ended['done'] and (self.sound.desk_stop(clip.get('media')), finished()))

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
    # It plays by itself as the question opens (tvsound.py); these play it again, and pause it.
    @Slot()
    def playAudio(self):
        """From the start."""
        if self._spotify_clip():
            return self._play_spotify()
        media = self._audio()
        if media and not self.sound.desk_play(media):
            self.desk.toast.emit('Open the TV to play the sound through it', True)

    @Slot()
    def pauseAudio(self):
        """Pauses it, or carries on from where it paused (a Spotify clip starts again: Spotify has no carry-on here)."""
        if self._spotify_clip():
            return self._stop_spotify() if self._spotify_playing else self._play_spotify()
        media = self._audio()
        player = self.sound._players.get(media, (None,))[0] if media else None
        if player and player.playbackState() == QMediaPlayer.PlaybackState.PlayingState:
            self.sound.desk_pause(media)
        elif player and player.playbackState() == QMediaPlayer.PlaybackState.PausedState:
            self.sound.desk_resume(media)

    def _audio(self):
        media = (self._q() or {}).get('media') or ''
        return media if media.lower().endswith(('.mp3', '.ogg', '.wav')) else ''

    # ---- a question's own Spotify clip (an audio question or answer sheet): on the Spotify player ----
    def _spotify_clip(self):
        q = self._q() or {}
        return q.get('clip') if (q.get('clip') or {}).get('spotify') else None

    def _play_spotify(self):
        q = self._q()
        self._spotify_run += 1
        run = self._spotify_run

        def started(reply):
            self._spotify_playing = True
            # It stops after its play time (as the browser desk's playAudioClip).
            QTimer.singleShot(int((reply.get('seconds') or q['clip'].get('seconds') or 30) * 1000), lambda: run == self._spotify_run and self._stop_spotify())
        failed = lambda e: self.desk.toast.emit(e, True)
        if q.get('live'):
            self.api.host('spotify/play', {'question': q['id']}, started, failed)
        else:
            # Closed or revealed: played again for the room, as a preview (nothing logged against the question).
            self.api.host('spotify/preview', {'link': q['clip']['spotify'], 'start': q['clip'].get('start') or 0}, started, failed)

    def _stop_spotify(self):
        self._spotify_run += 1
        self._spotify_playing = False
        self.api.host('spotify/pause', {}, lambda _: None, lambda _: None)

    def followSpotifyClip(self, q):
        """Each state: a question with a Spotify clip starts it as it opens (once it's sent, with Send Question), not
        when the desk catches up with one already running; a question moving on stops it."""
        if self._spotify_cued is not None and (not q or q.get('id') != self._spotify_cued) and self._spotify_playing:
            self._stop_spotify()
        if not q or not (q.get('clip') or {}).get('spotify') or not q.get('live') or q.get('held') or q.get('id') == self._spotify_cued:
            return
        self._spotify_cued = q['id']
        if (q.get('seconds') or 0) * 1000 - (q.get('remaining') or 0) < 5000:
            self._play_spotify()

    # ---- wheel, countdown, TV mode, tie-breaker ----
    @Slot(str)
    def spinWheel(self, items_text):
        items = [line.strip() for line in items_text.split('\n') if line.strip()]
        self.spin({'items': items} if items else {})

    @Slot('QVariantMap')
    def spin(self, body):
        """Any wheel: {} the teams, {kind: weighted}, {kind: number, min, max}, {saved: id}, {items: [...]}. The result
        (and a rollover jackpot or Fast Track prize) comes back as the toast."""
        mode = ((self.desk._state or {}).get('settings') or {}).get('displayMode')
        def said(reply):
            result = (reply.get('items') or [''])[reply.get('result', 0)]
            return f'Spinning: {result}' + (f' · {reply["note"]}' if reply.get('note') else '')

        def spin(_=None):
            self._call('wheel', dict(body), said)
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

    @Slot('QVariantMap')
    def saveWheel(self, wheel):
        self._call('wheels', {'action': 'save', 'wheel': dict(wheel)}, f'Wheel saved: {wheel.get("name", "")}')

    @Slot(str)
    def deleteWheel(self, wheel_id):
        self._call('wheels', {'action': 'delete', 'id': wheel_id}, 'Wheel deleted')

    # ---- Fast Track and questions on the fly ----
    @Slot(str, str)
    def fastTrack(self, team, action):
        """first: the team jumps one point clear into first place; wheel: it spins the Fast Track wheel."""
        if action == 'first':
            self._call('fasttrack', {'team': team, 'action': 'first'}, lambda r: f'Fast Track: +{r.get("points", 0)} points, into first place')
        else:
            mode = ((self.desk._state or {}).get('settings') or {}).get('displayMode')
            go = lambda _=None: self._call('fasttrack', {'team': team, 'action': 'wheel'}, lambda r: f'Fast Track wheel: {r["items"][r["result"]]}' + (f' · {r["note"]}' if r.get('note') else ''))
            if mode not in ('auto', 'wheel'):
                self.api.host('settings', {'displayMode': 'wheel'}, go, lambda e: self.desk.toast.emit(e, True))
            else:
                go()

    @Slot(str, int, int, int, str)
    def askOnTheFly(self, kind, options, seconds, points, text):
        q = self._q()
        if q and q.get('live'):
            self.desk.toast.emit('Close the question that is open first', True)
            return
        self._call('fly', {'type': kind, 'options': options, 'seconds': seconds, 'points': points, 'text': text}, 'On the fly: read it out now')

    @Slot(str)
    def flyAnswer(self, answer):
        q = self._q()
        if q and q.get('onTheFly'):
            self._call('fly/answer', {'question': q['id'], 'answer': answer}, 'Answer set: teams marked')

    # ---- slides between rounds ----
    @Slot('QVariantList')
    def setSlides(self, slides):
        self._call('slides', {'slides': [dict(x) for x in slides]}, 'Slides saved')

    @Slot('QVariantList')
    def addSlides(self, urls):
        """Pictures chosen on this laptop: uploaded to the quiz's media, then added to the slides."""
        slides = list(((self.desk._state or {}).get('slides') or []))
        paths = [u.toLocalFile() if hasattr(u, 'toLocalFile') else str(u) for u in urls]

        def next_one(_=None):
            if not paths:
                self.setSlides(slides)
                return
            path = Path(paths.pop(0))
            if path.suffix.lower() not in ('.png', '.jpg', '.jpeg', '.webp'):
                self.desk.toast.emit(f'{path.name}: slides are PNG, JPEG or WebP pictures', True)
                return next_one()
            try:
                data = path.read_bytes()
            except OSError as e:
                self.desk.toast.emit(f'Could not read {path.name}: {e}', True)
                return next_one()
            self.api.upload(data, f'slide{path.suffix.lower()}', lambda media: (slides.append({'media': media, 'seconds': 8}), next_one()),
                            lambda e: self.desk.toast.emit(e, True))
        next_one()

    @Slot()
    def playTieBreaker(self):
        tie = (self.desk._state or {}).get('tie') or {}
        q = self._q()
        if tie.get('breaker'):
            self._call('start', {'id': tie['breaker']['id'], 'expectedQuestion': q['id'] if q else None}, 'Tie-breaker opened')
