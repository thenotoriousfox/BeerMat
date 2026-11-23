// BeerMat Online (online/service.js) and the player app's client for it (online/client.js), against a real service
// on a temporary database. No internet involved.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createService} from '../online/service.js';
import {createOnlineClient} from '../online/client.js';
import {newVenueKey, signClaim} from '../shared/claims.js';

const memory = () => {const m = new Map(); return {getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), m};};
const result = (key, event, team, result, date = 1700000000000) => signClaim({v: 1, kind: 'beermat.result', event, title: 'Quiz ' + event, date, team,
  result: {name: 'Foxes', rank: 1, teams: 6, points: 30, answered: 10, correct: 8, fastestMs: 2500, perfectRounds: 1, categories: {Music: {answered: 5, correct: 5}}, ...result}}, key);

async function fixture(fn) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'beermat-online-')); let time = 1700000000000;
  const service = createService({database: path.join(dir, 'online.sqlite'), now: () => time, allowedOrigins: ['https://quiz.example']});
  await new Promise(r => service.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${service.server.address().port}`;
  const call = async (method, route, body, token = '', headers = {}) => {
    const res = await fetch(base + route, {method, headers: {'Content-Type': 'application/json', ...(token ? {Authorization: 'Bearer ' + token} : {}), ...headers}, ...(body ? {body: JSON.stringify(body)} : {})});
    return {status: res.status, headers: res.headers, ...await res.json().catch(() => ({}))};
  };
  const signUp = async (email, displayName = email.split('@')[0]) => (await call('POST', '/v1/accounts', {email, password: 'correct horse battery', displayName})).token;
  // Venues don't add themselves: an admin adds one and links it to its operator's account.
  let root;
  const addVenue = async (fields, operatorEmail) => {
    if (!root) {root = await signUp('root@example.com'); service.db.prepare("UPDATE accounts SET admin=1 WHERE email='root@example.com'").run();}
    const venue = await call('POST', '/v1/venues', fields, root);
    assert.equal(venue.status, 201, venue.error);
    if (operatorEmail) assert.equal((await call('POST', `/v1/venues/${venue.id}/operator`, {email: operatorEmail}, root)).status, 200);
    // Only BeerMat Pro venues are public, so the venues in these tests are Pro (Free venues: their own test).
    pro(venue.id);
    return venue;
  };
  const pro = (venueId = null) => service.db.prepare(`UPDATE venues SET plan='pro' WHERE ? IS NULL OR id=?`).run(venueId, venueId);
  try {await fn({base, call, signUp, addVenue, pro, service, tick: ms => time += ms, now: () => time});} finally {await service.close(); rmSync(dir, {recursive: true, force: true});}
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

test('results: only laptop-signed claims, once each however often sent; stats and achievements count registered venues only', () => fixture(async ({call, signUp, addVenue, service}) => {
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
  const venue = await addVenue({name: 'The Red Lion', town: 'Bristol', postcode: 'BS1 4DJ', lat: 51.4545, lon: -2.5879}, 'landlord@example.com');
  assert.equal((await call('POST', `/v1/venues/${venue.id}/keys`, {publicKey: 'not-a-key-at-all-but-long-enough-to-pass-the-pattern-check-xx'}, operator)).status, 400);
  assert.equal((await call('POST', `/v1/venues/${venue.id}/keys`, {publicKey: lion.publicKey}, player)).status, 403, 'only the operator registers laptops');
  assert.equal((await call('POST', `/v1/venues/${venue.id}/keys`, {publicKey: lion.publicKey}, operator)).status, 201);
  stats = await call('GET', '/v1/me/stats', null, player);
  assert.deepEqual([stats.stats.quizzes, stats.stats.wins, stats.waiting], [1, 1, 0]);
  assert.deepEqual(stats.achievements.map(a => a.id), ['first-quiz', 'first-win', 'podium', 'perfect-round', 'fastest-finger']);
  assert.equal((await call('GET', '/v1/me/results', null, player)).results[0].venueName, 'The Red Lion');
  // A laptop registered to one venue cannot be claimed by another.
  const other = await addVenue({name: 'Crown', town: 'Bath'}, 'pat@example.com');
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

test('venue results from quiz laptops: registered laptops only, a repeat replaces rather than duplicates', () => fixture(async ({call, signUp, addVenue}) => {
  const operator = await signUp('host@example.com'), key = newVenueKey();
  const summary = signClaim({v: 1, kind: 'beermat.event', event: 'ev9', title: 'Tuesday', date: 1, teams: [{ref: 'r1', name: 'Foxes', rank: 1, points: 20}]}, key);
  assert.equal((await call('POST', '/v1/venue-results', summary)).status, 403);
  const venue = await addVenue({name: 'Lamb', town: 'Leeds'}, 'host@example.com');
  await call('POST', `/v1/venues/${venue.id}/keys`, {publicKey: key.publicKey}, operator);
  assert.equal((await call('POST', '/v1/venue-results', {...summary, teams: []})).status, 422);
  assert.equal((await call('POST', '/v1/venue-results', summary)).status, 201);
  assert.equal((await call('POST', '/v1/venue-results', summary)).status, 200);
}));

test('events: operators publish and update; players search by town, postcode area or location; cancelled and past ones drop out', () => fixture(async ({call, signUp, addVenue, tick, now}) => {
  const operator = await signUp('op@example.com'), player = await signUp('pl@example.com');
  const lion = await addVenue({name: 'The Red Lion', town: 'Bristol', postcode: 'BS1 4DJ', lat: 51.4545, lon: -2.5879}, 'op@example.com');
  const crown = await addVenue({name: 'The Crown', town: 'Bath', postcode: 'BA1 1SU', lat: 51.3811, lon: -2.3590}, 'op@example.com');
  assert.equal((await call('POST', `/v1/venues/${lion.id}/events`, {title: 'Quiz', startsAt: now() + 86400000}, player)).status, 403);
  assert.equal((await call('POST', `/v1/venues/${lion.id}/events`, {title: '', startsAt: now()}, operator)).status, 400);
  const tuesday = await call('POST', `/v1/venues/${lion.id}/events`, {title: 'Tuesday Quiz', startsAt: now() + 86400000, format: 'General knowledge, 6 rounds', entry: '£2 a head'}, operator);
  const music = await call('POST', `/v1/venues/${crown.id}/events`, {title: 'Music Bingo', startsAt: now() + 2 * 86400000}, operator);
  assert.equal(tuesday.venue.directions, 'https://www.google.com/maps/dir/?api=1&destination=The%20Red%20Lion%2C%20Bristol%2C%20BS1%204DJ');
  assert.equal(music.venue.directions, 'https://www.google.com/maps/dir/?api=1&destination=The%20Crown%2C%20Bath%2C%20BA1%201SU');
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

test('client: results wait offline and are sent once when back; listings come from the cache when offline, marked as such', () => fixture(async ({base, signUp, addVenue}) => {
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
  await assert.rejects(operator.createVenue({name: 'The Ship', town: 'Hull'}), /added by BeerMat/);
  const venue = await addVenue({name: 'The Ship', town: 'Hull', lat: 53.74, lon: -0.33}, 'op2@example.com');
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

test('venue list: imported, kept up to date, operators edit their own profile only; nobody adds themselves', () => fixture(async ({call, signUp, addVenue, pro, service}) => {
  const list = {venues: [
    {id: 'red-lion-bristol', name: 'The Red Lion', town: 'Bristol', postcode: 'bs1 4dj', lat: 51.4545, lon: -2.5879, quizNights: [{day: 'tuesday', time: '20:00'}]},
    {id: 'crown-bath', name: 'The Crown', town: 'Bath'},
    {id: 'Bad Id', name: 'Nope', town: 'X'}, {id: 'no-town', name: 'Nope'}, {id: 'half-located', name: 'X', town: 'Y', lat: 51},
    {id: 'crown-bath', name: 'Twice', town: 'Bath'}, {id: 'bad-day', name: 'X', town: 'Y', quizNights: [{day: 'funday', time: '20:00'}]},
    {id: 'bad-time', name: 'X', town: 'Y', quizNights: [{day: 'monday', time: '8pm'}]}, {id: 'two-mondays', name: 'X', town: 'Y', quizNights: [{day: 'monday', time: '20:00'}, {day: 'monday', time: '21:00'}]},
  ]};
  const first = service.importVenues(list);
  assert.deepEqual([first.imported, first.errors.length], [2, 7]);
  assert.deepEqual((await call('GET', '/v1/venues')).venues, [], 'Free venues aren’t on the map');
  assert.equal((await call('GET', '/v1/venues/crown-bath')).status, 404, 'nor have a public page');
  pro();
  let venues = (await call('GET', '/v1/venues')).venues;
  assert.deepEqual(venues.map(v => [v.id, v.postcode, v.quizNights, v.next]), [['crown-bath', '', [], null], ['red-lion-bristol', 'BS1 4DJ', [{day: 'tuesday', time: '20:00'}], {id: venues[1].next.id, title: 'Quiz night', startsAt: Date.UTC(2023, 10, 21, 20)}]], 'its regular night is published');
  assert.equal(venues[0].owner, undefined, 'operators are not public');

  // Nobody adds or removes a venue but an admin; operators are linked by an admin.
  const landlord = await signUp('landlord@example.com'), stranger = await signUp('someone@example.com');
  assert.equal((await call('POST', '/v1/venues', {name: 'My Pub', town: 'Leeds'}, stranger)).status, 403);
  assert.equal((await call('PATCH', '/v1/venues/red-lion-bristol', {name: 'Mine now'}, landlord)).status, 403);
  assert.equal((await call('POST', '/v1/venues/red-lion-bristol/operator', {email: 'landlord@example.com'}, landlord)).status, 403);
  await addVenue({name: 'Admin Added', town: 'York'});
  const root = (await call('POST', '/v1/sessions', {email: 'root@example.com', password: 'correct horse battery'})).token;
  assert.equal((await call('POST', '/v1/venues/red-lion-bristol/operator', {email: 'nobody@example.com'}, root)).status, 404);
  assert.equal((await call('POST', '/v1/venues/red-lion-bristol/operator', {email: 'landlord@example.com'}, root)).status, 200);
  assert.deepEqual((await call('GET', '/v1/me/venues', null, landlord)).venues.map(v => v.id), ['red-lion-bristol']);
  assert.equal((await call('PATCH', '/v1/venues/crown-bath', {name: 'Not mine'}, landlord)).status, 403, 'only their own venue');
  assert.equal((await call('PATCH', '/v1/venues/red-lion-bristol', {lat: 51.5}, landlord)).status, 400, 'a location needs both');
  assert.equal((await call('PATCH', '/v1/venues/red-lion-bristol', {quizNights: [{day: 'wednesday', time: '7.30pm'}]}, landlord)).status, 400);
  const edited = await call('PATCH', '/v1/venues/red-lion-bristol', {quizNights: [{day: 'sunday', time: '18:00'}, {day: 'wednesday', time: '19:30'}], lat: 51.46, lon: -2.59}, landlord);
  assert.deepEqual([edited.quizNights, edited.lat], [[{day: 'wednesday', time: '19:30'}, {day: 'sunday', time: '18:00'}], 51.46], 'in weekday order');
  assert.equal((await call('DELETE', '/v1/venues/red-lion-bristol', null, landlord)).status, 403, 'taking a venue off is for BeerMat');
  await call('POST', '/v1/venues/red-lion-bristol/events', {title: 'Quiz', startsAt: 1700000000000 + 86400000}, landlord);

  // The list again: its changes apply except to what the operator changed; a venue taken off the list goes.
  const second = service.importVenues({venues: [{...list.venues[0], name: 'The Red Lion Inn', quizNights: [{day: 'friday', time: '21:00'}], lat: 1, lon: 1}]});
  assert.deepEqual([second.imported, second.removed], [1, 1]);
  venues = (await call('GET', '/v1/venues')).venues;
  assert.deepEqual(venues.map(v => [v.id, v.name, v.quizNights.map(n => n.day), v.lat, v.next?.title ?? null]), [[venues[0].id, 'Admin Added', [], null, null], ['red-lion-bristol', 'The Red Lion Inn', ['wednesday', 'sunday'], 51.46, 'Quiz']]);
  assert.deepEqual(service.importVenues({nope: true}), {imported: 0, removed: 0, errors: ['venues.json must be {"venues": [...]}']}, 'an unreadable list changes nothing');
  assert.equal((await call('GET', '/v1/venues')).venues.length, 2);
  // An operator's account going doesn't take the venue with it.
  await call('DELETE', '/v1/me', null, landlord);
  assert.equal((await call('GET', '/v1/venues/red-lion-bristol')).name, 'The Red Lion Inn');
}));

test('venue list: a database from before the list keeps its venues, quiz nights and laptops', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'beermat-online-old-')), file = path.join(dir, 'online.sqlite');
  const {DatabaseSync} = await import('node:sqlite');
  const old = new DatabaseSync(file);
  old.exec(`CREATE TABLE accounts(id TEXT PRIMARY KEY, email TEXT UNIQUE COLLATE NOCASE NOT NULL, password TEXT NOT NULL, created INTEGER NOT NULL, display_name TEXT NOT NULL, preferred_team TEXT NOT NULL DEFAULT '', avatar TEXT, privacy TEXT NOT NULL DEFAULT '{}', admin INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE venues(id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, name TEXT NOT NULL, town TEXT NOT NULL, postcode TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '', website TEXT NOT NULL DEFAULT '', lat REAL, lon REAL, verified INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL);
    CREATE TABLE events(id TEXT PRIMARY KEY, venue TEXT NOT NULL REFERENCES venues(id) ON DELETE CASCADE, title TEXT NOT NULL, starts INTEGER NOT NULL, format TEXT NOT NULL DEFAULT '', entry TEXT NOT NULL DEFAULT '', details TEXT NOT NULL DEFAULT '', cancelled INTEGER NOT NULL DEFAULT 0, updated INTEGER NOT NULL);
    INSERT INTO accounts VALUES('a1','op@example.com','x',1,'Op','',NULL,'{}',0);
    INSERT INTO venues(id,owner,name,town,verified,created) VALUES('v1','a1','Old Pub','Hull',1,1);
    INSERT INTO events VALUES('e1','v1','Old Quiz',9999999999999,'','','',0,1);`);
  old.close();
  const service = createService({database: file});
  try {
    assert.deepEqual(service.db.prepare('SELECT id,owner,name,verified,listed FROM venues').all().map(r => ({...r})), [{id: 'v1', owner: 'a1', name: 'Old Pub', verified: 1, listed: 0}]);
    assert.equal(service.db.prepare('SELECT COUNT(*) n FROM events').get().n, 1);
    assert.equal(service.db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  } finally {await service.close(); rmSync(dir, {recursive: true, force: true});}
});

test('venues.json in this repository is a valid venue list', async () => {
  const {parseVenueList} = await import('../shared/venues.js');
  const {readFileSync} = await import('node:fs');
  const {errors} = parseVenueList(JSON.parse(readFileSync(path.join(import.meta.dirname, '..', 'venues.json'), 'utf8')));
  assert.deepEqual(errors, []);
});

test('client: the map\'s venues come from the service, then its last list offline, then the venue list on GitHub', () => fixture(async ({base, service, pro}) => {
  service.importVenues({venues: [{id: 'ship-hull', name: 'The Ship', town: 'Hull', lat: 53.74, lon: -0.33, quizNights: [{day: 'thursday', time: '19:30'}]}]}); pro();
  let online = true;
  const github = {venues: [{id: 'listed', onMap: true, name: 'Listed', town: 'York', website: 'javascript:alert(1)'}, {id: 'free-pub', name: 'Free', town: 'York'}, {name: 'no id', onMap: true}]};
  const fetchSometimes = (url, options) => url.startsWith('https://raw.githubusercontent.com/') ? Promise.resolve(new Response(JSON.stringify(github))) : online ? fetch(url, options) : Promise.reject(new TypeError('fetch failed'));
  const client = createOnlineClient({baseUrl: base, venueListUrl: 'https://raw.githubusercontent.com/x/venues.json', fetch: fetchSometimes, storage: memory()});
  const live = await client.venues();
  assert.deepEqual([live.source, live.stale, live.venues.map(v => [v.name, v.quizNights[0].day])], ['service', false, [['The Ship', 'thursday']]]);
  online = false;
  assert.deepEqual([(await client.venues()).source, (await client.venues()).venues.length], ['cache', 1]);
  const fresh = createOnlineClient({baseUrl: base, venueListUrl: 'https://raw.githubusercontent.com/x/venues.json', fetch: fetchSometimes, storage: memory()});
  const listed = await fresh.venues();
  assert.deepEqual([listed.source, listed.venues.map(v => [v.id, v.website, v.lat])], ['list', [['listed', '', null]]], 'only well-formed entries, and only https websites');
  await assert.rejects(createOnlineClient({baseUrl: base, fetch: fetchSometimes, storage: memory()}).venues(), /No connection/);
}));

test('regular quiz nights publish themselves four weeks ahead in UK time; a cancelled week stays cancelled, specials take the day', () => fixture(async ({call, signUp, service, tick, pro}) => {
  // 1700000000000 is Tuesday 14 November 2023, 22:13 in London: tonight's 8pm quiz has been and gone.
  service.importVenues({venues: [{id: 'vic-derby', name: 'The Victoria Inn', town: 'Derby', postcode: 'DE1 2RR', lat: 52.9168, lon: -1.4646, quizNights: [{day: 'monday', time: '20:00'}, {day: 'tuesday', time: '20:00'}]}]});
  assert.deepEqual((await call('GET', '/v1/events?q=derby')).events, [], 'a Free venue’s quiz nights aren’t listed');
  pro();
  const listed = async () => (await call('GET', '/v1/events?q=derby')).events.map(e => `${new Date(e.startsAt).toISOString().slice(0, 16)} ${e.title}${e.regular ? ' (regular)' : ''}`);
  const weeks = ['2023-11-20', '2023-11-21', '2023-11-27', '2023-11-28', '2023-12-04', '2023-12-05', '2023-12-11', '2023-12-12'].map(d => `${d}T20:00 Quiz night (regular)`);
  assert.deepEqual(await listed(), weeks);
  service.importVenues({venues: [{id: 'vic-derby', name: 'The Victoria Inn', town: 'Derby', postcode: 'DE1 2RR', lat: 52.9168, lon: -1.4646, quizNights: [{day: 'monday', time: '20:00'}, {day: 'tuesday', time: '20:00'}]}]}); service.publishRegular();
  assert.deepEqual(await listed(), weeks, 'publishing again adds nothing');
  assert.equal((await call('GET', '/v1/events?lat=52.92&lon=-1.47&radiusKm=25')).events.length, 8, 'found by location too');

  const landlord = await signUp('vic@example.com');
  service.db.prepare("UPDATE venues SET owner=(SELECT id FROM accounts WHERE email='vic@example.com') WHERE id='vic-derby'").run();
  const own = (await call('GET', '/v1/venues/vic-derby')).events;
  // A bank holiday: that week is cancelled, and stays cancelled.
  await call('DELETE', `/v1/events/${own[0].id}`, null, landlord);
  service.publishRegular();
  // A charity quiz on the Tuesday takes the regular night's place; tidying one week's details makes it the venue's own.
  await call('POST', '/v1/venues/vic-derby/events', {title: 'Charity Quiz', startsAt: Date.UTC(2023, 10, 21, 19, 30)}, landlord);
  await call('PATCH', `/v1/events/${own[2].id}`, {entry: '£1'}, landlord);
  assert.deepEqual(await listed(), ['2023-11-21T19:30 Charity Quiz', '2023-11-27T20:00 Quiz night', ...weeks.slice(3)]);

  // New nights: Fridays at 9pm instead. Future regular nights follow; the venue's own quizzes stay.
  await call('PATCH', '/v1/venues/vic-derby', {quizNights: [{day: 'friday', time: '21:00'}]}, landlord);
  assert.deepEqual(await listed(), ['2023-11-17T21:00 Quiz night (regular)', '2023-11-21T19:30 Charity Quiz', '2023-11-24T21:00 Quiz night (regular)', '2023-11-27T20:00 Quiz night',
    '2023-12-01T21:00 Quiz night (regular)', '2023-12-08T21:00 Quiz night (regular)']);
  // Weeks later, in British Summer Time: 9pm in London is 20:00 UTC, still four weeks ahead.
  tick(Date.UTC(2024, 6, 1, 12) - 1700000000000); service.publishRegular();
  assert.deepEqual(await listed(), ['2024-07-05', '2024-07-12', '2024-07-19', '2024-07-26'].map(d => `${d}T20:00 Quiz night (regular)`));
}));

test('admin console: only admins; overview, venues with operators and laptops, accounts, and the nightly venues.json copy', () => fixture(async ({base, call, signUp, addVenue, service}) => {
  const player = await signUp('pat@example.com');
  for (const [method, route] of [['GET', '/v1/admin/overview'], ['GET', '/v1/admin/venues'], ['GET', '/v1/admin/accounts'], ['PATCH', '/v1/admin/accounts/x'], ['DELETE', '/v1/admin/accounts/x']]) {
    assert.equal((await call(method, route, method === 'PATCH' ? {} : undefined, player)).status, 403, `${method} ${route}`);
    assert.equal((await call(method, route, method === 'PATCH' ? {} : undefined)).status, 401);
  }
  const lion = await addVenue({name: 'The Red Lion', town: 'Bristol', postcode: 'BS1 4DJ', lat: 51.45, lon: -2.59, quizNights: [{day: 'tuesday', time: '20:00'}]}, 'pat@example.com');
  const twin = await addVenue({name: 'The Red Lion', town: 'Bristol'});
  assert.deepEqual([lion.id, twin.id], ['the-red-lion-bristol', 'the-red-lion-bristol-2'], 'readable ids from name and town');
  const root = (await call('POST', '/v1/sessions', {email: 'root@example.com', password: 'correct horse battery'})).token;
  assert.equal((await call('GET', '/v1/me', null, root)).admin, true);
  assert.equal((await call('GET', '/v1/me', null, player)).admin, false);
  const key = newVenueKey();
  await call('POST', `/v1/venues/${lion.id}/keys`, {publicKey: key.publicKey}, player);
  await call('POST', '/v1/venue-results', signClaim({v: 1, kind: 'beermat.event', event: 'e1', title: 'Tuesday Quiz', date: 1, teams: [{ref: 'r', name: 'Foxes', rank: 1, points: 9}]}, key));

  const overview = await call('GET', '/v1/admin/overview', null, root);
  assert.deepEqual([overview.venues, overview.operatedVenues, overview.mappedVenues, overview.accounts, overview.admins, overview.laptops, overview.venueResults, overview.lastBackup],
    [2, 1, 1, 2, 1, 1, 1, null]);
  const listed = (await call('GET', '/v1/admin/venues', null, root)).venues.find(v => v.id === lion.id);
  assert.deepEqual([listed.operator.email, listed.laptops.length, listed.upcoming[0].regular, listed.sharedResults[0].winner], ['pat@example.com', 1, true, 'Foxes']);

  // Accounts: search, admin rights (never your own), photos, deletion (the venue they ran stays).
  assert.deepEqual((await call('GET', '/v1/admin/accounts?q=PAT', null, root)).accounts.map(a => [a.email, a.venues]), [['pat@example.com', 'The Red Lion']]);
  const [pat, me] = ['pat@example.com', 'root@example.com'].map(email => service.db.prepare('SELECT id FROM accounts WHERE email=?').get(email).id);
  assert.equal((await call('PATCH', `/v1/admin/accounts/${me}`, {admin: false}, root)).status, 400);
  assert.equal((await call('DELETE', `/v1/admin/accounts/${me}`, null, root)).status, 400);
  await call('PATCH', '/v1/me', {avatar: 'data:image/png;base64,iVBORw0KGgo='}, player);
  assert.equal((await call('GET', '/v1/admin/accounts', null, root)).accounts.find(a => a.id === pat).photo, true);
  await call('PATCH', `/v1/admin/accounts/${pat}`, {removePhoto: true, admin: true}, root);
  assert.deepEqual([(await call('GET', '/v1/me', null, player)).avatar, (await call('GET', '/v1/me', null, player)).admin], [null, true]);
  assert.equal((await call('DELETE', `/v1/admin/accounts/${pat}`, null, root)).deleted, true);
  assert.equal((await call('GET', '/v1/me', null, player)).status, 401);
  assert.equal((await call('GET', `/v1/venues/${lion.id}`)).name, 'The Red Lion', 'the venue stays, without an operator');

  // The copy for the repository: venues.json's own format, which venues.js accepts.
  const copy = await call('GET', '/v1/venues.json');
  assert.deepEqual(copy.venues.map(v => v.id), ['the-red-lion-bristol', 'the-red-lion-bristol-2']);
  assert.deepEqual(copy.venues[0], {id: 'the-red-lion-bristol', onMap: true, name: 'The Red Lion', town: 'Bristol', postcode: 'BS1 4DJ', lat: 51.45, lon: -2.59, quizNights: [{day: 'tuesday', time: '20:00'}]});
  const {parseVenueList} = await import('../shared/venues.js');
  assert.deepEqual(parseVenueList(copy).errors, []);

  // The console's pages, and nothing else from beside them.
  const page = await fetch(base + '/admin/');
  assert.equal(page.status, 200); assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
  assert.match(await page.text(), /Admin console/);
  for (const bad of ['/admin/../service.js', '/admin/%2e%2e/service.js', '/admin/%2e%2e%2f%2e%2e%2fpackage.json', '/admin/nope.js']) assert.equal((await fetch(base + bad)).status, 404, bad);
}));

test('the website counter: anonymous quiz runs, counted once each, and venues using BeerMat', () => fixture(async ({call, addVenue}) => {
  assert.deepEqual((await call('GET', '/v1/stats')).venues, 0);
  await addVenue({name: 'The Lion', town: 'Leeds'});
  assert.equal((await call('POST', '/v1/quiz-runs', {run: '0123456789abcdef'})).status, 201);
  assert.equal((await call('POST', '/v1/quiz-runs', {run: '0123456789abcdef'})).status, 201, 'a retry is fine');
  assert.equal((await call('POST', '/v1/quiz-runs', {run: 'x', venue: 'The Lion'})).status, 400, 'nothing but a random id');
  await call('POST', '/v1/quiz-runs', {run: 'fedcba9876543210'});
  const stats = await call('GET', '/v1/stats');
  assert.equal(stats.quizzes, 2); assert.equal(stats.venues, 1, 'an approved Pro venue');
}));
