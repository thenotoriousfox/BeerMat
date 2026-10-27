#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")/.."
# A PubQuiz icon in the app menu. It runs the desktop app (desktop/main.js, docs/DESKTOP.md) from this folder with
# the repository's Electron (npm install); without Electron, or with --browser-app, scripts/pubquiz-app.sh, which
# opens the desk in the default browser.
app() {
  local apps=${XDG_DATA_HOME:-$HOME/.local/share}/applications icons=${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor/scalable/apps
  local electron=$PWD/node_modules/.bin/electron exec
  mkdir -p "$apps" "$icons"
  cp scripts/pubquiz.svg "$icons/pubquiz.svg"
  if [[ ${1:-} != browser && -x $electron ]] && "$electron" --version >/dev/null 2>&1; then
    exec="Exec=\"$electron\" \"$PWD\""
  else
    [[ ${1:-} == browser ]] || echo 'Electron is not installed here (npm install), so the icon opens the desk in the browser instead.'
    exec="Exec=\"$PWD/scripts/pubquiz-app.sh\""
  fi
  printf '%s\n' '[Desktop Entry]' 'Type=Application' 'Name=PubQuiz' 'Comment=Run a pub quiz: desk, TV screen and quiz Wi-Fi' \
    "$exec" 'Icon=pubquiz' 'Terminal=false' 'Categories=Game;' >"$apps/pubquiz.desktop"
  refresh_menu "$apps"
  echo "PubQuiz is in the app menu (Games). Remove it with: rm $apps/pubquiz.desktop"
}
# Menus that cache their entries pick up the new icon straight away. KDE keeps one cache per environment and reads
# the one matching Plasma's, so while Plasma runs the cache is rebuilt with Plasma's environment (a terminal or SSH
# session can differ and would otherwise rebuild a cache Plasma never reads).
refresh_menu() {
  local build plasma env
  if command -v update-desktop-database >/dev/null; then update-desktop-database "$1" 2>/dev/null || true; fi
  build=$(command -v kbuildsycoca6 || command -v kbuildsycoca5) || return 0
  plasma=$(pgrep -u "$(id -u)" -x plasmashell | head -n 1) || true
  if [[ -n $plasma && -r /proc/$plasma/environ ]]; then
    mapfile -d '' env <"/proc/$plasma/environ"
    env -i "${env[@]}" "$build" --noincremental >/dev/null 2>&1 || true
  else
    "$build" >/dev/null 2>&1 || true
  fi
}
if [[ ${1:-} == --app ]]; then app; exit 0; fi
if [[ ${1:-} == --browser-app ]]; then app browser; exit 0; fi
# Node 22.13 or later (built-in SQLite). A Node already installed is kept, e.g. nodejs-lts-jod, which other apps
# such as balena-etcher depend on; pacman cannot install a second one beside it.
node_ok() { command -v node >/dev/null && node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a==22&&b>=13)?0:1)'; }
packages=(networkmanager dnsmasq nftables python iw curl kdialog cloudflared)
node_ok || packages=(nodejs npm "${packages[@]}")
if [[ ${1:-} != --install ]]; then
  echo 'Preview only. Install prerequisites and the app-menu icon with: ./scripts/setup.sh --install (just the icon: --app; the browser launcher instead: --browser-app)'
  echo "sudo pacman -S --needed ${packages[*]}"
  exit 0
fi
sudo pacman -S --needed "${packages[@]}"
node_ok || { echo "PubQuiz needs Node 22.13 or later; this is $(node --version)" >&2; exit 1; }
npm test
# A spoken bingo caller for the pack's own calls, when Piper is installed (docs/QUIZMASTER.md, "A spoken bingo caller").
if [[ -f soundpack/bingo-calls.json && -x "$HOME/.local/opt/piper/bin/python" && ! -d soundpack/bingo_voice ]]; then node scripts/bingo-voice.mjs; fi
app
printf '%s\n' 'Setup complete. No network settings changed. Start PubQuiz from the app menu; see README.md before starting a hotspot.'
