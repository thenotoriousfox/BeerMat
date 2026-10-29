// The theme library: a Pro venue's quiz laptop shares a theme of its own through a real BeerMat Online; nobody sees it
// until an admin approves it; then everyone sees it, Pro laptops install it (checked again, under its library id) and
// it becomes a look; three venues' reports hide it; a venue stopped from sharing loses its themes.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createQuiz} from '../server/server.js';
import {createService} from '../online/service.js';
import {newVenueKey, signClaim} from '../shared/claims.js';

const day = 86400000;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

test('theme library: shared by Pro, approved by BeerMat, installed by Pro as a look, hidden after three reports', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'quiz-themes-lib-')), mails = [];
  let time = Date.now();
  const service = createService({database: path.join(dir, 'online.sqlite'), now: () => time, mail: async m => {mails.push(m);}, adminEmail: 'hello@beermat.test', publicUrl: 'https://online.test'});
  await new Promise(r => service.server.listen(0, '127.0.0.1', r));
  const online = `http://127.0.0.1:${service.server.address().port}`;
  const desk = async (name, plan) => {
    const quiz = createQuiz({hostKey: 'a-secure-quiz-test-key', database: path.join(dir, name, 'quiz.sqlite'), mediaDir: path.join(dir, name, 'media'), packDir: dir, soundsDir: dir, plan, now: () => time});
    await new Promise(r => quiz.server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${quiz.server.address().port}`;
    const host = (await (await fetch(base + '/api/login', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({key: 'a-secure-quiz-test-key'})})).json()).key;
    const call = async (route, body = {}) => {
      const response = await fetch(`${base}/api/host/${route}`, {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + host}, body: JSON.stringify(body)});
      return {status: response.status, ...await response.json()};
    };
    await call('settings', {onlineService: online});
    return {quiz, base, call, folder: path.join(dir, name, 'my-themes'), key: (await call('results')).venueKey};
  };
  const api = async (method, route, body, token) => {
    const response = await fetch(online + route, {method, headers: {'Content-Type': 'application/json', ...(token && {Authorization: 'Bearer ' + token})}, ...(body && {body: JSON.stringify(body)})});
    return {status: response.status, ...await response.json().catch(() => ({}))};
  };
  mkdirSync(path.join(dir, 'red'), {recursive: true}); mkdirSync(path.join(dir, 'blue'), {recursive: true});
  const [red, blue] = await Promise.all([desk('red', 'pro'), desk('blue')]);
  try {
    service.importVenues({venues: [{id: 'red-lion', name: 'The Red Lion', town: 'Bristol'}, {id: 'blue-bell', name: 'The Blue Bell', town: 'Bath'}]});
    service.db.prepare("UPDATE venues SET plan='pro', plan_until=? WHERE id='red-lion'").run(time + 30 * day);
    const register = (venue, key) => service.db.prepare('INSERT INTO venue_keys VALUES(?,?,?,?)').run(key.slice(-12), venue, key, time);
    register('red-lion', red.key); register('blue-bell', blue.key);

    // The Red Lion makes a theme in its My themes folder.
    const mine = path.join(red.folder, 'pub-glow');
    mkdirSync(path.join(mine, 'art'), {recursive: true});
    writeFileSync(path.join(mine, 'theme.json'), '{"name": "Pub glow"}');
    writeFileSync(path.join(mine, 'look.css'), ':root[data-look=pub-glow] { --gold: #33ff99; }\n:root[data-look=pub-glow] .decor { background: url(/themes/pub-glow/art/glow.png); }\n@keyframes glow { to { opacity: 1; } }\n');
    writeFileSync(path.join(mine, 'art', 'glow.png'), PNG);
    writeFileSync(path.join(mine, 'tv.json'), JSON.stringify({eyebrow: {color: '#33ff99'}, scene: [{image: 'art/glow.png', x: 0, y: 0, width: 100, height: 100}]}));
    // Its own theme is a look at once on its own laptop (after the server reloads its themes, as installing does).
    let listed = await red.call('theme-library');
    assert.deepEqual([listed.pro, listed.mine.map(t => t.id), listed.themes], [true, ['pub-glow'], []]);
    assert.equal(listed.folder, red.folder);

    // Sharing: Pro only, the box ticked, and the theme must pass the checks first.
    assert.match((await red.call('theme-library/share', {id: 'pub-glow', rights: false})).error, /Tick the box/);
    mkdirSync(path.join(blue.folder, 'pub-glow'), {recursive: true}); writeFileSync(path.join(blue.folder, 'pub-glow', 'theme.json'), '{"name": "Copy"}');
    assert.equal((await blue.call('theme-library/share', {id: 'pub-glow', rights: true})).status, 403, 'Free can’t share');
    writeFileSync(path.join(mine, 'bad.css'), 'body {}');
    const shared = await red.call('theme-library/share', {id: 'pub-glow', rights: true});
    assert.equal(shared.status, 200, JSON.stringify(shared));
    assert.equal(shared.status === 200 && shared.name, 'Pub glow');
    assert.match(shared.id, /^s-[0-9a-f]{10}$/);
    const id = shared.id;

    // Nobody sees it until BeerMat approves it; the laptop that shared it sees that it's waiting.
    assert.equal((await api('GET', '/v1/themes')).themes.length, 0);
    assert.deepEqual((await red.call('theme-library')).shared.map(t => [t.id, t.local, t.status]), [[id, 'pub-glow', 'pending']]);
    assert.match(mails.at(-1).subject, /Theme waiting for a look: Pub glow/);
    const admin = (await api('POST', '/v1/accounts', {email: 'admin@example.com', password: 'correct horse battery', displayName: 'Admin'})).token;
    service.db.prepare("UPDATE accounts SET admin=1 WHERE email='admin@example.com'").run();
    assert.equal((await api('GET', '/v1/admin/themes')).status, 401);
    const [row] = (await api('GET', '/v1/admin/themes', undefined, admin)).themes;
    assert.deepEqual([row.name, row.status, row.venueName, row.files.map(f => f.name).sort()], ['Pub glow', 'pending', 'The Red Lion', ['art/glow.png', 'look.css', 'theme.json', 'tv.json']]);
    assert.equal((await api('GET', '/v1/admin/overview', undefined, admin)).pendingThemes, 1);
    // The admin reads its files, safely: its stylesheet as text, under a sandbox, renamed to its library id.
    const css = await fetch(`${online}/v1/admin/themes/${id}/files/look.css`, {headers: {Authorization: 'Bearer ' + admin}});
    assert.match(css.headers.get('content-type'), /text\/plain/);
    assert.match(css.headers.get('content-security-policy'), /sandbox/);
    const text = await css.text();
    assert.match(text, new RegExp(`data-look=${id}\\]`));
    assert.match(text, new RegExp(`/themes/${id}/art/glow\\.png`));
    assert.match(text, new RegExp(`@keyframes ${id}--glow`));
    // Turned down, with a note the venue sees; then approved.
    await api('PATCH', `/v1/admin/themes/${id}`, {status: 'rejected', note: 'The glow picture is blank.'}, admin);
    assert.deepEqual((await red.call('theme-library')).shared.map(t => [t.status, t.note]), [['rejected', 'The glow picture is blank.']]);
    await api('PATCH', `/v1/admin/themes/${id}`, {status: 'approved'}, admin);
    listed = await blue.call('theme-library');
    assert.deepEqual([listed.pro, listed.themes.map(t => [t.id, t.name, t.look, t.tv, t.sounds])], [false, [[id, 'Pub glow', true, true, false]]]);

    // Free can't install it; Pro can, and it becomes a look, served from this laptop, checked again on the way in.
    assert.equal((await blue.call('theme-library/install', {id})).status, 403);
    const installed = await red.call('theme-library/install', {id});
    assert.deepEqual([installed.status, installed.name], [200, 'Pub glow']);
    assert.ok(existsSync(path.join(red.folder, id, 'look.css')) && !existsSync(path.join(red.folder, id, 'bad.css')), 'only the checked files');
    const looks = (await red.call('state')).looks.map(([look]) => look);
    assert.ok(looks.includes(id) && looks.includes('pub-glow'));
    assert.match(await (await fetch(red.base + '/themes.css')).text(), new RegExp(`data-look=${id}\\]`));
    assert.equal((await fetch(`${red.base}/themes/${id}/art/glow.png`)).status, 200);
    assert.equal((await (await fetch(`${red.base}/api/looks/${id}`)).json()).colours['--gold'], '#33ff99');
    assert.deepEqual((await red.call('theme-library')).installed.map(t => t.id), [id]);
    // Used tonight, then removed: the quiz goes back to the default look.
    await red.call('settings', {look: id});
    assert.equal((await red.call('theme-library/uninstall', {id})).status, 200);
    assert.ok(!existsSync(path.join(red.folder, id)));
    assert.equal((await red.call('state')).settings.look, 'stage');
    assert.equal((await red.call('theme-library/uninstall', {id: 'pub-glow'})).status, 400, 'only themes from the library');

    // Reports: one per venue; the third venue's hides it.
    service.importVenues({venues: [{id: 'red-lion', name: 'The Red Lion', town: 'Bristol'}, {id: 'blue-bell', name: 'The Blue Bell', town: 'Bath'}, ...[1, 2, 3].map(i => ({id: `pub-${i}`, name: `Pub ${i}`, town: 'Leeds'}))]});
    service.db.prepare("UPDATE venues SET plan='pro' WHERE id LIKE 'pub-%'").run();
    const pubs = [1, 2, 3].map(i => {const k = newVenueKey(); register(`pub-${i}`, k.publicKey); return k;});
    const report = k => api('POST', `/v1/themes/${id}/report`, {request: signClaim({v: 1, kind: 'beermat.theme-report', at: time, theme: id, reason: 'Not ours'}, k)});
    await report(pubs[0]); await report(pubs[0]); await report(pubs[1]);
    assert.equal((await api('GET', '/v1/themes')).themes.length, 1, 'two venues reporting isn’t enough');
    await report(pubs[2]);
    assert.equal((await api('GET', '/v1/themes')).themes.length, 0, 'hidden after three venues');
    const refused = await red.call('theme-library/install', {id}); assert.equal(refused.status, 400, JSON.stringify(refused));
    assert.ok((await api('GET', '/v1/admin/reports', undefined, admin)).reports.some(r => r.kind === 'theme' && r.targetName === 'Pub glow'));

    // What a laptop sends must be what it signed.
    const bundle = JSON.stringify({id: 'x', files: {}});
    assert.equal((await api('POST', '/v1/themes', {request: signClaim({v: 1, kind: 'beermat.theme-upload', at: time, rights: true, sha256: 'nope'}, pubs[2]), bundle})).status, 400);

    // A venue stopped from sharing loses its themes, and can't share again.
    await api('PATCH', `/v1/admin/themes/${id}`, {hidden: false}, admin);
    assert.equal((await api('GET', '/v1/themes')).themes.length, 1);
    await api('POST', '/v1/admin/venues/red-lion/library', {banned: true}, admin);
    assert.equal((await api('GET', '/v1/themes')).themes.length, 0);
    assert.equal((await red.call('theme-library/share', {id: 'pub-glow', rights: true})).status, 403);
    assert.ok(readFileSync(path.join(mine, 'look.css'), 'utf8').includes('pub-glow'), 'the venue’s own folder is untouched');
  } finally {
    await red.quiz.close(); await blue.quiz.close(); await service.close();
    rmSync(dir, {recursive: true, force: true});
  }
});
