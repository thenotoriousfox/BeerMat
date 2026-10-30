# BeerMat Desk: native (Qt 6 / QML) evaluation and prototype

Status: **prototype** on the `native-desk` branch (`native/`). Electron stays the shipping desk until the native one
reaches parity. Written 28 October 2026, after building the prototype, so the estimates below come from real work.

## 1. What actually has to change

The Electron app is small. Almost everything BeerMat does lives in the Node server (unchanged) and the browser pages
for phones and the TV (unchanged). The real rewrite is one thing: **the desk page** (`web/host.html` + `web/host.js`,
about 1,300 lines of dense JavaScript), which becomes QML.

| Part | Today | Native desk |
|---|---|---|
| Quiz engine, scoring, timing, teams, recovery, SQLite (`server/`) | Node | **Reused unchanged**: the desk calls its existing `/api/host/*` API |
| Database checks, backups, port choice, laptop controls (`desktop/server-host.js`, `database.js`) | run by Electron | **Reused unchanged**: started as a child process over a new line-based channel (10 lines added) |
| Phone and TV pages (`web/player.html`, `display.html`, …) and the Capacitor apps | browser | **Unchanged** |
| BeerMat Online, licences, Stripe, the website | | **Unchanged** |
| Window, menus, dialogs, single instance, first run, crash restart (`desktop/main.js`) | Electron | Rewrite in Python: mostly Qt one-liners (~300 lines) |
| Screens: which screen is the TV, swap, blank, hot-plug (`screens.js`, `displays.js`) | Electron | Port: `displays.js` is plain logic (port as is); the window side maps to `QScreen` and `QGuiApplication.screenAdded/Removed` |
| TV window | Electron `BrowserWindow` | A **QtWebEngine** window showing the same `/tv` page (the brief allows the TV to stay web-based). The desk itself never uses a web view |
| TV sound output (`sound.js`) | Chromium `setSinkId` | Same script injected into the TV's web page; the desk's own sounds through `QMediaDevices` |
| Quizmaster key storage (`store.js`) | Electron `safeStorage` | `keyring` (Windows Credential Manager, Secret Service). The key is only the desk password and can be regenerated, so no migration risk |
| Logs (`log.js`) | | Python `logging` with rotation |
| **The desk interface** (`web/host.*`) | HTML/JS | **The real work: QML** |

The native desk calls the server only through the API the web desk already uses, so there is no second quiz engine. The
only quiz-flow logic it carries is what the web desk already has in the browser: the label of the Next button (which
step comes next) and unpacking a quiz file's embedded pictures before loading it.

## 2. PySide6/QML or C++/QML

The interface is QML either way, and QML is most of the work. So the choice is only about the ~15% of code that is
glue: the server process, HTTP, files, screens and settings.

| | PySide6 (Python) + QML | C++ + QML |
|---|---|---|
| Development speed | Fastest: no compile step, glue in a few lines (the prototype's whole backend is 600 lines) | Slower: build system, header boilerplate, a longer edit-test loop |
| Performance | Plenty: a dashboard refreshing a few times a second; QML renders on the GPU either way | Faster, but nothing here needs it |
| Talking to the Node server | `QNetworkAccessManager` and `QProcess`, identical APIs | Identical |
| Packaging | PyInstaller or Nuitka: Python + PySide6 Essentials + WebEngine; slightly bigger | `windeployqt` / `linuxdeploy`: no Python, but needs a compiler toolchain per OS in CI |
| Maintenance | One language you can read; tests in plain Python | C++ memory and build issues to own |
| Licence | LGPL (dynamic linking): fine for a commercial app | Same (LGPL Qt) |

**Recommendation: PySide6.** QML is the same in both, Python makes the glue a fraction of the size, and BeerMat
needs nothing that only C++ offers. The packaged app is roughly the same size as the Electron one (both ship a
browser engine for the TV window), plus a Node runtime, which the Electron app gets from Electron itself.

## 3. The prototype

`native/` (run: `cd native && python -m beermat_desk`; test: `python -m unittest discover -s tests`).

- **Starts the real server** (`desktop/server-host.js`), signs in with a one-time ticket as Electron does, follows live
  updates on `/api/events`, and restarts the server if it dies (up to three times a minute). Closing the desk stops it;
  if the desk itself dies, the server notices its input close and stops too, so it never runs on alone.
- **Loads a quiz** from a native file dialog, uploading the pictures and sounds inside it first (as the web desk does),
  and asks before replacing a quiz that has been played.
- **Shows the live question**: round, format, points, the answers in colour with each one's count, the correct answer
  (on the desk only, marked as such), a countdown and how many teams have answered; teams in the room with
  answered status and scores; the quiz's rounds and questions, played ones ticked.
- **Runs the quiz**: Next (start question, next round, show and reveal the leaderboard, finish, with a confirmation),
  close answers, pause and resume, reveal; the same keys as the web desk (N, C, P, R; Ctrl+O to load).
- **Tested end to end** with no screen (Qt offscreen): the real server and QML window, two teams joining and answering
  over HTTP, a question from open to reveal, the server killed mid-quiz and back with the score intact, closing stops
  the server. 6.6 seconds. The existing 130 Node tests and the Electron desktop tests still pass.

Size: ~1,060 lines (Python 600, QML 460) and a 130-line test.

## 4. What's left, and how long

Each item below is listed against what the web desk does today. The days are focused development days, based on the
prototype's pace: the first ~1,000 lines, debugged and tested end to end, took about one day.

| Area | What it involves | Days |
|---|---|---|
| Tonight: everything else live | buzzer game (correct/wrong/pass/agree), bingo calls and verdicts, sound clips game (plays audio), wheel, TV countdown, leaderboard steps, tie-breaker, waiting room admit, team photo approval, away warnings, TV mode and look | 4–5 |
| Answers & marking | question history, per-team marking cards, sheets and multi-item marks, paper answers | 2 |
| Quizzes (the editor) | all 18 formats and their options (options, ordering, sheets, pinpoint target, word trail, clips and songs, bingo, buzzer variants, Risk It, speed bonus, go wide, secret rounds, tie-breaker), media upload and preview, import/export/Google Drive, unsaved-change guard | 6–8 |
| Teams | recovery codes, rename, move phone, disable, notes, returning teams and PINs, blocked words, adjustments, results download | 2 |
| Venue | BeerMat Online sign-in, venue details, quiz nights, events, laptop registration, subscription | 2 |
| Settings | plan, quiz room, joining (hotspot, LAN, online tunnel), screens, sounds and buzzers (incl. the shared library), bingo calls, results sharing, about/credits | 4 |
| TV window and screens | QtWebEngine TV window, screen choice, swap, blank, hot-plug, sound output, a live preview on the desk | 3 |
| App shell | single instance, keyring, first run, logs, backup/restore, crash dialog, menus, the reveal drum roll timing | 2 |
| Spotify | see below | 1 |
| Packaging and CI | PyInstaller builds with Node bundled, AppImage + tar.gz, Windows installer, release workflow | 4–5 |
| Tests and polish | native tests per area, high-DPI and resizing checks, fixes from your hardware testing | 3–4 |
| **Total** | | **33–39 days** |

**Revised estimate: about 7 weeks of development to full parity and packaged builds**, plus your hardware testing.
That's in line with the "several weeks" first feared, because the desk is big: 18 question formats and a lot of live
controls. The prototype shows it is low-risk weeks: the backend and every page except the desk are reused, and
each area is a straight translation into QML with the API already in place.

**Fastest route to something useful:** the live-night screens first (Tonight, marking, teams, TV window: about
2 weeks). A quizmaster could then run a whole night natively, building quizzes in the Electron desk or a browser
meanwhile. The editor, venue and settings follow, then packaging, then Electron is retired.

## 5. Risks and differences to decide on

- **Spotify on the desk.** The Electron desk plays Spotify itself through Spotify's web player, which needs Widevine
  (only castlabs' Electron has it). QtWebEngine doesn't, and the native desk has no web view anyway. The native desk
  would control the **Spotify app** on the laptop instead (Spotify Connect, which the server already supports: choose
  the player under Music). Same music rounds; one more app open. Spotify's terms still limit it to private quizzes.
- **Wayland.** Qt can't place a window on a chosen screen under Wayland either; the native desk does what the Electron
  app does and runs through XWayland (`QT_QPA_PLATFORM=xcb`) when it needs to.
- **Package size.** QtWebEngine (for the TV window) is about as big as Electron. If the TV moves to native QML later,
  that goes away.
- **Two desks during the move.** Until Electron is retired, both exist; the native one reads the same data folder
  (`--data`), so a quiz can move between them.
