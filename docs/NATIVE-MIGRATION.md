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
| TV page | `web/display.html` + `client.js` | shares `client.js` (57 KB) with the player | views: question, join, leaderboard + stepped reveal, winner, wheel, blank, countdown; 18 formats incl. bingo, word trail, clips, buzzer |
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
* **Quizzes**: load/download/print, Google Drive, the editor for all 18 formats and options (Risk It, speed bonus,
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
| Quiz library and editor: rounds and questions (add, duplicate, reorder, delete), format, wording, answer, aliases, choices, right choices, items, sheet answers, media path, points, time, note; save with server validation; save as file | yes | **built** (edit, save, server refusal tested) | per-format options (Risk It, speed bonus, go wide, buzzer/bingo, clips and songs, pinpoint target, word trail grid), media upload, Google Drive, print: todo, kept untouched meanwhile |
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
| Word trail grid, tiles, team photos | yes | todo | |
| Sounds (timer music, countdown, reveal, buzzers), audio questions | yes | todo | `QtMultimedia`; output device via `QMediaDevices` |
| Looks/themes (per-question colours) | yes | todo | |
| Blank, rehearsal badge | yes | **done** | |
| Full screen on chosen display, preview on desk | Electron | **built** (window + live preview tested offscreen) | needs a real second screen to verify |

Until this is done the web TV stays the fallback: the native desk can open `http://127.0.0.1:<port>/tv` in
the system browser on the TV screen.

### 2.3 Phone apps: Capacitor → Kotlin/Compose and SwiftUI

| Feature | Capacitor (both) | Android native | iOS native |
|---|---|---|---|
| QR scan (incl. Wi-Fi QR), typed address, recent quizzes | yes | **built** (parsing unit-tested; scanner needs a device) | written, **not compiled** |
| Discovery check (`/api/hello`, protocol version) | n/a | **done** | written, **not compiled** |
| Join, recovery code kept (Keystore-encrypted), transfer code, reconnect | yes (player page) | **done** against the real server (join, state, stream); Keystore needs a device | written, **not compiled** |
| Text, number, nearest, choice, vote, multi, letter, sequence, tiles, sheet | yes (player page) | **built**; choice and sequence answered against the real server | written, **not compiled** |
| Buzzer: buzz, queue position, agree | yes | **built** (buzz refused for test devices: tested) | written, **not compiled** |
| Pinpoint, word trail, bingo, music bingo, clips | yes | hand over to the browser player as the same team (**done**, browser side tested) | written, **not compiled** |
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

### Done since (29 Oct 2026)

* **Languages**: French and Spanish in both native apps and the native TV, from `web/i18n.js` as the one dictionary
  (`scripts/export-i18n.mjs`); tests keep the apps' copies in step and fail on any untranslated `t()` phrase.
* Desk: the quizmaster key in the system keychain (file fallback), swapping desk and TV screens (checked on real
  screens), wheel tick sounds, the Halloween look's scenery, printing blank answer sheets (PDF).

* **Release 0.5.5** builds BeerMat Desk (Linux tar.gz and AppImage, Windows installer and zip, its tests first) and the
  native Android app as the main downloads; Electron and Capacitor stay in each release as the fallback ("classic").
  The Windows desk build now runs in CI on Windows; it hasn't been installed on a real Windows laptop yet.
* **Release 0.5.6** releases only the native apps: the Electron desk and the Capacitor app are no longer built for
  releases (their source stays; releases up to 0.5.5 have them). It brings updates from inside the apps (signed
  `latest.json`, `shared/update.js`), so 0.5.6 is the first version that can update itself to the next.
* **Release 1.0.0**: fixes.
* **Release 0.7.17**: Phone deck shows each team's answer; mark as soon as a team locks in.
* **Release 0.7.16**: Quizmaster devices find each other through the account, not the network.
* **Release 0.7.15**: Spotify clips start through Spotify Connect again; bigger spotlight photos.
* **Release 0.7.14**: Round intros to read out, full answers on the phone deck, long clues on the TV.
* **Release 0.7.13**: Tools: the wheel's list of entries scrolls.
* **Release 0.7.12**: Spotify: clips at full volume, then the set volume back.
* **Release 0.7.11**: Quiz editor: the question list keeps its place.
* **Release 0.7.10**: Quiz files with a picture or sound labelled as the wrong kind (e.g. a WebP picture marked JPEG, as
  in a Google Drive quiz) load instead of failing.
* **Release 0.7.9**: Spotify clips start at their start time with no blip from 0:00; team photos in the TV spotlight are
  round; the Google Drive link is on the Quizzes page; the quiz maker prompt lists every format speed bonuses and Risk
  It work on; the editor's long labels wrap at a narrow window. (0.7.7 and 0.7.8 failed their test builds and were never
  published.).
* **Release 0.7.8**: Spotify clips start at their start time with no blip from 0:00; team photos in the TV spotlight are
  round; the Google Drive link is on the Quizzes page; the quiz maker prompt lists every format speed bonuses and Risk
  It work on; the editor's long labels wrap at a narrow window. (0.7.7's build failed a test and was never published.).
* **Release 0.7.7**: Qt TV: team photos in the spotlight are round; Spotify: clips start at their start time, with no
  blip from 0:00; Qt desk: quiz files with videos load and save; Risk It and Wipeout warnings on phones and TV; Round
  formats page: a picture for every option; Website: Round formats page; Video questions; Ordering audio clips: put
  songs in order, with a clip for each; Survey: points for how popular the answer was; Link groups: find the groups
  among the items and name each link; Sort into groups: put each item in its group, a point for each; Matching pairs:
  match each item to its partner, a point a pair; List answers: name as many as you can, a point for each; Progressive
  clues: a new format, fewer points with each clue; Wager questions: teams stake up to N points, won if right, lost if
  wrong; Pinpoint: several places to find; True or false, before or after: two-button Multiple choice; Number: accept a
  margin either side; Nearest wins: closest without going over; VAR Check: teams appeal their marking after a reveal;
  Phones: fallbacks so older phones play (iOS 14 / Chrome 86 on); Phones: Send answer stays at the top while the
  keyboard is open; Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>; Phones: blur reveal on the TV's curve;
  clearer Trace instructions; Finish quiz & reveal leaderboard; music round answers on Run the night and in the apps; TV
  spotlights: much bigger team photos, and the Qt TV plays the team's buzzer; Teams rename themselves from the team
  menu; Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>; Quiz Wi-Fi sign-in page: keep it open until the phone
  is told to stay, with the Android and iPhone steps; Apps: photo and buzzer on the waiting screen, as the browser
  player; Quiz Wi-Fi sign-in sheet: how to stay on the Wi-Fi, not the join form; Linux quiz Wi-Fi: run the hotspot
  script as root from a copy.
* **Release 0.7.6**: Linux: BeerMat Desk no longer crashes on newer Linux systems (it uses the computer's own keyboard
  library), and the programs it starts use the computer's libraries, so Spotify plays on the laptop's Spotify app and
  Connect Spotify opens the browser.
* **Release 0.7.5**: Spotify clips and songs play on the Spotify app on this laptop, told directly, even when Spotify's
  own link to the app stops answering; a player that has closed no longer stops them. The Qt desk plays a question's own
  Spotify clip as it opens, with Play again (also after the question closes) and Stop on the desk and in Run the night.
  Music bingo: Play this song again, on the desk and phones. Picture reveals: tiles cover a new picture from its first
  frame, and the blur sharpens smoothly (Qt TV and Android).
* **Release 0.7.4**: Run the night in a phone's browser: the laptop serves it at /deck (code sign-in, no app needed),
  with its address and QR code on the desks' Phone deck panel. Send Question now holds the question off the TV as well
  until Send: the room listens while it's read out, then the TV and phones show it together. Manage subscription from
  the desk's Settings → Plan.
* **Release 0.7.3**: Picture reveals over the first seconds (revealSeconds): the picture uncovers itself over its first
  N seconds and then stays whole, with the speed bonus earned only while it uncovers (3, 2, 1 with a bonus of 3). Every
  screen and both editors; the quiz maker guide explains it and when hideText is for.
* **Release 0.7.2**: One look for answers: solid colour blocks on the Qt TV and in the Android and iPhone apps, matching
  the browser. Phones follow the TV's leaderboard reveal, and the apps get a leaderboard between questions. Hidden
  wording: the TVs ask the room to listen and every desk (and Run the night) says to read it out. The Qt TV's reveal
  makes room for the whole answer and who scored; music bingo's reaction table sits beside the song; queued buzzers
  clear when answers close. Run the night shows the answer when the drum roll ends. The buzzer sound label reads 'Chosen
  for you: tap to pick one'. Test quizzes no longer count on the website.
* **Release 0.7.1**: 0.7.0's build stopped on a layout check; 0.7.1 is the same release (Run the night on Android and
  iPhone, Pro offers, the TV spotlight fix, website clips) with desk layouts that wrap instead of running past their
  panels.
* **Release 0.7.0**: Run the night: host the quiz from the BeerMat app on Android or iPhone (venue or admin account, or
  the desk's code); the Qt desk plays the phone's clips and songs and lists connected phones. Pro offers: a 14-day free
  trial, founding prices for the first 20 venues, a first-month guarantee and a set-up service. The TV's tied-for-first
  spotlight wraps long names. The website shows short clips of the TV.
* **Release 0.6.3**: BeerMat as a TV screen on another computer (it finds the quizmaster's laptop and plays all the
  sound, sound clips and music bingo songs included); GitHub's checks run only for releases. Built and published from
  the release laptop (Actions' allowance was used up for October).
* **Release 0.6.2**: 50/50, hint and second guess, options only where they apply, narrow-window fixes; TV: put in order
  sorts itself, audio autoplays, clips one at a time, fuller screens; An example quiz with a question in every format;
  Drop the CC BY music buzzers; one licences file per app; Android update prompt on resume, no Advanced setting, faster
  scores for big rooms; Release workflow: New release button, build files kept only for releases.
* **Release 0.6.1**: BeerMat TV offers its own updates (Update on its address screen; TVs on 0.6.0 need this version
  installed by hand once), a map pin in the apps opens a popup with the venue and its next quiz, the website's new ways
  to play with fresh screenshots, music bingo without "0 called" on the Qt TV, and time limits on every CI job.
* **Release 0.6.0**: Send Question, picture reveals (blur or tiles), multiple choice with six fixed buttons, Fast
  Track, more wheels (weighted, random number, saved, rollover jackpots), music bingo's reaction table, slides between
  rounds, a question report, questions on the fly, simple mode, team groups and table numbers, a signal monitor, bingo
  extras, a quizzes-run counter on the website, Letter tiles / Word trail / Risk It as names, the Qt desk choosing GLX
  when EGL draws nothing, and the iPhone app built in CI.
* **Release 0.5.9**: the Quizzes page (the quizzes on this laptop, My quizzes, Clear quiz, sharing), a TV without a
  cable (`/tv` in a TV's browser, on the venue network too; BeerMat TV on Android TV, Google TV and Fire TV), an admin
  downloading from the libraries without a venue, library buzzers added once, Settings at any window size, themes
  installed while the TV page is open, and Halloween's bats on the Qt TV.
* **Release 0.5.8**: the quiz library (Library → Quizzes; BeerMat Online stores shared quizzes, `shared/quiz-file.js`), and
  the app's My location from a fresh, precise fix.
* **Release 0.5.7**: a Library workspace on the desk (buzzers and themes), gradients that fill the window at any
  display scaling, Halloween only from the theme library. The first update delivered by the in-app updater.
* **Halloween moves to the theme library**: it's no longer shipped in `themes/`; its source is `library/halloween`,
  uploaded to the theme library, and the tests install it as a laptop's own theme.
* **Themes everywhere**: a theme's `tv.json` says what BeerMat Desk's TV draws beyond colours (Halloween's full web
  design: gradient title, eyebrow, question panel, scenery, all from data, `ThemeScene.qml`), and what the app draws
  on phones (its `phone` section); the Android app takes the look's colours and phone scenery (`GET /api/looks/<id>`).
  The iOS app doesn't yet (written code only, as the rest of it).
* **Theme library** (BeerMat Online): share, approve (admin), install, report, with pictures of each theme on the TV,
  in the app (both drawn by the desk that shares it) and in a phone's browser (drawn by the service).

### Still to do

* iOS: the quiz's look (colours and phone scenery) as the Android app has it.
* Hardware only: unplugging and replugging a TV (`native/tests/display_check.py --wait 60`), a real Android phone on a
  quiz Wi-Fi, any iPhone build, a Windows build and install, and the keychain on a real desktop session (the packaged
  test ran without one and used the file fallback, as designed).

## Release 1.1.0 (23 Nov 2026)

* **Phone deck relay**: commands and state flow through BeerMat Online when the laptop isn't directly reachable,
  removing the dependency on Cloudflare quick tunnels. Browser, Android and iOS.
* **Phone deck UX fixes**: answers only appear for teams that have answered (not "No answer yet" for everyone while
  the question is open); round intro only shows before the round starts, not during the leaderboard reveal; question
  card hides when the quiz ends.
* **Show any question on TV**: the desk can show a past question with its answers and scores on the TV (review mode).
  Browser TV and Qt TV.
* **Minus points shame**: during the leaderboard reveal, any team on minus points gets a fullscreen moment on the TV.
* **Answer submission confirmation**: a confirm dialog before submitting an answer (skipped for fastest-fingers
  questions, which show a speed warning instead). Browser, Android and iOS.
* **Wi-Fi detection fix**: `hotspot.py` `running()` falls back to checking `iw` for AP-mode interfaces when the
  profile file in `/run` is missing.

## Real display check (28 Oct 2026, this development machine)

KDE Plasma on Wayland, DP-4 2560×1440 (primary) and HDMI-A-5 1920×1080, NVIDIA, `native/tests/display_check.py`:

| Platform | Result |
|---|---|
| XWayland (the desk's default on Wayland) | TV full screen on HDMI-A-5 at its exact geometry, desk on DP-4; blank and close work. Two bugs found and fixed: the TV filled the desk's screen (now placed on its screen before going full screen), and OpenGL through GLX failed under XWayland (the desk now uses EGL there) |
| Pure Wayland (`BEERMAT_WAYLAND=1`) | TV opens as a window with the "drag to the TV, press F11" hint, as designed |
| Hot-plug | **Not tested on hardware**: display changes made from the development shell (kscreen-doctor) don't take effect. Needs a cable unplugged and replugged with `display_check.py --wait 60` |
