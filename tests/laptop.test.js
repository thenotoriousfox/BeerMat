import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createQuiz} from '../server.js';
import {createLaptop} from '../laptop.js';

const hostKey = 'a-secure-quiz-test-key';
const settle = () => new Promise(r => setImmediate(r));

test('laptop jobs: the Wi-Fi goes through pkexec with fixed arguments, and messages read like a person wrote them', async () => {
  const calls = [], results = [];
  const run = async (file, args) => {calls.push([file, ...args]); return results.shift() || {ok: true, code: 0, out: '{"wifiOn":true,"cards":[],"pick":null,"running":null}'};};
  const laptop = createLaptop({root: '/quiz', run, python: '/usr/bin/python3', speedQuizzing: '/nowhere', piper: ['/nowhere']});
  assert.deepEqual((await laptop.status()).wifi, {available: true, wifiOn: true, cards: [], pick: null, running: null});
  assert.deepEqual(calls.pop(), ['/usr/bin/python3', '/quiz/scripts/hotspot.py', 'status']);

  results.push({ok: false, code: 2, out: 'usage: hotspot.py [-h]\nhotspot.py: error: Your Wi-Fi (Home) is on 5 GHz.\n  nmcli connection modify Home 802-11-wireless.band bg'});
  let done; const finished = new Promise(r => {done = r;});
  laptop.startWifi({card: 'auto', ssid: ' Quiz Night '}, done);
  assert.deepEqual(calls.pop(), ['pkexec', '/usr/bin/python3', '/quiz/scripts/hotspot.py', 'up', '--interface', 'auto', '--ssid', 'Quiz Night', '--apply', '--replace']);
  await finished;
  assert.deepEqual((await laptop.status()).jobs.wifi, {running: false, ok: false, message: 'Your Wi-Fi (Home) is on 5 GHz.\n  nmcli connection modify Home 802-11-wireless.band bg'});

  // Dismissing the password prompt says so; one change at a time.
  results.push(new Promise(() => {}));
  laptop.stopWifi();
  assert.throws(() => laptop.stopWifi(), /Still working/);
  const cancelled = createLaptop({root: '/quiz', run: async () => ({ok: false, code: 126, out: 'Error executing command as another user: Request dismissed'})});
  await new Promise(r => cancelled.stopWifi(r));
  assert.equal((await cancelled.status()).jobs.wifi.message, 'Cancelled at the password prompt.');

  for (const bad of [{card: 'wlan0; rm -rf', ssid: 'Quiz'}, {card: 'auto', ssid: ''}, {card: 'auto', ssid: 'x'.repeat(33)}, {card: 'auto', ssid: 'a\nb'}]) assert.throws(() => laptop.startWifi(bad), /Pick a Wi-Fi card|Wi-Fi name/);
  assert.throws(() => laptop.soundPack(), /No SpeedQuizzing sounds/);
  assert.throws(() => laptop.bingoVoice(), /Piper is not installed/);
});

async function fixture(options, fn) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'quiz-laptop-'));
  const quiz = createQuiz({hostKey, database: path.join(dir, 'quiz.sqlite'), mediaDir: dir, packDir: path.join(dir, 'no-pack'), soundsDir: path.join(dir, 'no-pack'), ...options});
  await new Promise(r => quiz.server.listen(0, r));
  const port = quiz.server.address().port;
  const call = async (route, body = {}, key = route.startsWith('host/') ? host : '', address = '127.0.0.1') => {
    const response = await fetch(`http://${address}:${port}/api/${route}`, {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + key}, body: JSON.stringify(body)});
    return {status: response.status, ...await response.json()};
  };
  const host = (await call('login', {key: hostKey})).key;
  try {await fn({call, port});} finally {await quiz.close(); rmSync(dir, {recursive: true, force: true});}
}
// A stand-in for the laptop: the Wi-Fi is whatever the test says, and jobs finish when the test lets them.
function fakeLaptop() {
  const fake = {running: null, started: [], pending: [],
    wifi: async () => ({available: true, wifiOn: true, cards: [], pick: {interface: 'wlan0', keepWifi: false}, running: fake.running}),
    status: async () => ({wifi: await fake.wifi(), jobs: {}, setup: {speedQuizzing: false, piper: false}}),
    startWifi: (options, done) => {fake.started.push(options); fake.pending.push(() => {fake.running = {interface: 'wlan0', ssid: options.ssid, keepWifi: false}; done({ok: true});});},
    stopWifi: done => fake.pending.push(() => {fake.running = null; done({ok: true});}),
    wifiOn: async () => {}, soundPack: done => fake.pending.push(() => done({ok: true})), bingoVoice: () => {},
    finish: () => fake.pending.splice(0).forEach(f => f())};
  return fake;
}

test('desk Wi-Fi: starting it names the network on the TV, and PubQuiz then answers only on the quiz Wi-Fi and the laptop', () => {
  const laptop = fakeLaptop();
  return fixture({laptop}, async ({call}) => {
    assert.equal((await call('host/laptop')).canQuit, false);
    assert.equal((await call('host/laptop/wifi', {action: 'start', card: 'auto', ssid: 'Quiz Night'})).status, 200);
    assert.deepEqual(laptop.started, [{card: 'auto', ssid: 'Quiz Night'}]);
    assert.equal((await call('host/state')).settings.joinSsid, 'Quiz Night');
    laptop.finish(); await settle();
    assert.equal((await call('host/laptop')).wifi.running.ssid, 'Quiz Night');
    // Another address of this computer (its home network) no longer answers; the laptop itself still does.
    const lan = Object.values(os.networkInterfaces()).flat().find(a => a.family === 'IPv4' && !a.internal)?.address;
    if (lan) assert.equal((await call('leaderboard', {}, '', lan).catch(() => ({status: 'unreachable'}))).status, 403);
    assert.equal((await call('host/laptop/wifi', {action: 'stop'})).status, 200);
    laptop.finish(); await settle();
    if (lan) assert.equal((await call('host/laptop', {}, undefined, lan)).status, 403); // laptop controls stay laptop-only
    assert.equal((await call('host/laptop/setup', {job: 'rm'})).status, 400);
  });
});

test('desk without laptop controls, and closing PubQuiz from the desk', async () => {
  await fixture({}, async ({call}) => assert.equal((await call('host/laptop')).status, 404));
  const laptop = fakeLaptop(); let quit = 0;
  await fixture({laptop, onQuit: () => {quit++;}}, async ({call}) => {
    assert.equal((await call('host/laptop')).canQuit, true);
    assert.equal((await call('host/laptop/quit')).status, 200);
    await settle(); assert.equal(quit, 1);
  });
});

test('the app launcher\'s one-time desk link unlocks the desk once, only on the laptop', () => fixture({deskTicket: 'one-time-ticket-123'}, async ({call}) => {
  assert.equal((await call('login', {ticket: 'wrong-ticket-1234567'})).status, 403);
  const lan = Object.values(os.networkInterfaces()).flat().find(a => a.family === 'IPv4' && !a.internal)?.address;
  if (lan) assert.equal((await call('login', {ticket: 'one-time-ticket-123'}, '', lan)).status, 403);
  const {key} = await call('login', {ticket: 'one-time-ticket-123'});
  assert.equal((await call('host/state', {}, key)).status, 200);
  assert.equal((await call('login', {ticket: 'one-time-ticket-123'})).status, 403);
}));
