import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {createQuiz} from '../server/server.js';
import {createLaptop} from '../server/laptop.js';

const hostKey = 'a-secure-quiz-test-key';
const settle = () => new Promise(r => setImmediate(r));

test('laptop jobs: the Wi-Fi goes through pkexec with fixed arguments, and messages read like a person wrote them', async () => {
  const calls = [], results = [];
  const run = async (file, args) => {calls.push([file, ...args]); return results.shift() || {ok: true, code: 0, out: '{"wifiOn":true,"cards":[],"pick":null,"running":null}'};};
  const laptop = createLaptop({root: '/quiz', run, python: '/usr/bin/python3', piper: ['/nowhere']});
  assert.deepEqual((await laptop.status()).wifi, {available: true, platform: 'linux', needsPassword: false, wifiOn: true, cards: [], pick: null, running: null, address: '10.42.0.1'});
  assert.deepEqual(calls.pop(), ['/usr/bin/python3', '/quiz/scripts/hotspot.py', 'status']);

  results.push({ok: false, code: 2, out: 'usage: hotspot.py [-h]\nhotspot.py: error: Your Wi-Fi (Home) is on 5 GHz.\n  nmcli connection modify Home 802-11-wireless.band bg'});
  let done; const finished = new Promise(r => {done = r;});
  laptop.startWifi({card: 'auto', ssid: ' Quiz Night '}, done, 3000);
  assert.deepEqual(calls.pop(), ['pkexec', '/usr/bin/python3', '/quiz/scripts/hotspot.py', 'up', '--interface', 'auto', '--ssid', 'Quiz Night', '--port', '3000', '--apply', '--replace']);
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
  assert.throws(() => laptop.bingoVoice(), /Piper is not installed/);
});

test('laptop jobs on Windows: Mobile Hotspot through PowerShell, always with a password, settings passed as base64 JSON', async () => {
  const calls = [], results = [];
  const run = async (file, args) => {calls.push([file, ...args]); return results.shift() || {ok: true, code: 0, out: '{"available":true,"platform":"windows","needsPassword":true,"wifiOn":true,"cards":[{"name":"Wi-Fi","ap":true,"connected":true}],"pick":{"interface":"Mobile Hotspot","keepWifi":true},"running":null}'};};
  const laptop = createLaptop({root: 'C:\\BeerMat', run, platform: 'win32', cloudflared: null, piper: ['/nowhere'], ownerPid: 4242, hotspotState: 'C:\\State'});
  const status = await laptop.status();
  assert.equal(status.platform, 'windows');
  assert.equal(status.wifi.needsPassword, true);
  assert.equal(status.wifi.address, '192.168.137.1');
  const ps = ['powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join('C:\\BeerMat', 'scripts', 'hotspot-windows.ps1')];
  const state = ['-StateDir', 'C:\\State'];
  assert.deepEqual(calls.pop(), [...ps, 'status', ...state]);
  assert.throws(() => laptop.startWifi({ssid: 'Quiz', password: 'short'}), /8–63/);
  assert.throws(() => laptop.startWifi({ssid: 'Quiz', password: 'pässwörd-long'}), /8–63/);
  let done; const finished = new Promise(r => {done = r;});
  laptop.startWifi({ssid: '-Action down', password: 'quiz night 2024'}, done);
  // The script's administrator helper stops the hotspot if this process (its owner) goes away.
  const call = calls.pop(), config = call[ps.length + 1];
  assert.deepEqual(call, [...ps, 'up', config, '-OwnerPid', '4242', ...state]);
  assert.deepEqual(JSON.parse(Buffer.from(config, 'base64').toString()), {ssid: '-Action down', password: 'quiz night 2024'});
  assert.match(config, /^[A-Za-z0-9+/=]+$/);
  await finished;
  // A Windows exit code 126 is not a dismissed password prompt.
  results.push({ok: false, code: 126, out: 'Windows could not stop Mobile Hotspot'});
  await new Promise(r => laptop.stopWifi(r));
  assert.deepEqual(calls.pop(), [...ps, 'down', ...state]);
  assert.equal((await laptop.status()).jobs.wifi.message, 'Windows could not stop Mobile Hotspot');
  await assert.rejects(laptop.wifiOn(), /quick settings/);
  assert.throws(() => laptop.goOnline(3001), /winget install Cloudflare.cloudflared/);
  // The JSON line is found even after PowerShell warnings.
  results.push({ok: true, code: 0, out: 'WARNING: something\n{"available":false,"reason":"No API"}'});
  assert.deepEqual((await laptop.wifi()), {available: false, platform: 'windows', needsPassword: true, reason: 'No API', address: '192.168.137.1', running: null});
  // The address is the one the hotspot's adapter really has (ICS can be moved off 192.168.137.1), never made up.
  const isolation = {configured: true, state: 'applied', filters: 14, present: 14, interfaceIndex: 23};
  results.push({ok: true, code: 0, out: JSON.stringify({available: true, platform: 'windows', address: '192.168.140.1',
    running: {interface: 'Mobile Hotspot', ssid: 'Quiz', address: '192.168.140.1', interfaceIndex: 23, clients: 2, isolation}})});
  const moved = await laptop.wifi();
  assert.deepEqual([moved.address, moved.running.address, moved.running.isolation], ['192.168.140.1', '192.168.140.1', isolation]);
  results.push({ok: true, code: 0, out: JSON.stringify({available: true, address: 'not an address; rm', running: {ssid: 'Quiz', address: null}})});
  const odd = await laptop.wifi();
  assert.deepEqual([odd.address, odd.running.address], ['192.168.137.1', '192.168.137.1']);
});

// A stand-in for Windows' Mobile Hotspot: what hotspot-windows.ps1 status reports. The phones are this test, so their
// requests arrive at 127.0.0.1, which plays the hotspot's address here. None of this shows that Windows really keeps
// phones off the internet: that needs a Windows laptop and a phone (docs/DESKTOP.md).
function windowsLaptop(isolation) {
  const fake = fakeLaptop();
  const running = () => fake.running && {...fake.running, interface: 'Mobile Hotspot', address: '127.0.0.1', adapter: 'Local Area Connection* 10', interfaceIndex: 23, clients: 1, isolation: fake.isolation};
  fake.isolation = isolation;
  fake.wifi = async () => ({available: true, platform: 'windows', needsPassword: true, wifiOn: true, cards: [], address: '127.0.0.1', pick: {interface: 'Mobile Hotspot', keepWifi: true}, running: running()});
  return fake;
}

test('Windows quiz Wi-Fi: isolation is "on" only when its filters are, and "verified" only once phones fail to reach the internet', () => {
  const laptop = windowsLaptop({configured: true, state: 'applied', filters: 14, present: 14, interfaceIndex: 23});
  return fixture({laptop, reachProbe: async url => url.startsWith('http://127.0.0.1:')}, async ({call, port}) => {
    assert.equal((await call('host/laptop/wifi', {action: 'start', ssid: 'Quiz Night', password: 'quiz night 2024'})).status, 200);
    laptop.finish(); await settle(); await settle();
    // The join address (and the TV's QR code) is the one Windows gave the hotspot's adapter.
    assert.equal((await call('host/state')).settings.joinUrl, `http://127.0.0.1:${port}`);
    let wifi = (await call('host/laptop')).wifi.running;
    assert.deepEqual([wifi.reachable, wifi.isolation.configured, wifi.isolation.verified, wifi.isolation.phones], [true, true, false, 0]);
    assert.match(wifi.isolation.text, /Not checked yet/);
    assert.equal((await call('host/preflight')).checks.find(c => c.id === 'isolation').status, 'warn');
    // A phone on the quiz Wi-Fi is asked once to try the internet, and says it could not.
    const team = await call('join', {name: 'Offline Otters'});
    assert.equal((await call('state', {}, team.secret)).isolationCheck, true);
    assert.equal((await call('team/isolation', {ipv4: false, ipv6: false, dns: false}, team.secret)).status, 200);
    assert.equal((await call('state', {}, team.secret)).isolationCheck, undefined);
    assert.equal((await call('team/isolation', {ipv4: true}, team.secret)).status, 409);
    wifi = (await call('host/laptop')).wifi.running;
    assert.deepEqual([wifi.isolation.verified, wifi.isolation.phones, wifi.isolation.reached], [true, 1, 0]);
    assert.equal((await call('host/preflight')).checks.find(c => c.id === 'isolation').status, 'pass');
    assert.equal((await call('team/isolation', {}, 'not-a-team')).status, 401);
    // Starting the quiz Wi-Fi again starts the check again.
    await call('host/laptop/wifi', {action: 'stop'}); laptop.finish(); await settle();
    await call('host/laptop/wifi', {action: 'start', ssid: 'Quiz Night', password: 'quiz night 2024'}); laptop.finish(); await settle(); await settle();
    assert.equal((await call('host/laptop')).wifi.running.isolation.phones, 0);
    // A phone that reached the internet is a failure on the desk, whatever the filters say.
    assert.equal((await call('state', {}, team.secret)).isolationCheck, true);
    await call('team/isolation', {ipv4: true, ipv6: false, dns: true}, team.secret);
    wifi = (await call('host/laptop')).wifi.running;
    assert.deepEqual([wifi.isolation.verified, wifi.isolation.reached, wifi.isolation.reachedBy], [false, 1, ['Offline Otters']]);
    assert.match(wifi.isolation.text, /reached the internet \(Offline Otters\)/);
    assert.equal((await call('host/preflight')).checks.find(c => c.id === 'isolation').status, 'fail');
  });
});

test('Windows quiz Wi-Fi without its filters (helper gone, or started outside BeerMat) says so, and phones cannot vouch for it', () => {
  const laptop = windowsLaptop({configured: false, state: 'applied', filters: 14, present: 14, reason: 'The BeerMat isolation helper is no longer running, so phones may reach the internet. Stop and start the quiz Wi-Fi.'});
  return fixture({laptop, reachProbe: async () => false}, async ({call}) => {
    await call('host/laptop/wifi', {action: 'start', ssid: 'Quiz Night', password: 'quiz night 2024'}); laptop.finish(); await settle(); await settle();
    const wifi = (await call('host/laptop')).wifi.running;
    assert.deepEqual([wifi.reachable, wifi.isolation.configured, wifi.isolation.verified], [false, false, false]);
    assert.match(wifi.isolation.text, /^Not guaranteed: The BeerMat isolation helper is no longer running/);
    const check = (await call('host/preflight')).checks.find(c => c.id === 'isolation');
    assert.deepEqual([check.status, check.label], ['fail', 'Players kept off the internet']);
    // Even phones that report cannot turn an unfiltered hotspot into a verified one.
    const team = await call('join', {name: 'Leaky Llamas'});
    await call('team/isolation', {ipv4: false, ipv6: false, dns: false}, team.secret);
    assert.equal((await call('host/laptop')).wifi.running.isolation.verified, false);
  });
});

test('Linux quiz Wi-Fi is unchanged: no isolation check is asked of phones', () => {
  const laptop = fakeLaptop();
  return fixture({laptop}, async ({call}) => {
    await call('host/laptop/wifi', {action: 'start', card: 'auto', ssid: 'Quiz Night'}); laptop.finish(); await settle();
    const team = await call('join', {name: 'Penguins'});
    assert.equal((await call('state', {}, team.secret)).isolationCheck, undefined);
    assert.equal((await call('team/isolation', {}, team.secret)).status, 409);
    assert.equal((await call('host/laptop')).wifi.running.isolation, undefined);
    assert.equal((await call('host/preflight')).checks.find(c => c.id === 'isolation'), undefined);
  });
});

async function fixture(options, fn) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'quiz-laptop-'));
  const quiz = createQuiz({plan: 'pro', hostKey, database: path.join(dir, 'quiz.sqlite'), mediaDir: dir, packDir: path.join(dir, 'no-pack'), soundsDir: path.join(dir, 'no-pack'), ...options});
  await new Promise(r => quiz.server.listen(0, r));
  const port = quiz.server.address().port;
  const call = async (route, body = {}, key = route.startsWith('host/') ? host : '', address = '127.0.0.1') => {
    const response = await fetch(`http://${address}:${port}/api/${route}`, {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + key}, body: JSON.stringify(body)});
    return {status: response.status, ...await response.json()};
  };
  const host = (await call('login', {key: hostKey})).key; await call('host/settings', {waitingRoom: false});
  try {await fn({call, port, quiz});} finally {await quiz.close(); rmSync(dir, {recursive: true, force: true});}
}
// A stand-in for the laptop: the Wi-Fi is whatever the test says, and jobs finish when the test lets them.
function fakeLaptop() {
  const fake = {running: null, started: [], pending: [],
    wifi: async () => ({available: true, wifiOn: true, cards: [], pick: {interface: 'wlan0', keepWifi: false}, running: fake.running}),
    status: async () => ({wifi: await fake.wifi(), jobs: {}, setup: {piper: false}}),
    startWifi: (options, done) => {fake.started.push(options); fake.pending.push(() => {fake.running = {interface: 'wlan0', ssid: options.ssid, keepWifi: false}; done({ok: true});});},
    stopWifi: done => fake.pending.push(() => {fake.running = null; done({ok: true});}),
    tunnel: null, online: () => fake.tunnel, goOnline: () => {fake.tunnel = {url: 'https://quiz-test.trycloudflare.com', ready: true};}, goOffline: () => {fake.tunnel = null;},
    wifiOn: async () => {}, bingoVoice: () => {},
    finish: () => fake.pending.splice(0).forEach(f => f())};
  return fake;
}

test('desk Wi-Fi: starting it names the network on the TV, and BeerMat then answers only on the quiz Wi-Fi and the laptop', () => {
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
    // From another device the desk sees the panel, but the Wi-Fi (its password prompt is on the laptop) stays local.
    if (lan) {assert.equal((await call('host/laptop', {}, undefined, lan)).local, false); assert.equal((await call('host/laptop/wifi', {action: 'stop'}, undefined, lan)).status, 403);}
    for (const job of ['rm', 'soundPack']) assert.equal((await call('host/laptop/setup', {job})).status, 400, job);
  });
});

test('desk without laptop controls, and closing BeerMat from the desk', async () => {
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

test('online mode: cloudflared\'s link counts once a connection is registered, and a crash is reported', async () => {
  const children = [];
  const tunnel = (file, args) => {const child = new EventEmitter(); child.stderr = new PassThrough(); child.kill = () => child.emit('exit', null); child.args = [file, ...args]; children.push(child); return child;};
  let changes = 0;
  const laptop = createLaptop({root: '/quiz', tunnel, cloudflared: '/usr/bin/cloudflared', run: async () => ({ok: true, code: 0, out: '{}'})});
  laptop.goOnline(3001, () => changes++);
  assert.deepEqual(children[0].args, ['/usr/bin/cloudflared', 'tunnel', '--no-autoupdate', '--url', 'http://127.0.0.1:3001']);
  assert.throws(() => laptop.goOnline(3001), /Already online/);
  children[0].stderr.write('INF |  https://plain-words-here.trycloudflare.com  |\n'); await settle();
  assert.deepEqual(laptop.online(), {url: 'https://plain-words-here.trycloudflare.com', ready: false});
  children[0].stderr.write('INF Registered tunnel connection connIndex=0\n'); await settle();
  assert.deepEqual([laptop.online().ready, changes], [true, 1]);
  laptop.goOffline();
  assert.deepEqual([laptop.online(), (await laptop.status()).onlineError], [null, '']);
  laptop.goOnline(3001);
  children[1].stderr.write('2026-10-22T10:00:00Z ERR Failed to fetch quick Tunnel: no network\n'); await settle();
  children[1].emit('exit', 1);
  assert.equal((await laptop.status()).onlineError, 'Online mode stopped: Failed to fetch quick Tunnel: no network');
  assert.throws(() => createLaptop({root: '/quiz', cloudflared: null}).goOnline(3001), /Install cloudflared/);
});

test('the online link reaches the players\' and TV pages, the desk only when allowed, and shows itself as the join address', () => {
  const laptop = fakeLaptop();
  return fixture({laptop}, async ({call, quiz}) => {
    await new Promise(r => quiz.publicServer.listen(0, '127.0.0.1', r));
    const online = (route, init) => fetch(`http://127.0.0.1:${quiz.publicServer.address().port}${route}`, init);
    const post = (route, body, key = '') => online('/api/' + route, {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + key}, body: JSON.stringify(body)});
    for (const route of ['/host', '/host.js']) assert.equal((await online(route)).status, 404);
    assert.equal((await post('login', {key: hostKey})).status, 404);
    const desk = (await call('login', {key: hostKey})).key;
    assert.equal((await post('host/state', {}, desk)).status, 404); // not even with a valid desk session
    assert.equal((await online('/')).status, 200); assert.equal((await online('/tv')).status, 200);
    const team = await (await post('join', {name: 'Online Owls'})).json();
    assert.ok(team.secret);
    assert.equal((await (await online('/api/leaderboard')).json()).settings.joinUrl, 'http://10.42.0.1');
    assert.equal((await call('host/laptop/online', {action: 'start'})).status, 200);
    const shown = (await (await online('/api/leaderboard')).json()).settings;
    assert.deepEqual([shown.joinUrl, shown.online], ['https://quiz-test.trycloudflare.com', true]);
    assert.equal((await call('host/state')).settings.joinUrl, 'http://10.42.0.1'); // the saved join details are untouched
    // The quizmaster can put the desk on the link too; the quiz Wi-Fi still only changes at the laptop.
    await call('host/settings', {deskOnline: true});
    assert.equal((await online('/host')).status, 200);
    const remote = (await (await post('login', {key: hostKey})).json()).key;
    assert.equal((await post('host/state', {}, remote)).status, 200);
    assert.equal((await (await post('host/laptop', {}, remote)).json()).local, false);
    assert.equal((await post('host/laptop/wifi', {action: 'stop'}, remote)).status, 403);
    assert.equal((await post('login', {ticket: 'anything-at-all-123'})).status, 403);
    // Wrong keys are counted per visitor, so one guesser cannot lock out the rest.
    const guess = ip => online('/api/login', {method: 'POST', headers: {'Content-Type': 'application/json', 'CF-Connecting-IP': ip}, body: JSON.stringify({key: 'wrong-key-attempt'})});
    for (let i = 0; i < 10; i++) assert.equal((await guess('203.0.113.9')).status, 403);
    assert.equal((await guess('203.0.113.9')).status, 429);
    assert.equal((await guess('198.51.100.7')).status, 403);
    await call('host/settings', {deskOnline: false});
    assert.equal((await post('host/state', {}, remote)).status, 404);
    await call('host/laptop/online', {action: 'stop'});
    assert.equal((await (await online('/api/leaderboard')).json()).settings.online, undefined);
  });
});

test('online players get live nudges over a WebSocket, and their https pages may post', () => fixture({}, async ({call, quiz}) => {
  await new Promise(r => quiz.publicServer.listen(0, '127.0.0.1', r));
  const port = quiz.publicServer.address().port, host = `127.0.0.1:${port}`;
  const team = await call('join', {name: 'Socket Sloths'});
  const socket = new WebSocket(`ws://${host}/api/events?key=${team.secret}`), messages = [];
  socket.onmessage = e => messages.push(Number(e.data));
  await new Promise(r => {socket.onopen = r;});
  await new Promise(r => setTimeout(r, 100));
  const first = messages.length;
  assert.ok(first >= 1);
  await call('host/settings', {title: 'Nudged'});
  await new Promise(r => setTimeout(r, 100));
  assert.ok(messages.length > first && messages.at(-1) > messages[0]);
  // Through the tunnel the page is https; on the quiz Wi-Fi port only http pages may post.
  const post = (p, origin) => fetch(`http://127.0.0.1:${p}/api/join`, {method: 'POST', headers: {'Content-Type': 'application/json', Origin: origin}, body: JSON.stringify({name: 'Origin ' + p})});
  assert.equal((await post(port, `https://${host}`)).status, 200);
  assert.equal((await post(quiz.server.address().port, `https://127.0.0.1:${quiz.server.address().port}`)).status, 403);
  assert.equal((await post(port, 'https://evil.example')).status, 403);
  // A bad team key is refused before the upgrade.
  const bad = new WebSocket(`ws://${host}/api/events?key=nope`);
  assert.equal(await new Promise(r => {bad.onopen = () => r('open'); bad.onerror = () => r('refused');}), 'refused');
  socket.close();
}));

test('cloudflared installed while BeerMat runs is found without a restart', async () => {
  const {mkdtempSync, writeFileSync, rmSync} = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
  const dir = mkdtempSync(path.join(os.tmpdir(), 'quiz-path-')), saved = process.env.PATH, home = process.env.HOME;
  process.env.PATH = dir; process.env.HOME = dir;
  try {
    const laptop = createLaptop({root: '/quiz', run: async () => ({ok: true, code: 0, out: '{}'})});
    assert.equal((await laptop.status()).cloudflared, false);
    writeFileSync(path.join(dir, 'cloudflared'), '');
    assert.equal((await laptop.status()).cloudflared, true);
  } finally {process.env.PATH = saved; process.env.HOME = home; rmSync(dir, {recursive: true, force: true});}
});
