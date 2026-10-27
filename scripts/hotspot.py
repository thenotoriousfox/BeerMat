#!/usr/bin/env python3
"""Dedicated offline AP. Default is inspection only; --apply requires explicit local action."""
import argparse
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import time

PROFILE = 'BeerMat-offline'
TABLE = 'beermat'
DNSMASQ_UNIT = 'beermat-dnsmasq.service'
RUNTIME = '/run/beermat'
# Names from before the rename to BeerMat: a hotspot left up by the old version is still found and taken down.
OLD_PROFILE, OLD_TABLE, OLD_UNITS = 'PubQuiz-offline', 'pubquiz', ('pubquiz-dnsmasq.service', 'pubquiz-ap.service')
OURS = (PROFILE, OLD_PROFILE)
# With --keep-wifi the hotspot runs on this second, virtual interface while the card stays on your normal Wi-Fi.
# NetworkManager cannot drive it: it always starts a Wi-Fi interface as a second client, which cards such as the
# Intel AX200 refuse alongside the existing connection ("Device or resource busy"). wpa_supplicant runs it instead.
AP_IFACE = 'pq0'
AP_UNIT = 'beermat-ap.service'

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

def ap_config(ssid, channel):
    """wpa_supplicant access-point settings for an open network. The SSID is written in hex so any name is safe."""
    commands(AP_IFACE, ssid)
    freq = 2484 if channel == 14 else 2407 + 5 * channel
    return f'ap_scan=2\np2p_disabled=1\nnetwork={{\n  ssid={ssid.encode().hex()}\n  mode=2\n  frequency={freq}\n  key_mgmt=NONE\n}}\n'

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
    commands(interface, 'BeerMat')
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
dhcp-leasefile=/run/beermat/dnsmasq.leases
pid-file=/run/beermat/dnsmasq.pid
'''

def nft_config(interface, port=3000):
    commands(interface, 'BeerMat')
    if not isinstance(port, int) or not 1 <= port <= 65535:
        raise ValueError('Invalid port')
    return f'''table inet {TABLE} {{
 chain portal {{ type nat hook prerouting priority dstnat; policy accept;
  iifname "{interface}" tcp dport 80 redirect to :{port}
 }}
 chain isolation {{ type filter hook forward priority -10; policy accept;
  iifname "{interface}" drop
  oifname "{interface}" drop
 }}
}}
'''

def teardown():
    return [
        ['systemctl', 'stop', DNSMASQ_UNIT],
        ['systemctl', 'stop', AP_UNIT],
        ['nft', 'delete', 'table', 'inet', TABLE],
        ['nmcli', 'connection', 'down', PROFILE],
        ['nmcli', 'connection', 'delete', PROFILE],
    ]

def run(cmd, **kw):
    return subprocess.run(cmd, check=True, text=True, **kw)

def ask(cmd):
    """Output of a read-only command, or '' when it fails."""
    return subprocess.run(cmd, check=False, capture_output=True, text=True).stdout.strip()

def cards():
    """Wi-Fi cards NetworkManager knows (not the hotspot's own pq0): name, AP support and the network each is on."""
    found = []
    for line in ask(['nmcli', '-t', '-f', 'DEVICE,TYPE', 'device', 'status']).splitlines():
        name, _, kind = line.rpartition(':')
        if kind != 'wifi' or name == AP_IFACE:
            continue
        state, network = (ask(['nmcli', '-g', 'GENERAL.STATE,GENERAL.CONNECTION', 'device', 'show', name]).splitlines() + ['', ''])[:2]
        on = state.startswith('100') and network not in OURS
        found.append({'name': name, 'ap': ask(['nmcli', '-g', 'WIFI-PROPERTIES.AP', 'device', 'show', name]) == 'yes',
                      'connected': on, 'network': network if on else '', 'hosting': network in OURS})
    return found

def pick(found, interface='auto', offline=False):
    """The card to host on and whether it keeps its own Wi-Fi connection: a free card that can host, else the first
    that can, hosting beside the network it is on (--keep-wifi) unless offline."""
    able = [c for c in found if c['ap'] and (interface == 'auto' or c['name'] == interface)]
    card = next((c for c in able if not c['connected']), able[0] if able else None)
    if not card:
        return None
    return {'interface': card['name'], 'keepWifi': card['connected'] and not offline}

def running():
    """The hotspot this script started, if it is up: its card, name, and whether it shares a card (--keep-wifi)."""
    ssid = lambda iface: next((l.split('ssid ', 1)[1] for l in ask(['iw', 'dev', iface, 'info']).splitlines() if l.strip().startswith('ssid ')), '')
    if Path(f'/sys/class/net/{AP_IFACE}').exists():
        return {'interface': AP_IFACE, 'ssid': ssid(AP_IFACE), 'keepWifi': True}
    for line in ask(['nmcli', '-t', '-f', 'NAME,DEVICE', 'connection', 'show', '--active']).splitlines():
        name, _, device = line.rpartition(':')
        if name in OURS:
            return {'interface': device, 'ssid': ssid(device), 'keepWifi': False}
    return None

def take_down():
    # Never kill an arbitrary PID from a stale pidfile. Each step runs even if an earlier one
    # fails (for example dnsmasq already stopped), so a partial setup is still fully removed.
    names = ask(['nmcli', '-g', 'NAME', 'connection', 'show']).splitlines()
    steps = [c for c in teardown() if PROFILE in names or c[0] != 'nmcli'] + ([['iw', 'dev', AP_IFACE, 'del']] if Path(f'/sys/class/net/{AP_IFACE}').exists() else [])
    # Whatever the old version left behind, and only that (so a clean laptop doesn't report its absence).
    steps += [['systemctl', 'stop', u] for u in OLD_UNITS if subprocess.run(['systemctl', 'is-active', '--quiet', u], check=False).returncode == 0]
    if f'table inet {OLD_TABLE}' in ask(['nft', 'list', 'tables']):
        steps.append(['nft', 'delete', 'table', 'inet', OLD_TABLE])
    if OLD_PROFILE in names:
        steps += [['nmcli', 'connection', 'down', OLD_PROFILE], ['nmcli', 'connection', 'delete', OLD_PROFILE]]
    return [' '.join(cmd) for cmd in steps if subprocess.run(cmd, check=False, capture_output=True).returncode != 0]

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('action', choices=['up', 'down', 'check', 'status'])
    p.add_argument('--interface', default='auto', help='Wi-Fi card to host on; auto picks a free one that can host, else shares one')
    p.add_argument('--ssid', default='BeerMat')
    p.add_argument('--apply', action='store_true', help='Actually change local networking (requires approval/root)')
    p.add_argument('--keep-wifi', action='store_true', help='Stay on your normal Wi-Fi as well: host on a virtual interface sharing its 2.4 GHz channel (automatic when the card is connected)')
    p.add_argument('--offline', action='store_true', help='Let the hotspot card leave the network it is on instead of sharing it')
    p.add_argument('--replace', action='store_true', help='Take down a hotspot left from before instead of stopping')
    p.add_argument('--port', type=int, default=3000, help='BeerMat\'s port: phones opening http://10.42.0.1 are sent to it')
    a = p.parse_args()
    if a.action == 'status':
        # Read-only, for the quiz desk: no root needed.
        found = cards()
        print(json.dumps({'wifiOn': ask(['nmcli', 'radio', 'wifi']) == 'enabled', 'cards': found, 'pick': pick(found), 'running': running()}))
        return
    if a.interface == 'auto' or a.action == 'up':
        chosen = pick(cards(), a.interface, a.offline)
        if a.interface == 'auto' and not chosen and a.action != 'down':
            p.error('No Wi-Fi card that can host a hotspot (see: nmcli device status)')
        if chosen:
            a.interface = chosen['interface']
            a.keep_wifi = a.keep_wifi or chosen['keepWifi']
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
    runtime = Path(RUNTIME)
    if a.action == 'down':
        failed = take_down()
        if failed:
            print('Already absent or failed (inspect if unexpected):\n  ' + '\n  '.join(failed))
        return
    capability = run(['nmcli', '-g', 'WIFI-PROPERTIES.AP', 'device', 'show', a.interface], capture_output=True).stdout.strip()
    if capability != 'yes':
        p.error('Selected Wi-Fi adapter does not report AP support')
    # In list mode nmcli calls the connection name field NAME (connection.id only works for a single connection).
    # Leftovers happen when the laptop rejoins another network without running down first.
    leftovers = []
    names = run(['nmcli', '-g', 'NAME', 'connection', 'show'], capture_output=True).stdout.splitlines()
    leftovers += [f'Wi-Fi profile {name}' for name in OURS if name in names]
    tables = run(['nft', 'list', 'tables'], capture_output=True).stdout
    leftovers += [f'firewall table inet {table}' for table in (TABLE, OLD_TABLE) if f'table inet {table}' in tables]
    for unit in (DNSMASQ_UNIT, AP_UNIT, *OLD_UNITS):
        if subprocess.run(['systemctl', 'is-active', '--quiet', unit], check=False).returncode == 0:
            leftovers.append(unit.replace('.service', ' service'))
    if leftovers and a.replace:
        take_down()
    elif leftovers:
        p.error('A previous hotspot is still set up (' + ', '.join(leftovers) + '). Remove it first with:\n'
                f'  sudo python scripts/hotspot.py down --interface {a.interface} --apply' + (' --keep-wifi' if Path(f'/sys/class/net/{AP_IFACE}').exists() else ''))
    channel, connected = None, False
    if a.keep_wifi:
        # One radio can only serve one channel, and this kind of card only hosts on 2.4 GHz while connected.
        link = run(['iw', 'dev', a.interface, 'link'], capture_output=True).stdout
        freq = re.search(r'freq: (\d+)', link)
        # Not connected: host on channel 6. Joining a network later must then use 2.4 GHz channel 6 too.
        channel = channel_of(int(float(freq.group(1)))) if freq else 6
        connected = bool(freq)
        if not freq:
            print(f'{a.interface} is not connected; hosting on channel 6')
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
    run(['nft', '--check', '-f', '-'], input=nft_config(ap, a.port))
    created = firewall = virtual = False
    try:
        if a.keep_wifi:
            run(['iw', 'dev', a.interface, 'interface', 'add', AP_IFACE, 'type', '__ap']); virtual = True
            run(['ip', 'link', 'set', AP_IFACE, 'address', virtual_mac(Path(f'/sys/class/net/{a.interface}/address').read_text().strip())])
            for _ in range(20):  # keep NetworkManager away from it once it has noticed the new interface
                if subprocess.run(['nmcli', 'device', 'set', AP_IFACE, 'managed', 'no'], check=False, capture_output=True).returncode == 0:
                    break
                time.sleep(0.25)
            run(['ip', 'addr', 'add', '10.42.0.1/24', 'dev', AP_IFACE])
            ap_conf = runtime / 'ap.conf'; ap_conf.write_text(ap_config(a.ssid, channel))
            run(['systemd-run', f'--unit={AP_UNIT}', '--collect', '--service-type=exec', shutil.which('wpa_supplicant') or '/usr/bin/wpa_supplicant',
                 '-D', 'nl80211', '-i', AP_IFACE, '-c', str(ap_conf)])
            for _ in range(40):
                # The interface is an AP from creation; it is ready once it broadcasts the network name.
                if '\tssid ' in subprocess.run(['iw', 'dev', AP_IFACE, 'info'], check=False, capture_output=True, text=True).stdout:
                    break
                time.sleep(0.25)
            else:
                raise RuntimeError(f'The hotspot did not start on {AP_IFACE}; see: journalctl -u {AP_UNIT}')
        else:
            run(plan[0]); created = True
            run(plan[1]); run(plan[2])
        run(['nft', '-f', '-'], input=nft_config(ap, a.port)); firewall = True
        run(['systemd-run', '--unit=' + DNSMASQ_UNIT.removesuffix('.service'), '--collect', '--service-type=exec', '/usr/bin/dnsmasq', '--keep-in-foreground', '--conf-file=' + str(config)])
        run(['systemctl', 'is-active', '--quiet', DNSMASQ_UNIT])
    except Exception:
        subprocess.run(['systemctl', 'stop', DNSMASQ_UNIT], check=False)
        subprocess.run(['systemctl', 'stop', AP_UNIT], check=False, capture_output=True)
        if firewall:
            subprocess.run(['nft', 'delete', 'table', 'inet', TABLE], check=False)
        if created:
            subprocess.run(['nmcli', 'connection', 'delete', PROFILE], check=False)
        if virtual:
            subprocess.run(['iw', 'dev', AP_IFACE, 'del'], check=False)
        raise
    print(f'Hotspot "{a.ssid}" ready on {a.interface}' + (' beside the Wi-Fi it is on' if a.keep_wifi else '') + f'. Players: http://10.42.0.1 ; host: http://localhost:{a.port}/host')
    if a.keep_wifi:
        print(f'Hosting on 2.4 GHz channel {channel}' + (' alongside your normal Wi-Fi, which stays connected.' if connected else '.') + ' Stop with: down --keep-wifi --apply')

if __name__ == '__main__':
    main()
