// The shared buzzer library: a Pro venue's quiz desk shares a clip through a real BeerMat Online (with ffmpeg),
// everyone can see it, Pro desks play and add it, three venues' reports hide it, an admin deals with it, and a
// venue stopped from sharing loses its clips.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, readFileSync, existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {createQuiz} from '../server/server.js';
import {createService} from '../online/service.js';
import {newVenueKey, signClaim} from '../shared/claims.js';

const day = 86400000;

test('shared buzzer library: shared by Pro, seen by everyone, played and added by Pro, hidden after three reports', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'quiz-library-')), mails = [];
  let time = Date.now();
  const service = createService({database: path.join(dir, 'online.sqlite'), now: () => time, mail: async m => {mails.push(m);}, adminEmail: 'hello@beermat.test', publicUrl: 'https://online.test'});
  await new Promise(r => service.server.listen(0, '127.0.0.1', r));
  const online = `http://127.0.0.1:${service.server.address().port}`;
  const desk = async (name, plan) => {
    const quiz = createQuiz({hostKey: 'a-secure-quiz-test-key', database: path.join(dir, `${name}.sqlite`), mediaDir: path.join(dir, `${name}-media`), packDir: dir, soundsDir: dir, plan, now: () => time});
    await new Promise(r => quiz.server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${quiz.server.address().port}`;
    const host = (await (await fetch(base + '/api/login', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({key: 'a-secure-quiz-test-key'})})).json()).key;
    const call = async (route, body = {}) => {
      const response = await fetch(`${base}/api/host/${route}`, {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + host}, body: JSON.stringify(body)});
      return {status: response.status, ...await response.json()};
    };
    const upload = async file => (await (await fetch(`${base}/api/host/media?name=${encodeURIComponent(path.basename(file))}`, {method: 'POST', headers: {Authorization: 'Bearer ' + host}, body: readFileSync(file)})).json()).media;
    await call('settings', {onlineService: online});
    return {quiz, call, upload, key: (await call('results')).venueKey};
  };
  const api = async (method, route, body, token) => {
    const response = await fetch(online + route, {method, headers: {'Content-Type': 'application/json', ...(token && {Authorization: 'Bearer ' + token})}, ...(body && {body: JSON.stringify(body)})});
    return {status: response.status, ...await response.json().catch(() => ({}))};
  };
  const pro = desk('pro', 'pro'), free = desk('free');
  const [red, blue] = await Promise.all([pro, free]);
  try {
    // Two venues: the Red Lion on Pro, the Blue Bell on Free. Each laptop belongs to one.
    service.importVenues({venues: [{id: 'red-lion', name: 'The Red Lion', town: 'Bristol'}, {id: 'blue-bell', name: 'The Blue Bell', town: 'Bath'}]});
    service.db.prepare("UPDATE venues SET plan='pro', plan_until=? WHERE id='red-lion'").run(time + 30 * day);
    const register = (venue, key) => service.db.prepare('INSERT INTO venue_keys VALUES(?,?,?,?)').run(key.slice(-12), venue, key, time);
    register('red-lion', red.key); register('blue-bell', blue.key);

    // A three-second clip, with a second of silence before it.
    const wav = path.join(dir, 'Air horn.wav');
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono:d=1', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-filter_complex', '[0][1]concat=n=2:v=0:a=1', wav]);

    // Sharing: Pro only, and the box must be ticked.
    const media = await red.upload(wav);
    assert.match((await red.call('buzzer-library/share', {name: 'Air horn', media, rights: false})).error, /Tick the box/);
    assert.equal((await blue.call('buzzer-library/share', {name: 'Air horn', media: await blue.upload(wav), rights: true})).status, 403, 'Free can’t share');
    const shared = await red.call('buzzer-library/share', {name: 'Air horn', media, rights: true});
    assert.equal(shared.status, 200);
    assert.ok(shared.seconds > 2.5 && shared.seconds < 3.5, `silence trimmed: ${shared.seconds}s`);

    // Everyone sees what's in it, never who shared it.
    const listed = await blue.call('buzzer-library');
    assert.deepEqual([listed.pro, listed.buzzers.map(b => b.name)], [false, ['Air horn']]);
    assert.deepEqual(Object.keys(listed.buzzers[0]).sort(), ['added', 'id', 'name', 'seconds']);
    assert.equal((await api('GET', '/v1/buzzers?q=horn')).buzzers.length, 1); assert.equal((await api('GET', '/v1/buzzers?q=kazoo')).buzzers.length, 0);
    const id = shared.id;

    // Free can't play or add it; Pro can.
    assert.equal((await blue.call('buzzer-library/play', {id})).status, 403);
    assert.equal((await blue.call('buzzer-library/add', {id})).status, 403);
    const played = await red.call('buzzer-library/play', {id});
    assert.equal(played.status, 200, JSON.stringify(played));
    const mp3 = Buffer.from(played.audio, 'base64');
    assert.ok(mp3.subarray(0, 3).toString('latin1') === 'ID3' || mp3[0] === 0xff, 'an MP3');
    const added = await red.call('buzzer-library/add', {id});
    assert.equal(added.name, 'Air horn');
    const buzzer = added.sounds.buzzers.find(b => b.name === 'Air horn');
    assert.ok(buzzer && existsSync(path.join(dir, 'pro-media', path.basename(buzzer.media))), 'saved on the laptop, for quiz nights offline');
    assert.equal((await red.call('buzzer-library/add', {id})).name, 'Air horn (2)');

    // Asking BeerMat Online directly needs a request signed by a Pro venue's laptop, fresh, for that clip.
    const laptop = newVenueKey();
    const ask = (venueKey, request) => api('POST', `/v1/buzzers/${id}/audio`, {request: signClaim({v: 1, kind: 'beermat.buzzer-get', at: time, buzzer: id, ...request}, venueKey)});
    assert.equal((await ask(laptop)).status, 403, 'a laptop no venue registered');
    service.importVenues({venues: [{id: 'red-lion', name: 'The Red Lion', town: 'Bristol'}, {id: 'blue-bell', name: 'The Blue Bell', town: 'Bath'}, ...[1, 2, 3].map(i => ({id: `pub-${i}`, name: `Pub ${i}`, town: 'Leeds'}))]});
    service.db.prepare("UPDATE venues SET plan='pro' WHERE id LIKE 'pub-%'").run();
    const pubs = [1, 2, 3].map(i => {const k = newVenueKey(); register(`pub-${i}`, k.publicKey); return k;});
    assert.equal((await ask(pubs[0])).status, 200);
    assert.equal((await ask(pubs[0], {at: time - 11 * 60000})).status, 400, 'stale');
    assert.equal((await ask(pubs[0], {buzzer: 'another'})).status, 400, 'for another clip');

    // Reports: one per venue; the third venue's hides it and tells BeerMat.
    const report = (k, reason = 'Copied from a TV show') => api('POST', `/v1/buzzers/${id}/report`, {request: signClaim({v: 1, kind: 'beermat.buzzer-report', at: time, buzzer: id, reason}, k)});
    assert.equal((await blue.call('buzzer-library/report', {id, reason: 'Rude'})).status, 403, 'Free can’t report');
    await report(pubs[0]); await report(pubs[0]); await report(pubs[1]);
    assert.equal((await api('GET', '/v1/buzzers')).buzzers.length, 1, 'two venues reporting isn’t enough');
    assert.equal((await red.call('buzzer-library/report', {id, reason: 'Too loud'})).status, 200);
    assert.equal((await api('GET', '/v1/buzzers')).buzzers.length, 0, 'hidden after three venues');
    assert.equal((await red.call('buzzer-library/play', {id})).status, 400);
    assert.match(mails.at(-1).subject, /Shared buzzer hidden after 3 reports: Air horn/);

    // The admin sees who shared it and its reports, plays it, puts it back (the reports are dealt with), or removes it.
    const admin = (await api('POST', '/v1/accounts', {email: 'admin@example.com', password: 'correct horse battery', displayName: 'Admin'})).token;
    service.db.prepare("UPDATE accounts SET admin=1 WHERE email='admin@example.com'").run();
    assert.equal((await api('GET', '/v1/admin/buzzers', undefined, red.key)).status, 401);
    const [row] = (await api('GET', '/v1/admin/buzzers', undefined, admin)).buzzers;
    assert.deepEqual([row.name, row.venueName, row.reports, row.hidden], ['Air horn', 'The Red Lion', 3, true]);
    assert.equal((await api('GET', '/v1/admin/overview', undefined, admin)).hiddenBuzzers, 1);
    assert.ok((await api('GET', '/v1/admin/reports', undefined, admin)).reports.some(r => r.kind === 'buzzer' && r.targetName === 'Air horn' && r.reporter === 'Pub 1'));
    const audio = await fetch(`${online}/v1/admin/buzzers/${id}/audio`, {headers: {Authorization: 'Bearer ' + admin}});
    assert.equal(audio.headers.get('content-type'), 'audio/mpeg');
    await api('PATCH', `/v1/admin/buzzers/${id}`, {hidden: false}, admin);
    assert.equal((await api('GET', '/v1/buzzers')).buzzers.length, 1);
    assert.equal((await api('GET', '/v1/admin/overview', undefined, admin)).openReports, 0);

    // The venue that shared it can take it back out; nobody else can.
    const second = await red.call('buzzer-library/share', {name: 'Kazoo', media, rights: true});
    assert.equal((await blue.call('buzzer-library/remove', {id: second.id})).status, 400);
    assert.equal((await api('POST', `/v1/buzzers/${second.id}/remove`, {request: signClaim({v: 1, kind: 'beermat.buzzer-remove', at: time, buzzer: second.id}, pubs[2])})).status, 403);
    assert.equal((await red.call('buzzer-library/remove', {id: second.id})).removed, true);
    assert.deepEqual((await api('GET', '/v1/buzzers')).buzzers.map(b => b.name), ['Air horn']);

    // A venue stopped from sharing loses every clip it shared, and can't share again.
    await api('POST', '/v1/admin/venues/red-lion/library', {banned: true}, admin);
    assert.equal((await api('GET', '/v1/buzzers')).buzzers.length, 0);
    assert.equal((await red.call('buzzer-library/share', {name: 'Again', media, rights: true})).status, 403);

    // What a laptop sends must be what it signed.
    const k = pubs[2], clip = readFileSync(wav);
    const upload = (request, audioB64) => api('POST', '/v1/buzzers', {request: signClaim({v: 1, kind: 'beermat.buzzer-upload', at: time, rights: true, name: 'Bell', sha256: createHash('sha256').update(clip).digest('hex'), ...request}, k), audio: audioB64 ?? clip.toString('base64')});
    assert.equal((await upload({}, Buffer.from('not the clip').toString('base64'))).status, 400);
    assert.equal((await upload({sha256: createHash('sha256').update('x').digest('hex')}, Buffer.from('x').toString('base64'))).status, 400, 'not audio');
    assert.equal((await upload({})).status, 201);
  } finally {
    await Promise.all([red, blue].map(d => d.quiz.close()));
    await service.close(); rmSync(dir, {recursive: true, force: true});
  }
});
