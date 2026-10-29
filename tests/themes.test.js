import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, readdirSync, existsSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {loadThemes} from '../server/themes.js';
import {createQuiz} from '../server/server.js';

const root = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const write = (dir, file, text) => {mkdirSync(path.dirname(path.join(dir, file)), {recursive: true}); writeFileSync(path.join(dir, file), text);};

test('themes are folders: name and order from theme.json, a look from look.css, a sound theme from sounds/', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'quiz-themes-'));
  try {
    write(dir, 'b-theme/theme.json', '{"name": "Second", "order": 2}');
    write(dir, 'b-theme/look.css', ':root[data-look=b-theme] { --gold: red; }');
    write(dir, 'a-theme/theme.json', '{"name": "First", "order": 1, "seasonal": true}');
    write(dir, 'a-theme/sounds/correct.mp3', 'x'); write(dir, 'a-theme/sounds/drum_roll.mp3', 'x'); write(dir, 'a-theme/sounds/notes.txt', 'x');
    write(dir, 'no-info/look.css', 'body {}'); write(dir, 'Bad Name/theme.json', '{"name": "Bad"}'); write(dir, 'broken/theme.json', '{nope');
    const loaded = loadThemes(dir);
    assert.deepEqual(loaded.themes.map(t => [t.id, t.name, t.seasonal]), [['a-theme', 'First', true], ['b-theme', 'Second', false]]);
    assert.deepEqual(loaded.themes[0].sounds, {correct: '/themes/a-theme/sounds/correct.mp3', reveal: '/themes/a-theme/sounds/drum_roll.mp3'});
    assert.match(loaded.css, /--gold: red/); assert.doesNotMatch(loaded.css, /body \{\}/);
    assert.equal(loaded.file('a-theme', 'sounds/correct.mp3'), path.join(dir, 'a-theme', 'sounds', 'correct.mp3'));
    for (const [id, file] of [['a-theme', '../b-theme/look.css'], ['a-theme', 'theme.json'], ['a-theme', 'sounds/notes.txt'], ['no-info', 'look.css'], ['..', 'server.js'], ['a-theme', '/etc/passwd.css']]) assert.equal(loaded.file(id, file), null, `${id}/${file}`);
  } finally {rmSync(dir, {recursive: true, force: true});}
});

test('every shipped theme is complete: valid theme.json, its look styles only itself, and the files it uses exist', () => {
  const dir = path.join(root, 'themes'), ids = readdirSync(dir, {withFileTypes: true}).filter(e => e.isDirectory()).map(e => e.name);
  const loaded = loadThemes(dir);
  assert.deepEqual(loaded.themes.map(t => t.id).sort(), ids.sort(), 'every folder loads');
  assert.equal(loaded.themes[0].id, 'stage', 'the default look comes first');
  for (const id of ids) {
    const cssFile = path.join(dir, id, 'look.css');
    if (!existsSync(cssFile)) continue;
    const css = readFileSync(cssFile, 'utf8');
    for (const [, look] of css.matchAll(/data-look=([a-z0-9-]+)/g)) assert.equal(look, id, `${id}/look.css only styles its own look`);
    for (const [, url] of css.matchAll(/url\(([^)]+)\)/g)) {
      const match = /^\/themes\/([^/]+)\/(.+)$/.exec(url);
      assert.ok(match && match[1] === id, `${id}/look.css uses its own files (${url})`);
      assert.ok(loaded.file(id, match[2]) && existsSync(loaded.file(id, match[2])), `${url} exists`);
    }
  }
  assert.deepEqual(Object.keys(loaded.themes.find(t => t.id === 'halloween').sounds).sort(), ['correct', 'endRound', 'questionStart', 'reveal', 'startRound', 'timeUp', 'timerMusic', 'wrong']);
});

test('the server serves /themes.css and theme files, nothing else from the folder', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'quiz-themes-server-'));
  const quiz = createQuiz({plan: 'pro', hostKey: 'a-secure-quiz-test-key', database: path.join(dir, 'quiz.sqlite'), mediaDir: dir, packDir: path.join(dir, 'none'), soundsDir: path.join(dir, 'none')});
  await new Promise(r => quiz.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${quiz.server.address().port}`;
  try {
    const css = await fetch(base + '/themes.css');
    assert.equal(css.headers.get('content-type'), 'text/css; charset=utf-8'); assert.match(await css.text(), /data-look=halloween/);
    const svg = await fetch(base + '/themes/halloween/art/scene.svg');
    assert.equal(svg.status, 200); assert.equal(svg.headers.get('content-type'), 'image/svg+xml'); assert.match(svg.headers.get('content-security-policy'), /default-src 'self'/);
    for (const p of ['/themes/halloween/theme.json', '/themes/halloween/make-sounds.mjs', '/themes/nope/look.css', '/themes/halloween/art/missing.svg']) assert.equal((await fetch(base + p)).status, 404, p);
    // Sent exactly as written (fetch would tidy the dots away first).
    const raw = p => new Promise((resolve, reject) => http.get({host: '127.0.0.1', port: quiz.server.address().port, path: p}, r => {let body = ''; r.on('data', c => body += c); r.on('end', () => resolve(body));}).on('error', reject));
    for (const p of ['/themes/halloween/../../server/server.js', '/themes/halloween/%2e%2e/%2e%2e/server%2fserver.js', '/themes/halloween/art/..%2f..%2ftheme.json', '/themes/halloween/art/%2e%2e/theme.json']) {
      const body = await raw(p); assert.doesNotMatch(body, /export function createQuiz|"seasonal"/, p);
    }
    for (const page of ['/display', '/']) assert.match(await (await fetch(base + page)).text(), /href="\/themes.css"/);
  } finally {await quiz.close(); rmSync(dir, {recursive: true, force: true});}
});

test('the native apps get a look as data: its colours and its phone scenery', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'quiz-looks-'));
  const quiz = createQuiz({plan: 'pro', hostKey: 'a-secure-quiz-test-key', database: path.join(dir, 'quiz.sqlite'), mediaDir: dir, packDir: path.join(dir, 'none'), soundsDir: path.join(dir, 'none')});
  await new Promise(r => quiz.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${quiz.server.address().port}`;
  try {
    const halloween = await (await fetch(base + '/api/looks/halloween')).json();
    assert.equal(halloween.name, 'Halloween');
    assert.equal(halloween.colours['--gold'], '#ff7a1a');
    assert.equal(halloween.colours['--line'], 'rgba(255, 150, 70, .2)');
    assert.equal(halloween.colours['--scene'], undefined, 'only colours');
    assert.deepEqual(halloween.phone.scene.map(l => l.image), ['/themes/halloween/art/phone-moon.webp', '/themes/halloween/art/phone-hill.webp']);
    assert.equal((await fetch(base + halloween.phone.scene[0].image)).status, 200, 'the app can load its pictures');
    const stage = await (await fetch(base + '/api/looks/stage')).json();
    assert.deepEqual([stage.colours, stage.phone], [{}, null], 'the default look: BeerMat’s own colours');
    assert.equal((await fetch(base + '/api/looks/nope')).status, 404);
  } finally {await quiz.close(); rmSync(dir, {recursive: true, force: true});}
});
