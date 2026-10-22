// Laptop controls for the quiz desk: the quiz Wi-Fi (scripts/hotspot.py, which needs root, so it runs through pkexec
// and the desktop's own password prompt) and the one-off setup scripts. Each change runs as a background job; the desk
// polls status() and shows the job's last message.
import {execFile} from 'node:child_process';
import {existsSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {QuizError, requireValue} from './model.js';

const exec = (file, args, timeout) => new Promise(resolve => execFile(file, args, {timeout, maxBuffer: 1 << 20}, (error, stdout, stderr) =>
  resolve({ok: !error, code: error ? error.code ?? 1 : 0, out: `${stdout}\n${stderr}`.trim()})));
// What a person needs from a script's output: no Python usage line or "hotspot.py: error:" prefix.
const tidy = out => out.split('\n').filter(l => l.trim() && !/^usage: /.test(l)).map(l => l.replace(/^\S+\.py: error: /, '')).slice(-6).join('\n');

export function createLaptop({root, run = exec, python = '/usr/bin/python3',
  speedQuizzing = process.env.SQ_DOCUMENTS || path.join(os.homedir(), 'SpeedQuizzing Documents'),
  piper = [path.join(os.homedir(), '.local/opt/piper/bin/python'), path.join(os.homedir(), '.local/share/piper/en_GB-cori-high.onnx')]} = {}) {
  const hotspot = path.join(root, 'scripts', 'hotspot.py'), script = name => path.join(root, 'scripts', name);
  const jobs = {};
  function job(name, work, done) {
    requireValue(!jobs[name]?.running, 'Still working on the last one', 409);
    jobs[name] = {running: true, ok: null, message: ''};
    work().then(result => {
      // pkexec: 126 = the password prompt was dismissed, 127 = not allowed.
      const message = result.code === 126 ? 'Cancelled at the password prompt.' : result.code === 127 ? 'Not allowed: this account cannot change the Wi-Fi.' : tidy(result.out);
      jobs[name] = {running: false, ok: result.ok, message};
      done?.(result);
    });
  }
  async function wifi() {
    const result = await run(python, [hotspot, 'status'], 10000);
    try {return {available: true, ...JSON.parse(result.out)};} catch {return {available: false};}
  }
  return {
    wifi,
    async status() {
      return {wifi: await wifi(), jobs, setup: {speedQuizzing: existsSync(path.join(speedQuizzing, 'Sounds')), piper: piper.every(f => existsSync(f))}};
    },
    startWifi({card = 'auto', ssid}, done) {
      requireValue(card === 'auto' || /^[a-zA-Z0-9_-]{1,15}$/.test(card), 'Pick a Wi-Fi card');
      requireValue(typeof ssid === 'string' && ssid.trim() && Buffer.byteLength(ssid.trim()) <= 32 && !/[\u0000-\u001f]/.test(ssid), 'Wi-Fi name must be 1–32 bytes');
      job('wifi', () => run('pkexec', [python, hotspot, 'up', '--interface', card, '--ssid', ssid.trim(), '--apply', '--replace'], 180000), done);
    },
    stopWifi(done) {job('wifi', () => run('pkexec', [python, hotspot, 'down', '--apply'], 180000), done);},
    async wifiOn() {const result = await run('nmcli', ['radio', 'wifi', 'on'], 10000); if (!result.ok) throw new QuizError(tidy(result.out) || 'Could not switch Wi-Fi on');},
    soundPack(done) {
      requireValue(existsSync(path.join(speedQuizzing, 'Sounds')), `No SpeedQuizzing sounds found in ${speedQuizzing}`);
      job('soundPack', () => run(process.execPath, [script('sound-pack.mjs'), speedQuizzing], 300000), done);
    },
    bingoVoice(done) {
      requireValue(piper.every(f => existsSync(f)), 'Piper is not installed (docs/QUIZMASTER.md, "A spoken bingo caller")');
      job('bingoVoice', () => run(process.execPath, [script('bingo-voice.mjs')], 900000), done);
    },
  };
}
