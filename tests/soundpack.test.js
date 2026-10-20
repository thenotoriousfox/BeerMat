import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import http from 'node:http';
import {promisify} from 'node:util';
import {mkdtempSync, mkdirSync, rmSync, writeFileSync, readdirSync, existsSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createQuiz} from '../server.js';

const hostKey = 'a-secure-quiz-test-key';
test('a sound pack built from a SpeedQuizzing folder becomes the default; desk choices override it', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'quiz-pack-')), sq = path.join(dir, 'SpeedQuizzing Documents'), pack = path.join(dir, 'soundpack');
  const mp3 = Buffer.from([0xff, 0xfb, 0x90, 0x00, 1, 2, 3]), put = (file, data = mp3) => {mkdirSync(path.dirname(path.join(sq, file)), {recursive: true}); writeFileSync(path.join(sq, file), data);};
  for (const name of ['correct', 'incorrect', 'airhorn', 'start_round', 'end_clunk', 'applause/1']) put(`Sounds/general/${name}.mp3`);
  put('Sounds/buzzers/Sample Music/Barnyard Jig.mp3'); put('Sounds/buzzers/Impersonations/Ahaaa.mp3'); put('Sounds/buzzers/Impersonations (Offensive)/Rude.mp3');
  put('Bingo/Customisable Bingo Calls.txt', JSON.stringify({1: 'Kelly’s eye, number 1', 4: 'Knock at the door, 4'}));
  const {stdout} = await promisify(execFile)(process.execPath, ['scripts/sound-pack.mjs', sq, '--out', pack]);
  assert.match(stdout, /6 of 12 sound effects, 2 buzzer sounds from Impersonations, Sample Music, bingo calls/);
  // The pack is SpeedQuizzing's Sounds folder, copied as it is.
  assert.deepEqual(readdirSync(path.join(pack, 'buzzers')).sort(), ['Impersonations', 'Impersonations (Offensive)', 'Sample Music']);
  assert.ok(existsSync(path.join(pack, 'general', 'end_clunk.mp3')) && existsSync(path.join(pack, 'general', 'applause', '1.mp3')) && existsSync(path.join(pack, 'Customisable Bingo Calls.txt')));

  // The shipped CC0 sounds fill in the moments the pack lacks; the pack wins where both have one.
  const shipped = path.join(dir, 'shipped'); mkdirSync(path.join(shipped, 'general'), {recursive: true}); mkdirSync(path.join(shipped, 'buzzers', 'Jingles'), {recursive: true});
  for (const f of ['general/correct.mp3', 'general/wheel.mp3', 'buzzers/Jingles/Sax.mp3']) writeFileSync(path.join(shipped, f), mp3);
  const quiz = createQuiz({hostKey, database: path.join(dir, 'quiz.sqlite'), mediaDir: dir, packDir: pack, soundsDir: shipped});
  await new Promise(r => quiz.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${quiz.server.address().port}`;
  const call = async (route, body = {}, key = '') => {const r = await fetch(`${base}/api/${route}`, {method: 'POST', headers: {Authorization: 'Bearer ' + key}, body: JSON.stringify(body)}); return {status: r.status, ...await r.json()};};
  try {
    const key = (await call('login', {key: hostKey})).key, board = async () => (await fetch(base + '/api/leaderboard')).json();
    const {sounds} = await board();
    assert.deepEqual(Object.keys(sounds.slots).sort(), ['applause', 'bingo', 'correct', 'startRound', 'timeUp', 'wheel', 'wrong']);
    assert.equal(sounds.slots.correct, '/pack/general/correct.mp3'); assert.equal(sounds.slots.wheel, '/sounds/general/wheel.mp3');
    assert.equal(sounds.slots.applause, '/pack/general/applause/1.mp3');
    assert.deepEqual(sounds.buzzers.map(b => b.name), ['Ahaaa', 'Barnyard Jig', 'Sax'], 'pack buzzers first, offensive pack skipped, then the shipped ones');
    const served = await fetch(base + sounds.buzzers[1].media);
    assert.equal(served.status, 200); assert.equal(served.headers.get('content-type'), 'audio/mpeg');
    // Raw paths (fetch would tidy away the ..), so the server itself must keep requests inside the pack.
    const raw = target => new Promise((resolve, reject) => http.get({host: '127.0.0.1', port: quiz.server.address().port, path: target}, r => {
      let body = ''; r.on('data', c => {body += c.toString('latin1');}); r.on('end', () => resolve({status: r.statusCode, type: r.headers['content-type'] || '', body}));}).on('error', reject));
    for (const bad of ['/pack/../quiz.sqlite', '/pack/%2e%2e/quiz.sqlite', '/pack/general/..%2f..%2fquiz.sqlite', '/sounds/..%2fquiz.sqlite', '/pack/Customisable%20Bingo%20Calls.txt']) {
      const r = await raw(bad);
      assert.ok(!r.body.startsWith('SQLite format') && !r.type.startsWith('audio') && (r.status === 404 || r.type.startsWith('text/html')), bad);
    }
    // Teams can pick a pack buzzer; the desk can change a moment and still keep the rest of the pack.
    const team = await call('join', {name: 'Fox'}); assert.equal((await call('team/sound', {sound: 10}, team.secret)).ok, true);
    await call('host/sounds', {slots: {wheel: sounds.slots.bingo, correct: null}}, key);
    const after = (await board()).sounds;
    assert.equal(after.slots.wheel, sounds.slots.bingo); assert.equal(after.slots.correct, undefined); assert.equal(after.slots.timeUp, sounds.slots.timeUp);
    assert.equal((await call('host/sounds', {buzzers: [...after.buzzers, {name: 'Extra', media: sounds.slots.bingo}]}, key)).buzzers.length, 4);
    // Pack bingo calls are the default; "use the built-in calls" switches them off.
    const {id} = await call('host/open', {text: 'Bingo', type: 'bingo', seconds: 600, points: 1, mode: 'line'}, key);
    let phrase; for (let n = 0; n < 90 && phrase === undefined; n++) {const {number} = await call('host/bingo', {question: id}, key); if (number === 4) phrase = (await board()).question.bingo.phrase;}
    assert.equal(phrase, 'Knock at the door, 4');
    assert.equal((await call('host/state', {}, key)).bingoCalls[0], 'Kelly’s eye, number 1');
    await call('host/bingo-calls', {calls: null}, key); assert.equal((await call('host/state', {}, key)).bingoCalls, null);
  } finally {await quiz.close(); rmSync(dir, {recursive: true, force: true});}
});

test('sound themes from the pack replace the moments they have; picking one resets desk choices but keeps buzzers', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'quiz-theme-')), pack = path.join(dir, 'pack'), mp3 = Buffer.from([0xff, 0xfb, 0x90, 0x00, 1]);
  for (const f of ['general/correct.mp3', 'general/drum_roll.mp3', 'Themes/Arcade Theme/correct.mp3', 'Themes/Arcade Theme/stopwatch_timer_end.mp3', 'buzzers/Pack/Honk.mp3']) {
    mkdirSync(path.dirname(path.join(pack, f)), {recursive: true}); writeFileSync(path.join(pack, f), mp3);
  }
  const quiz = createQuiz({hostKey, database: path.join(dir, 'quiz.sqlite'), mediaDir: dir, packDir: pack, soundsDir: path.join(dir, 'none')});
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
