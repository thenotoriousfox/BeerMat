#!/usr/bin/env bash
# Runs the app's UI tests on a connected device or emulator against real servers on this computer: a live quiz (Pro,
# every format), a Free laptop's rehearsal, and a BeerMat Online with a Pro venue. The emulator reaches this computer at 10.0.2.2; a real phone
# on the same network: set HOST to this computer's address. Screenshots land in build/ui-shots.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(cd ../.. && pwd)
HOST=${HOST:-10.0.2.2}
ADB=${ANDROID_HOME:-$HOME/Android/Sdk}/platform-tools/adb
work=$(mktemp -d)
mkfifo "$work/live-in" "$work/rehearsal-in" "$work/online-in" "$work/keep-in" "$work/deck-in"
node --disable-warning=ExperimentalWarning "$ROOT/tests/fixtures/serve.mjs" pro full --bind 0.0.0.0 < "$work/live-in" > "$work/live-out" & live_pid=$!
node --disable-warning=ExperimentalWarning "$ROOT/tests/fixtures/serve.mjs" free --bind 0.0.0.0 < "$work/rehearsal-in" > "$work/rehearsal-out" & rehearsal_pid=$!
node --disable-warning=ExperimentalWarning "$ROOT/tests/fixtures/online.mjs" --bind 0.0.0.0 < "$work/online-in" > "$work/online-out" & online_pid=$!
# A quiz of its own for the Online test, which plays it to the end.
node --disable-warning=ExperimentalWarning "$ROOT/tests/fixtures/serve.mjs" pro --bind 0.0.0.0 < "$work/keep-in" > "$work/keep-out" & keep_pid=$!
# And one for Run the night (the phone deck), which hosts it.
node --disable-warning=ExperimentalWarning "$ROOT/tests/fixtures/serve.mjs" pro --bind 0.0.0.0 < "$work/deck-in" > "$work/deck-out" & deck_pid=$!
# Holding the fifos open keeps the servers running; closing them (on exit) stops them.
exec 5> "$work/live-in" 6> "$work/rehearsal-in" 7> "$work/online-in" 8> "$work/keep-in" 9> "$work/deck-in"
# The network test switches the device's Wi-Fi and data off: they're always switched back on.
trap 'exec 5>&- 6>&- 7>&- 8>&- 9>&-; "$ADB" shell "svc wifi enable; svc data enable" >/dev/null 2>&1; wait $live_pid $rehearsal_pid $online_pid $keep_pid $deck_pid 2>/dev/null; rm -rf "$work"' EXIT
until [ -s "$work/live-out" ] && [ -s "$work/rehearsal-out" ] && [ -s "$work/online-out" ] && [ -s "$work/keep-out" ] && [ -s "$work/deck-out" ]; do sleep 0.5; done
keep=$(head -1 "$work/keep-out"); deck=$(head -1 "$work/deck-out")
# BeerMat Online: a Pro venue in Bristol with a quiz night.
printf 'pro red-lion-bristol\nevent red-lion-bristol Halloween special\n' >&7
oport=$(node -e "console.log(JSON.parse(process.argv[1]).port)" "$(head -1 "$work/online-out")")
live=$(head -1 "$work/live-out"); rehearsal=$(head -1 "$work/rehearsal-out")
port=$(node -e "console.log(JSON.parse(process.argv[1]).port)" "$live"); key=$(node -e "console.log(JSON.parse(process.argv[1]).hostKey)" "$live")
rport=$(node -e "console.log(JSON.parse(process.argv[1]).port)" "$rehearsal")
./gradlew -q :app:connectedDebugAndroidTest \
  -Pandroid.testInstrumentationRunnerArguments.server="http://$HOST:$port" \
  -Pandroid.testInstrumentationRunnerArguments.hostKey="$key" \
  -Pandroid.testInstrumentationRunnerArguments.rehearsal="http://$HOST:$rport" \
  -Pandroid.testInstrumentationRunnerArguments.online="http://$HOST:$oport" \
  -Pandroid.testInstrumentationRunnerArguments.keepServer="http://$HOST:$(node -e "console.log(JSON.parse(process.argv[1]).port)" "$keep")" \
  -Pandroid.testInstrumentationRunnerArguments.keepHostKey="$(node -e "console.log(JSON.parse(process.argv[1]).hostKey)" "$keep")" \
  -Pandroid.testInstrumentationRunnerArguments.deckServer="http://$HOST:$(node -e "console.log(JSON.parse(process.argv[1]).port)" "$deck")" \
  -Pandroid.testInstrumentationRunnerArguments.deckHostKey="$(node -e "console.log(JSON.parse(process.argv[1]).hostKey)" "$deck")" \
  -Pandroid.injected.androidTest.leaveApksInstalledAfterRun=true "$@"
mkdir -p build/ui-shots
"$ADB" pull /sdcard/Android/data/uk.beermat.app.next/files/shots build/ui-shots/ >/dev/null 2>&1 || true
echo "UI tests passed; screenshots in $(pwd)/build/ui-shots"
