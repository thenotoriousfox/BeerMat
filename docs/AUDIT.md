# Prototype audit (2026-10-19)

Audited all six files on main before implementation. Repository metadata confirmed private. No AGENTS.md was present in the upstream tree.

* Teams, answers and scores were memory-only: restart lost everything.
* Reconnection retained no identity and team name uniqueness prevented rejoining.
* Repeated team:join on one socket left stale connected teams.
* New players received no current question; reconnecting hosts did not authenticate again.
* Answers had no question ID, server deadline, empty-answer guard or schema for choices.
* No SQLite, captive DNS/DHCP, AP integration, media, sheets, import/export or tests.
* Positive: host key was required, host actions checked authentication, UI used textContent rather than HTML for user text.

Implementation retains Node and browser clients but replaces volatile socket state with SQLite and authenticated HTTP polling. Node 22.13+ built-ins provide HTTP, SQLite, cryptography and tests without runtime npm dependencies or CDN assets. Polling also works in constrained captive portal browsers and naturally resumes after missed requests.

# Validation boundary

API integration tests run against a real loopback HTTP server and a temporary SQLite database, including restart. Network scripts are tested as plans with mocked subprocesses. This environment has no NetworkManager, dnsmasq, nftables or Wi-Fi device, so AP activation, DHCP leases, firewall interactions and Android/iOS captive detection have NOT been live-tested. No user laptop configuration was changed. Use the acceptance checklist in README before a public quiz.

# Completed application validation

The form-based quiz desk now covers saved quiz/round authoring and question order, media upload/preview, start/next, pause/resume, close/reveal, projector modes, marking history, per-item sheet marks, paper adjustments, team moderation and recovery-code rotation. The server migrates earlier SQLite databases automatically. Registration locks, finish/resume, leaderboard visibility, accepted text alternatives and optional speed bonuses are persistent.

Validated locally:

- 10 Node integration tests, including saved-library revision conflicts, guarded question transitions, pause/restart, withheld live scores/keys, explicit reveal, sheet drafts and marks, recovery revocation, moderation, idempotent adjustments, marking absent answers, media signature checks/range requests and legacy-database migration.
- Four Python hotspot-plan tests, plus shell/JavaScript syntax and whitespace checks.
- A real Chromium 153 browser rehearsal, using desktop quizmaster/projector windows and a mobile-sized touch player context: authored all five formats through forms, uploaded/decoded a picture, uploaded/played WAV audio, joined through an OS probe URL, restored a draft on reload, simulated lost network/reconnection, paused/resumed, submitted text/choice/sheet answers, changed sheet marks, rotated/recovered team credentials, recorded a paper score, finished the quiz and restarted the server. Printable sheet content was checked with the native print call intercepted. No browser JavaScript errors or external page requests were observed.

`npm run test:browser` reproduces the browser suite with a locally installed Playwright browser. The test harness also accepts `BEERMAT_PLAYWRIGHT` (module path) and `BEERMAT_BROWSER` (Chromium executable path) for restricted development runners; these are not runtime requirements.

Real Android/iOS captive windows, Wi-Fi hardware, AP setup, OS firewall interactions, physical audio output and actual paper printing still require the laptop/device acceptance check. These are distinct from the completed application-code tests. GitHub Actions runs the Node and Python suites on every push and pull request (`.github/workflows/test.yml`); the browser suite is run locally.

# Formats iteration (2026-10-19)

Added:

- Formats: letters, numbers, sequence, nearest wins (sliding scale, earliest wins ties), vote, buzz-in classic (queue, pass-on, lockout of the next buzz-in question) and advanced (announced answer, agree countdown, wrong/pass penalties, agreement points). Optional media on any non-sheet format. Reveal shows a full-answer note, scorer count and answer tallies.
- Live push over server-sent events for phones, projector and desk (polling every 1.5 s removed; 5 s fallback refresh remains).
- Fair speed bonus: per-team clock starts at delivery, capped at a 2 s grace period.
- Review fixes: host sessions persisted (hashed) across restarts; `ALLOWED_ADDRESSES` / `start.sh --hotspot` restrict the server to the quiz Wi-Fi; hotspot teardown continues past a failed step; login attempts and expired sessions are pruned; server close is idempotent.

Validated at that point: 19 Node tests, 5 Python hotspot tests, and the browser suite in Chrome with two phone contexts (no JavaScript errors, no external requests).

Second batch: multi-tap, pinpoint with go wide, 90-ball bingo with seeded per-team tickets and server-checked claims, spin-the-wheel on the projector, per-team buzzer sounds (synthesised, no audio files), and single-key desk shortcuts usable from a Stream Deck. Validated with 22 Node tests and 14 browser sections in Chrome.

Not covered yet: music bingo (needs a song library), Seven Squares and Word Snake puzzles, team photos, the native Stream Deck plugin (keys work instead), and internet play through a relay server (BeerMat is offline by design).

TV display iteration: projector join screen with an offline QR encoder (`qr.js`, byte mode, level M, versions 1–10; every version decoded with zbar, including from a 1080p screenshot of the page), editable Wi-Fi name and join address, a join reminder under the leaderboard, a full-screen toggle (button or F) and an idle pointer hide. 25 Node tests and 15 browser sections pass.

Quick-wins iteration: per-team scrambled keypads, a team-name filter (`names.js`, word-start matching with letter-swap and spacing normalisation, host-extendable), traditional bingo call phrases, and a winner celebration view shown on finish. 27 Node tests and 15 browser sections pass.

Gap-closing iteration: team photos with host approval, Sound Clips, music bingo, word snake, Seven Squares-style tiles, 4-digit phone transfer codes, private team notes and per-team stats, animated reveals and leaderboard moves, and French/Spanish for phones and the TV (`i18n.js`, with a test that every on-screen string has both translations). 36 Node tests and 21 browser sections pass (repeated runs stable).

Still not covered: a paid quiz-pack library and online reporting (services, not software), the native Stream Deck plugin (desk keys instead), dedicated router hardware, and internet play (offline by design).

Joining iteration: the first real hotspot run found `hotspot.py` querying the wrong nmcli field (fixed, with a test of the whole `--apply` path). Changes after that run: a single Wi-Fi QR code on the TV; “online” answers to phone connectivity checks after a team joins (Android, Apple, Windows, Firefox probe paths) with **Continue as <team>** for the same phone in a normal browser; leave-the-page reports during open questions; and `hotspot.py --keep-wifi`. 37 Node tests, 10 Python tests and 22 browser sections pass. Phone behaviour with the “online” answers has not yet been checked on real Android and iOS devices.

Host options added: Evil Mode, fixed or sliding speed bonus, a waiting room, a maximum player count, a TV countdown timer and a scores/positions toggle for the live screen. All six are in BeerMat (`tests/hosting.test.js` plus a browser section). The browser suite's wheel step raced the preceding close shortcut (every desk action briefly disables the buttons); the test now waits for it. A real desk bug also showed up as an intermittent browser failure: queued desk actions read their form value when they ran, not when clicked, so a refresh landing in between could send the old value (picking Spanish for the TV sent English). Handlers now read values at click time.

TV iteration: the projector page is now a fixed full screen (no scroll at 800×600 up to 4K, checked for every view) with the visible view scaled to fit, and an automatic mode (default) that switches between join, question, round-end leaderboard and winner from the quiz state.

Spotify iteration: optional playback control (Web API, PKCE sign-in, no secret) of the laptop's Spotify app for music bingo and sound clips, plus playlist/track import. Server-side only; tokens are host-only and excluded from exports; the callback answers only on loopback with a one-time state. Tested against a fake Spotify service (`tests/spotify.test.js`); not yet tried against the real Spotify API, which needs the user's own developer app and Premium account. Intended for private quizzes only (Spotify's personal-use terms). The desk can also be the player itself (Web Playback SDK): its script is fetched only on request and only the `/host` page's CSP allows Spotify's script, frame and audio hosts; the desk receives only the short-lived access token. Checked in Chrome that the SDK loads and reaches Spotify under that CSP (it rejected a dummy token, as expected); real playback still needs the user's account.

Hotspot hardware findings: on Intel AX200-class cards a NetworkManager AP on a second virtual interface fails ("wpa_supplicant couldn't grab this interface … Device or resource busy"), reproduced on a second CachyOS machine. `--keep-wifi` now creates `bm0` as an AP-type interface outside NetworkManager and runs `wpa_supplicant` in AP mode; verified on real hardware there (broadcasting on channel 6, 10.42.0.1, DNS and DHCP listening, firewall table, clean teardown). Hosting while also connected to a 2.4 GHz network still needs checking on the quiz laptop.

# Platform audit (2026-10-22)

Starting point: PR #1 (`development/offline-quiz`, 69 Node tests, 15 Python tests, 27 browser sections, all passing).
Work continued on `development/platform`.

Reusable as-is: the quiz engine and every round format, SQLite storage and migrations, the desk/TV/player pages, the
Linux hotspot, online mode, team recovery. Platform assumptions found and addressed: Linux-only laptop controls
(now Linux or Windows), data written beside the program (`QUIZ_DB`/`MEDIA_DIR`/`PACK_DIR`, and the desktop app's user
folder), a fixed port 3000 for the hotspot redirect (`hotspot.py --port`), the hotspot address `10.42.0.1` (Windows
uses `192.168.137.1`), and a join screen that assumed the quiz Wi-Fi (venue LAN mode added).

Security review of the new parts:

* **Desktop (Electron)**: context isolation, sandboxed renderers, no Node in pages; the desk's preload exposes 15
  calls and the main process accepts them only from the desk page on its own server; every page is kept on the quiz
  server (other links go to the system browser, only http/https); `<webview>` blocked; permissions denied except
  clipboard/full screen, plus permission *checks* for audio devices and speaker selection (TV sound: pages can list
  sound devices by name and choose an output; microphone requests are still refused); the TV window has its own session, so it never holds the desk login; DevTools only in
  development. The quiz server runs in a separate utility process. The quizmaster key is random and kept with
  safeStorage where available.
* **Uploads and imports**: unchanged checks (file signatures, sizes, schema validation of quiz files); restore only
  accepts a SQLite file that passes `quick_check` and has BeerMat's tables, after backing up the current one.
* **Path traversal**: sound and media routes unchanged; BeerMat Online's static files are contained to the app folder
  (tested with `..` and encoded `..`).
* **Command injection**: every command is `execFile` with an argument list; Wi-Fi settings reach PowerShell as base64
  JSON, so a Wi-Fi name like `-Action down` is just a name; card names are pattern-checked.
* **XSS**: new screens build content with `textContent`; links built from online data are https/geo/maps URLs made
  from validated numbers; profile pictures must be image data URLs.
* **Database integrity**: checked backup on every desktop start, damaged files moved aside (never deleted).
* **Privileged networking**: Linux unchanged (pkexec, the desktop's own prompt); Windows Mobile Hotspot needs no
  administrator rights. The venue LAN mode changes nothing on the router or laptop.
* **Signed results**: each install has an Ed25519 key in its database (backups therefore hold it: keep them private,
  as before). Claims carry a hashed team reference, never recovery codes. Exports and quiz files do not include the key.
* **Online accounts**: scrypt passwords, hashed bearer tokens (no cookies, so no CSRF), CORS only for the app and
  listed sites, sign-in limits per address and per email, generic sign-in errors (sign-up does reveal that an email is
  taken). The leaderboard is computed per request: fine for a reference service, needs aggregation at scale.
* **Mobile permissions**: camera, coarse location on request, notifications, vibration; no background or precise
  location, no exact alarms. Cleartext is allowed because quiz laptops serve local `http`.
* **Privacy/UK GDPR**: see ONLINE.md (opt-in publicity, export, erasure, what is still needed before launch).

Third-party code and assets that ship:

| Component | Where | Licence | Notes |
|---|---|---|---|
| Electron 39, castlabs ECS build (Chromium, Node, FFmpeg) | desktop builds | MIT, with Chromium's licences in `LICENSES.chromium.html` (shipped by the build) | castlabs' Widevine-enabled Electron; free to use |
| Widevine CDM | downloaded by the desktop app at run time, for the desk's Spotify player | Google's licence | not shipped or redistributed: fetched from Google by the app's component updater |
| Capacitor 8 core, Android, iOS, local notifications | phone app | MIT | |
| Capacitor ML Kit barcode scanning | phone app | Apache-2.0 | uses Google ML Kit (Google APIs terms; free to ship in apps) |
| Built-in sounds | `sounds/` | CC0 | listed in `sounds/CREDITS.md` |
| cloudflared | not bundled | Apache-2.0 | installed by the user for online mode |
| Playwright, electron-builder | development only | Apache-2.0 / MIT | not shipped |

A laptop's own sound pack and bingo calls stay in its gitignored `soundpack/` (or the desktop app's data folder).

Validation boundary: [TESTING.md](TESTING.md) lists what is automated and what still needs hardware, accounts or
hosting.
