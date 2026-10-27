// The desktop app's parts that do not need Electron: choosing screens, the TV window's behaviour (with stand-in
// screens and windows), settings and key storage, database backups and recovery, and the quiz server process.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, statSync, readdirSync} from 'node:fs';
import {EventEmitter} from 'node:events';
import {fork} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {plan, swapped} from '../desktop/displays.js';
import {createScreens} from '../desktop/screens.js';
import {createPrefs, hostKey} from '../desktop/store.js';
import {prepareDatabase, restoreDatabase, listBackups, checkDatabase, backupDatabase} from '../desktop/database.js';
import {createLog} from '../desktop/log.js';
import {pickOutput, sinkScript} from '../desktop/sound.js';
import {createQuiz} from '../server.js';

const temp = () => mkdtempSync(path.join(os.tmpdir(), 'quiz-desktop-'));
const laptopScreen = {id: 1, label: 'Built-in Retina', internal: true, bounds: {x: 0, y: 0, width: 1440, height: 900}};
const tv = {id: 7, label: 'SAMSUNG TV', internal: false, bounds: {x: 1440, y: 0, width: 1920, height: 1080}};
const projector = {id: 9, label: 'EPSON PJ', internal: false, bounds: {x: 3360, y: 0, width: 1280, height: 720}};

test('screens: desk on the main screen, TV on an external one (biggest first), remembered by id or by name after reconnection', () => {
  assert.deepEqual(plan([laptopScreen], 1), {desk: laptopScreen, audience: null, windowed: true});
  assert.equal(plan([laptopScreen, projector, tv], 1).audience, tv);
  assert.equal(plan([laptopScreen, projector, tv], 1, {audience: {id: 9, label: 'EPSON PJ'}}).audience, projector);
  // Unplugged and plugged back in: a new id, the same name.
  assert.equal(plan([laptopScreen, {...projector, id: 12}, tv], 1, {audience: {id: 9, label: 'EPSON PJ'}}).audience.id, 12);
  // The remembered TV is gone: any other screen; never the desk's own.
  assert.equal(plan([laptopScreen, tv], 1, {audience: {id: 9, label: 'EPSON PJ'}}).audience, tv);
  assert.equal(plan([laptopScreen, tv], 1, {audience: {id: 1, label: 'Built-in Retina'}}).audience, tv);
  // A built-in screen comes after external ones, even if bigger.
  assert.equal(plan([tv, {...laptopScreen, bounds: {x: 0, y: 0, width: 3000, height: 2000}}, projector], 7).audience, projector);
  // Swapped: the desk on the TV's screen.
  const s = swapped(plan([laptopScreen, tv], 1));
  assert.deepEqual(s, {desk: {id: 7, label: 'SAMSUNG TV'}, audience: {id: 1, label: 'Built-in Retina'}});
  assert.deepEqual(plan([laptopScreen, tv], 1, s), {desk: tv, audience: laptopScreen, windowed: false});
  assert.equal(swapped(plan([laptopScreen], 1)), null);
  assert.deepEqual(plan([], 1), {desk: null, audience: null, windowed: true});
});

// Stand-ins for Electron's screen module and BrowserWindow.
function fakeScreen(displays, primary = 1) {
  const s = new EventEmitter();
  s.displays = displays; s.getAllDisplays = () => s.displays; s.getPrimaryDisplay = () => s.displays.find(d => d.id === primary) || s.displays[0];
  s.plug = d => {s.displays = [...s.displays, d]; s.emit('display-added');};
  s.unplug = id => {s.displays = s.displays.filter(d => d.id !== id); s.emit('display-removed');};
  return s;
}
function fakeWindow(options) {
  const w = new EventEmitter(), contents = new EventEmitter();
  Object.assign(w, {options, bounds: options.bounds || {x: 0, y: 0, width: 960, height: 540}, full: options.fullscreen, destroyed: false, shown: 0, muted: false, scripts: [], css: [],
    isDestroyed: () => w.destroyed, isFullScreen: () => w.full, setFullScreen: f => {w.full = f;}, setBounds: b => {w.bounds = b;}, getBounds: () => w.bounds, show: () => w.shown++, maximize() {},
    close: () => {w.destroyed = true; w.emit('closed');}, webContents: contents});
  Object.assign(contents, {executeJavaScript: async js => {w.scripts.push(js);}, setAudioMuted: m => {w.muted = m;}, insertCSS: css => w.css.push(css)});
  return w;
}
function screensFixture(displays, saved = {}) {
  const screen = fakeScreen(displays), opened = [], changes = [];
  let prefs = {autoOpen: true, ...saved};
  const screens = createScreens({screen, prefs: () => prefs, savePrefs: p => {prefs = {...prefs, ...p};}, openAudience: o => {const w = fakeWindow(o); opened.push(w); return w;}, changed: () => changes.push(1)});
  return {screen, screens, opened, changes, prefs: () => prefs};
}

test('TV window: opens full screen on the second screen by itself, a preview window with one screen, and follows screens coming and going', () => {
  const {screen, screens, opened} = screensFixture([laptopScreen]);
  screens.start();
  assert.equal(opened.length, 0, 'one screen: nothing opens by itself');
  assert.equal(screens.info().windowed, true);
  screens.open();
  assert.equal(opened[0].full, false, 'a preview window');
  screens.close();
  // A TV plugged in later takes the audience display full screen on it.
  screen.plug(tv);
  assert.equal(opened.length, 2);
  assert.deepEqual([opened[1].full, opened[1].bounds], [true, tv.bounds]);
  // Unplugged mid-quiz: it carries on as a preview on the desk's screen instead of vanishing.
  screen.unplug(7);
  assert.equal(opened[1].full, false);
  assert.equal(opened[1].isDestroyed(), false);
  assert.ok(opened[1].bounds.x < laptopScreen.bounds.width);
  // Back again (with a new id): full screen there once more.
  screen.plug({...tv, id: 8});
  assert.deepEqual([opened[1].full, opened[1].bounds], [true, tv.bounds]);
  assert.equal(opened.length, 2);
});

test('TV window: choosing a screen, swapping with the desk, blanking without reloading, switching auto-open off', () => {
  const {screen, screens, opened, prefs} = screensFixture([laptopScreen, tv, projector]);
  screens.start();
  assert.deepEqual(opened[0].bounds, tv.bounds);
  screens.chooseAudience(9);
  assert.deepEqual(prefs().audience, {id: 9, label: 'EPSON PJ'});
  assert.deepEqual(opened[0].bounds, projector.bounds);
  assert.throws(() => screens.chooseAudience(42), /no longer connected/);
  screens.chooseAudience(null);
  assert.deepEqual(opened[0].bounds, tv.bounds);
  screens.swap();
  assert.deepEqual(prefs().desk, {id: 7, label: 'SAMSUNG TV'});
  assert.deepEqual(opened[0].bounds, laptopScreen.bounds);
  assert.equal(screens.info().displays.find(d => d.desk).id, 7);
  opened[0].webContents.emit('did-finish-load');
  assert.match(opened[0].css[0], /pubquiz-blank/);
  screens.toggleBlank();
  assert.deepEqual([opened[0].muted, opened[0].scripts.at(-1)], [true, "document.documentElement.classList.toggle('pubquiz-blank', true)"]);
  assert.equal(screens.info().blanked, true);
  screens.setBlank(false);
  assert.equal(opened[0].muted, false);
  // A blanked TV stays blank across a page reload.
  screens.setBlank(true); opened[0].webContents.emit('did-finish-load');
  assert.equal(opened[0].scripts.at(-1), "document.documentElement.classList.toggle('pubquiz-blank', true)");
  screens.close();
  assert.equal(screens.info().open, false);
  screens.setAutoOpen(false);
  screen.plug({...projector, id: 10, label: 'Other'});
  assert.equal(opened.length, 1, 'auto-open off: a new screen does not open the TV');
  const one = screensFixture([laptopScreen]);
  assert.throws(() => one.screens.swap(), /two screens/);
});

test('TV sound: automatic picks the TV\'s HDMI or DisplayPort output only while the TV is full screen; a chosen output only while connected', () => {
  const outputs = ['USB Audio Speakers', 'TU104 HD Audio Controller Digital Stereo (HDMI)', 'Built-in Audio'];
  assert.equal(pickOutput(outputs, 'auto', true), 'TU104 HD Audio Controller Digital Stereo (HDMI)');
  assert.equal(pickOutput(outputs, 'auto', false), null, 'a preview window plays with the laptop');
  assert.equal(pickOutput(['Speakers', 'LG TV (DisplayPort 2)'], 'auto', true), 'LG TV (DisplayPort 2)');
  assert.equal(pickOutput(['Speakers', 'Monitor DP-1 Audio'], 'auto', true), 'Monitor DP-1 Audio');
  assert.equal(pickOutput(['Speakers', 'DPS Headphones'], 'auto', true), null, 'no HDMI output: the laptop\'s');
  assert.equal(pickOutput(outputs, 'laptop', true), null);
  assert.equal(pickOutput(outputs, 'USB Audio Speakers', false), 'USB Audio Speakers', 'a chosen output is used even for a preview');
  assert.equal(pickOutput(outputs, 'Unplugged TV', true), null);
  // The page script carries the name as data, never as code.
  assert.match(sinkScript('Evil"); alert(1); ("'), /\("Evil\\"\); alert\(1\); \(\\""\)$/);
  assert.match(sinkScript(null), /\(null\)$/);
});

test('settings and key: written whole or not at all, broken settings start from defaults, the key is kept encrypted when possible', () => {
  const dir = temp();
  try {
    const file = path.join(dir, 'desktop.json'), prefs = createPrefs(file, {port: 3000, autoOpen: true});
    prefs.set({port: 3005});
    assert.deepEqual(createPrefs(file, {port: 3000, autoOpen: true}).get(), {port: 3005, autoOpen: true});
    assert.deepEqual(readdirSync(dir), ['desktop.json']);
    writeFileSync(file, '{"port": 30');
    assert.deepEqual(createPrefs(file, {port: 3000}).get(), {port: 3000});
    const plainKey = hostKey(path.join(dir, 'key-plain'));
    assert.ok(plainKey.length >= 24);
    assert.equal(hostKey(path.join(dir, 'key-plain')), plainKey);
    if (process.platform !== 'win32') assert.equal(statSync(path.join(dir, 'key-plain')).mode & 0o777, 0o600);
    const crypt = {encrypt: t => Buffer.from([...Buffer.from(t)].reverse()), decrypt: b => Buffer.from([...b].reverse()).toString()};
    const secret = hostKey(path.join(dir, 'key-enc'), crypt);
    assert.equal(readFileSync(path.join(dir, 'key-enc')).subarray(0, 4).toString(), 'enc:');
    assert.equal(readFileSync(path.join(dir, 'key-enc')).includes(secret), false);
    assert.equal(hostKey(path.join(dir, 'key-enc'), crypt), secret);
    const log = createLog(path.join(dir, 'logs', 'app.log'), {limit: 50});
    log('first line', {a: 1}); log('second line pushes past the limit'); log('third');
    assert.match(readFileSync(path.join(dir, 'logs', 'app.log.1'), 'utf8'), /second line/);
    assert.match(readFileSync(path.join(dir, 'logs', 'app.log'), 'utf8'), /third/);
  } finally {rmSync(dir, {recursive: true, force: true});}
});

test('database: a checked copy on each start, the newest ten kept; a damaged file is set aside and the newest good copy restored', async () => {
  const dir = temp(), file = path.join(dir, 'quiz.sqlite'), backups = path.join(dir, 'backups');
  try {
    assert.deepEqual(prepareDatabase(file, backups), {state: 'new'});
    const quiz = createQuiz({hostKey: 'a-secure-quiz-test-key', database: file, mediaDir: dir, packDir: dir, soundsDir: dir});
    quiz.db.prepare("INSERT INTO teams(id,name,secret,seen) VALUES('t1','Foxes','s1',0)").run();
    await quiz.close();
    let time = Date.UTC(2026, 0, 1);
    for (let i = 0; i < 12; i++) assert.equal(prepareDatabase(file, backups, {now: () => time += 1000}).state, 'ok');
    assert.equal(listBackups(backups).length, 10);
    const newest = listBackups(backups)[0].file;
    assert.equal(new DatabaseSync(newest).prepare('SELECT name FROM teams').get().name, 'Foxes');

    writeFileSync(file, Buffer.alloc(8192, 7));
    const damaged = prepareDatabase(file, backups, {now: () => time += 1000});
    assert.equal(damaged.state, 'recovered');
    assert.ok(existsSync(damaged.kept));
    assert.equal(checkDatabase(file), null);
    assert.equal(new DatabaseSync(file).prepare('SELECT name FROM teams').get().name, 'Foxes');

    // Restoring: only a PubQuiz database is accepted; the current one is backed up first.
    const other = path.join(dir, 'other.sqlite'); new DatabaseSync(other).exec('CREATE TABLE x(y)');
    assert.throws(() => restoreDatabase(other, file, backups), /not a BeerMat database/);
    writeFileSync(path.join(dir, 'junk.sqlite'), 'not a database at all, honestly');
    assert.throws(() => restoreDatabase(path.join(dir, 'junk.sqlite'), file, backups), /damaged|not a database/);
    restoreDatabase(newest, file, backups, {now: () => time += 1000});
    assert.ok(listBackups(backups).some(b => b.file.endsWith('before-restore.sqlite')));
    assert.ok(backupDatabase(file, path.join(dir, 'manual'), {label: 'manual'}).endsWith('-manual.sqlite'));

    // Damaged with no backups at all: a fresh start, the damaged file still kept.
    const lonely = path.join(dir, 'lonely.sqlite'); writeFileSync(lonely, Buffer.alloc(4096, 1));
    const reset = prepareDatabase(lonely, path.join(dir, 'none'));
    assert.equal(reset.state, 'reset'); assert.ok(existsSync(reset.kept)); assert.equal(existsSync(lonely), false);
  } finally {rmSync(dir, {recursive: true, force: true});}
});

test('quiz server process: starts on the preferred port or the next free one, mints desk tickets, backs up on request, shuts down cleanly', async () => {
  const dir = temp(), blocker = (await import('node:http')).createServer();
  await new Promise(r => blocker.listen(0, '127.0.0.1', r));
  const busy = blocker.address().port;
  const child = fork(path.join(import.meta.dirname, '..', 'desktop', 'server-host.js'), [], {env: {...process.env, HOST_KEY: 'a-secure-quiz-test-key', PUBQUIZ_DATA: dir, PORT: String(busy), BIND: '127.0.0.1', PUBQUIZ_LAPTOP: '0'}, execArgv: ['--disable-warning=ExperimentalWarning'], stdio: 'pipe'});
  const messages = [];
  const next = type => new Promise((resolve, reject) => {
    const found = messages.find(m => m.type === type); if (found) return resolve(found);
    const timer = setTimeout(() => reject(Error('no ' + type)), 10000);
    child.on('message', function listener(m) {if (m.type === type) {clearTimeout(timer); child.off('message', listener); resolve(m);}});
  });
  child.on('message', m => messages.push(m));
  try {
    const ready = await next('ready');
    assert.notEqual(ready.port, busy);
    assert.equal(ready.port, busy + 2);
    assert.equal(ready.prepared.state, 'new');
    const base = `http://127.0.0.1:${ready.port}`;
    assert.equal((await fetch(base + '/health')).status, 200);
    child.send({type: 'ticket', id: 'a'});
    const {ticket} = await next('ticket');
    const login = await fetch(base + '/api/login', {method: 'POST', body: JSON.stringify({ticket})});
    assert.equal(login.status, 200);
    child.send({type: 'backup', id: 'b', folder: path.join(dir, 'mine')});
    const backup = await next('backup');
    assert.equal(checkDatabase(backup.file), null);
    const exited = new Promise(r => child.on('exit', r));
    child.send({type: 'shutdown', stopWifi: true});
    assert.equal(await exited, 0);
    await assert.rejects(fetch(base + '/health'));
  } finally {child.kill(); blocker.close(); rmSync(dir, {recursive: true, force: true});}
});

test('editions: a single place for a future Free/Pro split, with every feature in every edition today', async () => {
  const {edition, features} = await import('../edition.js');
  for (const name of ['free', 'pro', 'unknown']) for (const f of features) assert.equal(edition(name).has(f), true);
  assert.equal(edition('free').has('somethingElse'), false);
});
