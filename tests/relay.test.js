// Phone deck relay: commands and state flow through BeerMat Online instead of a direct connection to the laptop.
// The laptop pushes its deck state to Online every second; a phone deck reads it and sends commands back.
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
const hostKey = 'a-secure-relay-test-key';

async function setup() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'quiz-relay-')), signer = keys();
  let time = Date.now();
  const service = createService({database: path.join(dir, 'online.sqlite'), licenceKey: signer.privateKey, now: () => time});
  await new Promise(r => service.server.listen(0, '127.0.0.1', r));
  const quiz = createQuiz({hostKey, database: path.join(dir, 'quiz.sqlite'), mediaDir: dir, packDir: dir, soundsDir: dir, licenceKey: signer.publicKey, now: () => time});
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
  // Sign in to Online and register the laptop.
  await api('POST', '/v1/accounts', {email: 'host@relay.test', password: 'correct horse battery', displayName: 'Host'});
  const ownerToken = (await api('POST', '/v1/sessions', {email: 'host@relay.test', password: 'correct horse battery'})).token;
  await post('/api/host/settings', {onlineService: online, title: 'Relay quiz'}, desk);
  await post('/api/host/online/signin', {email: 'host@relay.test', password: 'correct horse battery'}, desk);
  // Register a venue so the owner can get relay access.
  const venueKey = (await (await fetch(base + '/api/deck/hello')).json()).venueKey;
  const ownerId = service.db.prepare("SELECT id FROM accounts WHERE email='host@relay.test'").get().id;
  service.importVenues({venues: [{id: 'test-venue', name: 'Test Venue', town: 'London'}]});
  service.db.prepare('UPDATE venues SET owner=?').run(ownerId);
  service.db.prepare('INSERT INTO venue_keys VALUES(?,?,?,?)')
    .run('k1', 'test-venue', venueKey, time);
  return {service, quiz, post, api, host, desk, base, online, ownerToken, venueKey, tick: ms => {time += ms;}, now: () => time,
    done: async () => {await quiz.close(); await service.close(); rmSync(dir, {recursive: true, force: true});}};
}

test('the laptop pushes state and picks up commands through the relay', async () => {
  const {quiz, api, host, desk, base, online, ownerToken, venueKey, done} = await setup();
  try {
    // The laptop heartbeats so Online knows it's open.
    await host('link', {}, desk);
    // A phone connects via the relay.
    const relay = await api('POST', '/v1/relay/connect', {venueKey}, ownerToken);
    assert.ok(relay.keyId, 'relay connect returns a keyId');
    assert.ok(relay.token, 'relay connect returns a token');

    // Push state from the laptop (simulating the relay loop).
    const venueKeyValue = (await (await fetch(base + '/api/deck/hello')).json()).venueKey;
    const {signClaim} = await import('../shared/claims.js');
    const {keyId: keyIdFn} = await import('../shared/claims.js');
    const kid = keyIdFn(venueKeyValue);
    // Read the venue key from the quiz database to sign the relay push claim.
    const venueKeyData = JSON.parse(quiz.db.prepare("SELECT value FROM metadata WHERE key='venueKey'").get().value);
    const claim = signClaim({v: 1, kind: 'beermat.relay-push', at: Date.now()}, venueKeyData);
    const push1 = await api('POST', '/v1/me/desk/relay', {request: claim, state: {serverTime: Date.now(), question: null, teams: []}});
    assert.equal(push1.status, 200, 'relay push accepted');
    assert.deepEqual(push1.commands, [], 'no commands yet');
    assert.ok(push1.version > 0);

    // Phone reads the state.
    const stateResp = await (await fetch(`${online}/v1/relay/${relay.keyId}/state?token=${encodeURIComponent(relay.token)}`)).json();
    assert.ok(stateResp.state, 'state is available');
    assert.ok(stateResp.version > 0);

    // Phone sends a command.
    const cmdResp = await api('POST', `/v1/relay/${relay.keyId}/command`, {token: relay.token, route: 'settings', body: {registrationOpen: true}});
    assert.equal(cmdResp.ok, true, 'command accepted');

    // Laptop picks up the command on next push.
    const push2 = await api('POST', '/v1/me/desk/relay', {request: signClaim({v: 1, kind: 'beermat.relay-push', at: Date.now()}, venueKeyData), state: {serverTime: Date.now(), question: null, teams: []}});
    assert.equal(push2.commands.length, 1, 'one command queued');
    assert.equal(push2.commands[0].route, 'settings');
    assert.deepEqual(push2.commands[0].body, {registrationOpen: true});

    // Commands are cleared after pickup.
    const push3 = await api('POST', '/v1/me/desk/relay', {request: signClaim({v: 1, kind: 'beermat.relay-push', at: Date.now()}, venueKeyData), state: {serverTime: Date.now(), question: null, teams: []}});
    assert.deepEqual(push3.commands, [], 'commands cleared after pickup');
  } finally {await done();}
});

test('relay rejects unknown commands and invalid tokens', async () => {
  const {api, host, desk, online, ownerToken, venueKey, done} = await setup();
  try {
    await host('link', {}, desk);
    const relay = await api('POST', '/v1/relay/connect', {venueKey}, ownerToken);

    // Unknown command route.
    const bad = await api('POST', `/v1/relay/${relay.keyId}/command`, {token: relay.token, route: 'evil', body: {}});
    assert.equal(bad.status, 400);

    // Invalid token for state.
    const badState = await (await fetch(`${online}/v1/relay/${relay.keyId}/state?token=bad`)).json();
    assert.ok(badState.error);

    // Invalid token for command.
    const badCmd = await api('POST', `/v1/relay/${relay.keyId}/command`, {token: 'bad', route: 'next', body: {}});
    assert.ok(badCmd.status >= 400);
  } finally {await done();}
});

test('relay connect requires account access', async () => {
  const {api, host, desk, online, venueKey, done} = await setup();
  try {
    await host('link', {}, desk);
    // Unauthenticated.
    const noAuth = await api('POST', '/v1/relay/connect', {venueKey});
    assert.equal(noAuth.status, 401);
    // Another account with no access.
    await api('POST', '/v1/accounts', {email: 'stranger@relay.test', password: 'correct horse battery', displayName: 'Stranger'});
    const stranger = (await api('POST', '/v1/sessions', {email: 'stranger@relay.test', password: 'correct horse battery'})).token;
    const denied = await api('POST', '/v1/relay/connect', {venueKey}, stranger);
    assert.equal(denied.status, 403);
  } finally {await done();}
});
