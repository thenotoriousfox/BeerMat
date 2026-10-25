// PubQuiz Online (online/service.js) and the player app's client for it (online/client.js), against a real service
// on a temporary database. No internet involved.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createService} from '../online/service.js';
import {createOnlineClient} from '../online/client.js';
import {newVenueKey, signClaim} from '../claims.js';

const memory = () => {const m = new Map(); return {getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), m};};
const result = (key, event, team, result, date = 1700000000000) => signClaim({v: 1, kind: 'pubquiz.result', event, title: 'Quiz ' + event, date, team,
  result: {name: 'Foxes', rank: 1, teams: 6, points: 30, answered: 10, correct: 8, fastestMs: 2500, perfectRounds: 1, categories: {Music: {answered: 5, correct: 5}}, ...result}}, key);

async function fixture(fn) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pubquiz-online-')); let time = 1700000000000;
  const service = createService({database: path.join(dir, 'online.sqlite'), now: () => time, allowedOrigins: ['https://quiz.example']});
  await new Promise(r => service.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${service.server.address().port}`;
  const call = async (method, route, body, token = '', headers = {}) => {
    const res = await fetch(base + route, {method, headers: {'Content-Type': 'application/json', ...(token ? {Authorization: 'Bearer ' + token} : {}), ...headers}, ...(body ? {body: JSON.stringify(body)} : {})});
    return {status: res.status, headers: res.headers, ...await res.json().catch(() => ({}))};
  };
  const signUp = async (email, displayName = email.split('@')[0]) => (await call('POST', '/v1/accounts', {email, password: 'correct horse battery', displayName})).token;
  try {await fn({base, call, signUp, service, tick: ms => time += ms, now: () => time});} finally {await service.close(); rmSync(dir, {recursive: true, force: true});}
}

test('accounts: sign up, sign in, wrong passwords limited, profile and privacy, export and erasure', () => fixture(async ({call, signUp}) => {
  assert.equal((await call('POST', '/v1/accounts', {email: 'x', password: 'correct horse battery', displayName: 'X'})).status, 400);
  assert.equal((await call('POST', '/v1/accounts', {email: 'a@b.co', password: 'short', displayName: 'X'})).status, 400);
  const token = await signUp('sam@example.com', 'Sam');
  assert.equal((await call('POST', '/v1/accounts', {email: 'SAM@example.com', password: 'correct horse battery', displayName: 'Other'})).status, 409);
  const me = await call('GET', '/v1/me', null, token);
  assert.deepEqual([me.displayName, me.privacy], ['Sam', {leaderboards: false, photo: false, history: false}], 'nothing public until the player says so');
  assert.equal(me.password, undefined);
  assert.equal((await call('GET', '/v1/me')).status, 401);
  assert.equal((await call('POST', '/v1/sessions', {email: 'sam@example.com', password: 'nope nope nope'})).status, 401);
  const login = await call('POST', '/v1/sessions', {email: 'Sam@Example.com', password: 'correct horse battery'});
  assert.equal(login.status, 200);
  for (let i = 0; i < 9; i++) await call('POST', '/v1/sessions', {email: 'sam@example.com', password: 'wrong wrong wrong'});
  assert.equal((await call('POST', '/v1/sessions', {email: 'sam@example.com', password: 'correct horse battery'})).status, 429);

  assert.equal((await call('PATCH', '/v1/me', {avatar: 'data:text/html;base64,PHNjcmlwdD4='}, token)).status, 400);
  assert.equal((await call('PATCH', '/v1/me', {privacy: {sellMyData: true}}, token)).status, 400);
  const updated = await call('PATCH', '/v1/me', {preferredTeam: 'Quizteama Aguilera', avatar: 'data:image/png;base64,iVBORw0KGgo=', privacy: {leaderboards: true}}, token);
  assert.deepEqual([updated.preferredTeam, updated.privacy.leaderboards, updated.privacy.photo], ['Quizteama Aguilera', true, false]);
  const exported = await call('GET', '/v1/me/export', null, token);
  assert.equal(exported.profile.email, 'sam@example.com');
  assert.equal((await call('DELETE', '/v1/me', null, token)).deleted, true);
  assert.equal((await call('GET', '/v1/me', null, token)).status, 401);
  assert.equal((await call('GET', '/v1/me', null, login.token)).status, 401, 'every session goes with the account');
}));

test('results: only laptop-signed claims, once each however often sent; stats and achievements count registered venues only', () => fixture(async ({call, signUp, service}) => {
  const player = await signUp('pat@example.com'), operator = await signUp('landlord@example.com');
  const lion = newVenueKey(), stranger = newVenueKey();
  const claim = result(lion, 'ev1', 'team-a');
  assert.equal((await call('POST', '/v1/me/results', {claim})).status, 401);
  assert.equal((await call('POST', '/v1/me/results', {claim: {...claim, result: {...claim.result, points: 300}}}, player)).status, 422, 'a changed score breaks the signature');
  assert.equal((await call('POST', '/v1/me/results', {claim: {...claim, kind: 'other'}}, player)).status, 400);
  const first = await call('POST', '/v1/me/results', {claim}, player, {'Idempotency-Key': 'ev1:team-a'});
  assert.deepEqual([first.status, first.registeredVenue], [201, false]);
  assert.deepEqual([(await call('POST', '/v1/me/results', {claim}, player)).status, (await call('POST', '/v1/me/results', {claim}, player)).duplicate], [200, true]);
  assert.equal((await call('GET', '/v1/me/results', null, player)).results.length, 1);

  // Until the venue registers its laptop, the result is kept but not counted.
  let stats = await call('GET', '/v1/me/stats', null, player);
  assert.deepEqual([stats.stats.quizzes, stats.waiting, stats.achievements.length], [0, 1, 0]);
  const venue = await call('POST', '/v1/venues', {name: 'The Red Lion', town: 'Bristol', postcode: 'BS1 4DJ', lat: 51.4545, lon: -2.5879}, operator);
  assert.equal((await call('POST', `/v1/venues/${venue.id}/keys`, {publicKey: 'not-a-key-at-all-but-long-enough-to-pass-the-pattern-check-xx'}, operator)).status, 400);
  assert.equal((await call('POST', `/v1/venues/${venue.id}/keys`, {publicKey: lion.publicKey}, player)).status, 403, 'only the operator registers laptops');
  assert.equal((await call('POST', `/v1/venues/${venue.id}/keys`, {publicKey: lion.publicKey}, operator)).status, 201);
  stats = await call('GET', '/v1/me/stats', null, player);
  assert.deepEqual([stats.stats.quizzes, stats.stats.wins, stats.waiting], [1, 1, 0]);
  assert.deepEqual(stats.achievements.map(a => a.id), ['first-quiz', 'first-win', 'podium', 'perfect-round', 'fastest-finger']);
  assert.equal((await call('GET', '/v1/me/results', null, player)).results[0].venueName, 'The Red Lion');
  // A laptop registered to one venue cannot be claimed by another.
  const other = await call('POST', '/v1/venues', {name: 'Crown', town: 'Bath'}, player);
  assert.equal((await call('POST', `/v1/venues/${other.id}/keys`, {publicKey: lion.publicKey}, player)).status, 409);

  // Teams are not people: two players in the same team both keep the result.
  const teammate = await signUp('alex@example.com');
  assert.equal((await call('POST', '/v1/me/results', {claim}, teammate)).status, 201);
  // Someone's own laptop, unregistered, gives them nothing.
  await call('POST', '/v1/me/results', {claim: result(stranger, 'fake', 'me', {rank: 1})}, player);
  assert.equal((await call('GET', '/v1/me/stats', null, player)).stats.quizzes, 1);
  assert.equal((await call('DELETE', '/v1/me/results/fake/me', null, player)).ok, true);

  // Public leaderboard: verified venues and players who opted in only.
  assert.deepEqual((await call('GET', '/v1/leaderboards')).players, []);
  const admin = await signUp('admin@example.com');
  assert.equal((await call('POST', `/v1/venues/${venue.id}/verify`, {}, admin)).status, 403);
  service.db.prepare("UPDATE accounts SET admin=1 WHERE email='admin@example.com'").run();
  assert.equal((await call('POST', `/v1/venues/${venue.id}/verify`, {}, admin)).status, 200);
  assert.deepEqual((await call('GET', '/v1/leaderboards')).players, [], 'verified venue, but nobody opted in yet');
  await call('PATCH', '/v1/me', {privacy: {leaderboards: true}}, player);
  const board = (await call('GET', `/v1/leaderboards?venue=${venue.id}`)).players;
  assert.deepEqual(board.map(p => [p.name, p.wins, p.avatar]), [['pat', 1, null]], 'no photo unless the player allows it');
}));

test('venue results from quiz laptops: registered laptops only, a repeat replaces rather than duplicates', () => fixture(async ({call, signUp}) => {
  const operator = await signUp('host@example.com'), key = newVenueKey();
  const summary = signClaim({v: 1, kind: 'pubquiz.event', event: 'ev9', title: 'Tuesday', date: 1, teams: [{ref: 'r1', name: 'Foxes', rank: 1, points: 20}]}, key);
  assert.equal((await call('POST', '/v1/venue-results', summary)).status, 403);
  const venue = await call('POST', '/v1/venues', {name: 'Lamb', town: 'Leeds'}, operator);
  await call('POST', `/v1/venues/${venue.id}/keys`, {publicKey: key.publicKey}, operator);
  assert.equal((await call('POST', '/v1/venue-results', {...summary, teams: []})).status, 422);
  assert.equal((await call('POST', '/v1/venue-results', summary)).status, 201);
  assert.equal((await call('POST', '/v1/venue-results', summary)).status, 200);
}));

test('events: operators publish and update; players search by town, postcode area or location; cancelled and past ones drop out', () => fixture(async ({call, signUp, tick, now}) => {
  const operator = await signUp('op@example.com'), player = await signUp('pl@example.com');
  const lion = await call('POST', '/v1/venues', {name: 'The Red Lion', town: 'Bristol', postcode: 'BS1 4DJ', lat: 51.4545, lon: -2.5879}, operator);
  const crown = await call('POST', '/v1/venues', {name: 'The Crown', town: 'Bath', postcode: 'BA1 1SU', lat: 51.3811, lon: -2.3590}, operator);
  assert.equal((await call('POST', `/v1/venues/${lion.id}/events`, {title: 'Quiz', startsAt: now() + 86400000}, player)).status, 403);
  assert.equal((await call('POST', `/v1/venues/${lion.id}/events`, {title: '', startsAt: now()}, operator)).status, 400);
  const tuesday = await call('POST', `/v1/venues/${lion.id}/events`, {title: 'Tuesday Quiz', startsAt: now() + 86400000, format: 'General knowledge, 6 rounds', entry: '£2 a head'}, operator);
  const music = await call('POST', `/v1/venues/${crown.id}/events`, {title: 'Music Bingo', startsAt: now() + 2 * 86400000}, operator);
  assert.match(tuesday.venue.directions, /openstreetmap.org\/directions\?to=51.4545,-2.5879/);
  assert.deepEqual((await call('GET', '/v1/events?q=bristol')).events.map(e => e.title), ['Tuesday Quiz']);
  assert.deepEqual((await call('GET', '/v1/events?q=BS1 9ZZ')).events.map(e => e.title), ['Tuesday Quiz'], 'same postcode area');
  const near = await call('GET', '/v1/events?lat=51.45&lon=-2.59&radiusKm=30');
  assert.deepEqual(near.events.map(e => [e.title, e.distanceKm < 1]), [['Tuesday Quiz', true], ['Music Bingo', false]]);
  assert.deepEqual((await call('GET', '/v1/events?lat=51.45&lon=-2.59&radiusKm=5')).events.map(e => e.title), ['Tuesday Quiz']);
  assert.equal((await call('GET', '/v1/events')).status, 400);
  await call('PATCH', `/v1/events/${tuesday.id}`, {entry: 'Free'}, operator);
  assert.equal((await call('GET', `/v1/venues/${lion.id}`)).events[0].entry, 'Free');
  await call('DELETE', `/v1/events/${music.id}`, null, operator);
  assert.deepEqual((await call('GET', '/v1/events?q=bath')).events, []);
  tick(3 * 86400000);
  assert.deepEqual((await call('GET', '/v1/events?q=bristol')).events, []);
  assert.equal((await call('PUT', `/v1/me/favourites/${lion.id}`, {}, player)).ok, true);
  assert.deepEqual((await call('GET', '/v1/me/favourites', null, player)).venues.map(v => v.name), ['The Red Lion']);
}));

test('web: CORS for the app and listed sites only; the player web app is served and nothing outside it', () => fixture(async ({base, call}) => {
  const app = await call('OPTIONS', '/v1/events', null, '', {Origin: 'capacitor://localhost'});
  assert.equal(app.headers.get('access-control-allow-origin'), 'capacitor://localhost');
  assert.equal((await call('GET', '/v1/events?q=x', null, '', {Origin: 'https://quiz.example'})).headers.get('access-control-allow-origin'), 'https://quiz.example');
  assert.equal((await call('GET', '/v1/events?q=x', null, '', {Origin: 'https://evil.example'})).headers.get('access-control-allow-origin'), null);
  assert.equal((await fetch(base + '/app/../server.js')).status, 404);
  assert.equal((await fetch(base + '/app/%2e%2e/%2e%2e/package.json')).status, 404);
  assert.equal((await call('POST', '/v1/accounts', null, '', {'Content-Type': 'application/json'})).status, 400);
}));

test('client: results wait offline and are sent once when back; listings come from the cache when offline, marked as such', () => fixture(async ({base, signUp}) => {
  let online = false;
  const storage = memory(), fetchSometimes = (url, options) => online ? fetch(url, options) : Promise.reject(new TypeError('fetch failed'));
  const client = createOnlineClient({baseUrl: base, fetch: fetchSometimes, storage});
  const key = newVenueKey(), claim = result(key, 'ev1', 'team-a');
  await assert.rejects(client.signIn('x@example.com', 'whatever whatever'), /No connection/);
  assert.deepEqual(await client.saveResult(claim), {sent: 0, waiting: 1, problem: null});
  await client.saveResult(claim);
  assert.equal(client.outbox().length, 1, 'the same result is queued once');
  online = true;
  await client.signUp({email: 'kim@example.com', password: 'correct horse battery', displayName: 'Kim'});
  assert.equal(client.signedIn(), true);
  assert.deepEqual(await client.flush(), {sent: 1, waiting: 0, problem: null});
  assert.equal((await client.results()).results.length, 1);
  // A tampered claim is dropped with its reason rather than retried for ever.
  await client.saveResult({...result(key, 'ev2', 'team-a'), title: 'Changed'});
  assert.equal(client.outbox().length, 0);
  assert.match(client.rejected()[0].reason, /not signed by a quiz laptop/);

  const operator = createOnlineClient({baseUrl: base, storage: memory()});
  await operator.signUp({email: 'op2@example.com', password: 'correct horse battery', displayName: 'Op'});
  const venue = await operator.createVenue({name: 'The Ship', town: 'Hull', lat: 53.74, lon: -0.33});
  await operator.publishEvent(venue.id, {title: 'Ship Quiz', startsAt: Date.now() + 86400000 * 400});
  await operator.publishEvent(venue.id, {title: 'Ship Quiz Soon', startsAt: 1700000000000 + 86400000});
  const fresh = await client.findEvents({q: 'hull'});
  assert.deepEqual([fresh.stale, fresh.events.map(e => e.title)], [false, ['Ship Quiz Soon']]);
  online = false;
  const cached = await client.findEvents({q: 'Hull'});
  assert.deepEqual([cached.stale, cached.events.map(e => e.title)], [true, ['Ship Quiz Soon']]);
  await assert.rejects(client.findEvents({q: 'york'}), /No connection/);
  const stats = await client.stats().catch(e => e);
  assert.match(stats.message, /No connection/);
  online = true;
  assert.equal((await client.stats()).stale, false);
  online = false;
  assert.equal((await client.stats()).stale, true);
  online = true;
  await client.signOut();
  assert.equal(client.signedIn(), false);
  assert.equal(JSON.stringify([...storage.m.values()]).includes('correct horse'), false, 'the password is never stored');
}));
