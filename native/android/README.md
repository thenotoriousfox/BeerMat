# BeerMat for Android (native)

The player app in Kotlin and Jetpack Compose, replacing the Capacitor app in `mobile/` once it is verified. It talks to
the quiz server through the client protocol (`docs/CLIENT-PROTOCOL.md`); the server times, checks and scores
everything, so the app never decides a score, a deadline or who may play.

## What it does

* **Connect**: scan the TV's code (Google's code scanner: the camera runs in Play services, so the app asks for no
  camera permission), type the address, or pick a recent quiz. A Wi-Fi code shows the network and password and opens
  Wi-Fi settings. `GET /api/hello` checks it's a BeerMat quiz with a protocol the app speaks.
* **Join**: team name, or a recovery code / the quizmaster's 4-digit transfer code. Recovery codes are kept encrypted
  with an Android Keystore key, per quiz address.
* **Play**, drawn natively: typed answers (text, picture, audio), number and closest-wins, multiple choice and vote,
  tick-all, letter keypad, put-in-order, letter tiles, answer sheets, and the buzzer (buzz, queue, agree). Scrambled
  keypads and tiles use the browser's exact shuffle (`seededOrder`), so a team sees the same layout in either.
  Drafts save to the server as in the browser; one final answer; points shown once marking is final.
* **Every format is native**, also pinpoint (tap the picture, a second tap when going wide), word snake (trace the
  path; go wide), bingo and music bingo (the team's ticket, dabbed on the phone, and the BINGO shout) and sound clips
  (tap during the clip). If a future server adds a format this app doesn't know, the round opens in the phone's
  browser as the same team (`/#team=<code>`).
* **Rehearsals**: a phone that joins a rehearsal sees a branded "You're connected" screen; the server refuses it every
  gameplay route.
* Live updates over the server's event stream with automatic reconnection and a 15 s safety poll; leaving the app
  during an open question is reported to the quizmaster (as a browser tab is); haptics for a new question and for
  the team's buzzer turn (switchable).

Not yet in the native app (the Capacitor app has them): BeerMat Online profiles and results, Find a quiz, the map and
reminders; team photos and buzzer sounds; languages other than English.

## Building

JDK 17+ and the Android SDK (platform 36). The Gradle wrapper downloads everything else.

```bash
cd native/android
echo "sdk.dir=$HOME/Android/Sdk" > local.properties
./gradlew :app:assembleDebug        # app/build/outputs/apk/debug/app-debug.apk (installs as uk.beermat.app.next)
./gradlew :app:testDebugUnitTest    # shared rules + the real quiz server (needs Node.js 22.13+)
./scripts/ui-test.sh                # the real app on an emulator or phone against real quiz servers (screenshots in build/ui-shots)
./gradlew :app:assembleRelease      # signed when keystore.properties exists (below)
```

Release signing: create `keystore.properties` here (never committed) with `storeFile`, `storePassword`, `keyAlias`,
`keyPassword`, as for the Capacitor app. The release build uses the Capacitor app's id (`uk.beermat.app`) so it can
replace it as an update; use the same key as the published app. Don't publish to Google Play before the native app
is approved to replace the Capacitor one.

## Files

| File | What it does |
|---|---|
| `net/Protocol.kt` | The protocol's messages, parsed from the server's JSON |
| `net/QuizServer.kt` | HTTP calls, the live-update stream, address and QR parsing |
| `data/Identity.kt` | Recovery codes (Keystore-encrypted), recent quizzes, the haptics switch |
| `game/PlayerViewModel.kt` | Connect, join, play, reconnect, away; no game rules |
| `game/SeededOrder.kt` | The browser's keypad shuffle |
| `ui/` | Compose screens: theme, connect, join, rehearsal, play and each answer format |
