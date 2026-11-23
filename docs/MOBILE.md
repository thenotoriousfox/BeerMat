# BeerMat app (Android and iOS)

An optional phone app for quiz teams. **Installing it is never needed**: every quiz works in a normal phone
browser, and app and browser teams play the same quiz side by side.

## What it does

* **Play**: scan the code on the TV, type the address, or pick a recent quiz. The app opens the quiz laptop's own
  player page, the same page browsers get, so every round format, buzzers, bingo, pictures, sounds, live scores,
  timers, reconnection and team recovery behave exactly as in a browser. If the TV's code is the quiz Wi-Fi, the app
  shows its name (and password, for a Windows hotspot), then opens the quiz once the phone is on it.
* Inside a quiz the app adds a **Quizzes** button back to its own screens, and vibrates for a new question and for
  your buzz turn (Android; switch off in the team menu).
* **Profile** (optional, needs BeerMat Online): sign in, keep your team's result after a quiz (**Keep this result**),
  see statistics and badges, set privacy (everything off until you switch it on), download or delete your data.
  Results wait on the phone until it is online.
* **Find a quiz** (needs BeerMat Online): search by town or postcode, or use your location once (only when you tap
  it, rounded to about 100 m, never in the background). Save venues, set a reminder (a phone notification two hours
  before, or a calendar file). Offline, the last listing shows with a note that it may be out of date.
* **Map** (Find a quiz): every venue on an OpenStreetMap map; gold pins have a quiz night, and day buttons (Mon–Sun) show
  only venues with a quiz that day. Tap one for the venue's page: address, regular quiz nights, website, directions (Google Maps) and its next quiz. Offline it shows the last
  venues it saw, or the venue list from GitHub. Venues are added by BeerMat (docs/ONLINE.md → Venues).

The same screens are also BeerMat Online's web app (`/app/`), for browser players who want a profile.

## BeerMat TV (Android TV, Google TV, Fire TV)

The same app is **BeerMat TV** on a TV: it's listed in TV launchers (`LEANBACK_LAUNCHER`, a 320×180 banner) and
needs no touchscreen, camera or location. It shows the quiz on a TV with no cable to the laptop
(`tv/TvActivity.kt`):

* **Finding the quiz** (`tv/TvFinder.kt`): the last address that worked, the Wi-Fi's gateway (on the quiz Wi-Fi the
  laptop is the router), BeerMat's hotspot address, then every address on the TV's own network (its /24) at the desk's
  port, 3000: a TV is usually on the venue's Wi-Fi, where the laptop also is and the quiz server answers the TV page.
  Each is asked `/api/hello` (a quick check: 0.8 s to connect), 64 at a time, the first to answer as BeerMat winning;
  or the address typed with the remote.
* **Showing it**: the quiz's own TV page (`/tv?app=1`, the page a TV's browser opens) in a full-screen WebView, sized
  before it loads (a WebView measured at nothing gives the page a 0 `100vh`). Sound plays without a press of OK,
  the screen stays on, and the page itself reconnects; if the laptop can't be reached at all, it tries every few
  seconds. Back returns to the address. Debug builds let `chrome://inspect` inspect the page and log its console.
* **Updates**: BeerMat TV checks BeerMat's `latest.json` too (as the phone app's start screen does, `ui/UpdateBanner.kt`).
  With a newer version it stays on its address screen instead of opening the quiz by itself, and offers **Update**
  (selected first) above **Show the quiz**: one press of OK downloads it, checks it and hands it to Android's
  installer. A TV that hasn't allowed BeerMat to install apps opens that page, or its Settings where there is none
  (Fire TV: My Fire TV → Developer options). Store builds (`-PstoreBuild`) leave updates to the store.
* The remote: the screen starts on a button (Update, or Look again), never the address box, whose up and down keys
  move on rather than staying in it; buttons keep the selection when pressed. A TV's keyboard opens only when the
  quizmaster chooses the box.
* It draws the same TV as the browser page, so looks and scenery come with it; it isn't a second native TV.

## How it is built

[Capacitor](https://capacitorjs.com) 8 wraps `mobile/www` (plain HTML/JS, no framework) in native Android and iOS
projects (`mobile/android`, `mobile/ios`). Quiz pages are loaded from the quiz laptop into the same web view, which
identifies itself with `BeerMatApp/<version> (android|ios)` in its user agent. Plugins: ML Kit barcode scanning
(`@capacitor-mlkit/barcode-scanning`) and local notifications (`@capacitor/local-notifications`).

Why not a separate native quiz client: the player page already implements every format and is what browsers use; a
second copy would drift from the server and break the "app and browser in the same quiz" promise.

Settings that matter:

* `server.androidScheme: "http"` and Android `usesCleartextTraffic`: quiz laptops serve plain `http` on the local
  network (they have no certificate), and an `https` app page could not reach them.
* iOS App Transport Security: `NSAllowsLocalNetworking` and `NSAllowsArbitraryLoadsInWebContent` for the same reason.
* `server.allowNavigation: ["*"]`: quiz addresses are any local IP or an online link, so the web view must be allowed
  to open them.

## Building

```bash
cd mobile
npm ci
node scripts/build-web.mjs --online https://online.example     # optional: bake in a BeerMat Online address
npx cap sync
```

**Android** (any OS; JDK 21 and the Android SDK, platform 36):

```bash
npm run android:debug        # android/app/build/outputs/apk/debug/app-debug.apk
npm run android:release      # android/app/build/outputs/bundle/release/app-release.aab (signed if set up, below)
cd android && ./gradlew assembleRelease   # a signed APK for installing directly, as the releases carry
```

**iOS** (macOS with Xcode 16+): `npm run ios` opens the project in Xcode; choose a team and run, or Product →
Archive for the App Store.

## Android download (no store)

Each release on <https://github.com/thenotoriousfox/BeerMat/releases/latest> has `BeerMat-<version>.apk`. On the
phone: open that page, download the APK, allow your browser to "install unknown apps" when asked, and install. A
newer APK installs over the old one.

The native app then updates itself: on its start screen (never in a quiz) it reads `latest.json` from
downloads.beermatquiz.co.uk, and when there's a newer app it offers **Update**. It downloads the APK, checks its size
and SHA-256 against the manifest and that it's signed with the same key as the installed app, and hands it to
Android's installer, which asks the player (the first time, Android asks them to let BeerMat install apps). A store
build (`./gradlew -PstoreBuild …`) hides this and leaves updates to the store; for Google Play also remove the
`REQUEST_INSTALL_PACKAGES` permission from the manifest, which Play restricts.

The release workflow (`.github/workflows/release.yml`) signs it with the upload key kept in the repository's
secrets `ANDROID_KEYSTORE_BASE64` (the keystore, base64) and `ANDROID_KEYSTORE_PASSWORD`. The same key must sign
every release, or phones refuse the update: keep a backup of the keystore and its password (the maintainer's copy is
in `~/.local/share/beermat/`). Raise `versionCode` in `android/app/build.gradle` and `version` in
`mobile/package.json` (it must match the release tag) for each release.

## Signing and store submission (not done: needs your accounts)

**Google Play**

1. A Google Play developer account (one-off fee).
2. The upload key already exists (above). To sign on your own machine, create `mobile/android/keystore.properties`
   (ignored by git): `storeFile=<path to the keystore>`, `storePassword=…`, `keyAlias=upload`, `keyPassword=…`.
   The release build then signs with it; enrol in Play App Signing.
3. Raise `versionCode` in `android/app/build.gradle` for every upload.
4. Play Console: Data safety form (below), content rating, target audience (not aimed at children), privacy policy
   URL (needed because of accounts and location), and a note for reviewers on how to reach a quiz (a demo quiz
   online link works).
5. Permissions to explain: camera (scan the TV's code), coarse location (find quizzes, only on request),
   notifications (reminders). No background location; exact alarms are not requested.

**Apple App Store**

1. Apple Developer Program membership; an App ID `uk.beermat.app`; a distribution certificate and an App Store
   provisioning profile (Xcode's automatic signing handles both once a team is chosen).
2. App Store Connect: privacy nutrition labels, privacy policy URL, age rating, screenshots for 6.9" and 6.5" iPhones.
3. Review notes: the app opens quiz pages from the venue's laptop over the local network; give reviewers an online
   quiz link (online mode) so they can play without one. Apple's guideline 4.2 (minimum functionality) is a risk for
   apps that mostly show web content; the profile, listings, scanning and reminders are the native-side value.
4. The local network permission prompt (`NSLocalNetworkUsageDescription`) appears the first time a quiz is opened.

**Data declared to the stores** (if BeerMat Online is enabled): email address, name, optional photo, quiz results
the player chooses to keep, approximate location only for a search and not stored. Nothing is used for tracking or
advertising. Without BeerMat Online the app collects nothing; quiz laptops see only the team name the players type.

## What has been checked

* Automated: the join, scan and hand-over logic; and a Chromium run that emulates the app (its user agent and its
  screens on `http://localhost`) next to a normal phone browser in the same quiz, keeping both results in profiles and
  showing cached listings offline (`tests/mobile.browser.mjs`). See [TESTING.md](TESTING.md).
* An Android debug APK builds (`assembleDebug`, SDK 36) and its manifest and permissions were inspected.
* **Not yet checked on a phone**: the app on any Android or iOS device; whether the web view opens every local
  address under `allowNavigation: ["*"]`; whether Capacitor's bridge is available on quiz pages (not needed: the quiz
  page uses only web APIs); the ML Kit scanner; notifications; Android's and iOS's local network checks; iOS at all
  (no Mac was available: the iOS project was generated but never built). Vibration does not exist in iOS web views.
