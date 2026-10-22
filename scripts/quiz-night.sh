#!/usr/bin/env bash
# Everything for a quiz night in one go: starts the offline quiz Wi-Fi, runs PubQuiz on it, and takes the Wi-Fi down
# again when PubQuiz stops (Ctrl+C), even if it crashed.
#
#   ./scripts/quiz-night.sh                     hotspot "PubQuiz" on the laptop's Wi-Fi card
#   ./scripts/quiz-night.sh --keep-wifi         ...while staying on your normal Wi-Fi too (for Spotify)
#   ./scripts/quiz-night.sh --ssid "Quiz Night" --interface wlan0
#
# Asks for your password (sudo, for the Wi-Fi) and the quizmaster key. Same steps by hand: README.md, "Offline hotspot".
set -euo pipefail
cd -- "$(dirname -- "$0")/.."

ssid=PubQuiz iface='' extra=()
while (($#)); do
  case $1 in
    --ssid) ssid=$2; shift 2 ;;
    --interface) iface=$2; shift 2 ;;
    --keep-wifi) extra+=(--keep-wifi); shift ;;
    *) echo "Unknown option: $1 (see the top of $0)" >&2; exit 2 ;;
  esac
done
# The first Wi-Fi card NetworkManager knows, unless one was named.
iface=${iface:-$(nmcli -t -f DEVICE,TYPE device status | awk -F: '$2 == "wifi" {print $1; exit}')}
[[ -n $iface ]] || { echo 'No Wi-Fi card found; name one with --interface (see: nmcli device status)' >&2; exit 1; }

if [[ -z ${HOST_KEY:-} ]]; then
  read -r -s -p 'Quizmaster key (12+ characters): ' HOST_KEY
  printf '\n'
  ((${#HOST_KEY} >= 12)) || { echo 'The key needs at least 12 characters' >&2; exit 1; }
  export HOST_KEY
fi

down() { echo 'Taking the quiz Wi-Fi down...'; sudo python scripts/hotspot.py down --interface "$iface" --apply "${extra[@]}" || true; }
sudo python scripts/hotspot.py up --interface "$iface" --ssid "$ssid" --apply "${extra[@]}"
trap down EXIT
echo "Quiz Wi-Fi \"$ssid\" is up. Ctrl+C here ends the quiz night and takes it down."
./scripts/start.sh --hotspot
