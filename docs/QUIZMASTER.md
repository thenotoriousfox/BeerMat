# Running a quiz

## The desk

Five tabs, in the order a night uses them:

* **Tonight**: the night itself. The control bar stays at the top: where the quiz is (teams join → each round → final
  scores) and one big button for whatever comes next: it closes an open question (red), reveals a closed one, otherwise
  starts the next question or round, shows and reveals the leaderboard, and finishes. The smaller buttons beside it do
  the same steps by hand, plus pause and resume; **End quiz** (finish, or end and start the next) sits in its own menu.
  Below: the question on screen with its answer, **Answers & marking** for it (or any earlier question), and down the
  side the **teams in the room** (who has answered the open question, scores, who is waiting or offline), **Up next**
  in this round, **On the TV** (what the TV shows, its look, the leaderboard) and **Tools** (spin the wheel, a TV
  countdown). Before the first question, **Before the room fills** checks the quiz, joining, the TV and teams.
* **Quizzes**: the quiz's title, the **File** menu (load a quiz file or a Drive link, download, print answer sheets),
  and the editor, with an outline of every round and question beside it: click one to edit it.
* **Teams**: each team's controls (recovery codes, photos, notes, disable), returning teams, blocked names, paper
  rounds and score corrections.
* **Venue**: your venue on BeerMat Online.
* **Settings**: everything you set once: the quiz room (event name, team limit, join details, keypad and bingo
  options, waiting room, TV language), the quiz Wi-Fi and online mode, screens, how players join, past quizzes and
  BeerMat Online, sounds and bingo calls, Spotify, and the keyboard shortcuts.

**Plans.** BeerMat Free makes and rehearses quizzes with no limits (see **Rehearsals** below); hosting a live quiz with
real teams, Spotify and adding from the shared buzzer library are BeerMat Pro. When your venue has Pro: register this laptop with the venue (**Venue** tab),
then **Settings → Plan → Check my plan**. That needs the internet once; the plan then holds offline and renews itself
whenever the laptop is online. Players never need a plan.

**Rehearsals.** **Tonight → Rehearse this quiz** (or **Quizzes → Rehearse quiz**) plays the quiz with simulated teams
on the real quiz engine: timers, marking, scores, buzzers, the leaderboard and the TV, which shows a small Rehearsal
label. Choose how many teams (up to 30), how often they're right, whether they answer by themselves or only when told,
fast timers (a third of each question's time), buzzing, and teams dropping out. The Rehearsal panel makes a chosen team
answer right or wrong, twice, with nonsense, for an old question, buzz, agree, drop out or come back, and shows whether
the quiz server accepted it. Real phones can scan the code too: they show **Rehearsal mode — Connection successful**
and are listed as test phones, but can't play. Nothing from a rehearsal is kept or shared. **End rehearsal** clears it;
**Host live quiz** (Pro) clears it and lets real teams play. Rehearsing over a live quiz in progress saves that quiz's
results first and asks before going ahead. If the venue's Pro lapses during a live quiz, the quiz carries on for up to
a day; after that the laptop can rehearse but not go live.

**Preflight check** (Tonight) checks the quiz, its pictures and sounds, the database, disk space, the network, the quiz
Wi-Fi, and in the app the screens and sound, and says plainly what it couldn't check.

## A TV without a cable

A smart TV, or a Fire TV or Google TV stick, can show the quiz without an HDMI cable to the laptop: its own web browser
opens the TV page from the laptop. **TV without a cable…** (Live, under the TV preview) shows the address, a QR code and
the steps. The TV stays on the venue's own Wi-Fi, the one the laptop is on beside the quiz Wi-Fi: the quiz server
answers the TV page on every network the laptop is on (only the TV page: playing, joining and the desk stay on the
quiz Wi-Fi). Open the TV's browser, go to the address (the laptop's address on the venue network with `/tv` on the
end, e.g. `http://192.168.1.20:3000/tv`; if the laptop is on no other network, the quiz Wi-Fi's, `http://10.42.0.1/tv`)
and press OK on **Start the TV**, which goes full screen with sound. The TV draws the quiz itself, so it's as sharp as the TV and barely uses the Wi-Fi. Keep
the desk's own TV window closed, or on another screen.

On an **Android TV, Google TV or Fire TV** (most TV sticks), install the BeerMat app (the Android download on the
website; on a Fire TV, sideload it) and open **BeerMat TV** from the TV's apps: on the quiz Wi-Fi it finds the quiz by
itself (on the venue's Wi-Fi or the quiz Wi-Fi), with no address to type, and starts full screen with sound.

## The TV on another computer

When the TVs are wired to a different computer from the quizmaster's laptop (a PC behind the bar, say), open BeerMat on
that computer and make it the **TV screen**: the first-run welcome's *This computer is the TV screen*, or Settings →
Screens → *Use this computer as a TV screen*. It looks for the quiz on its networks (the quiz Wi-Fi or the venue's
Wi-Fi), connecting by itself to the laptop it used last; otherwise choose the quiz, or type the laptop's address. It
shows the TV full screen and plays all the sound there: the TV's own sounds, and the desk's sound clips, music bingo
songs and audio questions, which while a TV screen is connected play on it instead of the laptop (Settings → Screens
says which TV screen is connected). Spotify plays wherever Settings → Spotify sends it: open Spotify on the TV screen,
signed in to the same account, and choose it there. Move the mouse (or press Escape) on the TV screen for its bar:
change quiz, window or full screen, back to the quizmaster desk, or close. The laptop's own quiz is untouched.

## Before the room fills

1. **Desktop app** (Windows or Linux, [DESKTOP.md](DESKTOP.md)): open **BeerMat**; the desk opens unlocked and the TV display goes full screen on a second screen by itself. Choose how players join under **How players join** (venue Wi-Fi, below) or start the quiz Wi-Fi in **Quiz night**. From source on Linux, `./scripts/setup.sh --app` puts the desktop app in the app menu. **Browser launcher** (`./scripts/setup.sh --browser-app`): click **BeerMat** in the app menu and type the host key: the desk opens unlocked in the browser. In **Quiz night** at the top, press **Start quiz Wi-Fi** and enter your laptop password. (From a terminal: `./scripts/quiz-night.sh` does the same, Ctrl+C ends it; or `./scripts/start.sh` for BeerMat alone, then open `http://localhost:3000/host`.) After the quiz, **Close BeerMat** takes the Wi-Fi down and stops the server.
2. In **Quizzes**, set a quiz title and add rounds. Add and save questions with the form. Move questions up/down to set their order.
3. Pick a format (see **Round formats** below). Upload images/audio directly in the form; any format can carry an optional picture or clip. Files stay on the laptop. Each upload has a unique filename, so replacing a picture cannot change a question already played.
4. Add the correct answer and accepted alternatives, or leave it blank for manual marking. Choices must match one of the supplied options exactly. Each sheet item has its own marking key; the sheet's **Scoring** sets whether each item is worth a point, the parts share the question's points, or it's all-or-nothing. For a traditional paper round, print blank sheets and enter its score later.
5. **Download quiz JSON** saves an editable copy of the questions; **Download quiz with media** saves one file with its pictures and sounds inside, to move a quiz to another laptop. **Load a quiz file** starts a fresh quiz with it: if anything has been played, the current quiz's results are saved (in `results/`) and downloaded first, then teams and scores are cleared and phones are asked to join again. `examples/test-quiz.json` is a full rehearsal quiz to load this way. A quiz file in Google Drive loads the same way: in Drive, set the file's General access to **Anyone with the link** and **Copy link**, paste it into **Or a Google Drive link** and press **Load from Drive** (the laptop needs internet for this; no Google sign-in, and anyone with the link can read the file).
6. In **Tonight**, name the event, choose the projector view and open `/tv` on the TV or projector. The projector can show how to join, scores, the current question/media, the wheel, or a blank screen.
   - **Auto** (the default) runs the TV for you: the join QR code before the first question, each question while it runs (and its answer when you reveal it), the leaderboard when you show it at the end of a round (see “Leaderboard between rounds”, below), and the final standings when you finish. A spin of the wheel shows the wheel for 16 seconds (the spin and its result), then Auto carries on. Picking any other view overrides Auto; choose **Auto** again to hand back control. The desk shows what Auto is currently showing. A round's end is known from the saved quiz, so questions played outside it never offer the leaderboard.
   - **Leaderboard between rounds:** after a round's last question, **Next** on Tonight becomes **Show leaderboard**: the TV shows the board with every position hidden. Each press of **Reveal next position** shows the next team up from last place; **Reveal first place** fills the TV with the leader (photo, name, points and buzzer sound), then shows the whole board. **Next** then reads **Start next round**. After the last round, **Finish quiz** reveals the final standings the same way. Choosing a projector view ends a reveal early. With the leaderboard hidden or a secret round running there is nothing to reveal, so **Next** carries on to the next round.
   - The TV page always fits the screen without scrolling: long questions, big leaderboards (two columns past 10 teams) and reveals are scaled down to fit any resolution.
   - **TV over HDMI (most reliable):** extend the desktop to the TV, open `http://localhost:3000/tv` there and press **⛶ Full screen** (or **F**). The pointer and screen buttons hide after 3 seconds without movement.
   - **Smart TV or streaming-stick browser:** join the quiz Wi-Fi and open `http://10.42.0.1/tv`. Casting a browser tab needs internet, so it will not work on the offline hotspot.
   - **How to join** shows one QR code, which opens the quiz page. With the quiz Wi-Fi, teams join the Wi-Fi first (the TV names it, and its password if it has one), then scan; phones joining the open quiz Wi-Fi usually open the quiz in their sign-in window by themselves too. Teams pick a name there and play. If a phone asks about “no internet”, the team should choose “Use network as is” / “Stay connected”, which also keeps the phone off mobile data. The address is shown underneath for phones that cannot scan. Set the Wi-Fi name and address under **Save join details** (the Wi-Fi name must match the hotspot's `--ssid`). While registration is open, the leaderboard also shows a one-line join reminder.
7. Start the approved hotspot setup separately. Phones need only the quiz Wi-Fi and their browser. If the captive login window does not open, enter `http://10.42.0.1` manually. In direct LAN testing use the laptop IP and port 3000.

Questions and rounds are saved to SQLite immediately after **Save**. If another quizmaster window saves first, your stale save is refused: download/copy your changes, then reload the saved quiz. Unsaved edits trigger a warning when leaving the page. Keep the laptop clock steady during a quiz.

## Round formats

| Format | Phones show | Scoring |
|---|---|---|
| Multiple choice | Lettered buttons A–H | Points (+ optional speed bonus) for the right option. With a **50/50**, a team can take away half the wrong choices (different ones for each team) and scores the 50/50 points instead, without a speed bonus |
| Multi-tap | Lettered tick buttons | Each right tick earns a share of the points, each wrong tick removes a share (never below zero); the speed bonus needs every right tick and no wrong ones |
| Letters | A–Z keypad | First letter of the answer, e.g. “H” for Hedgehog. Put the full answer in the reveal note |
| Numbers | Number box | Exact numeric match (13 and 13.0 are equal), or within a margin you set (± a number, or ± a percentage of the answer); the reveal shows it, e.g. 1969 (± 2) |
| Sequence | Shuffled items to tap in order, with undo | All in the right order scores |
| Nearest wins | Number box | Closest scores; set how many places score on a sliding scale (e.g. 3 places of 9 points → 9, 6, 3). Ties go to the earlier answer. Tick **Tie-breaker** for a question outside the scores: it scores nothing and only orders teams level on points, closest first; its winner fills the TV at the reveal. **Next question** never opens a tie-breaker: once every other question has been played, if two or more teams are level for first place, Tonight shows who is tied with **Play the tie-breaker**, and **Finish quiz** reminds you of an unsettled tie. Ties for other places are left as they are. At the reveal the closest team fills the TV, and until the next question the leaderboard shows what every team answered Tick **Closest without going over** and answers above the answer score nothing. |
| Buzz-in classic | Big BUZZ button | First buzzer answers out loud. ✓ scores the points; ✗ applies the wrong-answer penalty, passes to the next buzzer in the queue, and that team sits out the next buzz-in question |
| Buzz-in advanced | BUZZ, then an “I agree” button | First buzzer answers. Type what they said and press **Start agree countdown**; other teams tap if they agree. ✓/✗ then scores the buzzer (points or penalty) and gives agreement points to everyone who agreed with a right answer or didn’t agree with a wrong one. **Pass** applies the pass penalty and moves to the next buzzer |
| Pinpoint | The picture, to tap | Upload a picture and click it in the builder to place the target circle (size slider). A first tap inside scores the points. With a **second guess**, a second tap scores the second-guess points if the first missed |
| Bingo | Their own 90-ball ticket (3 rows × 9 columns, 15 numbers) | Press **Call next number** (or key **B**); teams dab their own tickets and press **BINGO!** whenever they think they have it. The TV announces the call with the bingo sound, and the desk shows whether that ticket checks out for the prize; press **Correct — bingo!** (key **1**) or **Not a bingo** (key **2**), and the TV plays the right or wrong sound. The TV and phones show only the latest ball and how many have been called, so teams have to listen; **TV shows called numbers** in Settings → Quiz room puts the full board up (the desk always has the list, and everyone sees it once the game ends). Calling pauses while a call is being checked, and a team turned down waits for the next number before calling again. The first correct call gets the points plus the bonus; any other correct call on the same number gets the points. Calling stops once someone has won |
| Word trail | A 4×4 or 5×5 letter grid | The answer runs through touching squares (diagonals too); teams trace it. Tapping a letter that does not touch restarts the trace. A fresh grid is made every time the question plays. With a **hint**, a team can hide the decoy letters but scores the hint points instead |
| Letter tiles | Up to seven letter tiles and the word pattern (e.g. `___ ____ ____`) | The answer is cut into tiles, shuffled differently on every phone; teams tap them in order |
| Sound clips | A big **THIS ONE!** button | Upload several clips and pick the right one. **Play clips** on the desk plays them in order through the laptop; a team's single tap scores if it lands during the right clip, with a bonus that fades over its first five seconds. Phones only see “Clip 3 of 8” |
| Music bingo | A ticket of 15 song titles | Type 15–300 titles (or upload song files; each file name becomes its title). **Play next song** picks one at random and plays its file on the desk, or you play it from your own music player. The TV shows “Song 7” and reveals each title once the next song starts (or straight away, if you tick that). Claims are checked against the songs played |
| Vote | Lettered buttons | No right answer; the reveal shows the tally |
| Typed / picture / audio | Text box | Text matching as before, with alternatives. An audio question can play a Spotify song instead of a file: paste its link with a start time and play time, and the desk plays it on the laptop's Spotify as the question opens (**▶ Play the Spotify clip again** repeats it) |
| Answer sheet | Several text boxes | One point per item, the question's points shared between the items, or the points only if every item is right (**Scoring**). Put alternatives after the answer with “ / ”, e.g. `Shakespeare / William Shakespeare`. A sheet can carry a picture, a sound or a Spotify clip, so one song can have separately marked **Artist** and **Title** boxes |

**Bingo games** (number and music bingo): a **full game** (the default) plays one line, then two lines, then a full house, each with its own points. After a prize is won the game carries on: anyone else who claims on the same number shares that prize, and the next number moves play on to the next prize. The TV and phones show what is being played for and who won each prize; the desk stops calling once the full house is won. You can still choose a single-prize game (one line, two lines or full house only). With fastest fingers first, the first claim of each prize gets the bonus. Music bingo needs at least 15 songs, but use 30 or more: a ticket holds 15, so with fewer songs every team holds nearly the same ones.

**Music bingo timing:** *Start each song at* skips into the song (e.g. to the chorus), *Play each song for* stops it after that many seconds (0 = the whole song), and *Play the next song automatically* moves on after a 2-second gap. Auto-play pauses when a team claims, so you can check it, and stops when the game is paused, won or ended. This works for uploaded songs and Spotify.

Buzz-in and bingo stay live until you end them: for buzz-in the timer only limits buzzing. Teams choose their buzzer sound on the waiting screen before the quiz starts, or later in their team menu; each one plays on the phone as it is picked (**▶ Hear it** plays it again). The projector names the team that buzzed first and, after **🔊 Enable sound** is clicked once, plays a short tone for it (the desk plays it too). After a question closes, **Reveal answer** plays the reveal sound (a drum roll by default) on the TV and holds the answer back until it finishes (up to 10 seconds; phones wait too), then shows the answer, the full-answer note, every team that scored — quickest answer first, with its answer time and points (points are left out when the board shows positions only) — and, for choice, letters, numbers and votes, a tally of what teams picked.

## Sounds and bingo calls

**Sounds out of the box.** BeerMat ships a CC0 (public-domain) sound set in `sounds/` — jingles, correct/wrong tones, a "time over" voice, drum roll, airhorn, applause, a music bed for answering, and 42 buzzer sounds. Sources are listed in `sounds/CREDITS.md`.

**Your own sound pack.** A `soundpack/` folder — `general/` with a file for each moment (names below), `buzzers/<pack>/`, `Themes/<name>/`, and optionally `bingo-calls.json` at the top — takes priority over the shipped sounds; its buzzer packs are listed first, and packs with "Offensive" in the name are skipped. `soundpack/` is never committed to git, so copy it onto each laptop, then restart BeerMat.

**Sound theme** (Settings → Sounds & bingo calls) picks one of the pack's themes (`soundpack/Themes/<name>/`). A theme replaces the moments it has a sound for; the others keep the standard sounds. Choose **Random theme for each question** to give every question a theme (or the standard sounds) at random — each question keeps its pick — or **Theme by question type** to set one per format (keypad formats, typed answers and speed rounds start on different themes; change any of them in the table that appears). A sound you pick for a single moment on the desk applies whichever theme is playing. Changing theme mode resets those picks; added buzzer sounds stay. Themes can bring sounds too: **Halloween**, from the theme library (pipe organ, church bells, a music box while teams answer, a theremin for wrong answers, a timpani roll before reveals); pair it with the Halloween look. Halloween is seasonal, so random and by-type choices never pick it, and neither the theme nor the look ever turns up by chance.

**Settings → Sounds & bingo calls** changes the defaults for this quiz laptop. Sound effects play on the TV page (click its 🔊 Enable sound button once each night); without a file, BeerMat uses its built-in beeps or stays quiet.

- **Sound effects:** import a folder and files are matched to moments by name (`start_round`, `question_start`, `question_music`, a countdown such as `new_game_end_timer`, `time_up`, `end_round`, `correct`, `incorrect`, `drum_roll`, `bingo_number`, `bingo_call`, `your_applause`; the full list is in `web/soundnames.js`). Moments: round starts, question opens, music while answering (loops; not during audio, clips, buzzer or bingo rounds), final countdown (a count from ten, started so it hits zero exactly at time's up and rings out after; the music stops when it starts), time's up (when no countdown played, and for the TV countdown), round ends (Auto leaderboard), correct / wrong buzzer answer, answer reveal, bingo number called, bingo claimed, and winner. Bingo calls that name a colour ("red number 5") colour that number's ball, its square on the TV board and on phone tickets; a number whose call names none takes its neighbour's colour. The wheel needs no file: it clicks as each segment passes the pointer, slowing down with the wheel. You can also pick a file for any moment, play it on the desk, or remove it.
- **Buzzer sounds:** add a folder or files (e.g. `soundpack/buzzers/<pack>`); each becomes a choice in the teams' phone menu after the 8 built-in sounds (up to 200). Removing them puts teams back on a built-in sound.
- **Bingo calls:** import a JSON file (`{"1": "Kelly's eye, number 1", …}`) or one call per line for 1–90; numbers without a call use the built-in calls. **Use the built-in calls** switches back.

Files are copied into BeerMat's media folder on the laptop. Only use sound files you have the right to use.

### A spoken bingo caller

When a number is called, the TV plays its chime and then a voice reading the call ("Two little ducks, number 22"). BeerMat ships recordings of its own calls in `sounds/bingo_voice/`. A `soundpack/bingo-calls.json` gets its own recordings, made on the laptop with [Piper](https://pypi.org/project/piper-tts/), a free offline text-to-speech voice:

```sh
python3 -m venv ~/.local/opt/piper && ~/.local/opt/piper/bin/pip install piper-tts
mkdir -p ~/.local/share/piper && cd ~/.local/share/piper
for f in en_GB-cori-high.onnx en_GB-cori-high.onnx.json; do curl -LO "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/cori/high/$f"; done
cd - && node scripts/bingo-voice.mjs   # about 30 seconds; writes soundpack/bingo_voice/1.mp3 … 90.mp3
```

`./scripts/setup.sh` does the last step for you once Piper is installed. Run `node scripts/bingo-voice.mjs` again after changing the calls file, then restart BeerMat; rebuilding the sound pack keeps the recordings. The caller only speaks the calls it was recorded for: calls typed on the desk have no voice. **Bingo caller voice** in Settings → Quiz room switches it off and on (the chime still plays); nothing is spoken while **Bingo phrases** is off either.

## Spotify (optional, private quizzes only)

Music bingo and sound clips can play songs from Spotify instead of uploaded files. **Use this only for private quizzes**: Spotify's terms cover personal listening, so playing it to a pub audience breaks them, and a pub also needs its own music licence. For pub nights, upload audio files.

It needs Spotify Premium and internet on the laptop (run the hotspot with `--keep-wifi`, or use a cable). Phones never touch Spotify. If the laptop goes offline mid-round, the music stops; the round itself carries on.

1. Create an app at developer.spotify.com/dashboard (tick *Web API*) and add the Redirect URI shown under **Settings → Spotify** (`http://127.0.0.1:3000/spotify/callback`; Spotify requires the 127.0.0.1 form).
2. Paste its Client ID and press **Connect Spotify**, then sign in in the tab that opens.
3. On quiz night, press **🎵 Start Spotify player on this desk** (Settings → Spotify, or the same button that appears on Tonight when a Spotify round is live). The desk becomes a Spotify player called “BeerMat desk” and plays through the laptop's speakers or HDMI. Keep the desk open. In the desktop app it plays through the TV's sound output, like the TV's own sounds (desk → **Screens → TV sound**). It works in the BeerMat desktop app (once it has been online once, to fetch Widevine) and in Chrome, Firefox or Edge; plain Chromium builds may refuse.
4. Fallback: open the Spotify app on the laptop, play any song once, and pick it under **Play on**.

If you connected Spotify before the desk player existed, press **Connect Spotify** again: the desk player needs an extra permission. Spotify's player script is only downloaded when you press Start, and only by the desk page; phones and the TV never load anything from the internet.

- **Music bingo:** paste playlist or track links and press **Add songs from Spotify**; titles become `Song — Artist | spotify:track:…` lines. **Play next song** starts the song on the laptop's Spotify at **Start Spotify songs at** seconds (e.g. the chorus). A song can have its own start and play time: add them after its link, `Song — Artist | spotify:track:… | 45 | 20` (start 45 s in, play 20 s). Song links copied from Spotify (`https://open.spotify.com/track/…`) work too. Quiz files can carry the same per song as `start` and `seconds`; `docs/QUIZ-MAKER-PROMPT.md` is a ready prompt for an AI that writes quiz files. If Spotify can't play (no player, offline), the number still counts and the desk says why.
- **Sound clips:** upload clips or add Spotify tracks with a start time each; each plays for the clip length set (**Each clip plays for**), or to its end if that comes first, then the next starts. **Play all clips** plays them in order; a clip's own button plays just that one again.
- **Previewing while building:** **▶ Preview** under an audio question's Spotify link, **▶** beside each Spotify clip, and **▶ Preview the song the cursor is on** under the music bingo songs play the track from its start point for its play time, on the chosen Spotify player (uploaded songs play on the desk). **■ Stop** ends it early. Teams and the TV never hear or see a preview.
- Playlists made by Spotify itself (editorial and algorithmic ones) can't be read by personal apps; copy their songs into a playlist of your own first.
- Sign-in tokens stay in the quiz database on the laptop and are never exported. **Disconnect** removes them.

## Venue Wi-Fi instead of the quiz Wi-Fi

When the venue has Wi-Fi that phones already use, players can join on it instead (no quiz Wi-Fi needed):

1. Connect the laptop to the venue's Wi-Fi (or a network cable to the same router).
2. On the desk, **How players join → On the venue's own Wi-Fi or network**. Pick this laptop's address, type the
   venue's Wi-Fi name and press **Use for joining**. The TV's join screen then shows a QR code that opens the quiz,
   with the address underneath.
3. **Check the connection**: it tests that BeerMat answers on that address and warns about this laptop's firewall
   (Windows asks to allow BeerMat the first time: tick *Private networks*; a network set to *Public* blocks phones).
4. If phones still can't open it, the venue's Wi-Fi probably keeps devices apart (guest Wi-Fi often does). Ask for
   the staff network, or use the quiz Wi-Fi.

**Windows quiz Wi-Fi**: Windows' Mobile Hotspot always has a password, so type one (8–63 characters) beside the Wi-Fi
name. The TV shows a Wi-Fi code with the password and a second code that opens the quiz. Windows only starts it while
the laptop is connected to some network. Starting it asks for administrator approval once: BeerMat uses it to keep
players off the internet (the laptop keeps its own). The quiz Wi-Fi panel then shows whether that is on and, once
phones have joined, whether they really can't get out. See [DESKTOP.md](DESKTOP.md).

## Online quizzes

In online mode players join over the internet instead of the quiz Wi-Fi: in the room on their own mobile data or the venue's Wi-Fi, or from home.

1. Install cloudflared once: `sudo pacman -S cloudflared` (`./scripts/setup.sh --install` includes it).
2. Start BeerMat from the app icon. In **Quiz night**, press **Go online**. After a few seconds you get a link like `https://some-random-words.trycloudflare.com`; **Copy link** to share it. The TV's join screen shows it too, with a QR code.
3. In person, show the TV page (**TV screen ↗**) on the room's screen as usual; its sound plays through that computer or the TV, as on the quiz Wi-Fi. Remote players either watch it shared with sound over a video call, or open the link + `/display` themselves and click **🔊 Enable sound**. Spotify music plays on the desk device or the Spotify app, so remote players only hear it through a shared call.
4. Run the quiz as usual. Questions reach phones within about a tenth of a second, usually sooner than a shared screen, so remote players read them on their phones and use the shared screen for pictures, sound and the leaderboard.
5. **Go offline** (or **Close BeerMat**) ends it. Going online again makes a new link.

The link reaches the players' page and the TV. The desk joins them only while **Desk on the online link** is on (off by default): then `<link>/host` runs the quiz from anywhere with the quizmaster key, so use a long, private one. Wrong keys are limited to 10 a minute per visitor and 30 a minute through the link altogether. From another device the quiz Wi-Fi can't be changed (its password prompt opens on the laptop); online quizzes don't need it. Spotify sign-in is only ever on the laptop. Anyone with the link can join, so turn on the waiting room (Room options) if it may travel beyond your friends. The link uses Cloudflare's free quick tunnels, made for testing and casual use; no Cloudflare account is needed. Spotify's terms cover personal listening, so streaming its music to other people is at your own risk.

## Room options

- **Scramble keypads** puts multiple-choice, multi-tap, vote, letter and sequence buttons in a different order on each team's phone (labels keep their letters), so neighbouring tables cannot copy each other's taps. It applies from the next question.
- **Bingo phrases** shows the traditional call with each number ("22 — Two little ducks") on the TV, phones and desk.
- **Blocked team names** (Teams): common swear words are refused at registration, including spaced-out and number-swapped spellings, while names like Scunthorpe or Arsenal are allowed. Add your own words there. The desk can still rename any team.
- **Waiting screen:** until the first question, every phone shows a waiting screen where the team adds its photo and picks its buzzer sound.
- **Waiting room** (on by default): a new team's phone stays on the waiting screen until you let it in: **Let everyone in** on Tonight, or **Let in** / **Turn away** on its team card. Waiting teams are listed in the desk alerts and stay off the leaderboard and TV. Teams that joined before you switched it on are not affected.
- **Maximum teams** stops registration once that many teams (not counting disabled ones) have joined; 0 means no limit. Turning a team away or disabling it frees its place.
- **Board shows: scores / positions only** hides point totals on the TV, phones and winner screen while keeping the ranking, for suspense near the end. The desk always shows scores.
- **Secret round** (Quizzes, under the round list; usually the final round): from its first question until you end the quiz, teams don't see whether they got its questions right, **Reveal answer** shows nothing on the TV or phones, and the leaderboard is hidden everywhere but the desk. **End quiz** then shows the winner and the full scores. Buzz-in and bingo are ruled on live, so their outcomes still show in a secret round.
- **TV countdown:** set minutes, seconds and an optional label (“Hand in your answer sheets”), then **Start countdown**. It sits in the top corner of every TV view, turns red in the last 10 seconds, and shows “Time’s up!” with a beep (if sound is enabled on the TV) at zero. Pause, resume or stop it from the desk. It is separate from question timers.
- **Send Question** (Tools → The room; off by default): a question opens on the TV for you to read out, but phones see nothing and its clock doesn't start until you press **Send question** (or **S**). Nobody answers before they've heard it, and speed counts from the send. Per question, **Phones don't show the wording** keeps a give-away wording off the phones (and the TV) until the reveal.
- **Multiple choice: phones always show A–F**: six letter buttons whatever the number of options, so nobody can tell which option is the last before it's read. A letter past the last option is a wrong answer.
- **Table numbers**: teams give the table they sit at when they join; it shows beside the team on the desk (Teams can change it).
- **Team groups** (Teams: a group per team, such as a department): with **Team groups on the TV's leaderboard** on, each group's average score shows above the board.
- **Signal**: the desk shows each phone's last round trip (green under half a second, amber under two, red beyond), to spot a weak table before it complains.
- **Simple mode** (Settings): Quizzes shows only the everyday formats and options.
- **Count this venue's quizzes** (Settings, on by default): when a live quiz finishes, BeerMat Online is told "one quiz finished" (a random number, nothing else) for the counter on the BeerMat website.
- **Finish quiz & reveal leaderboard** puts the final standings on the projector, revealed with **Next** from the bottom up; then the **winner celebration**: the winning team (or tied teams) with confetti, a short fanfare if sound is enabled, and second and third place. It respects a hidden leaderboard.

## Keeping phones on the quiz Wi-Fi

A phone that sees “no internet” on the quiz Wi-Fi may quietly use mobile data instead. With **Keep phones on quiz Wi-Fi** on (the default), once a team has joined, the laptop answers that phone's “is there internet?” check with “yes”. iPhones then keep the quiz Wi-Fi as their main connection, so search engines stop loading while they play; many Android phones ask “Stay connected?”, and the join screen tells teams to say yes. Nothing on the laptop can switch a phone's mobile data off, so treat this as a strong nudge, not a lock.

If the sign-in window closes (on iPhone it gains a **Done** button), the team opens the quiz address in their normal browser and taps **Continue as <team>**: the laptop recognises the phone by its address on the quiz Wi-Fi, so no recovery code is needed.

**Leaving the quiz page:** if a phone switches to another app or tab, or is locked, while a question is open and unanswered, the desk shows “👀 Left the quiz page: Fox team (14s)”, live and in **Answers & marking**. Teams see a note that the quizmaster can see this. It is a deterrent and a prompt to look, not proof of cheating.

## Teams

- **Team photos:** teams can add a selfie from the team panel on their phone. It is cropped and shrunk on the phone before upload, stays private until you approve it under Teams (the desk shows how many are waiting), and then appears on the leaderboard, buzz call-outs and winner screen. Rejecting deletes it. Switch photos off under Settings → Quiz room.
- **Returning teams:** when a quiz finishes, every team that answered is saved with a permanent 4-digit PIN, its approved photo and its buzzer sound. They are listed under Teams → **Returning teams** (search by name). At a later quiz, read a team its PIN: on the phone they open “Played here before, or lost your team? Get it back” and type it, and they are in as themselves, photo and buzzer included, without waiting to be let in. Typing it on a second phone gets the same team. **Forget** stops the PIN and deletes the saved photo.
- **Moving to a new phone:** **Move to a new phone** on a team card shows a 4-digit code. On the new phone, open the quiz, choose “Played here before, or lost your team? Get it back” and enter it. It works once, for five minutes.
- **Notes and stats:** each team card has private notes (only on the desk) and shows how many questions the team answered, how many scored, and its fastest scoring answer.

## Languages

Phones show the quiz in the phone's own language when it is English, French or Spanish, and teams can change it in the join screen or team panel. The TV language is set on the desk (**TV language**). The desk itself stays in English, and the traditional bingo call phrases are always English.

## Looks

**TV & phone look** (Tonight → Settings → Quiz room) changes the colours of the TV and the teams' phones: Purple stage (the default), Electric blue, Sunset, Emerald casino, Retro neon or Royal gold. More looks, such as Halloween (a haunted hill at night behind the quiz: a moon rising behind a manor, bats, drifting fog, a cobweb with its spider and glowing jack-o'-lanterns; phones show the hill and moon; nothing moves when the TV asks for reduced motion), are in the **Theme library** (below). Each look is a theme folder in `themes/` (see `themes/README.md` to make your own). **Random look for each question** gives every question one of them (it keeps it until the next question); **Look by question type** sets one per format — keypad, typed, speed, buzzer/clips and bingo rounds start on different looks, and the table that appears lets you change any of them. Answer colours (A red, B blue, C green, D yellow…) stay the same in every look. The desk keeps its own colours.
Teams playing in the BeerMat app get the look too: its colours, and the theme's phone scenery behind the quiz.

**Quizzes page**: when no quiz is under way it opens on the quizzes on this laptop. **On the desk** is the quiz loaded
now: **Edit quiz** (the editor; **◀ All quizzes** comes back), **Share in the quiz library…**, **Save as file…** and
**Clear quiz**. **Create a new quiz** starts an empty one. **My quizzes** keeps a copy of every quiz this laptop has
had (in the data folder's `my-quizzes` folder, named after its title), updated whenever it's saved and kept before
another quiz takes its place, so clearing or loading never loses one; **Load** puts one back on the desk. Below it,
**From the quiz library** lists your downloads. While a quiz is under way, the page opens on the editor. When a quiz
finishes, the Live page offers to share it in the quiz library.

**Quiz library** (**Library** in the left rail → Quizzes): quizzes BeerMat and other venues shared, ready to run,
each with its description, rounds and formats (the questions stay hidden until you download it). With BeerMat Pro,
**Download and load** puts one on this desk as Load quiz file does (it asks first if a quiz is under way); it's kept in
the data folder's `quiz-library` folder. **Share yours** sends the quiz on this desk, pictures and sounds included, with
a line about it: BeerMat reads every quiz before other venues see it, and the tab shows whether yours is waiting, in
the library or turned down (and why). **Report** anything wrong with one.

**Theme library** (**Library** in the left rail → Themes; also Settings → Looks → Theme library…): themes other venues shared, each with a picture (click one to see it large) of it on the
TV, in the app and in a phone's browser. With BeerMat Pro, **Install** makes one a look on this laptop (it works
offline from then on); **Remove** takes it off again. Every theme in the library has been looked at by BeerMat first;
**Report** anything that shouldn't be there.

**My themes**: make your own by copying a theme folder (Halloween, from the theme library, is a good start: it's in My themes once installed) into the My themes folder (the
dialog opens it) and changing its files; `themes/README.md` explains each one, including `tv.json`, which sets what
BeerMat Desk's TV and the app draw. It's a look on this laptop at once (**Read them again** after editing). **Share…**
shows it on the TV and in the app, and sends those pictures with it; tick that you have the right to share everything
in it. BeerMat looks at it before it's in the library, and the dialog shows whether it's waiting, in the library, or
turned down (with the reason).

## Spin the wheel and keyboard control

**Spin the wheel** (Tonight → Settings → Quiz room) shows the wheel on the projector and spins it. In Auto the TV goes back to what it was showing once the result has been up for a few seconds; with any other view chosen, it stays on the wheel. The wheel clicks as each segment passes the pointer. Leave the entries blank to spin team names, or type your own (prizes, forfeits, categories). The result is chosen by the server before the animation starts and also shown on the desk.

Single keys work anywhere on the desk except while typing: **N** next question, **C** close/end, **P** pause or resume, **R** reveal, **1** correct, **2** wrong, **3** pass, **A** start agree countdown, **B** call a bingo number, **W** spin the wheel, **T** pause or resume the TV countdown, **S** switch the board between scores and positions. A Stream Deck, presenter remote or macro pad set to send these keys can drive the quiz.

## Comebacks, wheels, slides and questions on the fly (Tools)

- **Fast Track**: pick a team and put it **Into first place** (one point clear of the leader, shown on the TV), or let it **Spin the Fast Track wheel** (first place, a few points, or no luck). It's yours to call: announce the rule first, e.g. "if the top three all get this wrong".
- **Wheels**: the teams, **Teams, weighted** (teams lower down get more slices, up to three each), a **Random number** (up to 60 numbers), your own list (save it with a name), or a **rollover jackpot**: one jackpot slice and the rest "Roll over"; each roll over adds to the jackpot, a win puts it back to the start. Saved wheels and jackpots stay on this laptop between quizzes.
- **A question on the fly**: read out a question that isn't in the quiz (multiple choice A–F, a letter, a number or a typed answer); once answers close, type the answer and everyone is marked.
- **Slides between rounds**: pictures (adverts, food, next week's quiz) the TV plays when you choose **Slides** under TV shows, or after each round with **Play slides after each round**: 20 seconds after the round's leaderboard is fully revealed, or a minute after the round if you don't show it.

Per question (Quizzes): a picture can **start blurred** or **under twelve tiles** and show itself over the question's time; multi-tap can be **Wipeout** (any wrong tick scores nothing); bingo can call **1–3 numbers at a time** or be **speed bingo** (only numbers on a team's ticket are called); music bingo can have a **reaction table**: teams dab the song as soon as they know it, the TV shows the quickest, and the quickest on each song can score.

**How each question went** (Teams → Past quizzes → 📊): the share of teams that scored on each question and how long they took, for this quiz or a finished one.

## Live play

**Start next question** opens the first unplayed saved question in round order. A question cannot open while another is running or paused. To run a particular question, select it in **Quizzes** and use **Play saved question now**. Repeating a played question needs confirmation and creates a separate question/score entry.

Every timed question has a deadline enforced by the server. A phone timer is only a display. **Pause timer** stops accepting answers and freezes the remaining time; **Resume timer** restarts from that remainder. Pause survives a server restart. An unpaused question keeps its original deadline across a restart, so downtime counts against the timer. **Close answers** ends a question early. **Reveal answer** becomes available only after closing or expiry. It can be hidden again; this does not make it unseen by players who already read it.

Text marking normalises Unicode, surrounding/repeated whitespace and letter case, then uses exact matching against the key and alternatives. Punctuation and accents otherwise matter. Choice marking accepts only an exact option submitted by the phone. There is no reward for answering quickly unless a question has **Fastest fingers first** ticked. Then its speed bonus is whole extra points for fully correct, automatically marked answers (and the first bingo claim, or tapping the right sound clip quickly). A **sliding** bonus falls linearly from the configured maximum to zero with remaining answer time. A **fixed** bonus gives the full amount to the fastest correct answers only (1 by default; set how many), decided when answers close. When the answer is revealed, the fastest correct team fills the TV for a few seconds — team photo (or its initial), name and time — and its buzzer sound plays.

**Risk It** (per question, for formats with a correct answer set) takes the question's points off a team whose answer scores nothing. Teams that don't answer lose nothing. Buzz-in has its own wrong-answer penalty instead. Each team's clock starts when its phone received the question, so a slow phone is not penalised — but never more than 2 seconds after the question opened, so a phone that slept or looked at the projector gains nothing. Automatic points are withheld from player scores while the question remains open/paused to avoid revealing correctness during play.

A team can send one final answer per question. Sheet answers may be left blank, with a confirmation before submitting. Phone drafts save in browser storage and on the quiz laptop while connected. They are not submitted for marking until the team presses **Submit final answer**. Local drafts survive reload; server drafts allow another browser with the recovery code to resume. Reconnection never automatically submits a draft. If a submission's confirmation is lost, the next refresh checks whether the server stored it before re-enabling the button.

## Marking

Use **Answers & marking** and choose any played question. The marking key, alternatives and media appear above the team cards. Live/paused questions cannot be marked. Save the total points for a text/media/choice answer; for a sheet mark each item zero or one. Blank keyed sheet items are automatically wrong; items without a key need review. You can save marks for a team that did not submit, such as a paper answer delivered to the host. Repeated saves replace the answer's points rather than adding points. Every manual change is included in the marking log in results export.

**VAR Check:** after a reveal, a team that thinks its answer was marked wrong taps **📺 VAR Check** on its phone. The live page shows it in a gold bar with the team's answer: **Overturn** gives the question's full points, **Decision stands** leaves it. Either way the TV shows *VAR CHECK* over a drum roll, then the decision. Run the night can rule too. How many a team gets is set in **Tools → The room**: one each round (the default), one each night, no limit, or off.

For paper-round totals or general corrections, use **Teams → Paper round / score correction**. Enter positive or negative whole points and a reason. Each form submission has an idempotency key: retrying after a lost response does not add the same adjustment twice. To correct an already accepted adjustment, record a new reversing adjustment with an explanatory reason.

Scores update after question closure/expiry and after each saved mark/correction. Equal scores share rank. Hide the public leaderboard for suspense if needed; the quizmaster retains scores.

## Team recovery and disconnections

Phones keep a live connection to the laptop and update the moment anything changes; they also refresh every 5 seconds in case an update was missed. A team with no open connection and no request for 15 seconds appears disconnected. Sleeping/background phones and captive mini-browsers may trigger this too. The warning means unreachable, not proof of cheating. The quizmaster alert names the affected teams.

Players should keep their private recovery code. Switching from a captive window to a normal browser needs that code because storage may be separate. The recovery form restores the same team, answers and score. Multiple devices with the same code represent the same team: first final answer wins.

If a code is lost, use **Issue recovery code** for that team and give the new code privately to its captain. This revokes the old code immediately while preserving answers, scores and saved server drafts. Team names can be corrected by the host. Disable an abandoned/unwanted team to prevent answers and hide it from public scores; restore it without losing its history. Names remain reserved even while disabled.

## End and next event

**Finish quiz & reveal leaderboard** (Next after the last round) closes the current question and registration and puts the final standings on the TV, revealed with **Next** from the bottom up, then the winner. You can resume a finished quiz if needed.

**End quiz & start next…** (Tonight → Settings → Quiz room) is for the next quiz night:

1. The results — teams, every question played, answers, scores, adjustments and marking history — download to the desk and are also saved on the laptop in `results/` (named by date and quiz). Recovery codes are never included.
2. All teams, answers, scores, the countdown and the wheel are cleared (photos are kept only for returning teams). Phones still open from the last quiz show “A new quiz has started — pick your team name again”.
3. Choose the questions for the next quiz: keep the current ones, load a quiz file (.json), or start empty (then build it, or run `node scripts/load-test-quiz.mjs`).

Settings, join details, Spotify connection and question pictures and sounds are kept, and the TV goes back to Auto (the join screen).

## Past quizzes and player profiles

Every finished quiz's results (team names, positions, points, answers right) stay on the laptop under **Past
quizzes**, also after **End quiz & start next**; delete them there.

After you **Finish quiz**, teams see **Keep this result in your BeerMat profile** when BeerMat Online is set up (in
the BeerMat app, always). It is the player's choice; the result is signed by this laptop so it can't be
altered. For results to count towards players' statistics and badges, register this laptop with your venue on
BeerMat Online: the key is under **Past quizzes → BeerMat Online**, or use the desk's **Venue** tab, which registers
this laptop with one click once your venue is linked to your account (venues are added by BeerMat, see
docs/ONLINE.md). The Venue tab also edits your venue's page and pin on the app's map, and publishes your quiz nights. **Share results** (off by default) also sends
each finished quiz's team names, positions and points to your venue's page; tell the room if you switch it on.
Results wait on the laptop until the service can be reached. See [ONLINE.md](ONLINE.md).
