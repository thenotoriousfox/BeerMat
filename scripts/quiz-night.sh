#!/usr/bin/env bash
# Everything for a quiz night in one go: starts the offline quiz Wi-Fi, runs PubQuiz on it, and takes the Wi-Fi down
# again when PubQuiz stops (Ctrl+C), even if it crashed.
#
#   ./scripts/quiz-night.sh                     hotspot "PubQuiz", while the laptop stays on your normal Wi-Fi
#   ./scripts/quiz-night.sh --offline           hotspot only: the hotspot card leaves your normal Wi-Fi
#
# With two Wi-Fi cards (e.g. a USB adapter on your home Wi-Fi), the hotspot goes on the one that isn't connected and
# the other is left alone. With one card, it hosts beside your home Wi-Fi on that card (hotspot.py --keep-wifi).
#   ./scripts/quiz-night.sh --ssid "Quiz Night" --interface wlan0
#
# Asks for your password (sudo, for the Wi-Fi) and the quizmaster key. Same steps by hand: README.md, "Dedicated CachyOS Wi-Fi".
set -euo pipefail
cd -- "$(dirname -- "$0")/.."

ssid=PubQuiz iface='' offline=''
while (($#)); do
  case $1 in
    --ssid) ssid=$2; shift 2 ;;
    --interface) iface=$2; shift 2 ;;
    --offline) offline=1; shift ;;
    *) echo "Unknown option: $1 (see the top of $0)" >&2; exit 2 ;;
  esac
done
# Unless one was named: a Wi-Fi card that can host and isn't connected to anything, else the first one that can host.
connected() { [[ $(nmcli -g GENERAL.STATE device show "$1") == 100* ]]; }
if [[ -z $iface ]]; then
  for card in $(nmcli -t -f DEVICE,TYPE device status | awk -F: '$2 == "wifi" {print $1}'); do
    [[ $(nmcli -g WIFI-PROPERTIES.AP device show "$card") == yes ]] || continue
    if ! connected "$card"; then iface=$card; break; fi
    iface=${iface:-$card}
  done
fi
[[ -n $iface ]] || { echo 'No Wi-Fi card that can host a hotspot; name one with --interface (see: nmcli device status)' >&2; exit 1; }
# Share the card with your home Wi-Fi only when it is on it.
extra=()
if [[ -z $offline ]] && connected "$iface"; then extra=(--keep-wifi); fi
echo "Quiz Wi-Fi on $iface${extra:+, alongside the Wi-Fi it is connected to}."

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
