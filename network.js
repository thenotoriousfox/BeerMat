// Playing on a venue's own Wi-Fi or wired network instead of the quiz hotspot: the addresses phones on the same network
// can open, and checks that explain what usually stops them (this laptop's firewall, Wi-Fi client isolation).
// Nothing here changes the router or the laptop's network settings.
import os from 'node:os';

// The quiz hotspot's own address: NetworkManager's shared mode on Linux, Mobile Hotspot (ICS) on Windows.
export const hotspotAddresses = ['10.42.0.1', '192.168.137.1'];
// Adapters phones can never reach: containers, VMs and VPNs.
const virtual = /^(docker|br-|veth|virbr|vmnet|vboxnet|tailscale|zt|wg|tun|tap|utun|awdl|llw|lxc|cni|flannel)|vEthernet|VirtualBox|VMware|Hyper-V|WSL|Loopback/i;
const privateIp = ip => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);

export function lanAddresses(interfaces = os.networkInterfaces()) {
  const kind = (name, ip) => hotspotAddresses.includes(ip) ? 'hotspot' : virtual.test(name) ? 'virtual' : 'lan';
  const order = {lan: 0, hotspot: 1, virtual: 2};
  return Object.entries(interfaces)
    .flatMap(([name, list]) => (list || []).filter(a => (a.family === 'IPv4' || a.family === 4) && !a.internal && !a.address.startsWith('169.254.'))
      .map(a => ({name, address: a.address, kind: kind(name, a.address), private: privateIp(a.address)})))
    .sort((a, b) => order[a.kind] - order[b.kind] || b.private - a.private || a.name.localeCompare(b.name));
}

export const joinUrlFor = (address, port) => `http://${address}${port === 80 ? '' : ':' + port}`;

// Checks for the desk's "Check the connection" button. Each is {id, status: ok|warn|info, text}.
// `probe(url)` resolves true when BeerMat answers at that address; `run` is laptop.js's command runner.
export async function diagnose({port, addresses = lanAddresses(), platform = process.platform, run, probe = fetchProbe}) {
  const checks = [], lan = addresses.filter(a => a.kind === 'lan');
  if (!lan.length) checks.push({id: 'address', status: 'warn', text: addresses.some(a => a.kind === 'hotspot') ? 'This laptop is only on its quiz hotspot. Connect it to the venue Wi-Fi or a network cable to use the venue network.' : 'This laptop is not on a network. Connect it to the venue Wi-Fi or a network cable, or start the quiz hotspot.'});
  for (const a of lan) {
    const url = joinUrlFor(a.address, port);
    checks.push(await probe(url) ? {id: 'reach:' + a.address, status: 'ok', text: `BeerMat answers at ${url} (${a.name}).`}
      : {id: 'reach:' + a.address, status: 'warn', text: `BeerMat did not answer at ${url} (${a.name}). Something on this laptop is blocking it.`});
  }
  checks.push(...await firewall(platform, port, run));
  checks.push({id: 'isolation', status: 'info', text: 'If phones on the venue Wi-Fi still cannot open the address, the network keeps devices apart (client or AP isolation, common on guest and public Wi-Fi). Ask for a network without it, use a network cable to the same router as a staff Wi-Fi, or start the quiz hotspot instead. No router settings are changed by BeerMat.'});
  return checks;
}

async function firewall(platform, port, run) {
  if (!run) return [];
  if (platform === 'win32') {
    const state = await run('netsh', ['advfirewall', 'show', 'currentprofile', 'state'], 10000);
    const profile = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '(Get-NetConnectionProfile | Select-Object -ExpandProperty NetworkCategory) -join ","'], 15000);
    const checks = [];
    if (/State\s+ON/i.test(state.out)) checks.push({id: 'firewall', status: 'info', text: 'Windows Firewall is on. The first time BeerMat runs, Windows asks whether to allow it: tick Private networks. If you missed it, allow BeerMat in Windows Security → Firewall → Allow an app.'});
    if (/Public/i.test(profile.out)) checks.push({id: 'profile', status: 'warn', text: 'Windows treats this network as Public, which blocks phones by default. In Settings → Network → (this network), choose Private, or allow BeerMat on Public networks.'});
    return checks;
  }
  if (platform === 'linux') {
    const firewalld = await run('firewall-cmd', ['--state'], 5000);
    if (firewalld.ok && /running/.test(firewalld.out)) return [{id: 'firewall', status: 'warn', text: `firewalld is running. If phones cannot connect, allow the quiz port: sudo firewall-cmd --add-port=${port}/tcp`}];
    const ufw = await run('systemctl', ['is-active', 'ufw'], 5000);
    if (ufw.ok && /^active/.test(ufw.out)) return [{id: 'firewall', status: 'warn', text: `ufw is active. If phones cannot connect, allow the quiz port: sudo ufw allow ${port}/tcp`}];
    return [{id: 'firewall', status: 'ok', text: 'No firewall service (firewalld, ufw) is blocking the quiz port.'}];
  }
  return [];
}

async function fetchProbe(url) {
  try {return (await fetch(url + '/health', {signal: AbortSignal.timeout(2000)})).ok;} catch {return false;}
}
