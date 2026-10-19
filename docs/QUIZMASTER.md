# Running a quiz

## Before the room fills

1. Run `./scripts/start.sh` and open `http://localhost:3000/host`. Unlock with the host key.
2. In **Build quiz**, set a quiz title and add rounds. Add and save questions with the form. Move questions up/down to set their order.
3. Select text, choice, picture, audio or answer sheet. Upload images/audio directly in the form. Files stay on the laptop. Each upload has a unique filename, so replacing a picture cannot change a question already played.
4. Add the correct answer and accepted alternatives, or leave it blank for manual marking. Choices must match one of the supplied options exactly. Each sheet item is worth one point and can have its own marking key. For a traditional paper round, print blank sheets and enter its score later.
5. Use **Download quiz JSON** to keep an editable question-bank copy. A quiz import replaces the saved question bank but keeps played history and scores. Media files must still be present locally when importing media questions; JSON does not embed media.
6. In **Run quiz**, name the event, choose the projector view and open `/display` on the laptop's second screen. The projector can show scores, the current question/media, or a blank screen.
7. Start the approved hotspot setup separately. Phones need only the quiz Wi-Fi and their browser. If the captive login window does not open, enter `http://10.42.0.1` manually. In direct LAN testing use the laptop IP and port 3000.

Questions and rounds are saved to SQLite immediately after **Save**. If another quizmaster window saves first, your stale save is refused: download/copy your changes, then reload the saved quiz. Unsaved edits trigger a warning when leaving the page. Keep the laptop clock steady during a quiz.

## Live play

**Start next question** opens the first unplayed saved question in round order. A question cannot open while another is running or paused. To run a particular question, select it in **Build quiz** and use **Play saved question now**. Repeating a played question needs confirmation and creates a separate question/score entry.

Every timed question has a deadline enforced by the server. A phone timer is only a display. **Pause timer** stops accepting answers and freezes the remaining time; **Resume timer** restarts from that remainder. Pause survives a server restart. An unpaused question keeps its original deadline across a restart, so downtime counts against the timer. **Close answers** ends a question early. **Reveal answer** becomes available only after closing or expiry. It can be hidden again; this does not make it unseen by players who already read it.

Text marking normalises Unicode, surrounding/repeated whitespace and letter case, then uses exact matching against the key and alternatives. Punctuation and accents otherwise matter. Choice marking accepts only an exact option submitted by the phone. Optional speed bonuses are whole extra points, falling linearly from the configured maximum to zero with remaining answer time; they apply only to automatically correct non-sheet answers. Automatic points are withheld from player scores while the question remains open/paused to avoid revealing correctness during play.

A team can send one final answer per question. Sheet answers may be left blank, with a confirmation before submitting. Phone drafts save in browser storage and on the quiz laptop while connected. They are not submitted for marking until the team presses **Submit final answer**. Local drafts survive reload; server drafts allow another browser with the recovery code to resume. Reconnection never automatically submits a draft. If a submission's confirmation is lost, the next poll checks whether the server stored it before re-enabling the button.

## Marking

Use **Mark answers** and choose any played question. The marking key, alternatives and media appear above the team cards. Live/paused questions cannot be marked. Save the total points for a text/media/choice answer; for a sheet mark each item zero or one. Blank keyed sheet items are automatically wrong; items without a key need review. You can save marks for a team that did not submit, such as a paper answer delivered to the host. Repeated saves replace the answer's points rather than adding points. Every manual change is included in the marking log in results export.

For paper-round totals or general corrections, use **Teams & results → Paper round / score correction**. Enter positive or negative whole points and a reason. Each form submission has an idempotency key: retrying after a lost response does not add the same adjustment twice. To correct an already accepted adjustment, record a new reversing adjustment with an explanatory reason.

Scores update after question closure/expiry and after each saved mark/correction. Equal scores share rank. Hide the public leaderboard for suspense if needed; the quizmaster retains scores.

## Team recovery and disconnections

Phones poll the laptop every 1.5 seconds. A team with no authenticated request for 15 seconds appears disconnected. Sleeping/background phones and captive mini-browsers may trigger this too. The warning means unreachable, not proof of cheating. The quizmaster alert names the affected teams.

Players should keep their private recovery code. Switching from a captive window to a normal browser needs that code because storage may be separate. The recovery form restores the same team, answers and score. Multiple devices with the same code represent the same team: first final answer wins.

If a code is lost, use **Issue recovery code** for that team and give the new code privately to its captain. This revokes the old code immediately while preserving answers, scores and saved server drafts. Team names can be corrected by the host. Disable an abandoned/unwanted team to prevent answers and hide it from public scores; restore it without losing its history. Names remain reserved even while disabled.

## End and next event

**Finish quiz** closes the current question and registration, and marks the leaderboard as final. Download results to retain teams, played questions, answers, current scores, adjustments and all manual marking changes. Recovery secrets are excluded. You can resume a finished quiz and explicitly reopen registration if required.

For a separate event, stop the server and start it with a different `QUIZ_DB` filename. This preserves the old event intact and gives the new event an empty team list. Import the question-bank JSON and retain the same media folder. To back up a full event, stop the server and copy its SQLite database plus media directory. Results JSON is an archive, not a database restore format.

Host logins expire after 12 hours and do not survive server restart. **Lock desk** revokes the current login; teams continue playing. Keep the host key and team recovery codes private. Open HTTP quiz Wi-Fi is not encrypted: use a dedicated trusted local network and do not reuse important passwords.
