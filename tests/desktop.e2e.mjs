// The desktop app end to end, in a private virtual screen (Xvfb), never on the real desktop:
//   npm run test:desktop      (Linux, needs Xvfb; Playwright drives Electron)
// Checks startup and desk login, the TV preview window and blanking, what each page may reach, the quiz server being
// restarted after a crash, a second copy handing over to the first, closing, and picking the quiz up again.
import assert from 'node:assert/strict';
import {spawn, execFileSync} from 'node:child_process';
import {mkdtempSync, rmSync, existsSync, writeFileSync, readdirSync, readFileSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {_electron as electron} from 'playwright';

const root = path.join(import.meta.dirname, '..');
const binary = path.join(root, 'node_modules', 'electron', 'dist', 'electron');
const data = mkdtempSync(path.join(os.tmpdir(), 'pubquiz-desktop-e2e-')), port = 3900 + Math.floor(Math.random() * 50);
writeFileSync(path.join(data, 'desktop.json'), JSON.stringify({port}));

// A display of its own: Electron must not use the desktop's Wayland or X session.
let number = 90; while (existsSync(`/tmp/.X11-unix/X${number}`)) number++;
const xvfb = spawn('Xvfb', [`:${number}`, '-screen', '0', '1600x900x24', '-nolisten', 'tcp'], {stdio: 'ignore'});
for (let i = 0; i < 50 && !existsSync(`/tmp/.X11-unix/X${number}`); i++) await new Promise(r => setTimeout(r, 100));
const env = {...process.env, DISPLAY: `:${number}`, XDG_SESSION_TYPE: 'x11', PUBQUIZ_USER_DATA: data, PUBQUIZ_TEST: '1', PUBQUIZ_LAPTOP: '0'};
delete env.WAYLAND_DISPLAY;
const launch = () => electron.launch({executablePath: binary, args: [root, '--ozone-platform=x11'], env, timeout: 60000});
const pass = name => console.log('PASS:', name);
const serverPid = () => {
  const line = execFileSync('ss', ['-ltnpH', `sport = :${port}`]).toString();
  return Number(/pid=(\d+)/.exec(line)?.[1]);
};

let app;
try {
  app = await launch();
  const desk = await app.firstWindow();
  await desk.waitForURL(/\/host/);
  await desk.locator('#panel').waitFor({state: 'visible', timeout: 20000});
  assert.equal(desk.url(), `http://127.0.0.1:${port}/host`, 'the one-time ticket is cleared from the address');
  pass('starts the quiz server and opens the desk, logged in with a one-time ticket');

  assert.equal(await desk.evaluate(() => typeof window.require), 'undefined');
  assert.equal(await desk.evaluate(() => typeof window.process), 'undefined');
  assert.deepEqual(await desk.evaluate(() => Object.keys(window.pubquizDesktop).sort()).then(k => k.length), 14);
  await desk.locator('#screensPanel').waitFor({state: 'visible'});
  assert.match(await desk.locator('#screensInfo').textContent(), /One screen connected/);
  pass('desk page: no Node access, only the desktop calls; Screens panel shows one screen');

  const tvOpened = app.waitForEvent('window');
  await desk.locator('#tvOpen').click();
  const tv = await tvOpened;
  await tv.waitForURL(/\/display$/);
  await tv.locator('#projection').waitFor({state: 'attached'});
  const tvWindow = await app.browserWindow(tv);
  assert.equal(await tvWindow.evaluate(w => w.isFullScreen()), false, 'one screen: a preview window');
  assert.equal(await tv.evaluate(() => typeof window.pubquizDesktop), 'undefined', 'the TV page gets no desktop calls');
  assert.equal(await tv.evaluate(() => localStorage.getItem('pubquiz-host')), null, 'the TV page never sees the desk login');
  await desk.locator('#tvBlank').click();
  await tv.waitForFunction(() => document.documentElement.classList.contains('pubquiz-blank'));
  assert.equal(await tvWindow.evaluate(w => w.webContents.isAudioMuted()), true);
  await desk.locator('#tvBlank').click();
  await tv.waitForFunction(() => !document.documentElement.classList.contains('pubquiz-blank'));
  pass('TV preview window opens from the desk, blanks and unblanks without reloading; it has no desk access');

  await desk.evaluate(() => {location.href = 'https://example.com/';}).catch(() => {});
  await new Promise(r => setTimeout(r, 500));
  assert.match(desk.url(), /\/host$/, 'the desk cannot be navigated away from the quiz server');
  pass('pages stay on the quiz server; outside links go to the normal browser instead');

  // A team joins; the server is killed; the app restarts it and the desk carries on logged in.
  const base = `http://127.0.0.1:${port}`;
  const team = await (await fetch(base + '/api/join', {method: 'POST', body: JSON.stringify({name: 'Desktop Foxes'})})).json();
  assert.ok(team.secret);
  const before = serverPid();
  process.kill(before, 'SIGKILL');
  let after;
  for (let i = 0; i < 100; i++) {await new Promise(r => setTimeout(r, 100)); try {after = serverPid(); if (after && after !== before) break;} catch {}}
  assert.ok(after && after !== before, 'a new quiz server process');
  await desk.locator('#panel').waitFor({state: 'visible', timeout: 20000});
  await desk.waitForFunction(() => document.body.textContent.includes('Desktop Foxes'), null, {timeout: 20000});
  const state = await (await fetch(base + '/api/state', {method: 'POST', headers: {Authorization: 'Bearer ' + team.secret}, body: '{}'})).json();
  assert.equal(state.team.name, 'Desktop Foxes');
  pass('quiz server killed mid-quiz: restarted by the app, desk logged in again, the team keeps its place');

  // A second copy hands over to the running one and exits.
  const second = spawn(binary, [root, '--ozone-platform=x11'], {env, stdio: 'ignore'});
  const code = await new Promise(r => second.on('exit', r));
  assert.equal(code, 0);
  assert.equal(app.windows().length, 2);
  pass('a second copy exits and leaves the running one in charge');

  assert.ok(existsSync(path.join(data, 'quiz.sqlite')));
  assert.ok(readdirSync(path.join(data, 'backups')).length >= 1, 'a backup was taken when the server restarted');
  assert.match(readFileSync(path.join(data, 'logs', 'pubquiz.log'), 'utf8'), /Restarting the quiz server/);
  await app.close(); app = null;
  await assert.rejects(fetch(base + '/health'), 'the quiz server stops with the app');
  pass('data, backups and logs in the user data folder; closing stops the quiz server');

  app = await launch();
  const again = await app.firstWindow();
  await again.locator('#panel').waitFor({state: 'visible', timeout: 20000});
  await again.waitForFunction(() => document.body.textContent.includes('Desktop Foxes'), null, {timeout: 20000});
  pass('reopened: the quiz carries on where it was');
} finally {
  await app?.close().catch(() => {});
  xvfb.kill();
  rmSync(data, {recursive: true, force: true});
}
