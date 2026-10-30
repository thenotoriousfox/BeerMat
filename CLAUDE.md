# BeerMat: notes for Claude

BeerMat is one quiz engine with several clients. `docs/ARCHITECTURE.md` explains how they fit; `docs/CLIENT-PROTOCOL.md`
is what phones and TVs may rely on.

## Where a feature goes

The quizmaster's main app is the **Qt desk** (`native/beermat_desk`, PySide6/QML) with its **Qt TV** (`qml/TvStage.qml`).
A feature isn't done until every surface that shows it has it:

| Surface | Code |
|---|---|
| Quiz server (rules, scoring, state) | `server/server.js`, `server/model.js` |
| Phone page (browsers) | `web/player.html`, `web/client.js`, `web/app.js` |
| Qt desk and Qt TV | `native/beermat_desk/` (`desk.py`, `live.py`, `library.py` editor options, `qml/`) |
| Electron desk and browser TV (`/tv`) | `web/host.html`, `web/host.js`, `web/display.html`, `web/client.js` |
| Android app | `native/android/` (Kotlin, Compose) |
| iPhone app | `native/ios/` (SwiftUI; `BeerMatKit` for protocol and networking) |
| Website | `site/` (Astro) |
| BeerMat Online | `online/service.js` |

Data keys in quizzes and the protocol (`wordsnake`, `tiles`, `evil`, …) never change; only the names people see do.

## Words on phones and TVs

Every phrase phones and TVs show is in `web/i18n.js` with French and Spanish (`tests/i18n.test.js` checks). After
changing it, run `node scripts/export-i18n.mjs`: the Android and iOS apps' tests check their `i18n.json` matches.

## Tests

- Node: `npm test`; browsers: `npm run test:browser` and `npm run test:features` (Playwright Chromium).
- Qt: one module at a time, offscreen: `cd native && for t in tests/test_*.py; do QT_QPA_PLATFORM=offscreen python3 -m unittest discover -s tests -p $(basename $t); done`.
  `BEERMAT_SHOTS=<dir>` saves screenshots from the TV and desk tests.
- Android: `cd native/android && ./gradlew testDebugUnitTest` (unit and real-server tests); UI tests on an emulator or
  phone: `scripts/ui-test.sh`.
- iOS: `cd native/ios/BeerMatKit && swift test` (macOS or Linux). The SwiftUI app compiles only on macOS: the `ios` CI
  job. Keep SwiftUI view bodies in small typed parts, or Xcode gives up type-checking them.

## Releasing

Work goes on a branch and a PR to `main` (merge commits). A release: bump `package.json` and `package-lock.json`, the
Android `versionCode` (+1) and `versionName` in `native/android/app/build.gradle.kts`, and add a "Release x.y.z" entry
to `docs/NATIVE-MIGRATION.md`; merge; then push the tag `vX.Y.Z` on the merge commit. That runs
`.github/workflows/release.yml`: the Qt desk for Windows and Linux, the Android APK and an unsigned iPhone `.ipa`, then
the download site, the apps' `latest.json` and the website.

The website's downloads stay off (`DOWNLOADS_READY` in `site/src/consts.ts` is false; BeerMat is a private beta).
