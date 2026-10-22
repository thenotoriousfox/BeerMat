# Running a quiz

## Before the room fills

1. Click **PubQuiz** in the app menu and type the host key: the desk opens unlocked. In **Quiz night** at the top, press **Start quiz Wi-Fi** and enter your laptop password. (From a terminal: `./scripts/quiz-night.sh` does the same, Ctrl+C ends it; or `./scripts/start.sh` for PubQuiz alone, then open `http://localhost:3000/host`.) After the quiz, **Close PubQuiz** takes the Wi-Fi down and stops the server.
2. In **Build quiz**, set a quiz title and add rounds. Add and save questions with the form. Move questions up/down to set their order.
3. Pick a format (see **Round formats** below). Upload images/audio directly in the form; any format can carry an optional picture or clip. Files stay on the laptop. Each upload has a unique filename, so replacing a picture cannot change a question already played.
4. Add the correct answer and accepted alternatives, or leave it blank for manual marking. Choices must match one of the supplied options exactly. Each sheet item has its own marking key; the sheet's **Scoring** sets whether each item is worth a point, the parts share the question's points, or it's all-or-nothing. For a traditional paper round, print blank sheets and enter its score later.
5. To reuse SpeedQuizzing material, use **Import SpeedQuizzing files** for `.sqb`, `.sqq`, `.sqn`, `.sqt` (multi-tap) and `.sqw` (word snake) rounds or Quick Question files, or **Import a Quick Questions folder**. Each file or folder becomes a new round; nothing existing is replaced. Pictures referenced inside SpeedQuizzing round files are not embedded in them, so the import lists those questions for you to add the picture by hand. Quick Question picture and sound files are uploaded automatically.
6. **Download quiz JSON** saves an editable copy of the questions; **Download quiz with media** saves one file with its pictures and sounds inside, to move a quiz to another laptop. **Load a quiz file** starts a fresh quiz with it: if anything has been played, the current quiz's results are saved (in `results/`) and downloaded first, then teams and scores are cleared and phones are asked to join again. `examples/test-quiz.json` is a full rehearsal quiz to load this way.
7. In **Run quiz**, name the event, choose the projector view and open `/display` on the TV or projector. The projector can show how to join, scores, the current question/media, the wheel, or a blank screen.
   - **Auto** (the default) runs the TV for you: the join QR code before the first question, each question while it runs (and its answer when you reveal it), the leaderboard 10 seconds after the last question of a round is revealed (or 10 seconds after it closes if you don't reveal it), and the winner when you finish. A spin of the wheel shows the wheel for 16 seconds (the spin and its result), then Auto carries on. Picking any other view overrides Auto; choose **Auto** again to hand back control. The desk shows what Auto is currently showing. A round's end is known from the saved quiz, so questions played outside it never trigger the leaderboard.
   - The TV page always fits the screen without scrolling: long questions, big leaderboards (two columns past 10 teams) and reveals are scaled down to fit any resolution.
   - **TV over HDMI (most reliable):** extend the desktop to the TV, open `http://localhost:3000/display` there and press **⛶ Full screen** (or **F**). The pointer and screen buttons hide after 3 seconds without movement.
   - **Smart TV or streaming-stick browser:** join the quiz Wi-Fi and open `http://10.42.0.1:3000/display`. Casting a browser tab needs internet, so it will not work on the offline hotspot.
   - **How to join** shows one QR code. Scanning it joins the quiz Wi-Fi. iPhones then open the quiz in their sign-in window straight away; Android phones show a “Sign in to Wi-Fi network” notification, and tapping it opens the quiz. Teams pick a name there and play. If a phone asks about “no internet”, the team should choose “Use network as is” / “Stay connected”, which also keeps the phone off mobile data. The address is shown underneath for phones whose sign-in window does not appear. Set the Wi-Fi name and address under **Save join details** (the Wi-Fi name must match the hotspot's `--ssid`). While registration is open, the leaderboard also shows a one-line join reminder.
8. Start the approved hotspot setup separately. Phones need only the quiz Wi-Fi and their browser. If the captive login window does not open, enter `http://10.42.0.1` manually. In direct LAN testing use the laptop IP and port 3000.

Questions and rounds are saved to SQLite immediately after **Save**. If another quizmaster window saves first, your stale save is refused: download/copy your changes, then reload the saved quiz. Unsaved edits trigger a warning when leaving the page. Keep the laptop clock steady during a quiz.

## Round formats

| Format | Phones show | Scoring |
|---|---|---|
| Multiple choice | Lettered buttons A–H | Points (+ optional speed bonus) for the right option |
| Multi-tap | Lettered tick buttons | Each right tick earns a share of the points, each wrong tick removes a share (never below zero); the speed bonus needs every right tick and no wrong ones |
| Letters | A–Z keypad | First letter of the answer, e.g. “H” for Hedgehog. Put the full answer in the reveal note |
| Numbers | Number box | Exact numeric match (13 and 13.0 are equal) |
| Sequence | Shuffled items to tap in order, with undo | All in the right order scores |
| Nearest wins | Number box | Closest scores; set how many places score on a sliding scale (e.g. 3 places of 9 points → 9, 6, 3). Ties go to the earlier answer. Tick **Tie-breaker** for a question outside the scores: it scores nothing and only orders teams level on points, closest first; its winner fills the TV at the reveal. At the reveal the closest team fills the TV, and until the next question the leaderboard shows what every team answered |
| Buzz-in classic | Big BUZZ button | First buzzer answers out loud. ✓ scores the points; ✗ applies the wrong-answer penalty, passes to the next buzzer in the queue, and that team sits out the next buzz-in question |
| Buzz-in advanced | BUZZ, then an “I agree” button | First buzzer answers. Type what they said and press **Start agree countdown**; other teams tap if they agree. ✓/✗ then scores the buzzer (points or penalty) and gives agreement points to everyone who agreed with a right answer or didn’t agree with a wrong one. **Pass** applies the pass penalty and moves to the next buzzer |
| Pinpoint | The picture, to tap | Upload a picture and click it in the builder to place the target circle (size slider). A first tap inside scores the points. With **go wide**, a second tap scores the go-wide points if the first missed |
| Bingo | Their own 90-ball ticket (3 rows × 9 columns, 15 numbers) | Press **Call next number** (or key **B**); teams dab their own tickets and press **BINGO!** whenever they think they have it. The TV announces the call with the bingo sound, and the desk shows whether that ticket checks out for the prize; press **Correct — bingo!** (key **1**) or **Not a bingo** (key **2**), and the TV plays the right or wrong sound. The TV and phones show only the latest ball and how many have been called, so teams have to listen; **TV shows called numbers** in Room controls puts the full board up (the desk always has the list, and everyone sees it once the game ends). Calling pauses while a call is being checked, and a team turned down waits for the next number before calling again. The first correct call gets the points plus the bonus; any other correct call on the same number gets the points. Calling stops once someone has won |
| Word snake | A 4×4 or 5×5 letter grid | The answer runs through touching squares (diagonals too); teams trace it. Tapping a letter that does not touch restarts the trace. A fresh grid is made every time the question plays. With **go wide**, a team can remove the decoy letters but scores the go-wide points instead |
| Seven Squares-style tiles | Up to seven letter tiles and the word pattern (e.g. `___ ____ ____`) | The answer is cut into tiles, shuffled differently on every phone; teams tap them in order |
| Sound clips | A big **THIS ONE!** button | Upload several clips and pick the right one. **Play clips** on the desk plays them in order through the laptop; a team's single tap scores if it lands during the right clip, with a bonus that fades over its first five seconds. Phones only see “Clip 3 of 8” |
| Music bingo | A ticket of 15 song titles | Type 15–300 titles (or upload song files; each file name becomes its title). **Play next song** picks one at random and plays its file on the desk, or you play it from your own music player. The TV shows “Song 7” and reveals each title once the next song starts (or straight away, if you tick that). Claims are checked against the songs played |
| Vote | Lettered buttons | No right answer; the reveal shows the tally |
| Typed / picture / audio | Text box | Text matching as before, with alternatives. An audio question can play a Spotify song instead of a file: paste its link with a start time and play time, and the desk plays it on the laptop's Spotify as the question opens (**▶ Play the Spotify clip again** repeats it) |
| Answer sheet | Several text boxes | One point per item, the question's points shared between the items, or the points only if every item is right (**Scoring**). Put alternatives after the answer with “ / ”, e.g. `Shakespeare / William Shakespeare`. A sheet can carry a picture, a sound or a Spotify clip, so one song can have separately marked **Artist** and **Title** boxes |

**Bingo games** (number and music bingo): a **full game** (the default) plays one line, then two lines, then a full house, each with its own points. After a prize is won the game carries on: anyone else who claims on the same number shares that prize, and the next number moves play on to the next prize. The TV and phones show what is being played for and who won each prize; the desk stops calling once the full house is won. You can still choose a single-prize game (one line, two lines or full house only). With fastest fingers first, the first claim of each prize gets the bonus. Music bingo needs at least 15 songs, but use 30 or more: a ticket holds 15, so with fewer songs every team holds nearly the same ones.

**Music bingo timing:** *Start each song at* skips into the song (e.g. to the chorus), *Play each song for* stops it after that many seconds (0 = the whole song), and *Play the next song automatically* moves on after a 2-second gap. Auto-play pauses when a team claims, so you can check it, and stops when the game is paused, won or ended. This works for uploaded songs and Spotify.

Buzz-in and bingo stay live until you end them: for buzz-in the timer only limits buzzing. Teams can choose their buzzer sound under their recovery-code panel. The projector names the team that buzzed first and, after **🔊 Enable sound** is clicked once, plays a short tone for it (the desk plays it too). After a question closes, **Reveal answer** plays the reveal sound (a drum roll by default) on the TV and holds the answer back until it finishes (up to 10 seconds; phones wait too), then shows the answer, the full-answer note, every team that scored — quickest answer first, with its answer time and points (points are left out when the board shows positions only) — and, for choice, letters, numbers and votes, a tally of what teams picked.

## Sounds and bingo calls

**Sounds out of the box.** PubQuiz ships a CC0 (public-domain) sound set in `sounds/` — jingles, correct/wrong tones, a "time over" voice, drum roll, airhorn, applause, a music bed for answering, and 42 buzzer sounds. Sources are listed in `sounds/CREDITS.md`.

**Your own sound pack.** A `soundpack/` folder laid out exactly like `SpeedQuizzing Documents/Sounds/` (`general/` with SpeedQuizzing's file names, `buzzers/<pack>/`, `Themes/`), plus `Customisable Bingo Calls.txt` at the top, takes priority over the shipped sounds; its buzzer packs are listed first, and packs with "Offensive" in the name are skipped. `node scripts/sound-pack.mjs` builds it by copying your SpeedQuizzing `Sounds` folder and bingo calls (`./scripts/setup.sh --install` does it automatically when that folder exists); you can also copy the folder in by hand. `soundpack/` is never committed to git, so build or copy it on each laptop, then restart PubQuiz.

**Sound theme** (Build quiz → Sounds & bingo calls) picks one of the pack's themes (`soundpack/Themes/<name>/`, e.g. SpeedQuizzing's Arcade, Classic and Cop Show themes). A theme replaces the moments it has a sound for; the others keep the standard sounds. Choose **Random theme for each question** to give every question a theme (or the standard sounds) at random — each question keeps its pick — or **Theme by question type** to set one per format (keypad formats, typed answers and speed rounds start on different themes; change any of them in the table that appears). A sound you pick for a single moment on the desk applies whichever theme is playing. Changing theme mode resets those picks; added buzzer sounds stay.

**Build quiz → Sounds & bingo calls** changes the defaults for this quiz laptop. Sound effects play on the TV page (click its 🔊 Enable sound button once each night); without a file, PubQuiz uses its built-in beeps or stays quiet.

- **Sound effects:** import a folder and files are matched to moments by name — the SpeedQuizzing names work, so `SpeedQuizzing Documents/Sounds/Themes/Classic Theme` (or `Sounds/general`) sets them all at once. Moments: round starts, question opens, music while answering (loops; not during audio, clips, buzzer or bingo rounds), final countdown (a count from ten, started so it hits zero exactly at time's up and rings out after — SpeedQuizzing's timer files go here; the music stops when it starts), time's up (when no countdown played, and for the TV countdown), round ends (Auto leaderboard), correct / wrong buzzer answer, answer reveal, bingo number called, bingo claimed (SpeedQuizzing's `bingo_call` goes here), and winner. Bingo calls that name a colour ("red number 5") colour that number's ball, its square on the TV board and on phone tickets; a number whose call names none takes its neighbour's colour. The wheel needs no file: it clicks as each segment passes the pointer, slowing down with the wheel. You can also pick a file for any moment, play it on the desk, or remove it.
- **Buzzer sounds:** add a folder or files (e.g. `Sounds/buzzers/Sample Music`); each becomes a choice in the teams' phone menu after the 8 built-in sounds (up to 200). Removing them puts teams back on a built-in sound.
- **Bingo calls:** import SpeedQuizzing's `Bingo/Customisable Bingo Calls.txt` (or any file with one call per line for 1–90). Numbers without a call (SpeedQuizzing plays 80-ball bingo, so its file stops at 80) use the built-in calls. Building the sound pack (`scripts/sound-pack.mjs`) doesn't copy SpeedQuizzing's calls as they are, because they're written for its 80-ball game and mostly read the digits out ("Red, one and four 14"): it writes the traditional 90-ball calls with SpeedQuizzing's ball colours instead ("Valentine's Day, red 14", "Two fat ladies, yellow 88"). **Use the built-in calls** switches back.

Files are copied into PubQuiz's media folder on the laptop. Only use sound files you have the right to use; SpeedQuizzing's own sounds are licensed with SpeedQuizzing.

### A spoken bingo caller

When a number is called, the TV plays its chime and then a voice reading the call ("Two little ducks, number 22"). PubQuiz ships recordings of its own calls in `sounds/bingo_voice/`. A SpeedQuizzing calls file in `soundpack/` gets its own recordings, made on the laptop with [Piper](https://pypi.org/project/piper-tts/), a free offline text-to-speech voice:

```sh
python3 -m venv ~/.local/opt/piper && ~/.local/opt/piper/bin/pip install piper-tts
mkdir -p ~/.local/share/piper && cd ~/.local/share/piper
for f in en_GB-cori-high.onnx en_GB-cori-high.onnx.json; do curl -LO "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/cori/high/$f"; done
cd - && node scripts/bingo-voice.mjs   # about 30 seconds; writes soundpack/bingo_voice/1.mp3 … 90.mp3
```

`./scripts/setup.sh` does the last step for you once Piper is installed. Run `node scripts/bingo-voice.mjs` again after changing the calls file, then restart PubQuiz; rebuilding the sound pack keeps the recordings. The caller only speaks the calls it was recorded for: calls typed on the desk have no voice. **Bingo caller voice** in Room controls switches it off and on (the chime still plays); nothing is spoken while **Bingo phrases** is off either.

## Spotify (optional, private quizzes only)

Music bingo and sound clips can play songs from Spotify instead of uploaded files. **Use this only for private quizzes**: Spotify's terms cover personal listening, so playing it to a pub audience breaks them, and a pub also needs its own music licence. For pub nights, upload audio files.

It needs Spotify Premium and internet on the laptop (run the hotspot with `--keep-wifi`, or use a cable). Phones never touch Spotify. If the laptop goes offline mid-round, the music stops; the round itself carries on.

1. Create an app at developer.spotify.com/dashboard (tick *Web API*) and add the Redirect URI shown under **Build quiz → Spotify** (`http://127.0.0.1:3000/spotify/callback`; Spotify requires the 127.0.0.1 form).
2. Paste its Client ID and press **Connect Spotify**, then sign in in the tab that opens.
3. On quiz night, press **🎵 Start Spotify player on this desk** (Build quiz → Spotify, or the same button that appears on Run quiz when a Spotify round is live). The desk tab becomes a Spotify player called “PubQuiz desk” and plays through the laptop's speakers or HDMI. Keep the tab open. It needs Chrome, Firefox or Edge (protected-media support); plain Chromium builds may refuse.
4. Fallback: open the Spotify app on the laptop, play any song once, and pick it under **Play on**.

If you connected Spotify before the desk player existed, press **Connect Spotify** again: the desk player needs an extra permission. Spotify's player script is only downloaded when you press Start, and only by the desk page; phones and the TV never load anything from the internet.

- **Music bingo:** paste playlist or track links and press **Add songs from Spotify**; titles become `Song — Artist | spotify:track:…` lines. **Play next song** starts the song on the laptop's Spotify at **Start Spotify songs at** seconds (e.g. the chorus). A song can have its own start and play time: add them after its link, `Song — Artist | spotify:track:… | 45 | 20` (start 45 s in, play 20 s). Song links copied from Spotify (`https://open.spotify.com/track/…`) work too. Quiz files can carry the same per song as `start` and `seconds`; `docs/QUIZ-MAKER-PROMPT.md` is a ready prompt for an AI that writes quiz files. If Spotify can't play (no player, offline), the number still counts and the desk says why.
- **Sound clips:** add Spotify tracks with a start time each; each plays for the **Spotify clip length**, then the next starts. Uploaded and Spotify clips can be mixed.
- Playlists made by Spotify itself (editorial and algorithmic ones) can't be read by personal apps; copy their songs into a playlist of your own first.
- Sign-in tokens stay in the quiz database on the laptop and are never exported. **Disconnect** removes them.

## Online quizzes (Discord)

Friends can play from home: they answer on their phones over the internet while you share the TV page in a Discord call.

1. Install cloudflared once: `sudo pacman -S cloudflared` (`./scripts/setup.sh --install` includes it).
2. Start PubQuiz from the app icon. In **Quiz night**, press **Go online**. After a few seconds you get a link like `https://some-random-words.trycloudflare.com`; **Copy link** and post it in Discord. The TV's join screen shows it too, with a QR code.
3. Open **Projector ↗**, click **🔊 Enable sound**, and in Discord use **Share Screen** on that window with sound on. On Linux, Discord's own app may not share sound; Vesktop (a Discord client) does.
4. Run the quiz as usual. Questions reach phones within about a tenth of a second, sooner than the Discord stream, so players read them on their phones and use the stream for pictures, sound and the leaderboard.
5. **Go offline** (or **Close PubQuiz**) ends it. Going online again makes a new link.

The link reaches the players' page and the TV. The desk joins them only while **Desk on the online link** is on (off by default): then `<link>/host` runs the quiz from anywhere with the quizmaster key, so use a long, private one. Wrong keys are limited to 10 a minute per visitor and 30 a minute through the link altogether. From another device the quiz Wi-Fi can't be changed (its password prompt opens on the laptop); online quizzes don't need it. Spotify sign-in is only ever on the laptop. Anyone with the link can join, so turn on the waiting room (Room options) if it may travel beyond your friends. The link uses Cloudflare's free quick tunnels, made for testing and casual use; no Cloudflare account is needed. Spotify's terms cover personal listening, so streaming its music to a Discord call is at your own risk.

## Room options

- **Scramble keypads** puts multiple-choice, multi-tap, vote, letter and sequence buttons in a different order on each team's phone (labels keep their letters), so neighbouring tables cannot copy each other's taps. It applies from the next question.
- **Bingo phrases** shows the traditional call with each number ("22 — Two little ducks") on the TV, phones and desk.
- **Blocked team names** (Teams & results): common swear words are refused at registration, including spaced-out and number-swapped spellings, while names like Scunthorpe or Arsenal are allowed. Add your own words there. The desk can still rename any team.
- **Waiting room:** with it on, a new team's phone shows a waiting screen until you let it in: **Let everyone in** on Run quiz, or **Let in** / **Turn away** on its team card. Waiting teams are listed in the desk alerts and stay off the leaderboard and TV. Teams that joined before you switched it on are not affected.
- **Maximum teams** stops registration once that many teams (not counting disabled ones) have joined; 0 means no limit. Turning a team away or disabling it frees its place.
- **Board shows: scores / positions only** hides point totals on the TV, phones and winner screen while keeping the ranking, for suspense near the end. The desk always shows scores.
- **TV countdown:** set minutes, seconds and an optional label (“Hand in your answer sheets”), then **Start countdown**. It sits in the top corner of every TV view, turns red in the last 10 seconds, and shows “Time’s up!” with a beep (if sound is enabled on the TV) at zero. Pause, resume or stop it from the desk. It is separate from question timers.
- **Finish quiz** switches the projector to the **winner celebration**: the winning team (or tied teams) with confetti, a short fanfare if sound is enabled, and second and third place. It respects a hidden leaderboard.

## Keeping phones on the quiz Wi-Fi

A phone that sees “no internet” on the quiz Wi-Fi may quietly use mobile data instead. With **Keep phones on quiz Wi-Fi** on (the default), once a team has joined, the laptop answers that phone's “is there internet?” check with “yes”. iPhones then keep the quiz Wi-Fi as their main connection, so search engines stop loading while they play; many Android phones ask “Stay connected?”, and the join screen tells teams to say yes. Nothing on the laptop can switch a phone's mobile data off, so treat this as a strong nudge, not a lock.

If the sign-in window closes (on iPhone it gains a **Done** button), the team opens the quiz address in their normal browser and taps **Continue as <team>**: the laptop recognises the phone by its address on the quiz Wi-Fi, so no recovery code is needed.

**Leaving the quiz page:** if a phone switches to another app or tab, or is locked, while a question is open and unanswered, the desk shows “👀 Left the quiz page: Fox team (14s)”, live and in **Mark answers**. Teams see a note that the quizmaster can see this. It is a deterrent and a prompt to look, not proof of cheating.

## Teams

- **Team photos:** teams can add a selfie from the team panel on their phone. It is cropped and shrunk on the phone before upload, stays private until you approve it under Teams & results (the desk shows how many are waiting), and then appears on the leaderboard, buzz call-outs and winner screen. Rejecting deletes it. Switch photos off under Room controls.
- **Moving to a new phone:** **Move to a new phone** on a team card shows a 4-digit code. On the new phone, open the quiz, choose “Already registered?” and enter it. It works once, for five minutes.
- **Notes and stats:** each team card has private notes (only on the desk) and shows how many questions the team answered, how many scored, and its fastest scoring answer.

## Languages

Phones show the quiz in the phone's own language when it is English, French or Spanish, and teams can change it in the join screen or team panel. The TV language is set on the desk (**TV language**). The desk itself stays in English, and the traditional bingo call phrases are always English.

## Looks

**TV & phone look** (Run quiz → Room controls) changes the colours of the TV and the teams' phones: Purple stage (the default), Electric blue, Sunset, Emerald casino, Retro neon or Royal gold. **Random look for each question** gives every question one of them (it keeps it until the next question); **Look by question type** sets one per format — keypad, typed, speed, buzzer/clips and bingo rounds start on different looks, and the table that appears lets you change any of them. Answer colours (A red, B blue, C green, D yellow…) stay the same in every look. The desk keeps its own colours.

## Spin the wheel and keyboard control

**Spin the wheel** (Run quiz → Room controls) shows the wheel on the projector and spins it. In Auto the TV goes back to what it was showing once the result has been up for a few seconds; with any other view chosen, it stays on the wheel. The wheel clicks as each segment passes the pointer. Leave the entries blank to spin team names, or type your own (prizes, forfeits, categories). The result is chosen by the server before the animation starts and also shown on the desk.

Single keys work anywhere on the desk except while typing: **N** next question, **C** close/end, **P** pause or resume, **R** reveal, **1** correct, **2** wrong, **3** pass, **A** start agree countdown, **B** call a bingo number, **W** spin the wheel, **T** pause or resume the TV countdown, **S** switch the board between scores and positions. A Stream Deck, presenter remote or macro pad set to send these keys can drive the quiz.

## Live play

**Start next question** opens the first unplayed saved question in round order. A question cannot open while another is running or paused. To run a particular question, select it in **Build quiz** and use **Play saved question now**. Repeating a played question needs confirmation and creates a separate question/score entry.

Every timed question has a deadline enforced by the server. A phone timer is only a display. **Pause timer** stops accepting answers and freezes the remaining time; **Resume timer** restarts from that remainder. Pause survives a server restart. An unpaused question keeps its original deadline across a restart, so downtime counts against the timer. **Close answers** ends a question early. **Reveal answer** becomes available only after closing or expiry. It can be hidden again; this does not make it unseen by players who already read it.

Text marking normalises Unicode, surrounding/repeated whitespace and letter case, then uses exact matching against the key and alternatives. Punctuation and accents otherwise matter. Choice marking accepts only an exact option submitted by the phone. There is no reward for answering quickly unless a question has **Fastest fingers first** ticked (SpeedQuizzing rounds with a speed bonus import with it ticked). Then its speed bonus is whole extra points for fully correct, automatically marked answers (and the first bingo claim, or tapping the right sound clip quickly). A **sliding** bonus falls linearly from the configured maximum to zero with remaining answer time. A **fixed** bonus gives the full amount to the fastest correct answers only (1 by default; set how many), decided when answers close. When the answer is revealed, the fastest correct team fills the TV for a few seconds — team photo (or its initial), name and time — and its buzzer sound plays.

**Evil Mode** (per question, for formats with a correct answer set) takes the question's points off a team whose answer scores nothing. Teams that don't answer lose nothing. Buzz-in has its own wrong-answer penalty instead. Each team's clock starts when its phone received the question, so a slow phone is not penalised — but never more than 2 seconds after the question opened, so a phone that slept or looked at the projector gains nothing. Automatic points are withheld from player scores while the question remains open/paused to avoid revealing correctness during play.

A team can send one final answer per question. Sheet answers may be left blank, with a confirmation before submitting. Phone drafts save in browser storage and on the quiz laptop while connected. They are not submitted for marking until the team presses **Submit final answer**. Local drafts survive reload; server drafts allow another browser with the recovery code to resume. Reconnection never automatically submits a draft. If a submission's confirmation is lost, the next refresh checks whether the server stored it before re-enabling the button.

## Marking

Use **Mark answers** and choose any played question. The marking key, alternatives and media appear above the team cards. Live/paused questions cannot be marked. Save the total points for a text/media/choice answer; for a sheet mark each item zero or one. Blank keyed sheet items are automatically wrong; items without a key need review. You can save marks for a team that did not submit, such as a paper answer delivered to the host. Repeated saves replace the answer's points rather than adding points. Every manual change is included in the marking log in results export.

For paper-round totals or general corrections, use **Teams & results → Paper round / score correction**. Enter positive or negative whole points and a reason. Each form submission has an idempotency key: retrying after a lost response does not add the same adjustment twice. To correct an already accepted adjustment, record a new reversing adjustment with an explanatory reason.

Scores update after question closure/expiry and after each saved mark/correction. Equal scores share rank. Hide the public leaderboard for suspense if needed; the quizmaster retains scores.

## Team recovery and disconnections

Phones keep a live connection to the laptop and update the moment anything changes; they also refresh every 5 seconds in case an update was missed. A team with no open connection and no request for 15 seconds appears disconnected. Sleeping/background phones and captive mini-browsers may trigger this too. The warning means unreachable, not proof of cheating. The quizmaster alert names the affected teams.

Players should keep their private recovery code. Switching from a captive window to a normal browser needs that code because storage may be separate. The recovery form restores the same team, answers and score. Multiple devices with the same code represent the same team: first final answer wins.

If a code is lost, use **Issue recovery code** for that team and give the new code privately to its captain. This revokes the old code immediately while preserving answers, scores and saved server drafts. Team names can be corrected by the host. Disable an abandoned/unwanted team to prevent answers and hide it from public scores; restore it without losing its history. Names remain reserved even while disabled.

## End and next event

**Finish quiz** closes the current question and registration and shows the winner. You can resume a finished quiz if needed.

**End quiz & start next…** (Run quiz → Room controls) is for the next quiz night:

1. The results — teams, every question played, answers, scores, adjustments and marking history — download to the desk and are also saved on the laptop in `results/` (named by date and quiz). Recovery codes are never included.
2. All teams, answers, scores, team photos, the countdown and the wheel are cleared. Phones still open from the last quiz show “A new quiz has started — pick your team name again”.
3. Choose the questions for the next quiz: keep the current ones, load a quiz file (.json), or start empty (then build it, import SpeedQuizzing rounds, or run `node scripts/load-test-quiz.mjs`).

Settings, join details, Spotify connection and question pictures and sounds are kept, and the TV goes back to Auto (the join screen).
