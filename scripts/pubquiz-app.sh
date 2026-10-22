#!/usr/bin/env bash
# PubQuiz from the app menu (installed by ./scripts/setup.sh --app): asks for the quizmaster key in a window, starts
# PubQuiz in the background and opens the quiz desk, already unlocked. The desk's "Quiz night" panel runs the Wi-Fi and
# closes PubQuiz. If PubQuiz is already running, this just opens the desk. Log: ~/.local/state/pubquiz/server.log
set -uo pipefail
cd -- "$(dirname -- "$(readlink -f -- "$0")")/.."
port=${PORT:-3000} desk="http://localhost:${PORT:-3000}/host"
state=${XDG_STATE_HOME:-$HOME/.local/state}/pubquiz log=${XDG_STATE_HOME:-$HOME/.local/state}/pubquiz/server.log

# KDE's dialogs where there are any, GNOME's otherwise.
if command -v kdialog >/dev/null; then
  ask() { kdialog --title PubQuiz --password "$1"; }
  oops() { kdialog --title PubQuiz --error "$1"; }
elif command -v zenity >/dev/null; then
  ask() { zenity --password --title="PubQuiz — $1"; }
  oops() { zenity --error --title=PubQuiz --text="$1"; }
else
  ask() { echo 'Install kdialog or zenity to start PubQuiz from the app menu' >&2; return 1; }
  oops() { echo "$1" >&2; }
fi
up() { curl -fs --max-time 2 "http://127.0.0.1:$port/health" >/dev/null; }

if up; then xdg-open "$desk"; exit 0; fi
prompt='Quizmaster key (12+ characters). Anyone with it can run the quiz desk.'
while :; do
  key=$(ask "$prompt") || exit 0
  ((${#key} >= 12)) && break
  prompt='That key is too short: use at least 12 characters.'
done

mkdir -p "$state"
umask 077
ticket=$(head -c 24 /dev/urandom | base64 | tr '+/' '-_' | tr -d '=\n')
HOST_KEY=$key DESK_TICKET=$ticket PUBQUIZ_APP=1 setsid node --disable-warning=ExperimentalWarning server.js >>"$log" 2>&1 </dev/null &
for _ in $(seq 50); do
  up && { xdg-open "$desk#ticket=$ticket"; exit 0; }
  kill -0 $! 2>/dev/null || break
  sleep 0.2
done
oops "PubQuiz did not start. The end of its log ($log):

$(tail -n 8 "$log")"
exit 1
