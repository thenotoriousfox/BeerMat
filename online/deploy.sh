#!/usr/bin/env bash
# Puts PubQuiz Online on a fresh Ubuntu 22.04/24.04 server (an Oracle Cloud Always Free VM, or any VPS), from this
# repository on your own machine:
#   online/deploy.sh ubuntu@<server ip> [domain]
# Without a domain it uses <ip>.sslip.io, a free name that points at the server's IP. Run it again to update the
# service; the database is kept. What it sets up:
#   * Node.js 24 (official build, checksum checked) in /opt/node
#   * the service in /opt/pubquiz-online, run by systemd as its own user, listening on 127.0.0.1:8080 only
#   * Caddy in front, with HTTPS from Let's Encrypt (renewed by itself)
#   * ports 80 and 443 opened in the server's firewall (Oracle's images block them)
#   * a nightly database backup in /var/backups/pubquiz-online (14 kept); copy them off the server too
set -euo pipefail
target=${1:?usage: online/deploy.sh user@server-ip [domain]}
repo=$(cd "$(dirname "$0")/.." && pwd)
ip=$(ssh -o BatchMode=yes "$target" "curl -fsS4 https://ifconfig.me || hostname -I | cut -d' ' -f1")
domain=${2:-$(echo "$ip" | tr . -).sslip.io}
echo "Server $ip, address https://$domain"

# Only what the service needs: itself, the shared modules it imports, the venue list, and the web app it serves at /app/.
stage=$(mktemp -d); trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/online" "$stage/mobile"
cp "$repo/online/service.js" "$repo/online/client.js" "$repo/online/admin.js" "$stage/online/"
cp "$repo/claims.js" "$repo/achievements.js" "$repo/venues.js" "$repo/venues.json" "$stage/"
cp -r "$repo/mobile/www" "$stage/mobile/"
printf '{"private": true, "type": "module"}\n' > "$stage/package.json"
tar -C "$stage" -czf - . | ssh "$target" "rm -rf /tmp/pubquiz-online && mkdir /tmp/pubquiz-online && tar -C /tmp/pubquiz-online -xzf -"

ssh "$target" "sudo DOMAIN='$domain' bash -s" <<'REMOTE'
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
# Small servers (1 GB, like Oracle's free AMD shape) get 2 GB of swap so updates and Node have room.
if [ "$(swapon --noheadings | wc -l)" = 0 ] && [ "$(awk '/MemTotal/ {print $2}' /proc/meminfo)" -lt 2000000 ]; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap -q /swapfile && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
apt-get update -qq
apt-get install -y -qq caddy sqlite3 curl xz-utils iptables-persistent >/dev/null

# Node.js 24 from nodejs.org, checked against its published checksums.
arch=$(uname -m); case $arch in x86_64) arch=x64;; aarch64) arch=arm64;; esac
if ! /opt/node/bin/node -e 'process.exit(Number(process.versions.node.split(".")[0] < 24))' 2>/dev/null; then
  base=https://nodejs.org/dist/latest-v24.x
  file=$(curl -fsS $base/SHASUMS256.txt | grep -o "node-v[0-9.]*-linux-$arch.tar.xz" | head -1)
  cd /tmp && curl -fsSO $base/$file && curl -fsS $base/SHASUMS256.txt | grep " $file\$" | sha256sum -c -
  rm -rf /opt/node && mkdir /opt/node && tar -C /opt/node --strip-components=1 -xJf $file && rm $file
fi
/opt/node/bin/node --version

id pubquiz >/dev/null 2>&1 || useradd --system --home /var/lib/pubquiz-online --shell /usr/sbin/nologin pubquiz
install -d -o pubquiz -g pubquiz -m 700 /var/lib/pubquiz-online
install -d -m 700 /var/backups/pubquiz-online
rm -rf /opt/pubquiz-online && mv /tmp/pubquiz-online /opt/pubquiz-online && chown -R root:root /opt/pubquiz-online && chmod -R u=rwX,go=rX /opt/pubquiz-online

cat > /etc/systemd/system/pubquiz-online.service <<'UNIT'
[Unit]
Description=PubQuiz Online
After=network-online.target
Wants=network-online.target

[Service]
User=pubquiz
WorkingDirectory=/var/lib/pubquiz-online
Environment=PORT=8080 BIND=127.0.0.1 ONLINE_DB=/var/lib/pubquiz-online/online.sqlite NODE_ENV=production TRUST_PROXY=1
# The venue list: the copy deployed with the service. Once the repository is public, VENUES_URL (checked hourly) makes
# edits to venues.json on GitHub live without a redeploy:
#   Environment=VENUES_URL=https://raw.githubusercontent.com/DTJW92/PubQuiz/main/venues.json
Environment=VENUES_FILE=/opt/pubquiz-online/venues.json
ExecStart=/opt/node/bin/node --disable-warning=ExperimentalWarning /opt/pubquiz-online/online/service.js
Restart=on-failure
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/var/lib/pubquiz-online

[Install]
WantedBy=multi-user.target
UNIT

cat > /etc/systemd/system/pubquiz-online-backup.service <<'UNIT'
[Unit]
Description=Back up the PubQuiz Online database

[Service]
Type=oneshot
ExecStart=/bin/sh -c 'sqlite3 /var/lib/pubquiz-online/online.sqlite ".backup /var/backups/pubquiz-online/online-$(date +%%F).sqlite" && ls -1t /var/backups/pubquiz-online/online-*.sqlite | tail -n +15 | xargs -r rm --'
UNIT
cat > /etc/systemd/system/pubquiz-online-backup.timer <<'UNIT'
[Unit]
Description=Nightly PubQuiz Online backup

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

# Oracle's Ubuntu images reject everything but SSH in iptables, as well as in the cloud's security list.
for port in 80 443; do
  iptables -C INPUT -p tcp --dport $port -j ACCEPT 2>/dev/null || iptables -I INPUT 5 -p tcp -m state --state NEW --dport $port -j ACCEPT
done
netfilter-persistent save >/dev/null

systemctl daemon-reload
systemctl enable --now pubquiz-online pubquiz-online-backup.timer >/dev/null
systemctl restart pubquiz-online
systemctl reload-or-restart caddy
sleep 2; systemctl is-active pubquiz-online caddy
REMOTE

echo "Waiting for HTTPS on https://$domain …"
for _ in $(seq 30); do curl -fsS "https://$domain/health" >/dev/null 2>&1 && break; sleep 5; done
curl -fsS "https://$domain/health" && echo && echo "PubQuiz Online is up: https://$domain"
