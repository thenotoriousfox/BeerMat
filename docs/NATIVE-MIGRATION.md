# Native migration: audit, parity matrix and status

Branch: `native-migration`. Goal: replace the Electron desk and TV with a Qt 6/QML app (PySide6), and the Capacitor
phone app with native Kotlin/Compose (Android) and Swift/SwiftUI (iOS), keeping the Node quiz server as the only
quiz engine and the browser player fully supported. Electron and Capacitor stay until each replacement is verified
and approved (§6).

Companion documents: `docs/CLIENT-PROTOCOL.md` (the contract every client follows), `docs/NATIVE-DESK.md` (the
first evaluation and the PySide6 vs C++ choice).

Status labels used below: **done** (implemented and covered by an automated test), **built** (implemented, checked
by hand or partly tested), **todo**, **n/a**.

## 1. What exists today (audited 28 Oct 2026, `main` at 31fc077)

| Part | Where | Size | Notes |
|---|---|---|---|
| Quiz engine, SQLite, live updates, networking, plans, rehearsals | `server/` | server.js 144 KB, model.js 28 KB, rehearsal.js 11 KB | 90 routes; SSE + WebSocket nudges; `node:sqlite` with migrations on start |
| Desk page | `web/host.html` + `host.js` | 43 KB + 126 KB | 5 tabs: Tonight, Quizzes, Teams, Venue, Settings |
| TV page | `web/display.html` + `client.js` | shares `client.js` (57 KB) with the player | views: question, join, leaderboard + stepped reveal, winner, wheel, blank, countdown; 18 formats incl. bingo, word snake, clips, buzzer |
| Player page | `web/player.html` + `client.js`, `app.js`, `i18n.js` | | every format, buzzers, bingo, photos, sounds, recovery, transfer, away, rehearsal screen, languages |
| Electron shell | `desktop/` | main.js 23 KB + 8 small modules | server in a utility process, restart on crash, screens and TV window, TV sound output, backup/restore, key in safeStorage, menus, first-run, X11 relaunch on Wayland |
| Capacitor app | `mobile/` | www/main.js 24 KB | wraps the **same player page** loaded from the laptop; adds QR scan (ML Kit), Wi-Fi QR handling, recent quizzes, haptics, Profile/results (Online), Find a quiz + map + reminders (Online) |
| Online service | `online/` | | accounts, results, venues, licences, Stripe; untouched by this migration |
| Website | `site/` | Astro | untouched |
| Tests | `tests/` | 134 Node tests + Playwright browser suites + `test_hotspot.py` | all pass at the start of this branch |

Plans and rehearsals are already implemented on `main` (`server/edition.js`, `server/rehearsal.js`, session mode in
`server.js`): Free rehearses only, phones joining a rehearsal become *test devices* refused every gameplay route
(enforced in the server), simulated teams play through the normal player routes, Pro can go live. The `rehearsal`
branch is fully merged. The migration builds on this; it adds no licensing logic in clients.

### Desk features (web `host.*`) by tab

* **Tonight**: preflight checks; Next (question, round, leaderboard steps, finish); close/pause/resume/reveal with drum
  roll; answers & marking (per-team cards, sheets, multi-item marks, manual marks, paper answers); teams in the room
  (admit from waiting room, photos, away warnings); **Rehearsal** panel (start/stop, options, simulated teams, manual
  actions: right, wrong, duplicate, invalid, stale, buzz, agree, disconnect, reconnect; test phones; event log; go
  live); Up next; On the TV (view, look); tools: wheel, TV countdown; buzzer game controls; bingo calls/verdicts;
  sound clips; tie-breaker.
* **Quizzes**: load/download/print, Google Drive, the editor for all 18 formats and options (Evil Mode, speed bonus,
  go wide, secret rounds, tie-breaker, media upload), unsaved-change guard, library save.
* **Teams**: recovery codes, rename, move phone (transfer), disable, notes, returning teams/PINs, blocked names,
  paper round / score corrections, results download.
* **Venue**: BeerMat Online sign-in/up, venue details, quiz nights, laptop registration, venue key.
* **Settings**: plan (check/refresh), quiz room, joining (hotspot, LAN, online tunnel), laptop setup, screens, quiz
  data and past quizzes, sounds/buzzers (shared library), bingo calls, Spotify, shortcuts, credits.

### Electron-only (desktop app) features

Screens list, open/close TV, blank, swap, choose TV screen, auto-open on hot-plug, TV sound output (`setSinkId`),
backup, restore (stop server → restore → restart), show quizmaster key, open desk in a browser, open logs/data folder,
crash restart (3/min), single instance, first-run welcome (Windows firewall), Wayland → XWayland relaunch, castlabs
Widevine for the Spotify web player on the desk.

## 2. Parity matrix

Rows are features; columns are the existing client and its native replacement.

### 2.1 Quizmaster desk: Electron → native Qt (`native/`)

| Feature | Electron | Native | Notes |
|---|---|---|---|
| Start server, ticket login, live updates | yes | **done** | `server.py`, `api.py`; same `server-host.js` over a stdio channel |
| Crash restart (3/min), controlled shutdown, server stops if desk dies | yes | **done** | test kills the server mid-quiz |
| Load quiz file with embedded media | yes | **done** | |
| Next / close / pause / resume / reveal, keys N C P R | yes | **done** | reveal drum-roll delay: todo |
| Live question, tally, countdown, teams, outline | yes | **done** | |
| Session mode, simulated teams, test devices listed apart | yes | **done** | view fields + test; panel UI: todo |
| Rehearsal start/stop | yes | **done** (slots) | options UI, manual actions, log, go live: todo |
| Plan display / refresh | yes | todo | |
| Answers & marking: current question, points or sheet items, score corrections | yes | **done** (hand mark + correction tested) | question history and paper answers: todo |
| Buzzer, bingo, clips, wheel, countdown, tie-breaker controls | yes | todo | |
| Waiting room, photos, away warnings | yes | todo | |
| Quiz library and editor: rounds and questions (add, duplicate, reorder, delete), format, wording, answer, aliases, choices, right choices, items, sheet answers, media path, points, time, note; save with server validation; save as file | yes | **built** (edit, save, server refusal tested) | per-format options (Evil Mode, speed bonus, go wide, buzzer/bingo, clips and songs, pinpoint target, word snake grid), media upload, Google Drive, print: todo, kept untouched meanwhile |
| Teams: let in (one or all), rename, move to another phone, disable/restore | yes | **built** | notes, returning teams/PINs, blocked names, photos, results download: todo |
| Venue / Online | yes | todo | |
| Venue & network: quiz Wi-Fi start/stop (card, name, password), venue LAN address, online link, connection check, joining QR | yes | **built** (LAN join mode tested; Wi-Fi and tunnel need the real laptop) | |
| Settings: sounds, bingo calls, quiz room, results sharing | yes | todo | |
| Backup / restore / key / logs / data folder | yes | todo | backup message exists in `server-host.js` |
| Screens: choose, blank, hot-plug, auto-open | yes | **built** (open/blank tested; choose and hot-plug need real screens) | `screens.py`; swap: todo |
| Spotify web player on the desk | castlabs Widevine | **no equivalent** | proposal: Spotify Connect (server already supports choosing a device); needs your approval, see §5 |
| Single instance, first run, Wayland handling | yes | todo | |

### 2.2 TV / projector: web `display` → native QML window

| Feature | Web TV | Native | Notes |
|---|---|---|---|
| Question text, options, sequence/sheet items, timer, pictures, pinpoint target | yes | **done** (choice tested) | `TvStage.qml` reads `/api/leaderboard`, as the web TV |
| Reveal: answer, note, scorers; correct option highlighted | yes | **built** | tally bars and fastest-first list: todo |
| Join screen with QR | yes | **done** | QR from the same `web/qr.js` (made engine-neutral) |
| Leaderboard with stepped reveal, winner | yes | **built** | first-place spotlight, confetti, row slide: todo |
| Wheel, countdown, buzzer leader/queue/agree, bingo ball + board, clips | yes | **built** | untested against those formats yet |
| Word snake grid, tiles, team photos | yes | todo | |
| Sounds (timer music, countdown, reveal, buzzers), audio questions | yes | todo | `QtMultimedia`; output device via `QMediaDevices` |
| Looks/themes (per-question colours) | yes | todo | |
| Blank, rehearsal badge | yes | **done** | |
| Full screen on chosen display, preview on desk | Electron | **built** (window + live preview tested offscreen) | needs a real second screen to verify |

Until this is done the web TV stays the fallback: the native desk can open `http://127.0.0.1:<port>/display` in
the system browser on the TV screen.

### 2.3 Phone apps: Capacitor → Kotlin/Compose and SwiftUI

| Feature | Capacitor (both) | Android native | iOS native |
|---|---|---|---|
| QR scan (incl. Wi-Fi QR), typed address, recent quizzes | yes | **built** (parsing unit-tested; scanner needs a device) | written, **not compiled** |
| Discovery check (`/api/hello`, protocol version) | n/a | **done** | written, **not compiled** |
| Join, recovery code kept (Keystore-encrypted), transfer code, reconnect | yes (player page) | **done** against the real server (join, state, stream); Keystore needs a device | written, **not compiled** |
| Text, number, nearest, choice, vote, multi, letter, sequence, tiles, sheet | yes (player page) | **built**; choice and sequence answered against the real server | written, **not compiled** |
| Buzzer: buzz, queue position, agree | yes | **built** (buzz refused for test devices: tested) | written, **not compiled** |
| Pinpoint, word snake, bingo, music bingo, clips | yes | hand over to the browser player as the same team (**done**, browser side tested) | written, **not compiled** |
| Scrambled keypads/tiles identical to the browser | yes | **done** (`seededOrder` checked against the JS output) | written, **not compiled** |
| Rehearsal connection screen; server refuses play | yes (player page) | **done** (server refusals tested from the app's client) | written, **not compiled** |
| Drafts, one final answer, points after marking | yes | **built** (second answer refused: tested) | written, **not compiled** |
| Away reporting, haptics | Android | **built** | written, **not compiled** |
| Picture and audio questions | yes | **built** | written, **not compiled** |
| Profile, results, statistics, badges (Online) | yes | todo | todo |
| Find a quiz, map, reminders (Online) | yes | todo | todo |
| Team photo, buzzer sound, languages | yes | todo | todo |

The native Android UI has not been run on a device or emulator yet (none here); it compiles, and its client code is
tested against the real server.

**Drift risk.** The Capacitor app shows the server's own player page, so it can't drift from the browser. A native
player re-implements every format's input and display three times (browser, Kotlin, Swift). Mitigations: the server
stays the only judge (clients only shape `value`, table in `CLIENT-PROTOCOL.md`); a shared cross-client test plays
each format through every client against one server; and native apps fall back to the web player page for any
`type` they don't know, so a new server format never locks a team out.

## 3. Reused unchanged

`server/` (engine, SQLite, rehearsals, plans, networking, Spotify Connect), `desktop/server-host.js` and
`desktop/database.js` (run by the native desk), `scripts/hotspot.py` and `hotspot-windows.ps1`, `web/` (browser
player, and the TV until the native one is done), `online/`, `site/`, `shared/`.

## 4. Server changes made for native clients

| Change | Compatible? | Test |
|---|---|---|
| `server-host.js` stdio channel (`BEERMAT_CHANNEL=stdio`) | yes: Electron channels unchanged | `native/tests/test_desk.py` |
| `protocol: 1` on every state; `GET /api/hello` discovery | yes: new fields and route only | `tests/protocol.test.js` |
| `web/qr.js` works without `TextEncoder`/`flatMap` (for QML's engine) | yes: same output | `tests/qr.test.js`, native test |
| Player page accepts `#team=<code>` (handover from the native apps) | yes: client-only, fragment never sent | `tests/handover.browser.mjs` |

## 5. Decisions needing approval

1. **Spotify on the desk.** No technically and legally supported way to play Spotify inside a Qt app without
   Widevine/Chromium. Proposed: drive the Spotify app via Spotify Connect (already in the server). Not silently
   removed: the Electron desk keeps it until you decide.
2. **Native player vs web player in the phone apps** (§2.3 drift risk). `docs/MOBILE.md` records the earlier decision
   to wrap the web player; the migration brief reverses it.
3. **iOS** can't be compiled or tested here (no macOS/Xcode). Any iOS code will be marked unverified.
4. **Wayland**: Qt can't place a window on a chosen screen under Wayland; the native desk will run the TV window via
   XWayland (`QT_QPA_PLATFORM=xcb`) as Electron does, with a guided "drag the TV window to the TV and press F11"
   fallback.

## 6. Stages and status (updated 28 Oct 2026, evening)

| Stage | Status |
|---|---|
| 1. Audit and shared contracts | **done** |
| 2. Native Qt foundation | **done**: server lifecycle and restart, single instance, logs, first-run welcome, backup and restore, XWayland + EGL on Wayland |
| 3. Native desk workspaces | **built, near parity**: Live (with every format's controls, Tools: TV mode, wheel, countdown, tie-breaker, room switches), Rehearsal, Quizzes (every format's options, media upload, pinpoint target, clips and songs, Drive, save with media), Teams & marking (past questions, notes, photos, returning teams, past quizzes, blocked names, results), Venue & network (quiz Wi-Fi, venue LAN, online link, checks, BeerMat Online for the venue), Settings (plan, quiz room, sounds and buzzers, bingo calls, looks and sound themes, Spotify Connect, screens and TV sound, data, key). 10 desk tests |
| 4. Native TV | **built, near parity**: every view and format, reveal tallies and scorers, spotlight, confetti, look colours, the TV's sounds (soundCues), screen choice and blank; real two-screen check passed under XWayland |
| 5. Rehearsal and licensing | **done**: server-enforced; desk shows test phones apart; all three player clients tested as test devices |
| 6. Android | **built and UI-tested on an emulator**: all 18 formats native, team sound and photo, rotation, backgrounding, network drop, Online (profile, keep result, find, map, reminders). 8 JVM tests, 4 instrumented UI tests |
| 7. iOS | **written, not compiled** (no macOS/Xcode): same features as Android; BeerMatKit tests ready for `swift test` |
| 8. Packaging | Linux `.tar.gz` **built and run** (167 MB, bundled Node, Python, Qt incl. Multimedia); AppImage needs `appimagetool`; Windows installer script written, **not built**; Android debug APK built; iOS not built |
| 9. Legacy retirement | **not started**, as agreed: Electron, Capacitor and the browser player all still pass their tests |

### Still to do

* **Languages** (French, Spanish) in the native apps and the native TV: the browser player and web TV have them. Plan: export the dictionary from `web/i18n.js` as the single source, add the apps' own phrases to it, generate it into the apps.
* Desk: swap desk and TV screens, the quizmaster key in the system keychain, wheel tick sounds, the Halloween look's animated scenery, printing blank answer sheets.
* Hardware: unplugging and replugging a TV (`native/tests/display_check.py --wait 60`), a real Android phone on a quiz Wi-Fi, any iPhone build at all, a Windows build and install.

## Real display check (28 Oct 2026, this development machine)

KDE Plasma on Wayland, DP-4 2560×1440 (primary) and HDMI-A-5 1920×1080, NVIDIA, `native/tests/display_check.py`:

| Platform | Result |
|---|---|
| XWayland (the desk's default on Wayland) | TV full screen on HDMI-A-5 at its exact geometry, desk on DP-4; blank and close work. Two bugs found and fixed: the TV filled the desk's screen (now placed on its screen before going full screen), and OpenGL through GLX failed under XWayland (the desk now uses EGL there) |
| Pure Wayland (`BEERMAT_WAYLAND=1`) | TV opens as a window with the "drag to the TV, press F11" hint, as designed |
| Hot-plug | **Not tested on hardware**: display changes made from the development shell (kscreen-doctor) don't take effect. Needs a cable unplugged and replugged with `display_check.py --wait 60` |
