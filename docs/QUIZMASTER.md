# Running a quiz

## Before the room fills

1. Run `./scripts/start.sh` and open `http://localhost:3000/host`. Unlock with the host key.
2. In **Build quiz**, set a quiz title and add rounds. Add and save questions with the form. Move questions up/down to set their order.
3. Pick a format (see **Round formats** below). Upload images/audio directly in the form; any format except answer sheets can carry an optional picture or clip. Files stay on the laptop. Each upload has a unique filename, so replacing a picture cannot change a question already played.
4. Add the correct answer and accepted alternatives, or leave it blank for manual marking. Choices must match one of the supplied options exactly. Each sheet item is worth one point and can have its own marking key. For a traditional paper round, print blank sheets and enter its score later.
5. To reuse SpeedQuizzing material, use **Import SpeedQuizzing files** for `.sqb`, `.sqq`, `.sqn`, `.sqt` (multi-tap) and `.sqw` (word snake) rounds or Quick Question files, or **Import a Quick Questions folder**. Each file or folder becomes a new round; nothing existing is replaced. Pictures referenced inside SpeedQuizzing round files are not embedded in them, so the import lists those questions for you to add the picture by hand. Quick Question picture and sound files are uploaded automatically.
6. Use **Download quiz JSON** to keep an editable question-bank copy. A quiz import replaces the saved question bank but keeps played history and scores. Media files must still be present locally when importing media questions; JSON does not embed media.
7. In **Run quiz**, name the event, choose the projector view and open `/display` on the TV or projector. The projector can show how to join, scores, the current question/media, the wheel, or a blank screen.
   - **TV over HDMI (most reliable):** extend the desktop to the TV, open `http://localhost:3000/display` there and press **⛶ Full screen** (or **F**). The pointer and screen buttons hide after 3 seconds without movement.
   - **Smart TV or streaming-stick browser:** join the quiz Wi-Fi and open `http://10.42.0.1:3000/display`. Casting a browser tab needs internet, so it will not work on the offline hotspot.
   - **How to join** shows two QR codes: one joins the quiz Wi-Fi, the other opens the quiz page. Set the Wi-Fi name and address under **Save join details** (the Wi-Fi name must match the hotspot's `--ssid`). While registration is open, the leaderboard also shows a one-line join reminder.
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
| Nearest wins | Number box | Closest scores; set how many places score on a sliding scale (e.g. 3 places of 9 points → 9, 6, 3). Ties go to the earlier answer |
| Buzz-in classic | Big BUZZ button | First buzzer answers out loud. ✓ scores the points; ✗ applies the wrong-answer penalty, passes to the next buzzer in the queue, and that team sits out the next buzz-in question |
| Buzz-in advanced | BUZZ, then an “I agree” button | First buzzer answers. Type what they said and press **Start agree countdown**; other teams tap if they agree. ✓/✗ then scores the buzzer (points or penalty) and gives agreement points to everyone who agreed with a right answer or didn’t agree with a wrong one. **Pass** applies the pass penalty and moves to the next buzzer |
| Pinpoint | The picture, to tap | Upload a picture and click it in the builder to place the target circle (size slider). A first tap inside scores the points. With **go wide**, a second tap scores the go-wide points if the first missed |
| Bingo | Their own 90-ball ticket (3 rows × 9 columns, 15 numbers) | Press **Call next number** (or key **B**); teams dab their own tickets and press **BINGO!**. Claims are checked against the numbers called for one line, two lines or full house. The first valid claim gets the points plus the bonus; any other valid claim on the same number gets the points. Calling stops once someone has won |
| Word snake | A 4×4 or 5×5 letter grid | The answer runs through touching squares (diagonals too); teams trace it. Tapping a letter that does not touch restarts the trace. A fresh grid is made every time the question plays. With **go wide**, a team can remove the decoy letters but scores the go-wide points instead |
| Seven Squares-style tiles | Up to seven letter tiles and the word pattern (e.g. `___ ____ ____`) | The answer is cut into tiles, shuffled differently on every phone; teams tap them in order |
| Sound clips | A big **THIS ONE!** button | Upload several clips and pick the right one. **Play clips** on the desk plays them in order through the laptop; a team's single tap scores if it lands during the right clip, with a bonus that fades over its first five seconds. Phones only see “Clip 3 of 8” |
| Music bingo | A ticket of 15 song titles | Type 15–300 titles (or upload song files; each file name becomes its title). **Play next song** picks one at random and plays its file on the desk, or you play it from your own music player. The TV shows “Song 7” and reveals each title once the next song starts (or straight away, if you tick that). Claims are checked against the songs played |
| Vote | Lettered buttons | No right answer; the reveal shows the tally |
| Typed / picture / audio | Text box | Text matching as before, with alternatives |
| Answer sheet | Several text boxes | One point per item |

Buzz-in and bingo stay live until you end them: for buzz-in the timer only limits buzzing. Teams can choose their buzzer sound under their recovery-code panel. The projector names the team that buzzed first and, after **Enable buzzer sound** is clicked once, plays a short tone for it (the desk plays it too). After a question closes, **Reveal answer** shows the answer, the full-answer note, how many teams scored and, for choice, letters, numbers and votes, a tally of what teams picked.

## Room options

- **Scramble keypads** puts multiple-choice, multi-tap, vote, letter and sequence buttons in a different order on each team's phone (labels keep their letters), so neighbouring tables cannot copy each other's taps. It applies from the next question.
- **Bingo phrases** shows the traditional call with each number ("22 — Two little ducks") on the TV, phones and desk.
- **Blocked team names** (Teams & results): common swear words are refused at registration, including spaced-out and number-swapped spellings, while names like Scunthorpe or Arsenal are allowed. Add your own words there. The desk can still rename any team.
- **Finish quiz** switches the projector to the **winner celebration**: the winning team (or tied teams) with confetti, a short fanfare if sound is enabled, and second and third place. It respects a hidden leaderboard.

## Teams

- **Team photos:** teams can add a selfie from the team panel on their phone. It is cropped and shrunk on the phone before upload, stays private until you approve it under Teams & results (the desk shows how many are waiting), and then appears on the leaderboard, buzz call-outs and winner screen. Rejecting deletes it. Switch photos off under Room controls.
- **Moving to a new phone:** **Move to a new phone** on a team card shows a 4-digit code. On the new phone, open the quiz, choose “Already registered?” and enter it. It works once, for five minutes.
- **Notes and stats:** each team card has private notes (only on the desk) and shows how many questions the team answered, how many scored, and its fastest scoring answer.

## Languages

Phones show the quiz in the phone's own language when it is English, French or Spanish, and teams can change it in the join screen or team panel. The TV language is set on the desk (**TV language**). The desk itself stays in English, and the traditional bingo call phrases are always English.

## Spin the wheel and keyboard control

**Spin the wheel** (Run quiz → Room controls) switches the projector to the wheel and spins it. Leave the entries blank to spin team names, or type your own (prizes, forfeits, categories). The result is chosen by the server before the animation starts and also shown on the desk.

Single keys work anywhere on the desk except while typing: **N** next question, **C** close/end, **P** pause or resume, **R** reveal, **1** correct, **2** wrong, **3** pass, **A** start agree countdown, **B** call a bingo number, **W** spin the wheel. A Stream Deck, presenter remote or macro pad set to send these keys can drive the quiz.

## Live play

**Start next question** opens the first unplayed saved question in round order. A question cannot open while another is running or paused. To run a particular question, select it in **Build quiz** and use **Play saved question now**. Repeating a played question needs confirmation and creates a separate question/score entry.

Every timed question has a deadline enforced by the server. A phone timer is only a display. **Pause timer** stops accepting answers and freezes the remaining time; **Resume timer** restarts from that remainder. Pause survives a server restart. An unpaused question keeps its original deadline across a restart, so downtime counts against the timer. **Close answers** ends a question early. **Reveal answer** becomes available only after closing or expiry. It can be hidden again; this does not make it unseen by players who already read it.

Text marking normalises Unicode, surrounding/repeated whitespace and letter case, then uses exact matching against the key and alternatives. Punctuation and accents otherwise matter. Choice marking accepts only an exact option submitted by the phone. Optional speed bonuses are whole extra points, falling linearly from the configured maximum to zero with remaining answer time; they apply only to automatically correct keypad, sequence and typed answers. Each team's clock starts when its phone received the question, so a slow phone is not penalised — but never more than 2 seconds after the question opened, so a phone that slept or looked at the projector gains nothing. Automatic points are withheld from player scores while the question remains open/paused to avoid revealing correctness during play.

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

**Finish quiz** closes the current question and registration, and marks the leaderboard as final. Download results to retain teams, played questions, answers, current scores, adjustments and all manual marking changes. Recovery secrets are excluded. You can resume a finished quiz and explicitly reopen registration if required.

For a separate event, stop the server and start it with a different `QUIZ_DB` filename. This preserves the old event intact and gives the new event an empty team list. Import the question-bank JSON and retain the same media folder. To back up a full event, stop the server and copy its SQLite database plus media directory. Results JSON is an archive, not a database restore format.

Host logins expire after 12 hours and survive a server restart. **Lock desk** revokes the current login; teams continue playing. Keep the host key and team recovery codes private. Open HTTP quiz Wi-Fi is not encrypted: use a dedicated trusted local network and do not reuse important passwords.
