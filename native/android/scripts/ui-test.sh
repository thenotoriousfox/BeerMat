#!/usr/bin/env bash
# Runs the app's UI tests on a connected device or emulator against real quiz servers on this computer: a live quiz
# (Pro, every format) and a Free laptop's rehearsal. The emulator reaches this computer at 10.0.2.2; a real phone
# on the same network: set HOST to this computer's address. Screenshots land in build/ui-shots.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(cd ../.. && pwd)
HOST=${HOST:-10.0.2.2}
ADB=${ANDROID_HOME:-$HOME/Android/Sdk}/platform-tools/adb
work=$(mktemp -d)
mkfifo "$work/live-in" "$work/rehearsal-in"
node --disable-warning=ExperimentalWarning "$ROOT/tests/fixtures/serve.mjs" pro full --bind 0.0.0.0 < "$work/live-in" > "$work/live-out" & live_pid=$!
node --disable-warning=ExperimentalWarning "$ROOT/tests/fixtures/serve.mjs" free --bind 0.0.0.0 < "$work/rehearsal-in" > "$work/rehearsal-out" & rehearsal_pid=$!
# Holding the fifos open keeps the servers running; closing them (on exit) stops them.
exec 5> "$work/live-in" 6> "$work/rehearsal-in"
trap 'exec 5>&- 6>&-; wait $live_pid $rehearsal_pid 2>/dev/null; rm -rf "$work"' EXIT
until [ -s "$work/live-out" ] && [ -s "$work/rehearsal-out" ]; do sleep 0.5; done
live=$(head -1 "$work/live-out"); rehearsal=$(head -1 "$work/rehearsal-out")
port=$(node -e "console.log(JSON.parse(process.argv[1]).port)" "$live"); key=$(node -e "console.log(JSON.parse(process.argv[1]).hostKey)" "$live")
rport=$(node -e "console.log(JSON.parse(process.argv[1]).port)" "$rehearsal")
./gradlew -q :app:connectedDebugAndroidTest \
  -Pandroid.testInstrumentationRunnerArguments.server="http://$HOST:$port" \
  -Pandroid.testInstrumentationRunnerArguments.hostKey="$key" \
  -Pandroid.testInstrumentationRunnerArguments.rehearsal="http://$HOST:$rport" \
  -Pandroid.injected.androidTest.leaveApksInstalledAfterRun=true "$@"
mkdir -p build/ui-shots
"$ADB" pull /sdcard/Android/data/uk.beermat.app.next/files/shots build/ui-shots/ >/dev/null 2>&1 || true
echo "UI tests passed; screenshots in $(pwd)/build/ui-shots"
