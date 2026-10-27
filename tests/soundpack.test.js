import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import http from 'node:http';
import {promisify} from 'node:util';
import {mkdtempSync, mkdirSync, rmSync, writeFileSync, readdirSync, existsSync, readFileSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createQuiz} from '../server/server.js';
const root = path.join(path.dirname(new URL(import.meta.url).pathname), '..');

const hostKey = 'a-secure-quiz-test-key';
test('a laptop’s own sound pack becomes the default; desk choices override it', async () => {
  // soundpack/: general/<name>.mp3 for each moment, buzzers/<pack>/*.mp3, bingo-calls.json and a recorded caller.
  const dir = mkdtempSync(path.join(os.tmpdir(), 'quiz-pack-')), pack = path.join(dir, 'soundpack');
  const mp3 = Buffer.from([0xff, 0xfb, 0x90, 0x00, 1, 2, 3]), put = (file, data = mp3) => {mkdirSync(path.dirname(path.join(pack, file)), {recursive: true}); writeFileSync(path.join(pack, file), data);};
  for (const name of ['correct', 'incorrect', 'airhorn', 'bingo_call', 'start_round', 'end_clunk', 'applause/1']) put(`general/${name}.mp3`);
  put('buzzers/Sample Music/Barnyard Jig.mp3'); put('buzzers/Impersonations/Ahaaa.mp3'); put('buzzers/Impersonations (Offensive)/Rude.mp3');
  put('bingo-calls.json', JSON.stringify(Object.fromEntries([[1, 'Kelly\'s eye, yellow 1'], [4, 'Knock at the door, yellow 4'], [90, 'Top of the shop, yellow 90']])));
  put('bingo_voice/4.mp3');

  // The shipped CC0 sounds fill in the moments the pack lacks; the pack wins where both have one.
  const shipped = path.join(dir, 'shipped'); mkdirSync(path.join(shipped, 'general'), {recursive: true}); mkdirSync(path.join(shipped, 'buzzers', 'Jingles'), {recursive: true});
  mkdirSync(path.join(shipped, 'bingo_voice'));
  for (const f of ['general/correct.mp3', 'general/drum_roll.mp3', 'buzzers/Jingles/Sax.mp3', 'bingo_voice/4.mp3']) writeFileSync(path.join(shipped, f), mp3);
  const quiz = createQuiz({plan: 'pro', hostKey, database: path.join(dir, 'quiz.sqlite'), mediaDir: dir, packDir: pack, soundsDir: shipped});
  await new Promise(r => quiz.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${quiz.server.address().port}`;
  const call = async (route, body = {}, key = '') => {const r = await fetch(`${base}/api/${route}`, {method: 'POST', headers: {Authorization: 'Bearer ' + key}, body: JSON.stringify(body)}); return {status: r.status, ...await r.json()};};
  try {
    const key = (await call('login', {key: hostKey})).key, board = async () => (await fetch(base + '/api/leaderboard')).json();
    const {sounds} = await board();
    assert.deepEqual(Object.keys(sounds.slots).sort(), ['applause', 'bingo', 'correct', 'reveal', 'startRound', 'timeUp', 'wrong']);
    assert.equal(sounds.slots.correct, '/pack/general/correct.mp3'); assert.equal(sounds.slots.reveal, '/sounds/general/drum_roll.mp3');
    assert.equal(sounds.slots.applause, '/pack/general/applause/1.mp3');
    assert.equal(sounds.slots.bingo, '/pack/general/bingo_call.mp3', 'bingo_call is for a claim, ahead of the airhorn'); assert.equal(sounds.slots.bingoCall, undefined);
    assert.deepEqual(sounds.buzzers.map(b => b.name), ['Ahaaa', 'Barnyard Jig', 'Sax'], 'pack buzzers first, offensive pack skipped, then the shipped ones');
    const served = await fetch(base + sounds.buzzers[1].media);
    assert.equal(served.status, 200); assert.equal(served.headers.get('content-type'), 'audio/mpeg');
    // Raw paths (fetch would tidy away the ..), so the server itself must keep requests inside the pack.
    const raw = target => new Promise((resolve, reject) => http.get({host: '127.0.0.1', port: quiz.server.address().port, path: target}, r => {
      let body = ''; r.on('data', c => {body += c.toString('latin1');}); r.on('end', () => resolve({status: r.statusCode, type: r.headers['content-type'] || '', body}));}).on('error', reject));
    for (const bad of ['/pack/../quiz.sqlite', '/pack/%2e%2e/quiz.sqlite', '/pack/general/..%2f..%2fquiz.sqlite', '/sounds/..%2fquiz.sqlite', '/pack/bingo-calls.json']) {
      const r = await raw(bad);
      assert.ok(!r.body.startsWith('SQLite format') && !r.type.startsWith('audio') && (r.status === 404 || r.type.startsWith('text/html')), bad);
    }
    // Teams can pick a pack buzzer; the desk can change a moment and still keep the rest of the pack.
    const team = await call('join', {name: 'Fox'}); assert.equal((await call('team/sound', {sound: 10}, team.secret)).ok, true);
    await call('host/sounds', {slots: {startRound: sounds.slots.bingo, correct: null}}, key);
    const after = (await board()).sounds;
    assert.equal(after.slots.startRound, sounds.slots.bingo); assert.equal(after.slots.correct, undefined); assert.equal(after.slots.timeUp, sounds.slots.timeUp);
    assert.equal((await call('host/sounds', {buzzers: [...after.buzzers, {name: 'Extra', media: sounds.slots.bingo}]}, key)).buzzers.length, 4);
    // Pack bingo calls are the default; "use the built-in calls" switches them off.
    const {id} = await call('host/open', {text: 'Bingo', type: 'bingo', seconds: 600, points: 1, mode: 'line'}, key);
    let phrase; for (let n = 0; n < 90 && phrase === undefined; n++) {const {number} = await call('host/bingo', {question: id}, key); if (number === 4) phrase = (await board()).question.bingo.phrase;}
    assert.equal(phrase, 'Knock at the door, yellow 4');
    assert.equal((await call('host/state', {}, key)).bingoCalls[0], 'Kelly\'s eye, yellow 1');
    // The spoken caller matches the calls in use: the pack's with the pack's calls, the shipped one with the built-in calls.
    const voice = async () => (await board()).question.bingo.voice;
    assert.equal(await voice(), '/pack/bingo_voice/4.mp3');
    await call('host/bingo-calls', {calls: null}, key); assert.equal((await call('host/state', {}, key)).bingoCalls, null);
    assert.equal(await voice(), '/sounds/bingo_voice/4.mp3');
    await call('host/settings', {bingoPhrases: false}, key); assert.equal(await voice(), null, 'no caller with phrases off');
    await call('host/settings', {bingoPhrases: true, bingoVoice: false}, key); assert.equal(await voice(), null, 'caller switched off');
    await call('host/settings', {bingoVoice: true}, key); assert.equal(await voice(), '/sounds/bingo_voice/4.mp3');
    await call('host/bingo-calls', {calls: Array.from({length: 90}, (_, i) => `Call ${i + 1}`)}, key); assert.equal(await voice(), null, 'the desk\'s own calls have no recordings');
  } finally {await quiz.close(); rmSync(dir, {recursive: true, force: true});}
});

test('sound themes from the pack replace the moments they have; picking one resets desk choices but keeps buzzers', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'quiz-theme-')), pack = path.join(dir, 'pack'), mp3 = Buffer.from([0xff, 0xfb, 0x90, 0x00, 1]);
  for (const f of ['general/correct.mp3', 'general/drum_roll.mp3', 'Themes/Arcade Theme/correct.mp3', 'Themes/Arcade Theme/stopwatch_timer_end.mp3', 'buzzers/Pack/Honk.mp3']) {
    mkdirSync(path.dirname(path.join(pack, f)), {recursive: true}); writeFileSync(path.join(pack, f), mp3);
  }
  const quiz = createQuiz({plan: 'pro', hostKey, database: path.join(dir, 'quiz.sqlite'), mediaDir: dir, packDir: pack, soundsDir: path.join(dir, 'none'), themesDir: path.join(dir, 'none')});
  await new Promise(r => quiz.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${quiz.server.address().port}`;
  const call = async (route, body = {}, key = '') => {const r = await fetch(`${base}/api/${route}`, {method: 'POST', headers: {Authorization: 'Bearer ' + key}, body: JSON.stringify(body)}); return {status: r.status, ...await r.json()};};
  try {
    const key = (await call('login', {key: hostKey})).key, host = (route, body) => call('host/' + route, body, key);
    let s = await host('state'); assert.deepEqual(s.soundThemes, ['Arcade Theme']); assert.equal(s.sounds.slots.correct, '/pack/general/correct.mp3');
    await host('sounds', {slots: {wrong: s.sounds.slots.correct}, buzzers: []});
    await host('settings', {soundTheme: 'Arcade Theme'});
    s = await host('state');
    assert.deepEqual(s.sounds.slots, {correct: '/pack/Themes/Arcade%20Theme/correct.mp3', timeUp: '/pack/Themes/Arcade%20Theme/stopwatch_timer_end.mp3', reveal: '/pack/general/drum_roll.mp3'});
    assert.deepEqual(s.sounds.buzzers, [], 'buzzer choices survive a theme change');
    assert.equal((await fetch(base + s.sounds.slots.correct)).status, 200);
    assert.equal((await host('settings', {soundTheme: 'Nope'})).status, 400);
    await host('settings', {soundTheme: ''}); assert.equal((await host('state')).sounds.slots.correct, '/pack/general/correct.mp3');
  } finally {await quiz.close(); rmSync(dir, {recursive: true, force: true});}
});

test('sound themes can be random for each question or chosen by question type', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'quiz-themes-')), pack = path.join(dir, 'pack'), mp3 = Buffer.from([0xff, 0xfb, 0x90, 0x00, 1]);
  for (const f of ['general/correct.mp3', 'Themes/Arcade Theme/correct.mp3', 'Themes/Classic Theme/correct.mp3']) {mkdirSync(path.dirname(path.join(pack, f)), {recursive: true}); writeFileSync(path.join(pack, f), mp3);}
  const quiz = createQuiz({plan: 'pro', hostKey, database: path.join(dir, 'quiz.sqlite'), mediaDir: dir, packDir: pack, soundsDir: path.join(dir, 'none')});
  await new Promise(r => quiz.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${quiz.server.address().port}`;
  const call = async (route, body = {}, key = '') => {const r = await fetch(`${base}/api/${route}`, {method: 'POST', headers: {Authorization: 'Bearer ' + key}, body: JSON.stringify(body)}); return {status: r.status, ...await r.json()};};
  try {
    const key = (await call('login', {key: hostKey})).key, host = (route, body) => call('host/' + route, body, key);
    const correct = async () => (await host('state')).sounds.slots.correct;
    const open = async (type, extra = {}) => {await host('close'); return host('open', {text: 'Q', type, seconds: 30, points: 1, ...extra});};
    // By type: keypad questions and typed answers get different themes by default, and any type can be changed.
    await host('settings', {soundTheme: '@type'});
    await open('choice', {options: ['A', 'B'], answer: 'A'}); assert.match(await correct(), /Arcade/);
    await open('text', {answer: 'x'}); assert.match(await correct(), /Classic/);
    await host('settings', {soundThemeByType: {text: ''}}); assert.equal(await correct(), '/pack/general/correct.mp3');
    assert.equal((await host('settings', {soundThemeByType: {text: 'Nope'}})).status, 400);
    // Random: every question gets one of the themes or the standard sounds, and keeps it.
    await host('settings', {soundTheme: '@random'});
    const seen = new Set();
    for (let i = 0; i < 12; i++) {await open('text', {answer: 'x'}); const first = await correct(); assert.equal(await correct(), first); seen.add(first.includes('Arcade') ? 'Arcade' : first.includes('Classic') ? 'Classic' : 'Standard');}
    assert.ok(seen.size >= 2, `themes vary between questions: ${[...seen]}`);
    // A moment chosen on the desk applies whichever theme is playing.
    await host('sounds', {slots: {wrong: '/pack/general/correct.mp3'}});
    await open('text', {answer: 'x'}); assert.equal((await host('state')).sounds.slots.wrong, '/pack/general/correct.mp3');
  } finally {await quiz.close(); rmSync(dir, {recursive: true, force: true});}
});

test('Halloween: the shipped theme and look are there to choose, and never turn up by chance', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'quiz-halloween-')), pack = path.join(dir, 'pack'), mp3 = Buffer.from([0xff, 0xfb, 0x90, 0x00, 1]);
  for (const f of ['general/correct.mp3', 'Themes/Arcade Theme/correct.mp3']) {mkdirSync(path.dirname(path.join(pack, f)), {recursive: true}); writeFileSync(path.join(pack, f), mp3);}
  const quiz = createQuiz({plan: 'pro', hostKey, database: path.join(dir, 'quiz.sqlite'), mediaDir: dir, packDir: pack, soundsDir: path.join(dir, 'none')});
  await new Promise(r => quiz.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${quiz.server.address().port}`;
  const call = async (route, body = {}, key = '') => {const r = await fetch(`${base}/api/${route}`, {method: 'POST', headers: {Authorization: 'Bearer ' + key}, body: JSON.stringify(body)}); return {status: r.status, ...await r.json()};};
  try {
    const key = (await call('login', {key: hostKey})).key, host = (route, body) => call('host/' + route, body, key);
    assert.deepEqual((await host('state')).soundThemes, ['Arcade Theme', 'Halloween']);
    await host('settings', {soundTheme: 'Halloween', look: 'halloween'});
    let s = await host('state');
    for (const slot of ['startRound', 'questionStart', 'timerMusic', 'timeUp', 'endRound', 'correct', 'wrong', 'reveal']) {
      assert.match(s.sounds.slots[slot], /^\/themes\/halloween\/sounds\//, slot);
      assert.equal((await fetch(base + s.sounds.slots[slot])).headers.get('content-type'), 'audio/mpeg');
    }
    assert.equal((await (await fetch(base + '/api/leaderboard')).json()).look, 'halloween');
    // Random and by-type choices leave seasonal ones out.
    assert.equal((await host('settings', {soundTheme: '@type', look: '@type'})).look, '@type');
    s = await host('state');
    assert.ok(!Object.values(s.soundThemesByType).includes('Halloween') && !Object.values(s.looksByType).includes('halloween'));
    await host('settings', {soundTheme: '@random', look: '@random'});
    for (let i = 0; i < 30; i++) {
      await host('close'); await host('open', {text: 'Q', type: 'text', seconds: 30, points: 1, answer: 'x'});
      const state = await host('state');
      assert.doesNotMatch(state.sounds.slots.correct, /Halloween/); assert.notEqual(state.look, 'halloween');
    }
  } finally {await quiz.close(); rmSync(dir, {recursive: true, force: true});}
});
