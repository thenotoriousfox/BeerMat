// Matching pairs: teams match each left item to a right one (shown shuffled); every right pair scores the points.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createQuiz} from '../server/server.js';
import {validateQuestion, basePoints, isCorrect, answerValue} from '../server/model.js';

const base = {text: 'Match each capital to its country.', type: 'pairs', seconds: 45, points: 1,
  pairs: [['Canberra', 'Australia'], ['Ottawa', 'Canada'], ['Wellington', 'New Zealand']]};

test('a point for each right pair; every pair right is correct', () => {
  const q = validateQuestion(base), value = list => answerValue(list, q);
  assert.equal(basePoints(value(['Australia', 'New Zealand', 'Canada']), q), 1);
  assert.equal(isCorrect(value(['Australia', 'Canada', 'New Zealand']), q), true);
  assert.equal(basePoints(value(['Australia', '', '']), q), 1, 'unmatched ones score nothing');
  assert.throws(() => answerValue(['Australia', 'Canada'], q), /Match each/);
  assert.throws(() => answerValue(['Austria', 'Canada', 'New Zealand'], q), /Match each/);
  assert.throws(() => validateQuestion({...base, pairs: [['A', 'B']]}), /2–8 pairs/);
  assert.throws(() => validateQuestion({...base, pairs: [['A', 'X'], ['B', 'x']]}), /different/);
});

test('played: the right side shuffled the same for everyone, the pairing hidden until the reveal', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'quiz-pairs-')); let time = 1000000;
  const quiz = createQuiz({plan: 'pro', hostKey: 'matching-pairs-test-key', database: path.join(dir, 'q.sqlite'), mediaDir: dir, packDir: path.join(dir, 'x'), soundsDir: path.join(dir, 'x'), now: () => time});
  await new Promise(r => quiz.server.listen(0, '127.0.0.1', r));
  const call = async (route, body = {}, key = route.startsWith('host/') ? host : '') => {
    const r = await fetch(`http://127.0.0.1:${quiz.server.address().port}/api/${route}`, {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + key}, body: JSON.stringify(body)});
    return {status: r.status, ...await r.json()};
  };
  const host = (await call('login', {key: 'matching-pairs-test-key'})).key;
  try {
    await call('host/settings', {waitingRoom: false});
    const [a, b] = [await call('join', {name: 'Owls'}), await call('join', {name: 'Cats'})];
    const {id} = await call('host/open', base);
    const [qa, qb] = [(await call('state', {}, a.secret)).question, (await call('state', {}, b.secret)).question];
    assert.deepEqual(qa.left, ['Canberra', 'Ottawa', 'Wellington']);
    assert.deepEqual([...qa.right].sort(), ['Australia', 'Canada', 'New Zealand']); assert.deepEqual(qa.right, qb.right, 'the same order on every phone');
    assert.equal(qa.pairs, undefined);
    await call('answer', {question: id, value: ['Australia', 'Canada', 'New Zealand']}, a.secret);
    await call('host/close', {expectedQuestion: id}); await call('host/reveal', {question: id}); time += 10000;
    const after = await call('state', {}, a.secret);
    assert.deepEqual([after.answer.points, after.question.pairs.length], [3, 3]);
  } finally {await quiz.close(); rmSync(dir, {recursive: true, force: true});}
});
