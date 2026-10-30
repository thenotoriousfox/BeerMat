# BeerMat for iPhone (native)

The player app in Swift and SwiftUI, replacing the Capacitor app in `mobile/` once it is verified. It does what the
native Android app does (`native/android/README.md`): connect by QR code, address or recent quiz; join or recover a
team; **all 18 formats natively** (pinpoint, word trail, bingo, music bingo and clips too); the team's buzzer sound
and photo (system photo picker, no library permission); the rehearsal "You're connected" screen; live updates with
reconnection; away reporting; haptics; and the **BeerMat Online** side as tabs: Profile (statistics, badges,
privacy, data download and deletion), Keep this result, Find a quiz (by town, or near you with permission asked on
tap), reminders (a notification two hours before, or a calendar file to share), saved venues, venue pages and an
Apple Maps map with day filters. The quiz server decides everything (`docs/CLIENT-PROTOCOL.md`).

> **Status: compiled only in CI.** This was written on Linux without Xcode. The `ios` job in
> `.github/workflows/test.yml` runs `BeerMatKit`'s tests and builds the app for the simulator on a macOS runner; nothing
> has been run on a simulator or a device, or signed. `BeerMatKit`'s tests also run on Linux (`swift test`).

## Layout

| Path | What it is |
|---|---|
| `BeerMat.xcodeproj` | The app target (iOS 16+, iPhone). Compiles `BeerMat/` and `BeerMatKit/Sources/BeerMatKit/` |
| `BeerMat/` | SwiftUI app: `PlayerModel` (connect, join, play, reconnect; no game rules), views, Keychain `Identity`, `Info.plist`, assets, Fredoka |
| `BeerMatKit/` | Swift package with no UI: protocol, networking, QR parsing, the browser's keypad shuffle, the BeerMat Online client; its tests run with `swift test` (against real servers when Node.js is there) |
| `make-project.py` | Writes `BeerMat.xcodeproj` from the files present: run it after adding or removing one |

## iOS specifics

* **Local network privacy**: `NSLocalNetworkUsageDescription` explains why; iOS asks on the first connection to the
  quiz laptop. If the player declines, the app can't reach the quiz (Settings → BeerMat → Local Network).
* **Plain http to the laptop**: ATS doesn't apply to IP addresses; `NSAllowsLocalNetworking` covers `.local` names.
  Online quizzes use https. No arbitrary-loads exception.
* **Camera**: VisionKit's `DataScannerViewController` (`NSCameraUsageDescription`), asked when the player taps Scan.
  Typing the address works without it.
* **Quiz Wi-Fi codes**: the app shows the network and password and opens Settings. Joining automatically
  (`NEHotspotConfiguration`) would need the Hotspot Configuration entitlement; not added.
* **Recovery codes** are kept in the Keychain (`AfterFirstUnlockThisDeviceOnly`), per quiz address.
* **Audio questions** play with `AVPlayer`: MP3 and WAV work; **OGG doesn't play on iOS** (the browser player has the
  same limit in Safari).

## Building (on a Mac)

```bash
cd native/ios/BeerMatKit && swift test        # protocol and shared rules; the server tests need Node.js 22.13+
open native/ios/BeerMat.xcodeproj             # choose your team under Signing, then Run
```

Debug builds use the bundle id `uk.beermat.app.next` (side by side with the Capacitor app); Release uses
`uk.beermat.app`, the Capacitor app's id, so it can replace it as an update. Set `DEVELOPMENT_TEAM` (Signing &
Capabilities) to the team that publishes the current app. Don't submit to the App Store before the native app is
approved to replace the Capacitor one.

Not yet in the native app: languages other than English. No Xcode UI-test target yet (the Android app's UI tests,
`native/android/scripts/ui-test.sh`, are the model for one).
