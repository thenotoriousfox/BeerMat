// Survey: a team's answer scores the points of the survey answer it matches (alternatives too); the list is ranked.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createQuiz} from '../server/server.js';
import {validateQuestion, basePoints, isCorrect} from '../server/model.js';

const base = {text: 'Name something you find in a kitchen.', type: 'survey', seconds: 30,
  survey: [['Toaster', 1], ['Kettle', 4], ['Fridge | Refrigerator', 3]]};

test('the matching answer’s points; ranked; points are the top answer’s', () => {
  const q = validateQuestion(base);
  assert.deepEqual([q.survey.map(s => s[0]), q.points], [['Kettle', 'Fridge | Refrigerator', 'Toaster'], 4]);
  assert.deepEqual(['kettle', 'refrigerator', 'Toaster', 'Spoon'].map(v => basePoints(v, q)), [4, 3, 1, 0]);
  assert.deepEqual([isCorrect('Fridge', q), isCorrect('Spoon', q)], [true, false]);
  assert.throws(() => validateQuestion({...base, survey: [['A', 2]]}), /2–12/);
  assert.throws(() => validateQuestion({...base, survey: [['A', 0], ['B', 0]]}), /top survey answer/);
});

test('played: the survey hidden until the reveal', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'quiz-survey-')); let time = 1000000;
  const quiz = createQuiz({plan: 'pro', hostKey: 'survey-test-key', database: path.join(dir, 'q.sqlite'), mediaDir: dir, packDir: path.join(dir, 'x'), soundsDir: path.join(dir, 'x'), now: () => time});
  await new Promise(r => quiz.server.listen(0, '127.0.0.1', r));
  const call = async (route, body = {}, key = route.startsWith('host/') ? host : '') => {
    const r = await fetch(`http://127.0.0.1:${quiz.server.address().port}/api/${route}`, {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + key}, body: JSON.stringify(body)});
    return {status: r.status, ...await r.json()};
  };
  const host = (await call('login', {key: 'survey-test-key'})).key;
  try {
    await call('host/settings', {waitingRoom: false});
    const team = await call('join', {name: 'Owls'});
    const {id} = await call('host/open', base);
    assert.equal((await call('state', {}, team.secret)).question.survey, undefined);
    await call('answer', {question: id, value: 'Fridge'}, team.secret);
    await call('host/close', {expectedQuestion: id}); await call('host/reveal', {question: id}); time += 10000;
    const after = await call('state', {}, team.secret);
    assert.deepEqual([after.answer.points, after.question.survey[0][0]], [3, 'Kettle']);
  } finally {await quiz.close(); rmSync(dir, {recursive: true, force: true});}
});
