// Sort into groups: each item belongs to one of 2–5 groups; every item put in its own group scores the points.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createQuiz} from '../server/server.js';
import {validateQuestion, basePoints, isCorrect, answerValue} from '../server/model.js';

const base = {text: 'Fruit or vegetable?', type: 'sort', seconds: 45, points: 1,
  sorting: [['Tomato', 'Fruit'], ['Carrot', 'Vegetable'], ['Cucumber', 'Fruit'], ['Potato', 'Vegetable']]};

test('groups come from the items; a point for each item in its group', () => {
  const q = validateQuestion(base), value = list => answerValue(list, q);
  assert.deepEqual(q.categories, ['Fruit', 'Vegetable']);
  assert.equal(basePoints(value(['Fruit', 'Vegetable', 'Vegetable', '']), q), 2);
  assert.equal(isCorrect(value(['Fruit', 'Vegetable', 'Fruit', 'Vegetable']), q), true);
  assert.throws(() => answerValue(['Fruit', 'Nut', 'Fruit', 'Fruit'], q), /Sort each/);
  assert.throws(() => validateQuestion({...base, sorting: [['A', 'X'], ['B', 'X']]}), /2–5 groups/);
  assert.throws(() => validateQuestion({...base, sorting: [['A', 'X'], ['a', 'Y']]}), /different/);
});

test('played: items and groups shown, which goes where hidden until the reveal', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'quiz-sort-')); let time = 1000000;
  const quiz = createQuiz({plan: 'pro', hostKey: 'sort-groups-test-key', database: path.join(dir, 'q.sqlite'), mediaDir: dir, packDir: path.join(dir, 'x'), soundsDir: path.join(dir, 'x'), now: () => time});
  await new Promise(r => quiz.server.listen(0, '127.0.0.1', r));
  const call = async (route, body = {}, key = route.startsWith('host/') ? host : '') => {
    const r = await fetch(`http://127.0.0.1:${quiz.server.address().port}/api/${route}`, {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + key}, body: JSON.stringify(body)});
    return {status: r.status, ...await r.json()};
  };
  const host = (await call('login', {key: 'sort-groups-test-key'})).key;
  try {
    await call('host/settings', {waitingRoom: false});
    const team = await call('join', {name: 'Owls'});
    const {id} = await call('host/open', base);
    const before = (await call('state', {}, team.secret)).question;
    assert.deepEqual([before.sortItems, before.categories, before.sorting], [['Tomato', 'Carrot', 'Cucumber', 'Potato'], ['Fruit', 'Vegetable'], undefined]);
    await call('answer', {question: id, value: ['Fruit', 'Vegetable', 'Fruit', 'Fruit']}, team.secret);
    await call('host/close', {expectedQuestion: id}); await call('host/reveal', {question: id}); time += 10000;
    const after = await call('state', {}, team.secret);
    assert.deepEqual([after.answer.points, after.question.sorting.length], [3, 4]);
  } finally {await quiz.close(); rmSync(dir, {recursive: true, force: true});}
});
