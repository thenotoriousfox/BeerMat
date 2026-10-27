// The desk's Venue tab: the laptop signs in to BeerMat Online for the venue's operator and passes on only the calls
// that run a venue, against a real BeerMat Online on a temporary database.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createQuiz} from '../server/server.js';
import {createService} from '../online/service.js';
import {keyId} from '../shared/claims.js';

test('desk venue tab: sign in through the laptop, edit only your venue, register this laptop, publish quiz nights', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'quiz-venuedesk-'));
  const service = createService({database: path.join(dir, 'online.sqlite')});
  await new Promise(r => service.server.listen(0, '127.0.0.1', r));
  const online = `http://127.0.0.1:${service.server.address().port}`;
  const looked = [];
  const fetchImpl = (url, options) => {
    if (url.startsWith('https://api.postcodes.io/')) {looked.push(url); return Promise.resolve(new Response(JSON.stringify(url.endsWith('BS1%204DJ') ? {status: 200, result: {latitude: 51.454512345, longitude: -2.587912345, admin_district: 'Bristol'}} : {status: 404})));}
    return fetch(url, options);
  };
  const quiz = createQuiz({plan: 'pro', hostKey: 'a-secure-quiz-test-key', database: path.join(dir, 'quiz.sqlite'), mediaDir: dir, packDir: dir, soundsDir: dir, fetchImpl});
  await new Promise(r => quiz.server.listen(0, '127.0.0.1', r));
  const call = async (route, body = {}) => {
    const response = await fetch(`http://127.0.0.1:${quiz.server.address().port}/api/host/${route}`, {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + host}, body: JSON.stringify(body)});
    return {status: response.status, ...await response.json()};
  };
  let host;
  try {
    host = (await fetch(`http://127.0.0.1:${quiz.server.address().port}/api/login`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({key: 'a-secure-quiz-test-key'})}).then(r => r.json())).key;
    assert.equal((await call('online/account')).service, 'https://online.beermatquiz.co.uk', 'the desk knows where BeerMat Online is');
    await call('settings', {onlineService: online});
    service.importVenues({venues: [{id: 'red-lion-bristol', name: 'The Red Lion', town: 'Bristol'}, {id: 'crown-bath', name: 'The Crown', town: 'Bath'}]});

    assert.equal((await call('online/call', {method: 'GET', path: '/v1/me/venues'})).status, 401, 'signed in first');
    assert.equal((await call('online/signup', {email: 'landlord@example.com', password: 'short', displayName: 'Lou'})).status, 400);
    const account = await call('online/signup', {email: 'landlord@example.com', password: 'correct horse battery', displayName: 'Lou'});
    assert.deepEqual([account.signedIn, account.name], [true, 'Lou']);
    assert.deepEqual((await call('online/call', {method: 'GET', path: '/v1/me/venues'})).venues, [], 'no venue until BeerMat links one');
    service.db.prepare("UPDATE venues SET owner=(SELECT id FROM accounts WHERE email='landlord@example.com') WHERE id='red-lion-bristol'").run();

    // Only the calls that run a venue go through: not adding venues, not other people's data.
    for (const [method, route] of [['POST', '/v1/venues'], ['GET', '/v1/me/export'], ['DELETE', '/v1/me'], ['POST', '/v1/venues/red-lion-bristol/operator'], ['GET', '/v1/venues/../me']])
      assert.equal((await call('online/call', {method, path: route})).status, 400, `${method} ${route}`);
    assert.equal((await call('online/call', {method: 'PATCH', path: '/v1/venues/crown-bath', body: {name: 'Mine'}})).status, 400, 'someone else’s venue: refused by BeerMat Online');

    const at = await call('online/locate', {postcode: 'BS1 4DJ'});
    assert.deepEqual([at.lat, at.lon], [51.45451, -2.58791]);
    assert.equal((await call('online/locate', {postcode: 'ZZ9 9ZZ'})).status, 404);
    assert.equal((await call('online/locate', {postcode: '../../x'})).status, 400);
    assert.equal(looked.length, 2);
    const saved = await call('online/call', {method: 'PATCH', path: '/v1/venues/red-lion-bristol', body: {quizNights: [{day: 'tuesday', time: '20:00'}], lat: at.lat, lon: at.lon}});
    assert.deepEqual([saved.quizNights, saved.lat], [[{day: 'tuesday', time: '20:00'}], 51.45451]);

    // Registering always sends this laptop's own key, whatever the page sends.
    await call('online/call', {method: 'POST', path: '/v1/venues/red-lion-bristol/keys', body: {publicKey: 'someone-elses-key'}});
    const {venueKeyId} = await call('results');
    assert.deepEqual((await call('online/call', {method: 'GET', path: '/v1/me/venues'})).venues[0].keys, [venueKeyId]);
    assert.equal(keyId(service.db.prepare('SELECT public_key FROM venue_keys').get().public_key), venueKeyId);

    const night = await call('online/call', {method: 'POST', path: '/v1/venues/red-lion-bristol/events', body: {title: 'Tuesday Quiz', startsAt: Date.now() + 86400000, entry: '£2'}});
    assert.ok((await fetch(online + '/v1/venues/red-lion-bristol').then(r => r.json())).events.some(e => e.title === 'Tuesday Quiz'), 'in the app straight away');
    await call('online/call', {method: 'DELETE', path: '/v1/events/' + night.id});
    const left = (await call('online/call', {method: 'GET', path: '/v1/venues/red-lion-bristol'})).events;
    assert.deepEqual([left.filter(e => !e.regular), left.every(e => e.title === 'Quiz night' && new Date(e.startsAt).getUTCDay() === 2)], [[], true], 'only the regular Tuesday nights are left');

    assert.equal((await call('online/signout')).signedIn, false);
    assert.equal((await call('online/account')).signedIn, false);
    assert.equal((await call('online/call', {method: 'GET', path: '/v1/me/venues'})).status, 401);
    assert.equal((await call('online/signin', {email: 'landlord@example.com', password: 'wrong password!'})).status, 401);
    assert.equal((await call('online/signin', {email: 'landlord@example.com', password: 'correct horse battery'})).email, 'landlord@example.com');
  } finally {await quiz.close(); await service.close(); rmSync(dir, {recursive: true, force: true});}
});
