#!/usr/bin/env bash
# Puts BeerMat Online on a fresh Ubuntu 22.04/24.04 server (an Oracle Cloud Always Free VM, or any VPS), from this
# repository on your own machine:
#   online/deploy.sh ubuntu@<server ip> [domain]
# Without a domain it uses <ip>.sslip.io, a free name that points at the server's IP; with one, <ip>.sslip.io keeps
# working too (for apps built before the domain). Run it again to update the
# service; the database is kept. What it sets up:
#   * Node.js 24 (official build, checksum checked) in /opt/node
#   * the service in /opt/beermat-online, run by systemd as its own user, listening on 127.0.0.1:8080 only
#   * Caddy in front, with HTTPS from Let's Encrypt (renewed by itself)
#   * PySide6 (Qt, no browser engine) in /opt/beermat-qt, to draw shared themes' TV and app pictures
#   * ports 80 and 443 opened in the server's firewall (Oracle's images block them)
#   * a nightly database backup in /var/backups/beermat-online (14 kept); copy them off the server too
#   * the key that signs BeerMat Pro licences, from ~/.local/share/beermat/licence-key.txt (or LICENCE_KEY_FILE),
#     in /etc/beermat-online, readable by the service only. Without it the service runs but issues no licences.
#   * /etc/beermat-online/env for secrets set on the server by hand (made empty the first time), such as the email
#     service's key: RESEND_API_KEY=… and MAIL_FROM="BeerMat <noreply@your.domain>". Restart the service after editing.
set -euo pipefail
target=${1:?usage: online/deploy.sh user@server-ip [domain]}
repo=$(cd "$(dirname "$0")/.." && pwd)
ip=$(ssh -o BatchMode=yes "$target" "curl -fsS4 https://ifconfig.me || hostname -I | cut -d' ' -f1")
domain=${2:-$(echo "$ip" | tr . -).sslip.io}
echo "Server $ip, address https://$domain"

# Only what the service needs: itself, the shared modules it imports, the web app it serves at /app/ and the admin
# console at /admin/.
stage=$(mktemp -d); trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/online" "$stage/mobile" "$stage/shared"
cp "$repo/online/service.js" "$repo/online/client.js" "$repo/online/admin.js" "$repo/online/preview.js" "$repo/online/qt-preview.js" "$stage/online/"
# Shared themes' TV and app pictures, drawn by BeerMat Desk's own TV and app mock (online/qt-preview.js): the desk's
# Python and QML that draw them, run by PySide6 (Qt without a browser engine, about 250 MB) installed on the server.
mkdir -p "$stage/native/beermat_desk"
cp "$repo"/native/beermat_desk/{__init__.py,looks.py,previews.py,gradients.py} "$stage/native/beermat_desk/" && cp -r "$repo/native/beermat_desk/qml" "$stage/native/beermat_desk/"
mkdir -p "$stage/web" && cp "$repo/web/i18n.js" "$repo/web/qr.js" "$stage/web/"   # the TV's words in the quiz's language, and its QR code
# THEME_PREVIEWS=1: shared themes get a picture of a phone's browser too (online/preview.js), which needs the quiz
# engine and Playwright's Chromium (about 400 MB) on the server. Without it, themes still have the desk's pictures.
if [ "${THEME_PREVIEWS:-0}" = 1 ]; then
  mkdir -p "$stage/server" "$stage/web" && cp "$repo"/server/*.js "$stage/server/" && cp -r "$repo"/web/. "$stage/web/"
  cp "$repo/brand/fredoka.woff2" "$repo/brand/mark.svg" "$stage/brand/" 2>/dev/null || true
  printf '%s\n' "$(node -p 'require("'"$repo"'/package.json").devDependencies?.playwright || require("'"$repo"'/package.json").dependencies?.playwright')" > "$stage/playwright-version"
fi
cp "$repo"/shared/*.js "$stage/shared/"
mkdir -p "$stage/server" && cp "$repo/server/model.js" "$stage/server/"   # the quiz engine's checks, for shared quizzes (shared/quiz-file.js)
mkdir -p "$stage/brand" && cp "$repo"/brand/*.svg "$repo/brand/fredoka.woff2" "$repo"/brand/fredoka-*.ttf "$repo/brand/logo-email.png" "$stage/brand/"
cp -r "$repo/mobile/www" "$stage/mobile/"
cp -r "$repo/online/admin" "$repo/online/pages" "$stage/online/"
printf '{"private": true, "type": "module"}\n' > "$stage/package.json"
tar -C "$stage" -czf - . | ssh "$target" "rm -rf /tmp/beermat-online && mkdir /tmp/beermat-online && tar -C /tmp/beermat-online -xzf -"

licence_key=${LICENCE_KEY_FILE:-$HOME/.local/share/beermat/licence-key.txt}
if [ -f "$licence_key" ]; then ssh "$target" "umask 077 && cat > /tmp/beermat-licence-key" < "$licence_key"
else echo "No licence key at $licence_key: the service won't issue BeerMat Pro licences"; fi

ssh "$target" "sudo DOMAIN='$domain' IP_NAME='$(echo "$ip" | tr . -).sslip.io' bash -s" <<'REMOTE'
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
# Small servers (1 GB, like Oracle's free AMD shape) get 2 GB of swap so updates and Node have room.
if [ "$(swapon --noheadings | wc -l)" = 0 ] && [ "$(awk '/MemTotal/ {print $2}' /proc/meminfo)" -lt 2000000 ]; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap -q /swapfile && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
apt-get update -qq
apt-get install -y -qq caddy sqlite3 curl xz-utils rsync iptables-persistent ffmpeg >/dev/null
# Qt for the shared themes' TV and app pictures: Python, the libraries Qt draws with off screen, and a sans serif.
apt-get install -y -qq python3-venv libegl1 libgl1 libxkbcommon0 libfontconfig1 libdbus-1-3 libglib2.0-0 fonts-noto-core >/dev/null
[ -x /opt/beermat-qt/bin/python ] || python3 -m venv /opt/beermat-qt
/opt/beermat-qt/bin/python -c 'import PySide6.QtQuick' 2>/dev/null || /opt/beermat-qt/bin/pip install -q --no-cache-dir PySide6-Essentials==6.11.1

# Node.js 24 from nodejs.org, checked against its published checksums.
arch=$(uname -m); case $arch in x86_64) arch=x64;; aarch64) arch=arm64;; esac
if ! /opt/node/bin/node -e 'process.exit(Number(process.versions.node.split(".")[0] < 24))' 2>/dev/null; then
  base=https://nodejs.org/dist/latest-v24.x
  file=$(curl -fsS $base/SHASUMS256.txt | grep -o "node-v[0-9.]*-linux-$arch.tar.xz" | head -1)
  cd /tmp && curl -fsSO $base/$file && curl -fsS $base/SHASUMS256.txt | grep " $file\$" | sha256sum -c -
  rm -rf /opt/node && mkdir /opt/node && tar -C /opt/node --strip-components=1 -xJf $file && rm $file
fi
/opt/node/bin/node --version

id beermat >/dev/null 2>&1 || useradd --system --home /var/lib/beermat-online --shell /usr/sbin/nologin beermat
install -d -o beermat -g beermat -m 700 /var/lib/beermat-online
install -d -m 750 -g beermat /var/backups/beermat-online
chgrp beermat /var/backups/beermat-online && chmod 750 /var/backups/beermat-online
install -d -m 750 -g beermat /etc/beermat-online
[ -f /etc/beermat-online/env ] || install -o root -g beermat -m 640 /dev/null /etc/beermat-online/env
if [ -f /tmp/beermat-licence-key ]; then
  install -D -o root -g beermat -m 640 /tmp/beermat-licence-key /etc/beermat-online/licence-key.txt && rm /tmp/beermat-licence-key
fi
rm -rf /opt/beermat-online && mv /tmp/beermat-online /opt/beermat-online && chown -R root:root /opt/beermat-online && chmod -R u=rwX,go=rX /opt/beermat-online
# Theme browser previews (THEME_PREVIEWS=1 on the computer deploying): Playwright and its Chromium, outside any home
# folder so the service's user can run it.
if [ -f /opt/beermat-online/playwright-version ]; then
  cd /opt/beermat-online && /opt/node/bin/npm install --no-save --no-audit --no-fund "playwright@$(cat playwright-version)" >/dev/null
  PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright /opt/node/bin/npx playwright install --with-deps chromium >/dev/null
  chmod -R a+rX /opt/ms-playwright && cd /
fi

cat > /etc/systemd/system/beermat-online.service <<UNIT
[Unit]
Description=BeerMat Online
After=network-online.target
Wants=network-online.target

[Service]
User=beermat
WorkingDirectory=/var/lib/beermat-online
Environment=PORT=8080 BIND=127.0.0.1 ONLINE_DB=/var/lib/beermat-online/online.sqlite NODE_ENV=production TRUST_PROXY=1
# Venues are kept here and edited in the admin console; this is only read to show admins when the last backup ran.
Environment=BACKUP_DIR=/var/backups/beermat-online
# Signs BeerMat Pro licences for quiz laptops (shared/licence.js).
Environment=LICENCE_KEY_FILE=/etc/beermat-online/licence-key.txt
# Links in emails (confirm an address, reset a password) point here.
Environment=PUBLIC_URL=https://$DOMAIN
# Secrets added on the server by hand: RESEND_API_KEY, MAIL_FROM.
EnvironmentFile=-/etc/beermat-online/env
Environment=PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright
# Draws shared themes' TV and app pictures (online/qt-preview.js).
Environment=QT_PYTHON=/opt/beermat-qt/bin/python
ExecStart=/opt/node/bin/node --disable-warning=ExperimentalWarning /opt/beermat-online/online/service.js
Restart=on-failure
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/var/lib/beermat-online

[Install]
WantedBy=multi-user.target
UNIT

cat > /etc/systemd/system/beermat-online-backup.service <<'UNIT'
[Unit]
Description=Back up the BeerMat Online database

[Service]
Type=oneshot
ExecStart=/bin/sh -c 'sqlite3 /var/lib/beermat-online/online.sqlite ".backup /var/backups/beermat-online/online-$(date +%%F).sqlite" && ls -1t /var/backups/beermat-online/online-*.sqlite | tail -n +15 | xargs -r rm --'
UNIT
cat > /etc/systemd/system/beermat-online-backup.timer <<'UNIT'
[Unit]
Description=Nightly BeerMat Online backup

[Timer]
OnCalendar=*-*-* 04:00
Persistent=true

[Install]
WantedBy=timers.target
UNIT

cat > /etc/caddy/Caddyfile <<CADDY
$DOMAIN {
	encode gzip
	reverse_proxy 127.0.0.1:8080
}
CADDY
if [ "$DOMAIN" != "$IP_NAME" ]; then cat >> /etc/caddy/Caddyfile <<CADDY
$IP_NAME {
	encode gzip
	reverse_proxy 127.0.0.1:8080
}
CADDY
fi

# Oracle's Ubuntu images reject everything but SSH in iptables, as well as in the cloud's security list.
for port in 80 443; do
  iptables -C INPUT -p tcp --dport $port -j ACCEPT 2>/dev/null || iptables -I INPUT 5 -p tcp -m state --state NEW --dport $port -j ACCEPT
done
netfilter-persistent save >/dev/null

systemctl daemon-reload
systemctl enable --now beermat-online beermat-online-backup.timer >/dev/null
systemctl restart beermat-online
# A backup now, so there is always one (and the console shows when).
systemctl start beermat-online-backup
systemctl reload-or-restart caddy
sleep 2; systemctl is-active beermat-online caddy
REMOTE

echo "Waiting for HTTPS on https://$domain …"
for _ in $(seq 30); do curl -fsS "https://$domain/health" >/dev/null 2>&1 && break; sleep 5; done
curl -fsS "https://$domain/health" && echo && echo "BeerMat Online is up: https://$domain"
