// The phone deck: the quizmaster's phone hosting the quiz on the laptop. It signs in with a ticket from BeerMat Online
// (its account runs the laptop's venue, or is an admin), checked by the laptop with the licence key, or with a code the
// desk shows. The desk lists phones and can take one off; a phone can reach the desk from the venue's Wi-Fi; the host
// state says what the big button does next; and a phone can ask the desk itself to play clips and songs.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtempSync, rmSync} from 'node:fs';
import {generateKeyPairSync} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {createQuiz} from '../server/server.js';
import {createService} from '../online/service.js';
import {signDeckTicket} from '../shared/licence.js';

const keys = () => {
  const {privateKey, publicKey} = generateKeyPairSync('ed25519');
  return {privateKey: privateKey.export({type: 'pkcs8', format: 'der'}).toString('base64'), publicKey: publicKey.export({type: 'spki', format: 'der'}).toString('base64')};
};
const hostKey = 'a-secure-deck-test-key';

async function setup(options = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'quiz-deck-')), signer = keys();
  let time = Date.now();
  const service = createService({database: path.join(dir, 'online.sqlite'), licenceKey: signer.privateKey, now: () => time});
  await new Promise(r => service.server.listen(0, '127.0.0.1', r));
  const quiz = createQuiz({hostKey, database: path.join(dir, 'quiz.sqlite'), mediaDir: dir, packDir: dir, soundsDir: dir, licenceKey: signer.publicKey, now: () => time, ...options});
  await new Promise(r => quiz.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${quiz.server.address().port}`, online = `http://127.0.0.1:${service.server.address().port}`;
  const request = async (url, method, body, token) => {
    const r = await fetch(url, {method, headers: {'Content-Type': 'application/json', ...(token && {Authorization: 'Bearer ' + token})}, ...(body && {body: JSON.stringify(body)})});
    return {status: r.status, ...await r.json().catch(() => ({}))};
  };
  const post = (route, body = {}, token) => request(base + route, 'POST', body, token);
  const api = (method, route, body, token) => request(online + route, method, body, token);
  const desk = (await post('/api/login', {key: hostKey})).key;
  const host = (route, body, token = desk) => post('/api/host/' + route, body, token);
  return {service, quiz, post, api, host, desk, signer, base, tick: ms => {time += ms;}, now: () => time,
    done: async () => {await quiz.close(); await service.close(); rmSync(dir, {recursive: true, force: true});}};
}

test('a code from the desk signs one phone in; the desk lists it and can take it off', async () => {
  const {post, host, done} = await setup();
  try {
    const {code} = await host('deck-code');
    assert.match(code, /^\d{6}$/);
    assert.equal((await post('/api/deck/login', {code: '000000' === code ? '111111' : '000000', name: 'Dan’s phone'})).status, 403);
    const {key, title} = await post('/api/deck/login', {code: code.slice(0, 3) + ' ' + code.slice(3), name: 'Dan’s phone'});
    assert.ok(key); assert.equal(title, 'BeerMat');
    assert.equal((await post('/api/deck/login', {code})).status, 403, 'a code works once');
    const state = await host('state', {}, key);
    assert.equal(state.status, 200, 'the phone hosts');
    assert.deepEqual(state.decks.map(d => [d.name, d.how]), [['Dan’s phone', 'code']]);
    assert.equal(state.nextStep, 'question');
    await host('deck/disconnect', {id: state.decks[0].id});
    assert.equal((await host('state', {}, key)).status, 403, 'taken off');
    assert.deepEqual((await host('state')).decks, []);
  } finally {await done();}
});

test('a ticket from BeerMat Online: only the venue’s own account, or an admin, and only for its laptop', async () => {
  const {service, post, api, host, signer, tick, now, base, done} = await setup();
  try {
    const venueKey = (await (await fetch(base + '/api/deck/hello')).json()).venueKey;
    const owner = (await api('POST', '/v1/accounts', {email: 'landlord@example.com', password: 'correct horse battery', displayName: 'Landlord'})).token;
    const other = (await api('POST', '/v1/accounts', {email: 'player@example.com', password: 'correct horse battery', displayName: 'Player'})).token;
    const ownerId = service.db.prepare("SELECT id FROM accounts WHERE email='landlord@example.com'").get().id;
    const noVenue = await api('POST', '/v1/deck-tickets', {venueKey}, owner); assert.equal(noVenue.status, 403, 'a laptop with no venue: admins only: ' + noVenue.error);
    service.importVenues({venues: [{id: 'red-lion-bristol', name: 'The Red Lion', town: 'Bristol'}]});
    service.db.prepare('UPDATE venues SET owner=?').run(ownerId);
    service.db.prepare('INSERT INTO venue_keys VALUES(?,?,?,?)').run('k1', 'red-lion-bristol', venueKey, now());
    assert.equal((await api('POST', '/v1/deck-tickets', {venueKey})).status, 401, 'signed in only');
    assert.equal((await api('POST', '/v1/deck-tickets', {venueKey}, other)).status, 403, 'another account can’t');
    const {ticket} = await api('POST', '/v1/deck-tickets', {venueKey}, owner);
    assert.equal(ticket.venue, 'red-lion-bristol');
    const signedIn = await post('/api/deck/login', {ticket, name: 'Landlord’s phone'});
    assert.ok(signedIn.key);
    assert.deepEqual((await host('state')).decks.map(d => d.how), ['venue']);
    // An admin, any laptop.
    service.db.prepare("UPDATE accounts SET admin=1 WHERE email='player@example.com'").run();
    const admin = await api('POST', '/v1/deck-tickets', {venueKey}, other);
    assert.ok((await post('/api/deck/login', {ticket: admin.ticket})).key);
    // Not for another laptop, not changed, not old.
    assert.equal((await post('/api/deck/login', {ticket: {...ticket, venueKey: 'another-laptop'}})).status, 403);
    assert.equal((await post('/api/deck/login', {ticket: {...ticket, admin: true}})).status, 403, 'changed: the signature fails');
    assert.equal((await post('/api/deck/login', {ticket: signDeckTicket({venueKey, account: ownerId, issued: now(), expires: now() + 60000}, keys().privateKey)})).status, 403, 'not signed by BeerMat Online');
    tick(6 * 60000);
    assert.equal((await post('/api/deck/login', {ticket})).status, 403, 'run out');
    void signer;
  } finally {await done();}
});

test('a phone deck reaches the desk from the venue’s Wi-Fi; nothing else of the desk does', async () => {
  // The quiz Wi-Fi is 127.0.0.1 here; 127.0.0.2 stands in for the venue's Wi-Fi, which the laptop is also on.
  const dir = mkdtempSync(path.join(os.tmpdir(), 'quiz-deck-net-'));
  const quiz = createQuiz({hostKey, database: path.join(dir, 'quiz.sqlite'), mediaDir: dir, allowedAddresses: ['127.0.0.1']});
  await new Promise(r => quiz.server.listen(0, '0.0.0.0', r));
  const port = quiz.server.address().port;
  const post = async (address, route, body = {}, token) => {
    const r = await fetch(`http://${address}:${port}${route}`, {method: 'POST', headers: {'Content-Type': 'application/json', ...(token && {Authorization: 'Bearer ' + token})}, body: JSON.stringify(body)});
    return {status: r.status, ...await r.json().catch(() => ({}))};
  };
  try {
    const desk = (await post('127.0.0.1', '/api/login', {key: hostKey})).key;
    assert.equal((await post('127.0.0.2', '/api/host/state', {}, desk)).status, 403, 'the desk itself stays on the quiz Wi-Fi');
    assert.equal((await post('127.0.0.2', '/api/login', {key: hostKey})).status, 403, 'and so does its key');
    const {code} = await post('127.0.0.1', '/api/host/deck-code', {}, desk);
    const {key} = await post('127.0.0.2', '/api/deck/login', {code, name: 'Phone'});
    assert.ok(key, 'a phone signs in from the venue Wi-Fi');
    assert.equal((await post('127.0.0.2', '/api/host/state', {}, key)).status, 200, 'and hosts from there');
    assert.equal((await (await fetch(`http://127.0.0.2:${port}/api/deck/hello`)).json()).app, 'BeerMat');
    // Run the night in a phone's browser: its page and script come from the venue Wi-Fi too; the desk's page doesn't.
    for (const page of ['/deck', '/deck.js', '/compat.js', '/app.js', '/i18n.js']) assert.equal((await fetch(`http://127.0.0.2:${port}${page}`)).status, 200, page);
    assert.match(await (await fetch(`http://127.0.0.2:${port}/deck`)).text(), /deck\.js/);
    assert.equal((await fetch(`http://127.0.0.2:${port}/host`)).status, 403, 'the desk stays on the quiz Wi-Fi');
  } finally {await quiz.close(); rmSync(dir, {recursive: true, force: true});}
});

test('the desk plays what a phone asks: only with the desk open', async () => {
  const {host, base, desk, done} = await setup();
  let stream;
  try {
    assert.equal((await host('deck-command', {action: 'playClips'})).status, 409, 'no desk open');
    stream = http.get(`${base}/api/events?key=${desk}&desk=1`);
    for (let i = 0; i < 50 && !(await host('state')).deskConnected; i++) await new Promise(r => setTimeout(r, 40));
    assert.equal((await host('deck-command', {action: 'shout'})).status, 400);
    assert.equal((await host('deck-command', {action: 'playClip', value: 2})).status, 200);
    const {deckCommand} = await host('state');
    assert.deepEqual([deckCommand.seq, deckCommand.action, deckCommand.value], [1, 'playClip', 2]);
  } finally {stream?.destroy(); await done();}
});

// A round's intro is for the quizmaster to read out before starting it: the host state (the desks and the phone deck)
// carries the next round's while none of it has been played, and no round's once it has started.
test('the next round’s intro reaches the desks and phone deck until the round starts', async () => {
  const {host, done} = await setup({plan: 'pro'});
  try {
    const q = (id, text) => ({id, type: 'text', text, answer: 'x', seconds: 30, points: 1});
    const saved = await host('library/save', {revision: 0, quiz: {title: 'Intro quiz', rounds: [
      {id: 'r1', title: 'Round 1', intro: '  Two quick ones.  ', questions: [q('a', 'One'), q('b', 'Two')]},
      {id: 'r2', title: 'Round 2', questions: [q('c', 'Three')]},
      {id: 'r3', title: 'Round 3 · Risk It', intro: 'A wrong answer loses its points.', questions: [q('d', 'Four')]},
    ]}});
    assert.equal(saved.status, 200, saved.error);
    assert.equal((await host('library')).rounds[0].intro, 'Two quick ones.', 'kept, trimmed');
    assert.deepEqual((await host('state')).nextRound, {id: 'r1', title: 'Round 1', intro: 'Two quick ones.'});
    const next = async () => {const s = await host('state'); const opened = await host('next', {expectedQuestion: s.question?.id || null}); assert.equal(opened.status, 200, opened.error); await host('close', {expectedQuestion: opened.id});};
    await next();
    assert.equal((await host('state')).nextRound, null, 'round 1 under way');
    await next();
    assert.equal((await host('state')).nextRound, null, 'round 2 has no intro');
    await next();
    assert.deepEqual((await host('state')).nextRound, {id: 'r3', title: 'Round 3 · Risk It', intro: 'A wrong answer loses its points.'});
    assert.equal((await host('library/save', {revision: (await host('library')).revision, quiz: {title: 'Too long', rounds: [{id: 'r1', title: 'R', intro: 'x'.repeat(1001), questions: [q('a', 'One')]}]}})).status, 400);
  } finally {await done();}
});
