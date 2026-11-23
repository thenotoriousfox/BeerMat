// Number with a tolerance (answers within ± N, or ± N% of the answer, count) and Nearest wins without going over
// (answers above the answer score nothing).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createQuiz} from '../server/server.js';
import {validateQuestion, isCorrect, rankNearest} from '../server/model.js';

const base = {text: 'Q', seconds: 30, points: 3};

test('a number within the tolerance counts; a percentage is of the answer', () => {
  const q = validateQuestion({...base, type: 'number', answer: '1969', tolerance: 2});
  assert.deepEqual(['1967', '1971', '1969.5', '1966', '1972'].map(v => isCorrect(v, q)), [true, true, true, false, false]);
  const pct = validateQuestion({...base, type: 'number', answer: '8848', tolerance: 5, tolerancePercent: true});
  assert.deepEqual(['8406', '9290', '8400', '9300'].map(v => isCorrect(v, pct)), [true, true, false, false], '5% of 8,848 is 442.4');
  const exact = validateQuestion({...base, type: 'number', answer: '7', tolerance: 0, tolerancePercent: true});
  assert.deepEqual([exact.tolerance, exact.tolerancePercent, isCorrect('7', exact), isCorrect('8', exact)], [undefined, undefined, true, false], 'no tolerance: exact, nothing stored');
  for (const tolerance of [-1, '2', 1e10]) assert.throws(() => validateQuestion({...base, type: 'number', answer: '7', tolerance}), /Tolerance/);
});

test('closest without going over: answers above score nothing and rank last', () => {
  const q = validateQuestion({...base, type: 'nearest', answer: '100', places: 3, notOver: true});
  assert.equal(q.notOver, true);
  const ranked = rankNearest(q, [{team: 'over', value: '101', submitted: 1}, {team: 'far', value: '60', submitted: 2}, {team: 'near', value: '95', submitted: 3}, {team: 'exact', value: '100', submitted: 4}]);
  assert.deepEqual(ranked.map(r => [r.team, r.points]), [['exact', 3], ['near', 2], ['far', 1], ['over', 0]]);
  const usual = validateQuestion({...base, type: 'nearest', answer: '100', places: 3});
  assert.deepEqual(rankNearest(usual, [{team: 'over', value: '101', submitted: 1}, {team: 'far', value: '60', submitted: 2}]).map(r => [r.team, r.points]), [['over', 3], ['far', 2]], 'without it, over counts');
});

test('through the server: marked as teams answer, and the reveal shows the margin', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'quiz-margins-')); let time = 1000000;
  const quiz = createQuiz({plan: 'pro', hostKey: 'number-margins-test-key', database: path.join(dir, 'q.sqlite'), mediaDir: dir, packDir: path.join(dir, 'x'), soundsDir: path.join(dir, 'x'), now: () => time});
  await new Promise(r => quiz.server.listen(0, '127.0.0.1', r));
  const call = async (route, body = {}, key = route.startsWith('host/') ? host : '') => {
    const r = await fetch(`http://127.0.0.1:${quiz.server.address().port}/api/${route}`, {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + key}, body: JSON.stringify(body)});
    return {status: r.status, ...await r.json()};
  };
  const host = (await call('login', {key: 'number-margins-test-key'})).key;
  try {
    await call('host/settings', {waitingRoom: false});
    const a = await call('join', {name: 'Owls'}), b = await call('join', {name: 'Cats'});
    const {id} = await call('host/open', {...base, type: 'number', answer: '1969', tolerance: 2});
    await call('answer', {question: id, value: '1970'}, a.secret); await call('answer', {question: id, value: '1975'}, b.secret);
    await call('host/close', {expectedQuestion: id}); await call('host/reveal', {question: id}); time += 10000;
    const seen = await call('state', {}, a.secret);
    assert.deepEqual([seen.answer.points, (await call('state', {}, b.secret)).answer.points, seen.question.tolerance], [3, 0, 2]);
    const n = await call('host/open', {...base, type: 'nearest', answer: '100', notOver: true});
    await call('answer', {question: n.id, value: '101'}, a.secret); await call('answer', {question: n.id, value: '90'}, b.secret);
    assert.equal((await call('state', {}, a.secret)).question.notOver, true, 'phones know the rule');
    await call('host/close', {expectedQuestion: n.id});
    assert.deepEqual([(await call('state', {}, a.secret)).answer.points, (await call('state', {}, b.secret)).answer.points], [0, 3]);
  } finally {await quiz.close(); rmSync(dir, {recursive: true, force: true});}
});
