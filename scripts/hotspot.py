#!/usr/bin/env python3
"""Dedicated offline AP. Default is inspection only; --apply requires explicit local action."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import time

PROFILE = 'PubQuiz-offline'
TABLE = 'pubquiz'
# With --keep-wifi the hotspot runs on this second, virtual interface while the card stays on your normal Wi-Fi.
AP_IFACE = 'pq0'

def channel_of(freq):
    """2.4 GHz channel for a frequency in MHz, or None for 5/6 GHz."""
    if 2412 <= freq <= 2472:
        return (freq - 2407) // 5
    return 14 if freq == 2484 else None

def virtual_mac(mac):
    """A locally administered address next to the card's own, so the hotspot does not clash with it."""
    parts = [int(x, 16) for x in mac.split(':')]
    parts[0] = (parts[0] | 0x02) & 0xFE
    parts[5] ^= 0x01
    return ':'.join(f'{x:02x}' for x in parts)

def commands(interface, ssid, channel=None):
    if not re.fullmatch(r'[a-zA-Z0-9_-]{1,15}', interface):
        raise ValueError('Invalid interface')
    if not 1 <= len(ssid.encode()) <= 32:
        raise ValueError('SSID must be 1–32 bytes')
    return [
        ['nmcli', 'connection', 'add', 'type', 'wifi', 'ifname', interface, 'con-name', PROFILE, 'ssid', ssid],
        ['nmcli', 'connection', 'modify', PROFILE, '802-11-wireless.mode', 'ap', '802-11-wireless.band', 'bg', 'connection.autoconnect', 'no', 'ipv4.method', 'manual', 'ipv4.addresses', '10.42.0.1/24', 'ipv4.never-default', 'yes', 'ipv6.method', 'disabled']
        + (['802-11-wireless.channel', str(channel)] if channel else []),
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
    p.add_argument('--keep-wifi', action='store_true', help='Stay on your normal Wi-Fi as well: host on a virtual interface sharing its 2.4 GHz channel')
    a = p.parse_args()
    ap = AP_IFACE if a.keep_wifi else a.interface
    plan = commands(ap, a.ssid)
    if a.action == 'check':
        run(['nmcli', '-f', 'GENERAL,WIFI-PROPERTIES', 'device', 'show', a.interface])
        return
    if not a.apply:
        preview = {'action': a.action, 'commands': plan, 'dnsmasq': dns_config(ap), 'nftables': nft_config(ap)}
        if a.keep_wifi:
            preview['keep_wifi'] = [f'iw dev {a.interface} interface add {AP_IFACE} type __ap', f'ip link set {AP_IFACE} address <card address, locally administered>',
                                    'hotspot uses the 2.4 GHz channel your normal Wi-Fi is on (5 GHz is refused with instructions)']
        print(json.dumps(preview, indent=2))
        return
    if os.geteuid() != 0:
        p.error('--apply requires root')
    runtime = Path('/run/pubquiz')
    if a.action == 'down':
        # Never kill an arbitrary PID from a stale pidfile. Each step runs even if an earlier one
        # fails (for example dnsmasq already stopped), so a partial setup is still fully removed.
        steps = teardown() + ([['iw', 'dev', AP_IFACE, 'del']] if a.keep_wifi or Path(f'/sys/class/net/{AP_IFACE}').exists() else [])
        failed = [' '.join(cmd) for cmd in steps if subprocess.run(cmd, check=False).returncode != 0]
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
    channel = None
    if a.keep_wifi:
        # One radio can only serve one channel, and this kind of card only hosts on 2.4 GHz while connected.
        link = run(['iw', 'dev', a.interface, 'link'], capture_output=True).stdout
        freq = re.search(r'freq: (\d+)', link)
        if not freq:
            p.error(f'{a.interface} is not connected to a Wi-Fi network; connect it first or leave out --keep-wifi')
        channel = channel_of(int(float(freq.group(1))))
        if channel is None:
            home = run(['nmcli', '-g', 'GENERAL.CONNECTION', 'device', 'show', a.interface], capture_output=True).stdout.strip()
            p.error(f"Your Wi-Fi ({home}) is on 5 GHz, and this card can only host on 2.4 GHz while connected.\n"
                    f"Lock that connection to 2.4 GHz, then run this again:\n  nmcli connection modify '{home}' 802-11-wireless.band bg\n  nmcli connection up '{home}'")
        if Path(f'/sys/class/net/{AP_IFACE}').exists():
            p.error(f'{AP_IFACE} already exists; run down first')
        plan = commands(ap, a.ssid, channel)
    runtime.mkdir(mode=0o700, exist_ok=True)
    config = runtime / 'dnsmasq.conf'
    config.write_text(dns_config(ap))
    run(['dnsmasq', '--test', '--conf-file=' + str(config)])
    # Validate the firewall syntax before touching the wireless profile.
    run(['nft', '--check', '-f', '-'], input=nft_config(ap))
    created = firewall = virtual = False
    try:
        if a.keep_wifi:
            run(['iw', 'dev', a.interface, 'interface', 'add', AP_IFACE, 'type', '__ap']); virtual = True
            run(['ip', 'link', 'set', AP_IFACE, 'address', virtual_mac(Path(f'/sys/class/net/{a.interface}/address').read_text().strip())])
            for _ in range(20):  # NetworkManager needs a moment to notice the new interface
                if subprocess.run(['nmcli', 'device', 'set', AP_IFACE, 'managed', 'yes'], check=False, capture_output=True).returncode == 0:
                    break
                time.sleep(0.25)
        run(plan[0]); created = True
        run(plan[1]); run(plan[2])
        run(['nft', '-f', '-'], input=nft_config(ap)); firewall = True
        run(['systemd-run', '--unit=pubquiz-dnsmasq', '--collect', '--service-type=exec', '/usr/bin/dnsmasq', '--keep-in-foreground', '--conf-file=' + str(config)])
        run(['systemctl', 'is-active', '--quiet', 'pubquiz-dnsmasq.service'])
    except Exception:
        subprocess.run(['systemctl', 'stop', 'pubquiz-dnsmasq.service'], check=False)
        if firewall:
            subprocess.run(['nft', 'delete', 'table', 'inet', TABLE], check=False)
        if created:
            subprocess.run(['nmcli', 'connection', 'delete', PROFILE], check=False)
        if virtual:
            subprocess.run(['iw', 'dev', AP_IFACE, 'del'], check=False)
        raise
    print('Hotspot ready. Players: http://10.42.0.1 ; host: http://localhost:3000/host')
    if a.keep_wifi:
        print(f'Sharing 2.4 GHz channel {channel} with your normal Wi-Fi, which stays connected. Stop with: down --keep-wifi --apply')

if __name__ == '__main__':
    main()
