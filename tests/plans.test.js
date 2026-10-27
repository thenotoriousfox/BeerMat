// BeerMat Free and Pro: the limits on a free laptop, and a Pro licence from a real BeerMat Online (on a temporary
// database, with its own signing key) that lifts them.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {generateKeyPairSync} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {createQuiz} from '../server/server.js';
import {createService} from '../online/service.js';
import {edition} from '../server/edition.js';
import {signLicence, readLicence} from '../shared/licence.js';
import {newVenueKey} from '../shared/claims.js';

const keys = () => {
  const {privateKey, publicKey} = generateKeyPairSync('ed25519');
  return {privateKey: privateKey.export({type: 'pkcs8', format: 'der'}).toString('base64'), publicKey: publicKey.export({type: 'spki', format: 'der'}).toString('base64')};
};
const day = 86400000;

test('plans: Free has three questions, three teams and no Spotify; Pro has no limits', () => {
  assert.deepEqual([edition().plan, edition().limits, edition().has('spotify')], ['free', {questions: 3, teams: 3}, false]);
  assert.deepEqual([edition('pro').limits, edition('pro').has('spotify')], [null, true]);
  assert.equal(edition('gold').plan, 'free', 'an unknown plan is Free');
});

test('licences: only a genuine, unexpired licence for this laptop counts', () => {
  const signer = keys(), other = keys(), laptop = newVenueKey().publicKey, now = 1_000_000;
  const licence = signLicence({plan: 'pro', venue: 'v', venueName: 'V', venueKey: laptop, issued: now, expires: now + day}, signer.privateKey);
  const read = (l, options = {}) => readLicence(l, {venueKey: laptop, now, publicKey: signer.publicKey, ...options});
  assert.equal(read(licence).plan, 'pro');
  assert.equal(read(licence, {venueKey: newVenueKey().publicKey}), null, 'another laptop');
  assert.equal(read(licence, {now: now + 2 * day}), null, 'expired');
  assert.equal(read(licence, {publicKey: other.publicKey}), null, 'signed by someone else');
  assert.equal(read({...licence, expires: now + 365 * day}), null, 'changed');
  assert.equal(read(signLicence({plan: 'pro', venueKey: laptop, expires: now + day}, other.privateKey)), null);
  for (const junk of [null, 'pro', {}, {...licence, sig: 'x'}]) assert.equal(read(junk), null);
});

test('a free laptop stops at three questions and three teams, and gets Pro from its venue’s plan on BeerMat Online', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'quiz-plans-')), signer = keys();
  let time = Date.now();
  const service = createService({database: path.join(dir, 'online.sqlite'), licenceKey: signer.privateKey, now: () => time});
  await new Promise(r => service.server.listen(0, '127.0.0.1', r));
  const online = `http://127.0.0.1:${service.server.address().port}`;
  const quiz = createQuiz({hostKey: 'a-secure-quiz-test-key', database: path.join(dir, 'quiz.sqlite'), mediaDir: dir, packDir: dir, soundsDir: dir, licenceKey: signer.publicKey, now: () => time});
  await new Promise(r => quiz.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${quiz.server.address().port}`;
  const post = async (route, body = {}, auth) => {
    const response = await fetch(base + route, {method: 'POST', headers: {'Content-Type': 'application/json', ...(auth && {Authorization: 'Bearer ' + auth})}, body: JSON.stringify(body)});
    return {status: response.status, ...await response.json()};
  };
  const api = async (method, route, body, token) => {
    const response = await fetch(online + route, {method, headers: {'Content-Type': 'application/json', ...(token && {Authorization: 'Bearer ' + token})}, ...(body && {body: JSON.stringify(body)})});
    return {status: response.status, ...await response.json()};
  };
  try {
    let host = (await post('/api/login', {key: 'a-secure-quiz-test-key'})).key;
    const call = (route, body) => post('/api/host/' + route, body, host), later = async ms => {time += ms; host = (await post('/api/login', {key: 'a-secure-quiz-test-key'})).key;};
    const question = n => ({text: `Question ${n}`, type: 'text', answer: 'x', seconds: 30, points: 1});
    const ask = async n => {await call('close'); return call('open', question(n));};
    assert.equal((await call('state')).plan.plan, 'free', 'Free until a licence says otherwise');

    for (const n of [1, 2, 3]) assert.equal((await ask(n)).status, 200);
    const fourth = await ask(4);
    assert.equal(fourth.status, 403); assert.match(fourth.error, /BeerMat Free plays 3 questions/);
    for (const name of ['Team One', 'Team Two', 'Team Three']) assert.equal((await post('/api/join', {name})).status, 200);
    const fourthTeam = await post('/api/join', {name: 'Team Four'});
    assert.deepEqual([fourthTeam.status, fourthTeam.error], [409, 'The quiz is full. Ask the quizmaster.'], 'players just see a full quiz');
    assert.equal((await call('spotify/status')).locked, true);
    assert.equal((await call('spotify/connect', {clientId: 'a'.repeat(32)})).status, 403, 'Spotify is Pro');

    // The laptop asks BeerMat Online: first it has to belong to a venue.
    await call('settings', {onlineService: online});
    assert.match((await call('plan/refresh')).error, /Register this laptop with your venue first/);
    service.importVenues({venues: [{id: 'red-lion-bristol', name: 'The Red Lion', town: 'Bristol'}]});
    const publicKey = (await call('results')).venueKey;
    service.db.prepare('INSERT INTO venue_keys VALUES(?,?,?,?)').run('k1', 'red-lion-bristol', publicKey, time);
    assert.deepEqual([(await call('plan/refresh')).plan, (await call('plan')).venue], ['free', 'The Red Lion'], 'a free venue gets a Free licence');

    // An admin gives the venue Pro for a month.
    const admin = await api('POST', '/v1/accounts', {email: 'admin@example.com', password: 'correct horse battery', displayName: 'Admin'});
    service.db.prepare("UPDATE accounts SET admin=1 WHERE email='admin@example.com'").run();
    assert.equal((await api('PATCH', '/v1/admin/venues/red-lion-bristol', {plan: 'gold'}, admin.token)).status, 400);
    assert.equal((await api('PATCH', '/v1/admin/venues/red-lion-bristol', {plan: 'pro', planUntil: time + 30 * day}, admin.token)).status, 200);
    const listed = (await api('GET', '/v1/admin/venues', undefined, admin.token)).venues[0];
    assert.deepEqual([listed.plan, listed.planUntil], ['pro', time + 30 * day]);
    assert.equal((await api('GET', '/v1/admin/overview', undefined, admin.token)).proVenues, 1);
    const pro = await call('plan/refresh');
    assert.deepEqual([pro.plan, pro.name, pro.limits, pro.paidUntil, pro.expires], ['pro', 'BeerMat Pro', null, time + 30 * day, time + 44 * day]);
    assert.equal((await ask(4)).status, 200, 'the rest of the quiz plays');
    assert.equal((await post('/api/join', {name: 'Team Four'})).status, 200);
    assert.notEqual((await call('spotify/connect', {clientId: 'a'.repeat(32)})).status, 403);

    // Offline after the subscription ends: Pro lasts two weeks more, then the laptop is Free again.
    await later(40 * day); assert.equal((await call('plan')).plan, 'pro');
    await later(5 * day); assert.equal((await call('plan')).plan, 'free');
    assert.equal((await call('plan/refresh')).plan, 'free', 'the plan ended');

    // A request that isn't signed by a laptop, or is stale, gets nothing.
    assert.equal((await api('POST', '/v1/licence', {v: 1, kind: 'beermat.licence-request', at: time, venueKey: publicKey, sig: 'x'})).status, 400);
    const unset = createService({database: path.join(dir, 'other.sqlite')});
    await new Promise(r => unset.server.listen(0, '127.0.0.1', r));
    try {assert.equal((await fetch(`http://127.0.0.1:${unset.server.address().port}/v1/licence`, {method: 'POST', body: '{}'})).status, 503, 'no signing key: no licences');}
    finally {await unset.close();}
  } finally {await quiz.close(); await service.close(); rmSync(dir, {recursive: true, force: true});}
});
