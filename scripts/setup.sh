#!/usr/bin/env bash
set -euo pipefail
if [[ ${1:-} != --install ]]; then
  echo 'Preview only. Install prerequisites with: ./scripts/setup.sh --install'
  echo 'sudo pacman -S --needed nodejs npm networkmanager dnsmasq nftables python'
  exit 0
fi
sudo pacman -S --needed nodejs npm networkmanager dnsmasq nftables python
node -e 'if(Number(process.versions.node.split(".")[0])<24)process.exit(1)'
npm test
# Sounds, buzzers and bingo calls from SpeedQuizzing on this laptop become PubQuiz's defaults (kept out of git).
if [[ -d "${SQ_DOCUMENTS:-$HOME/SpeedQuizzing Documents}/Sounds" ]]; then node scripts/sound-pack.mjs; fi
# A spoken bingo caller for the pack's own calls, when Piper is installed (docs/QUIZMASTER.md, "A spoken bingo caller").
if [[ -f soundpack/"Customisable Bingo Calls.txt" && -x "$HOME/.local/opt/piper/bin/python" && ! -d soundpack/bingo_voice ]]; then node scripts/bingo-voice.mjs; fi
printf '%s\n' 'Setup complete. No network settings changed. See README.md before starting a hotspot.'
