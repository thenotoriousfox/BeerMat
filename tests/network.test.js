import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createQuiz} from '../server/server.js';
import {lanAddresses, diagnose, joinUrlFor} from '../server/network.js';

const hostKey = 'a-secure-quiz-test-key';
const v4 = (address, internal = false) => ({address, family: 'IPv4', internal});
const interfaces = {lo: [v4('127.0.0.1', true)], wlan0: [v4('192.168.1.23'), {address: 'fe80::1', family: 'IPv6', internal: false}], bm0: [v4('10.42.0.1')],
  docker0: [v4('172.17.0.1')], 'vEthernet (WSL)': [v4('172.20.0.1')], eth9: [v4('169.254.3.3')], tailscale0: [v4('100.64.0.2')]};

test('venue network: addresses phones can use come first; the hotspot, containers, VMs and link-local are labelled or left out', () => {
  assert.deepEqual(lanAddresses(interfaces), [
    {name: 'wlan0', address: '192.168.1.23', kind: 'lan', private: true},
    {name: 'bm0', address: '10.42.0.1', kind: 'hotspot', private: true},
    {name: 'docker0', address: '172.17.0.1', kind: 'virtual', private: true},
    {name: 'vEthernet (WSL)', address: '172.20.0.1', kind: 'virtual', private: true},
    {name: 'tailscale0', address: '100.64.0.2', kind: 'virtual', private: false},
  ]);
  assert.equal(joinUrlFor('192.168.1.23', 3000), 'http://192.168.1.23:3000');
  assert.equal(joinUrlFor('192.168.1.23', 80), 'http://192.168.1.23');
});

test('connection check: reachability per address, firewall hints for Linux and Windows, and the client isolation explanation', async () => {
  const addresses = lanAddresses(interfaces), probed = [];
  const probe = async url => {probed.push(url); return false;};
  const linux = await diagnose({port: 3000, addresses, platform: 'linux', probe, run: async file => file === 'firewall-cmd' ? {ok: true, out: 'running'} : {ok: false, out: ''}});
  assert.deepEqual(probed, ['http://192.168.1.23:3000']);
  assert.equal(linux.find(c => c.id === 'reach:192.168.1.23').status, 'warn');
  assert.match(linux.find(c => c.id === 'firewall').text, /firewall-cmd --add-port=3000\/tcp/);
  assert.match(linux.at(-1).text, /client or AP isolation/);
  const ufw = await diagnose({port: 3000, addresses, platform: 'linux', probe: async () => true, run: async file => file === 'systemctl' ? {ok: true, out: 'active'} : {ok: false, out: ''}});
  assert.equal(ufw[0].status, 'ok');
  assert.match(ufw.find(c => c.id === 'firewall').text, /ufw allow 3000\/tcp/);
  const windows = await diagnose({port: 3000, addresses, platform: 'win32', probe: async () => true,
    run: async file => file === 'netsh' ? {ok: true, out: 'Domain Profile Settings:\nState                                 ON'} : {ok: true, out: 'Public'}});
  assert.deepEqual(windows.map(c => c.id), ['reach:192.168.1.23', 'firewall', 'profile', 'isolation']);
  assert.match(windows[2].text, /choose Private/);
  // Not on any network, or only on the hotspot.
  assert.match((await diagnose({port: 3000, addresses: [], platform: 'darwin'}))[0].text, /not on a network/);
  assert.match((await diagnose({port: 3000, addresses: [{name: 'bm0', address: '10.42.0.1', kind: 'hotspot'}], platform: 'darwin'}))[0].text, /only on its quiz hotspot/);
});

test('desk: venue network mode shows the address on the TV; a Wi-Fi password is checked and never shown online; desktop desk tickets', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'quiz-network-'));
  const quiz = createQuiz({hostKey, database: path.join(dir, 'quiz.sqlite'), mediaDir: dir, packDir: dir, soundsDir: dir, interfaces,
    networkCheck: async ({port, addresses}) => [{id: 'fake', status: 'ok', text: `${addresses.length} addresses on ${port}`}]});
  await new Promise(r => quiz.server.listen(0, '127.0.0.1', r));
  const port = quiz.server.address().port;
  const call = async (route, body = {}, key = host) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/${route}`, {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + key}, body: JSON.stringify(body)});
    return {status: response.status, ...await response.json()};
  };
  let host = '';
  try {
    host = (await call('login', {key: hostKey})).key;
    const network = await call('host/network');
    assert.equal(network.port, port);
    assert.equal(network.addresses[0].address, '192.168.1.23');
    assert.deepEqual((await call('host/network/check')).checks, [{id: 'fake', status: 'ok', text: `5 addresses on ${port}`}]);
    assert.equal((await call('host/network')).status, 200);
    assert.equal((await call('host/network', {}, 'nope')).status, 403);

    assert.equal((await call('host/settings', {joinMode: 'router'})).status, 400);
    assert.equal((await call('host/settings', {joinPassword: 'short'})).status, 400);
    const saved = await call('host/settings', {joinMode: 'lan', joinUrl: `http://192.168.1.23:${port}`, joinSsid: 'Red Lion Guest', joinPassword: 'quiz night 2024'});
    assert.equal(saved.joinMode, 'lan');
    const tv = await (await fetch(`http://127.0.0.1:${port}/api/leaderboard`)).json();
    assert.equal(tv.settings.joinUrl, `http://192.168.1.23:${port}`);
    assert.equal(tv.settings.joinPassword, 'quiz night 2024');

    // The desktop app asks for a new one-time ticket each time it opens the desk.
    const first = quiz.newDeskTicket(), second = quiz.newDeskTicket();
    assert.equal((await call('login', {ticket: first}, '')).status, 403);
    const login = await call('login', {ticket: second}, '');
    assert.equal(login.status, 200);
    assert.equal((await call('host/state', {}, login.key)).status, 200);
    assert.equal((await call('login', {ticket: second}, '')).status, 403);
  } finally {await quiz.close(); rmSync(dir, {recursive: true, force: true});}
});

test('online link hides the quiz Wi-Fi password', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'quiz-network-'));
  const laptop = {wifi: async () => ({available: false}), status: async () => ({wifi: {available: false}, jobs: {}, setup: {}}), online: () => ({url: 'https://q.trycloudflare.com', ready: true}), goOffline() {}};
  const quiz = createQuiz({hostKey, database: path.join(dir, 'quiz.sqlite'), mediaDir: dir, packDir: dir, soundsDir: dir, laptop});
  await new Promise(r => quiz.server.listen(0, '127.0.0.1', r));
  try {
    const port = quiz.server.address().port;
    const host = (await (await fetch(`http://127.0.0.1:${port}/api/login`, {method: 'POST', body: JSON.stringify({key: hostKey})})).json()).key;
    await fetch(`http://127.0.0.1:${port}/api/host/settings`, {method: 'POST', headers: {Authorization: 'Bearer ' + host}, body: JSON.stringify({joinPassword: 'quiz night 2024'})});
    const tv = await (await fetch(`http://127.0.0.1:${port}/api/leaderboard`)).json();
    assert.equal(tv.settings.joinUrl, 'https://q.trycloudflare.com');
    assert.equal(tv.settings.joinPassword, '');
  } finally {await quiz.close(); rmSync(dir, {recursive: true, force: true});}
});
