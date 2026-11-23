#!/usr/bin/env bash
# Everything for a quiz night in one go: starts the offline quiz Wi-Fi, runs BeerMat on it, and takes the Wi-Fi down
# again when BeerMat stops (Ctrl+C), even if it crashed.
#
#   ./scripts/quiz-night.sh                     hotspot "BeerMat", while the laptop stays on your normal Wi-Fi
#   ./scripts/quiz-night.sh --offline           hotspot only: the hotspot card leaves your normal Wi-Fi
#
# With two Wi-Fi cards (e.g. a USB adapter on your home Wi-Fi), the hotspot goes on the one that isn't connected and
# the other is left alone. With one card, it hosts beside your home Wi-Fi on that card (hotspot.py --keep-wifi).
#   ./scripts/quiz-night.sh --ssid "Quiz Night" --interface wlan0
#
# Asks for your password (sudo, for the Wi-Fi) and the quizmaster key. Same steps by hand: README.md, "Dedicated CachyOS Wi-Fi".
set -euo pipefail
cd -- "$(dirname -- "$0")/.."

ssid=BeerMat iface=auto extra=()
while (($#)); do
  case $1 in
    --ssid) ssid=$2; shift 2 ;;
    --interface) iface=$2; shift 2 ;;
    --offline) extra+=(--offline); shift ;;
    *) echo "Unknown option: $1 (see the top of $0)" >&2; exit 2 ;;
  esac
done
# hotspot.py picks the card (with --interface auto) and shares it with your home Wi-Fi when it is on one.

if [[ -z ${HOST_KEY:-} ]]; then
  read -r -s -p 'Quizmaster key (12+ characters): ' HOST_KEY
  printf '\n'
  ((${#HOST_KEY} >= 12)) || { echo 'The key needs at least 12 characters' >&2; exit 1; }
  export HOST_KEY
fi

down() { echo 'Taking the quiz Wi-Fi down...'; sudo python scripts/hotspot.py down --apply || true; }
sudo python scripts/hotspot.py up --interface "$iface" --ssid "$ssid" --apply --replace "${extra[@]}"
trap down EXIT
echo "Quiz Wi-Fi \"$ssid\" is up. Ctrl+C here ends the quiz night and takes it down."
./scripts/start.sh --hotspot
