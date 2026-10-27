#!/usr/bin/env bash
# Copies BeerMat Online's nightly database backups off the server, onto this machine, so losing the server doesn't
# lose the accounts and venues. The backups hold people's email addresses and results: keep the folder private.
#   online/pull-backups.sh ubuntu@<server ip> [folder]       copy now (default folder ~/BeerMatBackups)
#   online/pull-backups.sh --daily ubuntu@<server ip> [folder]  also copy every day (a systemd user timer on this machine)
# It only adds and updates files here; backups the server drops after 14 days stay on this machine.
set -euo pipefail
daily=0; [ "${1:-}" = --daily ] && { daily=1; shift; }
target=${1:?usage: online/pull-backups.sh [--daily] user@server-ip [folder]}
folder=${2:-$HOME/BeerMatBackups}
install -d -m 700 "$folder"
rsync -rt --chmod=D700,F600 -e 'ssh -o BatchMode=yes' --rsync-path='sudo rsync' "$target:/var/backups/beermat-online/" "$folder/"
echo "Backups in $folder: $(ls "$folder" | wc -l) files, newest $(ls -t "$folder" | head -1)"

if [ $daily = 1 ]; then
  units=${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user; mkdir -p "$units"
  script=$(readlink -f "$0")
  cat > "$units/beermat-backups.service" <<UNIT
[Unit]
Description=Copy BeerMat Online's backups to this machine

[Service]
Type=oneshot
ExecStart=$script $target $folder
UNIT
  cat > "$units/beermat-backups.timer" <<UNIT
[Unit]
Description=Copy BeerMat Online's backups every day

[Timer]
OnCalendar=*-*-* 12:00
Persistent=true

[Install]
WantedBy=timers.target
UNIT
  systemctl --user daemon-reload && systemctl --user enable --now beermat-backups.timer
  echo "Copies every day at noon (or when this machine next starts): systemctl --user list-timers beermat-backups.timer"
fi
