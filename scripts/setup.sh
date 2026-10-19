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
printf '%s\n' 'Setup complete. No network settings changed. See README.md before starting a hotspot.'
