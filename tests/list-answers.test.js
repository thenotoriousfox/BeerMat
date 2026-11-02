// List answers: up to `slots` boxes; each box matching an accepted answer (or one of its alternatives) not already
// used scores the points, in any order.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createQuiz} from '../server/server.js';
import {validateQuestion, basePoints, isCorrect, answerValue} from '../server/model.js';

const base = {text: 'Name the countries of the UK.', type: 'list', seconds: 60, points: 1, slots: 4,
  accepted: ['England', 'Scotland', 'Wales | Cymru', 'Northern Ireland | NI']};

test('a point for each accepted answer named, alternatives too, each once', () => {
  const q = validateQuestion(base), value = list => answerValue(list, q);
  assert.equal(basePoints(value(['england', ' Cymru ', 'NI', 'Ireland']), q), 3);
  assert.equal(basePoints(value(['Wales', 'Cymru', 'wales', '']), q), 1, 'one answer counts once, whichever name');
  assert.deepEqual([isCorrect(value(['NI', 'Scotland', 'Wales', 'England']), q), isCorrect(value(['NI', 'Scotland', 'Wales']), q)], [true, false]);
  assert.throws(() => answerValue(['a', 'b', 'c', 'd', 'e'], q), /One answer per box/);
  assert.equal(validateQuestion({...base, slots: undefined}).slots, 4, 'default: every answer, up to 10');
  assert.throws(() => validateQuestion({...base, slots: 5}), /1–4/);
  assert.throws(() => validateQuestion({...base, accepted: ['one']}), /2–50/);
});

test('played: the accepted list stays hidden until the reveal', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'quiz-list-')); let time = 1000000;
  const quiz = createQuiz({plan: 'pro', hostKey: 'list-answers-test-key', database: path.join(dir, 'q.sqlite'), mediaDir: dir, packDir: path.join(dir, 'x'), soundsDir: path.join(dir, 'x'), now: () => time});
  await new Promise(r => quiz.server.listen(0, '127.0.0.1', r));
  const call = async (route, body = {}, key = route.startsWith('host/') ? host : '') => {
    const r = await fetch(`http://127.0.0.1:${quiz.server.address().port}/api/${route}`, {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + key}, body: JSON.stringify(body)});
    return {status: r.status, ...await r.json()};
  };
  const host = (await call('login', {key: 'list-answers-test-key'})).key;
  try {
    await call('host/settings', {waitingRoom: false});
    const team = await call('join', {name: 'Owls'});
    const {id} = await call('host/open', base);
    const before = (await call('state', {}, team.secret)).question;
    assert.deepEqual([before.slots, before.accepted], [4, undefined]);
    await call('answer', {question: id, value: ['Scotland', 'England', '', '']}, team.secret);
    await call('host/close', {expectedQuestion: id}); await call('host/reveal', {question: id}); time += 10000;
    const after = await call('state', {}, team.secret);
    assert.deepEqual([after.answer.points, after.question.accepted.length], [2, 4]);
  } finally {await quiz.close(); rmSync(dir, {recursive: true, force: true});}
});
