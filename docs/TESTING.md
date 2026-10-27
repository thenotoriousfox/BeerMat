# Tests, and what has and hasn't been checked

## Running them

```bash
npm test                                   # node --test: engine, formats, scoring, server, desktop parts, online, mobile logic
python -m unittest discover -s tests -p 'test_*.py'   # Linux hotspot plans
npx playwright install chromium            # once, for the three runs below
npm run test:browser                       # desk, TV and phones in Chromium (every round format)
npm run test:desktop                       # the Electron app on a private Xvfb screen (Linux; needs Xvfb)
PUBQUIZ_DESKTOP_BINARY=dist/linux-unpacked/pubquiz npm run test:desktop   # the same against a packaged build
node tests/mobile.browser.mjs              # app-emulating and browser phones in one quiz, profiles, listings
```

The desktop run never touches the real desktop: it starts its own Xvfb display, removes `WAYLAND_DISPLAY` and forces
X11.

## Automated coverage (2026-10-22)

| Area | Where | Result |
|---|---|---|
| Quiz engine, all round formats, scoring, speed bonuses, penalties, tie-breakers | `quiz`, `rounds`, `gameplay`, `hosting` tests; browser suite | pass |
| SQLite migrations from older databases; restart recovery | `quiz.test.js`, `gameplay.test.js`; browser suite (server restart) | pass |
| Team reconnection, recovery codes, 4-digit transfer | `gameplay.test.js`; browser suite | pass |
| Imports (quiz files with media, Google Drive), exports | `gameplay`, `drive` tests; browser suite | pass |
| Linux hotspot plans, `--port`, teardown | `test_hotspot.py` (mocked commands) | pass |
| Windows hotspot backend (commands, validation, password, base64 settings) | `laptop.test.js` (mocked PowerShell) | pass |
| Network-mode selection: venue LAN addresses, connection check (Linux/Windows firewall), join screen | `network.test.js`; browser suite (join screen) | pass |
| Online mode tunnel, WebSocket, origins | `laptop.test.js` | pass |
| Results kept after a quiz, signed claims, sync outbox and retries | `results.test.js` | pass |
| Statistics and achievement calculations | `results.test.js` | pass |
| Accounts and guest separation, privacy, export/erasure, rate limits | `online.test.js`; `mobile.browser.mjs` | pass |
| Result synchronisation (idempotent; offline then online) | `online.test.js`, `results.test.js`, `mobile.browser.mjs` | pass |
| Event discovery: publish, search by town/postcode/location, offline cache | `online.test.js`, `mobile.browser.mjs` | pass |
| Desktop: screen choice, plug/unplug, swap, blank, preview (simulated screens) | `desktop.test.js` | pass |
| Desktop: settings/key storage, database backup/recovery/restore, server process ports and shutdown | `desktop.test.js` | pass |
| Desktop app end to end: startup, desk login, TV preview/blank, page isolation, crash restart, second instance, shutdown, reopen | `desktop.e2e.mjs`, source and packaged Linux build | pass |
| Browser and app interoperability in one quiz | `mobile.browser.mjs` (emulated app web view) | pass |
| Security boundaries: desk-only routes, loopback-only routes, path traversal, upload signatures, CORS | `quiz`, `laptop`, `network`, `online` tests; e2e (Node access, navigation) | pass |

Numbers at the time of writing: 96 node tests, 15 Python tests, 27 browser sections, 8 desktop end-to-end checks
(each on source and on the packaged Linux build) and 6 mobile interoperability checks.

## Builds produced here

* Linux: `BeerMat-0.4.0.AppImage`, `pubquiz-0.4.0.tar.gz`. The unpacked build passed the desktop end-to-end run.
* Windows: `BeerMat Setup 0.4.0.exe` (NSIS) and `BeerMat-0.4.0-portable.exe`, built on Linux with Wine. **Not run on
  Windows.** Unsigned.
* Android: debug APK (`assembleDebug`, SDK 36), manifest and permissions inspected. **Not installed on a phone.**
  Unsigned (debug key).
* iOS: project generated. **Not built** (needs macOS and Xcode).

## Not verified (needs hardware, accounts or hosting)

* Windows: the app on Windows 10/11, Windows Firewall prompts, Mobile Hotspot starting and stopping, SmartScreen.
* A real second screen, TV or projector with the desktop app (plug/unplug, full screen on the right screen, sound).
  The logic is tested with simulated screens only; Xvfb cannot present two screens to Chromium.
* The desktop first-run window and dialogs, as a person sees them.
* The Linux quiz hotspot from the desktop app (the same `hotspot.py` and pkexec path as before; previously verified on
  real hardware for `--keep-wifi`).
* Phones: BeerMat app on Android and iPhone (scanner, notifications, vibration, local network prompts, opening
  quiz pages inside the app, the Quizzes button and result hand-over), and captive sign-in windows.
* App-store submission and signed builds (Google Play, App Store, Windows code signing).
* BeerMat Online on the internet (it runs locally in tests only; no deployment, email or HTTPS).
* Spotify playback inside the desktop app. Checked here: the app (castlabs Electron) downloads Widevine and the desk
  page gets `com.widevine.alpha`; not checked: a real Spotify sign-in playing a song, and Windows (needs VMP signing).
* Build quiz previews heard from a real Spotify player (the server side is tested with a fake Spotify).
* TV sound with a real TV: Automatic picking its HDMI/DisplayPort output when full screen, and Spotify's player following
  it. Checked here: choosing an output moves the TV page's sound (`desktop.e2e.mjs`, using this machine's outputs) and
  the choice rules (`desktop.test.js`).
