// Pinpoint with several places to find: a tap for each, the question's points for each place found (a tap counts for
// one place at most); phones learn how many before the reveal, and every circle after it.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createQuiz} from '../server/server.js';
import {validateQuestion, isCorrect, basePoints as score, answerValue as normalizeAnswer} from '../server/model.js';

const places = [{x: 0.2, y: 0.2, r: 0.05}, {x: 0.5, y: 0.5, r: 0.05}, {x: 0.8, y: 0.3, r: 0.05}];
const base = {text: 'Tap Paris, Rome and Berlin.', type: 'pinpoint', seconds: 30, points: 2, media: '/media/map.png'};
const mediaDir = mkdtempSync(path.join(os.tmpdir(), 'quiz-places-media-')); writeFileSync(path.join(mediaDir, 'map.png'), Buffer.from('89504e470d0a1a0a', 'hex'));

test('places found score the points each; one tap finds one place; the first is also the target', () => {
  const q = validateQuestion({...base, targets: places}, mediaDir);
  assert.equal(q.targets.length, 3); assert.deepEqual(q.target, {...places[0], aspect: 1});
  const taps = list => JSON.stringify(list);
  assert.equal(score(taps([[0.2, 0.2], [0.5, 0.51], [0.8, 0.3]]), q), 6);
  assert.equal(score(taps([[0.2, 0.2], [0.21, 0.2], [0.9, 0.9]]), q), 2, 'two taps on one place find it once');
  assert.equal(isCorrect(taps([[0.8, 0.3], [0.2, 0.2], [0.5, 0.5]]), q), true, 'any order');
  assert.equal(isCorrect(taps([[0.8, 0.3], [0.2, 0.2]]), q), false);
  assert.throws(() => normalizeAnswer([[0.1, 0.1], [0.2, 0.2], [0.3, 0.3], [0.4, 0.4]], q, true), /Tap the picture/, 'no more taps than places');
  assert.throws(() => validateQuestion({...base, targets: [places[0]]}, mediaDir), /2–10/);
  assert.throws(() => validateQuestion({...base, targets: places, goWide: true, goWidePoints: 1}, mediaDir), /second guess/);
});

test('played: phones learn how many places, then every circle at the reveal', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'quiz-places-')); let time = 1000000;
  writeFileSync(path.join(dir, 'map.png'), Buffer.from('89504e470d0a1a0a', 'hex'));
  const quiz = createQuiz({plan: 'pro', hostKey: 'pinpoint-places-test-key', database: path.join(dir, 'q.sqlite'), mediaDir: dir, packDir: path.join(dir, 'x'), soundsDir: path.join(dir, 'x'), now: () => time});
  await new Promise(r => quiz.server.listen(0, '127.0.0.1', r));
  const call = async (route, body = {}, key = route.startsWith('host/') ? host : '') => {
    const r = await fetch(`http://127.0.0.1:${quiz.server.address().port}/api/${route}`, {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + key}, body: JSON.stringify(body)});
    return {status: r.status, ...await r.json()};
  };
  const host = (await call('login', {key: 'pinpoint-places-test-key'})).key;
  try {
    await call('host/settings', {waitingRoom: false});
    const team = await call('join', {name: 'Owls'});
    const {id} = await call('host/open', {...base, targets: places});
    const before = (await call('state', {}, team.secret)).question;
    assert.deepEqual([before.targetCount, before.targets, before.target], [3, undefined, undefined], 'how many, not where');
    assert.equal((await call('answer', {question: id, value: [[0.2, 0.2], [0.5, 0.5]]}, team.secret)).status, 200);
    await call('host/close', {expectedQuestion: id}); await call('host/reveal', {question: id}); time += 10000;
    const after = await call('state', {}, team.secret);
    assert.deepEqual([after.answer.points, after.question.targets.length], [4, 3]);
  } finally {await quiz.close(); rmSync(dir, {recursive: true, force: true});}
});
