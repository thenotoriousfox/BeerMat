// Updates for BeerMat Desk: the release's signed manifest (scripts/update-manifest.mjs, shared/update.js) served by a
// stand-in for downloads.beermatquiz.co.uk; the desk's quiz server finds the newer version and downloads its file,
// checked; a manifest not signed by the release key, or a file that isn't what it says, is refused.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import {createQuiz} from '../server/server.js';
import {newVenueKey} from '../shared/claims.js';
import {newer, readManifest, signManifest} from '../shared/update.js';

const current = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const next = current.replace(/\d+$/, n => String(Number(n) + 1));

test('versions compare part by part', () => {
  assert.ok(newer('0.5.10', '0.5.9'));
  assert.ok(newer('1.0.0', '0.9.9'));
  assert.ok(!newer('0.5.5', '0.5.5'));
  assert.ok(!newer('0.5.4', '0.5.5'));
});

test('desk updates: the signed manifest, a checked download, and refusals', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'quiz-updates-')), release = newVenueKey(), other = newVenueKey();
  // The release's files, and its manifest made by the release workflow's script.
  const files = path.join(dir, 'release');
  mkdirSync(files);
  writeFileSync(path.join(files, `BeerMat-Desk-Setup-${next}.exe`), 'installer bytes');
  writeFileSync(path.join(files, `BeerMat-Desk-${next}-linux-x64.AppImage`), 'appimage bytes');
  writeFileSync(path.join(files, `BeerMat-${next}.apk`), 'apk bytes');
  const manifest = JSON.parse(execFileSync(process.execPath, ['scripts/update-manifest.mjs', files, next],
    {env: {...process.env, UPDATE_KEY: release.privateKey, UPDATE_PUBLIC_KEY: release.publicKey}, stdio: ['ignore', 'pipe', 'ignore']}));
  assert.deepEqual(Object.keys(manifest.files).sort(), ['android', 'linux-appimage', 'windows-installer']);
  assert.ok(Number.isInteger(manifest.files.android.versionCode));
  assert.ok(readManifest(manifest, {publicKey: release.publicKey}));
  assert.equal(readManifest(manifest), null, 'only the release key’s manifests');

  // downloads.beermatquiz.co.uk
  let served = manifest, bytes = name => readFileSync(path.join(files, name));
  const downloads = http.createServer((req, res) => {
    if (req.url === '/latest.json') return res.end(JSON.stringify(served));
    const [, version, name] = req.url.split('/');
    try {res.end(version === next ? bytes(decodeURIComponent(name)) : '');} catch {res.statusCode = 404; res.end();}
  });
  await new Promise(r => downloads.listen(0, '127.0.0.1', r));
  mkdirSync(path.join(dir, 'desk'), {recursive: true});
  const quiz = createQuiz({hostKey: 'a-secure-quiz-test-key', database: path.join(dir, 'desk', 'quiz.sqlite'), mediaDir: path.join(dir, 'media'), packDir: dir, soundsDir: dir,
    updatesBase: `http://127.0.0.1:${downloads.address().port}`, updateKey: release.publicKey});
  await new Promise(r => quiz.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${quiz.server.address().port}`;
  const host = (await (await fetch(base + '/api/login', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({key: 'a-secure-quiz-test-key'})})).json()).key;
  const call = async (route, body = {}) => {
    const response = await fetch(`${base}/api/host/${route}`, {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + host}, body: JSON.stringify(body)});
    return {status: response.status, ...await response.json()};
  };
  try {
    assert.ok([401, 403].includes((await fetch(`${base}/api/host/update/check`, {method: 'POST', body: '{}'})).status), 'the desk only');
    let checked = await call('update/check', {kind: 'windows-installer'});
    assert.deepEqual([checked.current, checked.latest, checked.available, checked.file?.name], [current, next, true, `BeerMat-Desk-Setup-${next}.exe`]);
    // A kind of install without a file this version (the zip): told, to download by hand.
    checked = await call('update/check', {kind: 'windows-zip'});
    assert.deepEqual([checked.available, checked.file], [true, null]);
    assert.equal((await call('update/download', {kind: 'windows-zip'})).status, 502);

    // The download, checked, in the data folder's updates/.
    const got = await call('update/download', {kind: 'linux-appimage'});
    assert.equal(got.status, 200, JSON.stringify(got));
    assert.equal(readFileSync(got.path, 'utf8'), 'appimage bytes');
    assert.equal(path.dirname(got.path), path.join(dir, 'desk', 'updates'));

    // A file that isn't what the manifest says: refused, nothing left behind.
    bytes = name => name.endsWith('.exe') ? Buffer.from('tampered bytes!') : readFileSync(path.join(files, name));
    const tampered = await call('update/download', {kind: 'windows-installer'});
    assert.deepEqual([tampered.status, /doesn’t match/.test(tampered.error)], [502, true]);
    assert.ok(!existsSync(path.join(dir, 'desk', 'updates', `BeerMat-Desk-Setup-${next}.exe`)));
    assert.deepEqual(readdirSync(path.join(dir, 'desk', 'updates')), [], 'the earlier download is cleared too');

    // A manifest signed by anyone else, or changed after signing: no update.
    served = signManifest({version: next, files: manifest.files}, other.privateKey);
    assert.match((await call('update/check', {kind: 'linux-appimage'})).error, /isn’t signed by BeerMat/);
    served = {...manifest, version: '9.9.9'};
    assert.match((await call('update/check', {kind: 'linux-appimage'})).error, /isn’t signed by BeerMat/);
    // The same version or older: up to date.
    served = signManifest({version: current, files: manifest.files}, release.privateKey);
    checked = await call('update/check', {kind: 'linux-appimage'});
    assert.deepEqual([checked.available, checked.file], [false, null]);
    assert.match((await call('update/download', {kind: 'linux-appimage'})).error, /up to date/);
  } finally {
    await quiz.close(); downloads.close();
    rmSync(dir, {recursive: true, force: true});
  }
});
