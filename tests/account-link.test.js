// Quizmaster devices found through the account, not the network: venue Wi-Fi often keeps devices apart (client
// isolation). A laptop signed in to BeerMat Online says where it can be reached (its addresses and its quizmaster link,
// a tunnel to its quizmaster port); another desk on the same account sees it, gets a ticket and takes over its desk;
// a TV signs in once by a code a signed-in phone approves, then gets a ticket for whichever laptop is running the quiz.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {generateKeyPairSync} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {createQuiz} from '../server/server.js';
import {createService} from '../online/service.js';

const keys = () => {
  const {privateKey, publicKey} = generateKeyPairSync('ed25519');
  return {privateKey: privateKey.export({type: 'pkcs8', format: 'der'}).toString('base64'), publicKey: publicKey.export({type: 'spki', format: 'der'}).toString('base64')};
};
const hostKey = 'a-secure-link-test-key';
const json = async r => ({status: r.status, ...await r.json().catch(() => ({}))});

async function setup() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'quiz-link-')), signer = keys();
  const service = createService({database: path.join(dir, 'online.sqlite'), licenceKey: signer.privateKey});
  await new Promise(r => service.server.listen(0, '127.0.0.1', r));
  const online = `http://127.0.0.1:${service.server.address().port}`;
  const laptops = [];
  async function laptop(name) {
    const folder = path.join(dir, name);
    // The laptop's tunnel stands in for Cloudflare's: its address is only listed; tests use the quizmaster port itself.
    const fake = {wifi: async () => ({running: null}), link: () => ({url: `https://${name}.trycloudflare.com`, ready: true, error: ''}), linkUp() {}, linkDown() {}};
    const quiz = createQuiz({plan: 'pro', hostKey, database: path.join(dir, name + '.sqlite'), mediaDir: dir, packDir: dir, soundsDir: dir, licenceKey: signer.publicKey, laptop: fake});
    await new Promise(r => quiz.server.listen(0, '127.0.0.1', r));
    await new Promise(r => quiz.remoteServer.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${quiz.server.address().port}`, remote = `http://127.0.0.1:${quiz.remoteServer.address().port}`;
    const desk = (await json(await fetch(base + '/api/login', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({key: hostKey})}))).key;
    const host = async (route, body = {}, key = desk, at = base) => json(await fetch(`${at}/api/host/${route}`, {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + key}, body: JSON.stringify(body)}));
    await host('settings', {onlineService: online, title: name === 'bar' ? 'Tuesday quiz' : 'Spare'});
    laptops.push(quiz);
    return {quiz, base, remote, host, folder};
  }
  const api = async (method, route, body, token) => json(await fetch(online + route, {method, headers: {'Content-Type': 'application/json', ...(token && {Authorization: 'Bearer ' + token})}, ...(body && {body: JSON.stringify(body)})}));
  const post = async (url, body, token) => json(await fetch(url, {method: 'POST', headers: {'Content-Type': 'application/json', ...(token && {Authorization: 'Bearer ' + token})}, body: JSON.stringify(body)}));
  return {service, online, laptop, api, post, done: async () => {for (const q of laptops) await q.close(); await service.close(); rmSync(dir, {recursive: true, force: true});}};
}

test('a second desk on the account finds the first through BeerMat Online and takes over its desk', async () => {
  const {laptop, api, post, done} = await setup();
  try {
    const bar = await laptop('bar'), office = await laptop('office');
    const me = await api('POST', '/v1/accounts', {email: 'host@example.com', password: 'correct horse battery', displayName: 'Dan'});
    assert.equal(me.status, 201, me.error);
    for (const l of [bar, office]) assert.equal((await l.host('online/signin', {email: 'host@example.com', password: 'correct horse battery'})).signedIn, true);
    await bar.host('link');
    const seen = await office.host('link');
    assert.deepEqual(seen.others.map(d => [d.name, d.title, d.role, d.link]), [[os.hostname(), 'Tuesday quiz', 'desk', 'https://bar.trycloudflare.com']], 'the other laptop, with its quizmaster link');
    assert.ok(seen.others[0].addresses.every(a => /^http:\/\/[\d.]+:\d+$/.test(a)), 'and its addresses on its networks');
    // Someone else's account sees none of it, and gets no ticket for it.
    const other = (await api('POST', '/v1/accounts', {email: 'other@example.com', password: 'correct horse battery', displayName: 'Other'})).token;
    assert.deepEqual((await api('GET', '/v1/me/desks', null, other)).desks, []);
    assert.equal((await api('POST', '/v1/desk-tickets', {venueKey: seen.others[0].venueKey, role: 'desk'}, other)).status, 403);

    // The office takes over the bar's desk, through the bar's quizmaster link.
    const {ticket, link} = await office.host('link/ticket', {venueKey: seen.others[0].venueKey, role: 'desk'});
    assert.equal(link, 'https://bar.trycloudflare.com');
    assert.equal((await post(bar.remote + '/api/deck/login', {code: '123456', name: 'x'})).status, 403, 'no desk code through the link');
    const {key} = await post(bar.remote + '/api/deck/login', {ticket, name: 'Office laptop'});
    assert.ok(key);
    assert.equal((await post(bar.remote + '/api/deck/login', {ticket, name: 'Again'})).status, 403, 'a ticket works once');
    await office.host('link/role', {role: 'remote'});
    assert.equal((await bar.host('handover', {}, key, bar.remote)).ok, true);
    const state = await bar.host('state');
    assert.deepEqual([state.deskAway?.name, state.decks.map(d => d.how)], ['Office laptop', ['desk']], 'the bar shows the desk is elsewhere');
    assert.equal((await bar.host('state', {}, key, bar.remote)).status, 200, 'the office runs the bar’s quiz');
    assert.deepEqual((await office.host('link')).others.map(d => d.role), ['hosting'], 'the bar: hosting, its desk elsewhere');
    assert.deepEqual((await bar.host('link')).others.map(d => d.role), ['remote'], 'the office: running another laptop’s quiz');
    // The bar takes its desk back: the office's session ends.
    await bar.host('handover/end');
    assert.equal((await bar.host('state', {}, key, bar.remote)).status, 403);
    assert.equal((await bar.host('state')).deskAway, null);
    // A phone deck's own handover is refused: only another desk takes over the desk.
    const phone = (await post(bar.base + '/api/deck/login', {ticket: (await api('POST', '/v1/deck-tickets', {venueKey: seen.others[0].venueKey}, me.token)).ticket, name: 'Phone'})).key;
    assert.equal((await bar.host('handover', {}, phone)).status, 400);
    // Signing out takes the laptop off the account's list.
    await office.host('online/signout');
    assert.deepEqual((await api('GET', '/v1/me/desks', null, me.token)).desks.map(d => d.title), ['Tuesday quiz']);
  } finally {await done();}
});

test('the quizmaster link answers only signed-in desks, phones and TVs; never the players’ routes', async () => {
  const {laptop, done} = await setup();
  try {
    const bar = await laptop('bar');
    const get = async route => (await fetch(bar.remote + route)).status;
    assert.equal(await get('/tv'), 200, 'the TV page itself');
    assert.equal(await get('/deck'), 200);
    assert.equal(await get('/host'), 404, 'not the browser desk');
    assert.equal(await get('/api/leaderboard'), 404, 'the TV’s state needs a TV or desk sign-in');
    assert.equal(await get('/api/events'), 404);
    assert.equal(await get('/api/state'), 404, 'no player routes');
    assert.equal((await fetch(bar.remote + '/api/join', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{}'})).status, 404);
    assert.equal((await fetch(bar.remote + '/api/login', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({key: hostKey})})).status, 404, 'not the quizmaster key');
    assert.equal((await bar.host('state', {}, 'nonsense', bar.remote)).status, 403);
  } finally {await done();}
});

test('a TV signs in once by a code a phone approves, then reaches whichever laptop runs the quiz', async () => {
  const {laptop, api, post, done} = await setup();
  try {
    const bar = await laptop('bar'), office = await laptop('office');
    const me = (await api('POST', '/v1/accounts', {email: 'host@example.com', password: 'correct horse battery', displayName: 'Dan'})).token;
    for (const l of [bar, office]) await l.host('online/signin', {email: 'host@example.com', password: 'correct horse battery'});
    await office.host('link/role', {role: 'remote'});
    await bar.host('link');

    const {code} = await api('POST', '/v1/tv-pairings', {name: 'Bar TV'});
    assert.ok(code.length > 30, 'a long secret code (in the QR code)');
    assert.equal((await api('GET', '/v1/tv-pairings/' + code)).waiting, true);
    assert.equal((await api('POST', `/v1/tv-pairings/${code}/approve`)).status, 401, 'approved by someone signed in');
    assert.equal((await api('POST', `/v1/tv-pairings/${code}/approve`, {}, me)).name, 'Bar TV');
    const {device} = await api('GET', '/v1/tv-pairings/' + code);
    assert.ok(device);
    assert.equal((await api('GET', '/v1/tv-pairings/' + code)).status, 404, 'handed over once');

    const found = await api('POST', '/v1/tv/connect', {device});
    assert.deepEqual(found.desks.map(d => d.title), ['Tuesday quiz'], 'the laptop running a quiz, not the one running another’s');
    assert.equal((await api('POST', '/v1/tv/connect', {device: 'not-a-device'})).status, 401);
    const {ticket} = found.desks[0];
    assert.equal((await post(bar.remote + '/api/deck/login', {ticket, name: 'TV'})).status, 403, 'a TV’s ticket doesn’t host');
    const {key} = await post(bar.remote + '/api/tv/login', {ticket, name: 'Bar TV'});
    assert.ok(key);
    assert.equal((await fetch(`${bar.remote}/api/leaderboard?tv=${key}`)).status, 200, 'the TV’s state');
    assert.equal((await fetch(bar.remote + '/api/leaderboard', {headers: {Authorization: 'Bearer ' + key}})).status, 200);
    const stream = await fetch(`${bar.remote}/api/events?tv=${key}&screen=Bar%20TV`);
    assert.equal(stream.status, 200, 'its live updates'); await stream.body.cancel();
    assert.equal((await bar.host('state', {}, key, bar.remote)).status, 403, 'and nothing of the desk');
    // A signed-in desk becoming a TV gets a device straight away.
    assert.ok((await office.host('link/tv-device')).device);
  } finally {await done();}
});
