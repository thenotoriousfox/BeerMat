// Laptop controls for the quiz desk: the quiz Wi-Fi, online mode (a Cloudflare quick tunnel to the players-only port)
// and the one-off setup scripts. Each change runs as a background job; the desk polls status() and shows the job's
// last message.
// The quiz Wi-Fi differs by system. Linux: scripts/hotspot.py (NetworkManager; needs root, so it runs through pkexec
// and the desktop's own password prompt), an open network with a sign-in window. Windows: scripts/hotspot-windows.ps1
// (Windows' Mobile Hotspot, kept off the internet by Windows Filtering Platform filters, so it asks for administrator
// approval once per start), which always has a password.
import {execFile, spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {QuizError, requireValue} from './model.js';

const exec = (file, args, timeout, env) => new Promise(resolve => execFile(file, args, {timeout, maxBuffer: 1 << 20, windowsHide: true, ...(env ? {env} : {})}, (error, stdout, stderr) =>
  resolve({ok: !error, code: error ? error.code ?? 1 : 0, out: `${stdout}\n${stderr}`.trim()})));
const startTunnel = (file, args) => spawn(file, args, {stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true});
const winTools = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles].filter(Boolean).map(dir => path.join(dir, 'cloudflared'));
const onPath = name => [...(process.env.PATH || '').split(path.delimiter), path.join(os.homedir(), '.local/bin'), ...(process.platform === 'win32' ? winTools : [])]
  .flatMap(dir => process.platform === 'win32' ? [path.join(dir, name + '.exe'), path.join(dir, name)] : [path.join(dir, name)]).find(f => existsSync(f)) || null;
// What a person needs from a script's output: no Python usage line or "hotspot.py: error:" prefix.
const tidy = out => out.split('\n').filter(l => l.trim() && !/^usage: /.test(l)).map(l => l.replace(/^\S+\.py: error: /, '')).slice(-6).join('\n');
// Node scripts run with this same runtime; inside the desktop app that is Electron, which runs them as plain Node with this.
const nodeEnv = () => process.versions.electron ? {...process.env, ELECTRON_RUN_AS_NODE: '1'} : undefined;
export const hotspotAddress = platform => platform === 'win32' ? '192.168.137.1' : '10.42.0.1';
// Windows reports the address its hotspot adapter really has (ICS's ScopeAddress can move it off 192.168.137.1).
const reported = (platform, address) => platform === 'win32' && /^\d{1,3}(\.\d{1,3}){3}$/.test(address || '') ? address : hotspotAddress(platform);

export function createLaptop({root, run = exec, tunnel: launch = startTunnel, cloudflared, python = '/usr/bin/python3', platform = process.platform,
  powershell = 'powershell.exe', ownerPid = process.pid, hotspotState = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'BeerMat', 'hotspot'), packDir = path.join(root, 'soundpack'),
  piper = [path.join(os.homedir(), '.local/opt/piper/bin/python'), path.join(os.homedir(), '.local/share/piper/en_GB-cori-high.onnx')]} = {}) {
  const windows = platform === 'win32';
  const hotspot = path.join(root, 'scripts', windows ? 'hotspot-windows.ps1' : 'hotspot.py'), script = name => path.join(root, 'scripts', name);
  // The state folder is shared with the script's administrator helper; the owner is this process, and the helper
  // switches the hotspot off if it goes away.
  const ps = (...args) => [powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', hotspot, ...args, '-StateDir', hotspotState]];
  const jobs = {};
  // Looked for each time, so installing cloudflared while BeerMat runs is enough (tests pass a path, or null for none).
  const tool = () => cloudflared === undefined ? onPath('cloudflared') : cloudflared;
  // Online mode: one cloudflared process while it lasts. The link counts once Cloudflare has registered a connection.
  let tunnel = null, tunnelError = '';
  process.once('exit', () => tunnel?.child.kill());
  const online = () => tunnel ? {url: tunnel.url, ready: tunnel.ready} : null;
  function job(name, work, done) {
    requireValue(!jobs[name]?.running, 'Still working on the last one', 409);
    jobs[name] = {running: true, ok: null, message: ''};
    work().then(result => {
      // pkexec: 126 = the password prompt was dismissed, 127 = not allowed.
      const message = !windows && result.code === 126 ? 'Cancelled at the password prompt.' : !windows && result.code === 127 ? 'Not allowed: this account cannot change the Wi-Fi.' : tidy(result.out);
      jobs[name] = {running: false, ok: result.ok, message};
      done?.(result);
    });
  }
  async function wifi() {
    const result = windows ? await run(...ps('status'), 30000) : await run(python, [hotspot, 'status'], 10000);
    try {
      const status = JSON.parse(result.out.split('\n').find(l => l.startsWith('{')) || '');
      const address = reported(platform, status.address);
      return {available: true, platform: windows ? 'windows' : 'linux', needsPassword: windows, ...status, address,
        running: status.running ? {...status.running, address: reported(platform, status.running.address || address)} : null};
    } catch {return {available: false};}
  }
  return {
    wifi,
    async status() {
      return {wifi: await wifi(), jobs, online: online(), onlineError: tunnelError, cloudflared: !!tool(), platform: windows ? 'windows' : 'linux',
        setup: {piper: piper.every(f => existsSync(f))}};
    },
    // `port` is BeerMat's own port: Linux sends phones that open http://10.42.0.1 there.
    startWifi({card = 'auto', ssid, password = ''}, done, port = 3000) {
      requireValue(card === 'auto' || /^[a-zA-Z0-9_-]{1,15}$/.test(card), 'Pick a Wi-Fi card');
      requireValue(typeof ssid === 'string' && ssid.trim() && Buffer.byteLength(ssid.trim()) <= 32 && !/[\u0000-\u001f]/.test(ssid), 'Wi-Fi name must be 1–32 bytes');
      if (windows) {
        // Windows' Mobile Hotspot is WPA2 only.
        requireValue(typeof password === 'string' && /^[\x20-\x7e]{8,63}$/.test(password), 'Windows needs a Wi-Fi password of 8–63 letters, numbers or symbols');
        const config = Buffer.from(JSON.stringify({ssid: ssid.trim(), password})).toString('base64');
        // Up to 90 seconds of that is the administrator prompt.
        return job('wifi', () => run(...ps('up', config, '-OwnerPid', String(ownerPid)), 180000), done);
      }
      requireValue(Number.isInteger(port) && port > 0 && port < 65536, 'Invalid port');
      job('wifi', () => run('pkexec', [python, hotspot, 'up', '--interface', card, '--ssid', ssid.trim(), '--port', String(port), '--apply', '--replace'], 180000), done);
    },
    online,
    goOnline(port, changed) {
      const cloudflaredPath = tool();
      requireValue(cloudflaredPath, windows ? 'Install cloudflared first: winget install Cloudflare.cloudflared' : 'Install cloudflared first: sudo pacman -S cloudflared');
      requireValue(!tunnel, 'Already online');
      const child = launch(cloudflaredPath, ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`]), mine = {child, url: '', ready: false, log: ''};
      tunnel = mine; tunnelError = '';
      child.stderr?.setEncoding('utf8');
      child.stderr?.on('data', text => {
        mine.log = (mine.log + text).slice(-4000);
        mine.url ||= /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(mine.log)?.[0] || '';
        if (mine.url && !mine.ready && /Registered tunnel connection/.test(mine.log)) {mine.ready = true; changed?.();}
      });
      const ended = error => {
        if (tunnel !== mine) return;
        tunnel = null;
        if (!mine.stopping) tunnelError = error || 'Online mode stopped: ' + (mine.log.split('\n').filter(l => / ERR /.test(l)).pop()?.replace(/^.* ERR /, '') || 'cloudflared quit');
        changed?.();
      };
      child.on('exit', () => ended());
      child.on('error', e => ended('Could not start cloudflared: ' + e.message));
    },
    goOffline() {if (tunnel) {tunnel.stopping = true; tunnel.child.kill();}},
    stopWifi(done) {job('wifi', () => windows ? run(...ps('down'), 60000) : run('pkexec', [python, hotspot, 'down', '--apply'], 180000), done);},
    async wifiOn() {
      requireValue(!windows, 'Switch Wi-Fi on from the Windows quick settings (the network icon on the taskbar)');
      const result = await run('nmcli', ['radio', 'wifi', 'on'], 10000); if (!result.ok) throw new QuizError(tidy(result.out) || 'Could not switch Wi-Fi on');
    },
    bingoVoice(done) {
      requireValue(piper.every(f => existsSync(f)), 'Piper is not installed (docs/QUIZMASTER.md, "A spoken bingo caller")');
      job('bingoVoice', () => run(process.execPath, [script('bingo-voice.mjs'), '--pack', packDir], 900000, nodeEnv()), done);
    },
  };
}
