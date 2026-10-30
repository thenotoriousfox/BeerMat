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
| BeerMat TV (Android TV, Google TV, Fire TV) | `native/android/.../tv/` (shows `/tv?app=1` in a WebView; finds the laptop itself) |
| iPhone app | `native/ios/` (SwiftUI; `BeerMatKit` for protocol and networking) |
| Website | `site/` (Astro) |
| BeerMat Online | `online/service.js`, admin console `online/admin/` |

Data keys in quizzes and the protocol (`wordsnake`, `tiles`, `evil`, …) never change; only the names people see do.

## Plans

Free makes, saves and rehearses quizzes with no limits; hosting a live quiz with real teams is Pro (`server/edition.js`,
the `live` feature). In a rehearsal (`server/rehearsal.js`) simulated teams play through the normal player routes, and
real phones join as test devices that every gameplay route refuses on the server. A rehearsal keeps no results. A live
quiz started under Pro runs on for up to a day if the licence lapses (`LIVE_GRACE_MS`). A desk signed in to BeerMat
Online with an admin account gets a Pro licence (`/v1/licence`), venue or not. Prices are £19.99 a month or £199 a
year: never change them, or Stripe, without the user saying so.

## What BeerMat may ship

- Only sounds, music and pictures that are CC0, public domain or BeerMat's own, and nothing that needs attribution
  (the Qt desk has no credits screen; the two Kevin MacLeod CC BY tracks were taken out for that). Every shipped file
  has its source in `sounds/CREDITS.md` and is listed on the website (`site/src/pages/credits.astro`).
- Other people's software is listed with its licence in one generated file per app: the desk's `LICENCES.txt`
  (`native/packaging/licences.py`, from what's in the bundle) and the Android app's `assets/licences.txt` (the
  `writeLicences` task, from each library's POM). A new dependency needs nothing extra unless its licence asks for more.
- Nothing from SpeedQuizzing in the repo or a build: no code, sounds or media. Its clips live only in a laptop's
  gitignored `soundpack/`. Never use or print the SSH private key bundled with it.
- No AI copies of real people's voices, and no famous film, TV or music clips: quizmasters add their own, at their own
  risk (the terms say so).
- Spotify's developer policy forbids it in a product sold to businesses; the website doesn't mention it.

## The user's own desk

- The **BeerMat** app-menu entry runs `python3 -m beermat_desk` from `~/BeerMat/native`: whatever branch this folder
  has checked out is what the user runs. Put it back on `main` after branch work, and tell the user to close and reopen
  BeerMat after a merge (the desk and its quiz server only load code when they start).
- Its data folder is `~/.local/share/BeerMat/BeerMat Desk`: `quiz.sqlite` (settings, the quiz and the sound pack in its
  `metadata` table), `media/`, `my-themes/` (made here or installed from the theme library), `my-quizzes/` (a copy of
  every quiz, kept on save and before another replaces it) and `quiz-library/` (downloads). Read it with
  `sqlite3 -readonly` (not `immutable=1`: that misses recent writes).

## Themes and libraries

- `themes/` ships in every build; `library/` (Halloween) doesn't: it's offered only in the theme library, uploaded
  from the admin console. Tests use `library/` themes as a laptop's installed ones (`my-themes/`).
- A theme's look is CSS for browsers and `tv.json` for the Qt TV. Qt's SVG renderer doesn't run SVG animation: every
  picture must draw without its `<animate>` (`native/tests/test_theme_art.py`).
- Libraries on BeerMat Online: buzzers go live straight away; themes and quizzes wait for an admin. `shared/theme-bundle.js`
  and `shared/quiz-file.js` check them on upload and again on the laptop (Online ships `server/model.js` for the quiz
  checks). Downloading is Pro, or a BeerMat admin signed in on the desk; sharing needs a Pro venue.
- To add or fix library content without the admin's password, run a small script on the server as the service user
  with `ONLINE_DB=/var/lib/beermat-online/online.sqlite`, using the same checks as the admin route
  (`/opt/beermat-online/shared/*`).

## Network

While the quiz Wi-Fi runs, the quiz server answers only on it (and this laptop), except the TV page (`tvOnly` in
`server/server.js`): a smart TV or TV stick stays on the venue's Wi-Fi, where the laptop also is (`--keep-wifi`). The
desk's port there is 3000. `/tv` is the TV page; `/display` redirects to it.

## Words on phones and TVs

Every phrase phones and TVs show is in `web/i18n.js` with French and Spanish (`tests/i18n.test.js` checks). After
changing it, run `node scripts/export-i18n.mjs`: the Android and iOS apps' tests check their `i18n.json` matches.

## Tests

- Node: `npm test`; browsers: `npm run test:browser` and `npm run test:features` (Playwright Chromium).
- Qt: one module at a time, offscreen: `cd native && for t in tests/test_*.py; do QT_QPA_PLATFORM=offscreen python3 -m unittest discover -s tests -p $(basename $t); done`.
  `BEERMAT_SHOTS=<dir>` saves screenshots from the TV and desk tests. PySide now and then hands back stale wrappers
  for items: find items by `objectName` and skip a `TypeError` rather than walking the tree. Check layouts at a
  narrow window too (`test_settings_layout.py`): the user doesn't always run the desk full screen.
- Android: `cd native/android && ./gradlew testDebugUnitTest` (unit and real-server tests); UI tests on an emulator or
  phone: `scripts/ui-test.sh`.
- Real servers in tests: `tests/fixtures/serve.mjs` stops when its stdin closes (hold a fifo open); don't
  `execFileSync` a script that calls a server running in the same process (it deadlocks); a `pkill -f` pattern can
  match your own shell.
- A new check should fail on the old code: run it against `main`'s copy of the file before calling a fix done.
- iOS: `cd native/ios/BeerMatKit && swift test` (macOS or Linux). The SwiftUI app compiles only on macOS: the `ios` CI
  job. Keep SwiftUI view bodies in small typed parts, or Xcode gives up type-checking them.

## Releasing

Work goes on a branch and a PR to `main` (merge commits). A release: bump `package.json` and `package-lock.json`, the
Android `versionCode` (+1) and `versionName` in `native/android/app/build.gradle.kts`, and add a "Release x.y.z" entry
to `docs/NATIVE-MIGRATION.md`; merge; then push the tag `vX.Y.Z` on the merge commit. That runs
`.github/workflows/release.yml`: the Qt desk for Windows and Linux, the Android APK and an unsigned iPhone `.ipa`, then
the download site, the apps' `latest.json` and the website.
Or **Actions → New release** (run on `main`, choose patch, minor or major): it does the bump (Android and iPhone too)
with `scripts/bump-version.mjs`, merges it, tags it and starts Release on the tag. Release's build files are deleted
from Actions storage once it publishes; a test build (Release run by hand on a branch) loses them as soon as it ends.

Watch the run to the end (`gh run watch`), then check what it made: the GitHub release's files, that
`https://downloads.beermatquiz.co.uk/latest.json` names the version and its signature passes `readManifest` in
`shared/update.js`, and that the previous version's files are gone. The update signing key is
`~/.local/share/beermat/update-key.txt` (the `UPDATE_KEY` secret).

## Deploying

- BeerMat Online: `online/deploy.sh ubuntu@130.162.161.81 online.beermatquiz.co.uk` (keeps its database; the TV and
  app pictures of shared themes are drawn with PySide6 there; `THEME_PREVIEWS=1`, Chromium for browser pictures, stays
  off: the server has 1 GB).
- Website: `cd site && npm run deploy` (Cloudflare). Screenshots: `QT_QPA_PLATFORM=offscreen python3
  scripts/site-screenshots-native.py` (desk, TV, Library) and `node scripts/site-screenshots-android.mjs` (phones, on
  the emulator). Lossless WebP: lossy WebP puts bands back into the dark gradients.
- Cloudflare: the token in the user's fish config (`CLOUDFLARE_API_TOKEN`) can deploy the website and use R2 but can't
  edit DNS or make tokens: the user adds DNS records by hand. GitHub has its own narrower token (the
  `CLOUDFLARE_API_TOKEN` secret and `CLOUDFLARE_ACCOUNT_ID` variable); **Actions → Check Cloudflare** tests it.
- Stripe: `online/stripe-setup.mjs` makes the product, prices, portal and webhook (safe to run again). Checkout always
  passes `managed_payments: {enabled: false}`; the account defaults it on. The API can't change the account's own
  branding: that's the dashboard.

## Pitfalls already met

- Gradients: `Desk/SmoothGradient.qml` draws dithered strips (`gradients.py`); the image provider must not set a
  device pixel ratio (Image applies the screen's: at 125–200% scaling the gradient stopped part-way down).
- An Android WebView needs its size (`layoutParams`) before `loadUrl`, or the page's `100vh` is 0.
- Offscreen Qt grabs of big windows at `QT_SCALE_FACTOR=2` come out white: grab a half-size window with the stage scaled.

The website's downloads stay off (`DOWNLOADS_READY` in `site/src/consts.ts` is false; BeerMat is a private beta).
