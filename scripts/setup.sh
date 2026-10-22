#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")/.."
# A PubQuiz icon in the app menu, running scripts/pubquiz-app.sh from this folder.
app() {
  local apps=${XDG_DATA_HOME:-$HOME/.local/share}/applications icons=${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor/scalable/apps
  mkdir -p "$apps" "$icons"
  cp scripts/pubquiz.svg "$icons/pubquiz.svg"
  printf '%s\n' '[Desktop Entry]' 'Type=Application' 'Name=PubQuiz' 'Comment=Run a pub quiz: quiz Wi-Fi, desk and TV' \
    "Exec=\"$PWD/scripts/pubquiz-app.sh\"" 'Icon=pubquiz' 'Terminal=false' 'Categories=Game;' >"$apps/pubquiz.desktop"
  echo "PubQuiz is in the app menu (Games). Remove it with: rm $apps/pubquiz.desktop"
}
if [[ ${1:-} == --app ]]; then app; exit 0; fi
if [[ ${1:-} != --install ]]; then
  echo 'Preview only. Install prerequisites and the app-menu icon with: ./scripts/setup.sh --install (just the icon: --app)'
  echo 'sudo pacman -S --needed nodejs npm networkmanager dnsmasq nftables python iw curl kdialog'
  exit 0
fi
sudo pacman -S --needed nodejs npm networkmanager dnsmasq nftables python iw curl kdialog
node -e 'if(Number(process.versions.node.split(".")[0])<24)process.exit(1)'
npm test
# Sounds, buzzers and bingo calls from SpeedQuizzing on this laptop become PubQuiz's defaults (kept out of git).
if [[ -d "${SQ_DOCUMENTS:-$HOME/SpeedQuizzing Documents}/Sounds" ]]; then node scripts/sound-pack.mjs; fi
# A spoken bingo caller for the pack's own calls, when Piper is installed (docs/QUIZMASTER.md, "A spoken bingo caller").
if [[ -f soundpack/"Customisable Bingo Calls.txt" && -x "$HOME/.local/opt/piper/bin/python" && ! -d soundpack/bingo_voice ]]; then node scripts/bingo-voice.mjs; fi
app
printf '%s\n' 'Setup complete. No network settings changed. Start PubQuiz from the app menu; see README.md before starting a hotspot.'
