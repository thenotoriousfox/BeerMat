# Prototype audit (2026-10-19)

Audited all six files on main before implementation. Repository metadata confirmed private. No AGENTS.md was present in the upstream tree.

* Teams, answers and scores were memory-only: restart lost everything.
* Reconnection retained no identity and team name uniqueness prevented rejoining.
* Repeated team:join on one socket left stale connected teams.
* New players received no current question; reconnecting hosts did not authenticate again.
* Answers had no question ID, server deadline, empty-answer guard or schema for choices.
* No SQLite, captive DNS/DHCP, AP integration, media, sheets, import/export or tests.
* Positive: host key was required, host actions checked authentication, UI used textContent rather than HTML for user text.

Implementation retains Node and browser clients but replaces volatile socket state with SQLite and authenticated HTTP polling. Node 24 built-ins provide HTTP, SQLite, cryptography and tests without runtime npm dependencies or CDN assets. Polling also works in constrained captive portal browsers and naturally resumes after missed requests.

# Validation boundary

API integration tests run against a real loopback HTTP server and a temporary SQLite database, including restart. Network scripts are tested as plans with mocked subprocesses. This environment has no NetworkManager, dnsmasq, nftables or Wi-Fi device, so AP activation, DHCP leases, firewall interactions and Android/iOS captive detection have NOT been live-tested. No user laptop configuration was changed. Use the acceptance checklist in README before a public quiz.

# Completed application validation

The form-based quiz desk now covers saved quiz/round authoring and question order, media upload/preview, start/next, pause/resume, close/reveal, projector modes, marking history, per-item sheet marks, paper adjustments, team moderation and recovery-code rotation. The server migrates earlier SQLite databases automatically. Registration locks, finish/resume, leaderboard visibility, accepted text alternatives and optional speed bonuses are persistent.

Validated locally:

- 10 Node integration tests, including saved-library revision conflicts, guarded question transitions, pause/restart, withheld live scores/keys, explicit reveal, sheet drafts and marks, recovery revocation, moderation, idempotent adjustments, marking absent answers, media signature checks/range requests and legacy-database migration.
- Four Python hotspot-plan tests, plus shell/JavaScript syntax and whitespace checks.
- A real Chromium 153 browser rehearsal, using desktop quizmaster/projector windows and a mobile-sized touch player context: authored all five formats through forms, uploaded/decoded a picture, uploaded/played WAV audio, joined through an OS probe URL, restored a draft on reload, simulated lost network/reconnection, paused/resumed, submitted text/choice/sheet answers, changed sheet marks, rotated/recovered team credentials, recorded a paper score, finished the quiz and restarted the server. Printable sheet content was checked with the native print call intercepted. No browser JavaScript errors or external page requests were observed.

`npm run test:browser` reproduces the browser suite with a locally installed Playwright browser. The test harness also accepts `PUBQUIZ_PLAYWRIGHT` (module path) and `PUBQUIZ_BROWSER` (Chromium executable path) for restricted development runners; these are not runtime requirements.

Real Android/iOS captive windows, Wi-Fi hardware, AP setup, OS firewall interactions, physical audio output and actual paper printing still require the laptop/device acceptance check. These are distinct from the completed application-code tests. GitHub Actions runs the Node and Python suites on every push and pull request (`.github/workflows/test.yml`); the browser suite is run locally.

# SpeedQuizzing parity iteration (2026-10-19)

Compared against SpeedQuizzing Pro 5.4.11's published game rules and quiz-file formats (interoperability only; no code or media was copied). Added:

- Formats: letters, numbers, sequence, nearest wins (sliding scale, earliest wins ties), vote, buzz-in classic (queue, pass-on, lockout of the next buzz-in question) and advanced (announced answer, agree countdown, wrong/pass penalties, agreement points). Optional media on any non-sheet format. Reveal shows a full-answer note, scorer count and answer tallies.
- Live push over server-sent events for phones, projector and desk (polling every 1.5 s removed; 5 s fallback refresh remains).
- Fair speed bonus: per-team clock starts at delivery, capped at a 2 s grace period.
- Import of SpeedQuizzing `.sqb`/`.sqq`/`.sqn` rounds and Quick Question files/folders; verified against every sample file shipped with SpeedQuizzing 5.4.11 (all questions convert and validate).
- Review fixes: host sessions persisted (hashed) across restarts; `ALLOWED_ADDRESSES` / `start.sh --hotspot` restrict the server to the quiz Wi-Fi; hotspot teardown continues past a failed step; login attempts and expired sessions are pruned; server close is idempotent.

Validated at that point: 19 Node tests (integration plus importer), 5 Python hotspot tests, and the browser suite in Chrome with two phone contexts (no JavaScript errors, no external requests).

Second batch: multi-tap, pinpoint with go wide, 90-ball bingo with seeded per-team tickets and server-checked claims, spin-the-wheel on the projector, per-team buzzer sounds (synthesised, no audio files), and single-key desk shortcuts usable from a Stream Deck. Validated with 22 Node tests and 14 browser sections in Chrome.

Not covered compared with SpeedQuizzing: music bingo (needs a song library), Seven Squares and Word Snake puzzles, team photos, the native Stream Deck plugin (keys work instead), and internet play through a relay server (PubQuiz is offline by design).

TV display iteration: projector join screen with an offline QR encoder (`qr.js`, byte mode, level M, versions 1–10; every version decoded with zbar, including from a 1080p screenshot of the page), editable Wi-Fi name and join address, a join reminder under the leaderboard, a full-screen toggle (button or F) and an idle pointer hide. 25 Node tests and 15 browser sections pass.

Quick-wins iteration: per-team scrambled keypads, a team-name filter (`names.js`, word-start matching with letter-swap and spacing normalisation, host-extendable), traditional bingo call phrases, and a winner celebration view shown on finish. 27 Node tests and 15 browser sections pass.

Gap-closing iteration: team photos with host approval, Sound Clips, music bingo, word snake, Seven Squares-style tiles (Seven Squares' own rules are not in the SpeedQuizzing installer, so this follows the tile-assembly idea), 4-digit phone transfer codes, private team notes and per-team stats, animated reveals and leaderboard moves, `.sqt`/`.sqw` import, and French/Spanish for phones and the TV (`i18n.js`, with a test that every on-screen string has both translations). 36 Node tests and 21 browser sections pass (repeated runs stable).

Still not covered: SpeedQuizzing's paid quiz-pack library and online reporting (services, not software), the native Stream Deck plugin (desk keys instead), dedicated router hardware, and internet play (offline by design).

Joining iteration: the first real hotspot run found `hotspot.py` querying the wrong nmcli field (fixed, with a test of the whole `--apply` path). Changes after that run: a single Wi-Fi QR code on the TV; “online” answers to phone connectivity checks after a team joins (Android, Apple, Windows, Firefox probe paths) with **Continue as <team>** for the same phone in a normal browser; leave-the-page reports during open questions; and `hotspot.py --keep-wifi`. 37 Node tests, 10 Python tests and 22 browser sections pass. Phone behaviour with the “online” answers has not yet been checked on real Android and iOS devices.

Running SpeedQuizzing itself (its unmodified app on native Linux Electron 12.2.3) showed host options the file formats did not: Evil Mode, fixed or sliding speed bonus, a waiting room, a maximum player count, a TV countdown timer and a scores/positions toggle for the live screen. Hosting there needs a SpeedQuizzing account, so only the setup screens were seen. All six are now in PubQuiz (`tests/hosting.test.js` plus a browser section). The browser suite's wheel step raced the preceding close shortcut (every desk action briefly disables the buttons); the test now waits for it. A real desk bug also showed up as an intermittent browser failure: queued desk actions read their form value when they ran, not when clicked, so a refresh landing in between could send the old value (picking Spanish for the TV sent English). Handlers now read values at click time.

Hotspot hardware findings: on Intel AX200-class cards a NetworkManager AP on a second virtual interface fails ("wpa_supplicant couldn't grab this interface … Device or resource busy"), reproduced on a second CachyOS machine. `--keep-wifi` now creates `pq0` as an AP-type interface outside NetworkManager and runs `wpa_supplicant` in AP mode; verified on real hardware there (broadcasting on channel 6, 10.42.0.1, DNS and DHCP listening, firewall table, clean teardown). Hosting while also connected to a 2.4 GHz network still needs checking on the quiz laptop.
