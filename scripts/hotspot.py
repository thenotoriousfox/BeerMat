#!/usr/bin/env python3
"""Dedicated offline AP. Default is inspection only; --apply requires explicit local action."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess

PROFILE = 'PubQuiz-offline'
TABLE = 'pubquiz'

def commands(interface, ssid):
    if not re.fullmatch(r'[a-zA-Z0-9_-]{1,15}', interface):
        raise ValueError('Invalid interface')
    if not 1 <= len(ssid.encode()) <= 32:
        raise ValueError('SSID must be 1–32 bytes')
    return [
        ['nmcli', 'connection', 'add', 'type', 'wifi', 'ifname', interface, 'con-name', PROFILE, 'ssid', ssid],
        ['nmcli', 'connection', 'modify', PROFILE, '802-11-wireless.mode', 'ap', '802-11-wireless.band', 'bg', 'connection.autoconnect', 'no', 'ipv4.method', 'manual', 'ipv4.addresses', '10.42.0.1/24', 'ipv4.never-default', 'yes', 'ipv6.method', 'disabled'],
        ['nmcli', 'connection', 'up', PROFILE],
    ]

def dns_config(interface):
    commands(interface, 'PubQuiz')
    return f'''interface={interface}
except-interface=lo
bind-interfaces
listen-address=10.42.0.1
port=53
no-resolv
no-hosts
address=/#/10.42.0.1
dhcp-range=10.42.0.20,10.42.0.220,255.255.255.0,12h
dhcp-option=3,10.42.0.1
dhcp-option=6,10.42.0.1
dhcp-authoritative
dhcp-leasefile=/run/pubquiz/dnsmasq.leases
pid-file=/run/pubquiz/dnsmasq.pid
'''

def nft_config(interface):
    commands(interface, 'PubQuiz')
    return f'''table inet {TABLE} {{
 chain portal {{ type nat hook prerouting priority dstnat; policy accept;
  iifname "{interface}" tcp dport 80 redirect to :3000
 }}
 chain isolation {{ type filter hook forward priority -10; policy accept;
  iifname "{interface}" drop
  oifname "{interface}" drop
 }}
}}
'''

def teardown():
    return [
        ['systemctl', 'stop', 'pubquiz-dnsmasq.service'],
        ['nft', 'delete', 'table', 'inet', TABLE],
        ['nmcli', 'connection', 'down', PROFILE],
        ['nmcli', 'connection', 'delete', PROFILE],
    ]

def run(cmd, **kw):
    return subprocess.run(cmd, check=True, text=True, **kw)

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('action', choices=['up', 'down', 'check'])
    p.add_argument('--interface', default='wlan0')
    p.add_argument('--ssid', default='PubQuiz')
    p.add_argument('--apply', action='store_true', help='Actually change local networking (requires approval/root)')
    a = p.parse_args()
    plan = commands(a.interface, a.ssid)
    if a.action == 'check':
        run(['nmcli', '-f', 'GENERAL,WIFI-PROPERTIES', 'device', 'show', a.interface])
        return
    if not a.apply:
        print(json.dumps({'action': a.action, 'commands': plan, 'dnsmasq': dns_config(a.interface), 'nftables': nft_config(a.interface)}, indent=2))
        return
    if os.geteuid() != 0:
        p.error('--apply requires root')
    runtime = Path('/run/pubquiz')
    if a.action == 'down':
        # Never kill an arbitrary PID from a stale pidfile. Each step runs even if an earlier one
        # fails (for example dnsmasq already stopped), so a partial setup is still fully removed.
        failed = [' '.join(cmd) for cmd in teardown() if subprocess.run(cmd, check=False).returncode != 0]
        if failed:
            print('Already absent or failed (inspect if unexpected):\n  ' + '\n  '.join(failed))
        return
    capability = run(['nmcli', '-g', 'WIFI-PROPERTIES.AP', 'device', 'show', a.interface], capture_output=True).stdout.strip()
    if capability != 'yes':
        p.error('Selected Wi-Fi adapter does not report AP support')
    # In list mode nmcli calls the connection name field NAME (connection.id only works for a single connection).
    existing = run(['nmcli', '-g', 'NAME', 'connection', 'show'], capture_output=True).stdout.splitlines()
    if PROFILE in existing:
        p.error('PubQuiz profile already exists; inspect/stop it first')
    if run(['nft', 'list', 'tables'], capture_output=True).stdout.find('table inet pubquiz') >= 0:
        p.error('PubQuiz firewall table already exists; inspect/stop it first')
    runtime.mkdir(mode=0o700, exist_ok=True)
    config = runtime / 'dnsmasq.conf'
    config.write_text(dns_config(a.interface))
    run(['dnsmasq', '--test', '--conf-file=' + str(config)])
    # Validate the firewall syntax before touching the wireless profile.
    run(['nft', '--check', '-f', '-'], input=nft_config(a.interface))
    created = firewall = False
    try:
        run(plan[0]); created = True
        run(plan[1]); run(plan[2])
        run(['nft', '-f', '-'], input=nft_config(a.interface)); firewall = True
        run(['systemd-run', '--unit=pubquiz-dnsmasq', '--collect', '--service-type=exec', '/usr/bin/dnsmasq', '--keep-in-foreground', '--conf-file=' + str(config)])
        run(['systemctl', 'is-active', '--quiet', 'pubquiz-dnsmasq.service'])
    except Exception:
        subprocess.run(['systemctl', 'stop', 'pubquiz-dnsmasq.service'], check=False)
        if firewall:
            subprocess.run(['nft', 'delete', 'table', 'inet', TABLE], check=False)
        if created:
            subprocess.run(['nmcli', 'connection', 'delete', PROFILE], check=False)
        raise
    print('Hotspot ready. Players: http://10.42.0.1 ; host: http://localhost:3000/host')

if __name__ == '__main__':
    main()
