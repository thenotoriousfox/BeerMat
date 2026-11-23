// Wager questions: each team stakes 0 to `wager` points with its answer; right wins the stake, wrong loses it.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createQuiz} from '../server/server.js';
import {validateQuestion} from '../server/model.js';

const base = {text: 'Capital of Wales?', type: 'text', answer: 'Cardiff', seconds: 30, points: 2};

test('a wager is the question’s most; only with a right answer set, and on its own', () => {
  assert.deepEqual([validateQuestion({...base, wager: 5}).wager, validateQuestion({...base, wager: 5}).points], [5, 5]);
  assert.equal(validateQuestion({...base, wager: 0}).wager, undefined, '0: no wager');
  for (const extra of [{evil: true}, {fastestFingers: true, speedBonus: 2}]) assert.throws(() => validateQuestion({...base, wager: 5, ...extra}), /whole score/);
  assert.throws(() => validateQuestion({...base, answer: '', wager: 5}), /correct answer/);
  assert.throws(() => validateQuestion({...base, wager: 101}), /1–100/);
});

test('teams stake with their answer: right wins it, wrong loses it, no stake refused', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'quiz-wager-'));
  const quiz = createQuiz({plan: 'pro', hostKey: 'wagers-test-key', database: path.join(dir, 'q.sqlite'), mediaDir: dir, packDir: path.join(dir, 'x'), soundsDir: path.join(dir, 'x')});
  await new Promise(r => quiz.server.listen(0, '127.0.0.1', r));
  const call = async (route, body = {}, key = route.startsWith('host/') ? host : '') => {
    const r = await fetch(`http://127.0.0.1:${quiz.server.address().port}/api/${route}`, {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + key}, body: JSON.stringify(body)});
    return {status: r.status, ...await r.json()};
  };
  const host = (await call('login', {key: 'wagers-test-key'})).key;
  try {
    await call('host/settings', {waitingRoom: false});
    const [owls, cats, foxes] = [await call('join', {name: 'Owls'}), await call('join', {name: 'Cats'}), await call('join', {name: 'Foxes'})];
    const {id} = await call('host/open', {...base, wager: 5});
    assert.equal((await call('state', {}, owls.secret)).question.wager, 5, 'phones know the most');
    assert.equal((await call('answer', {question: id, value: 'Cardiff'}, owls.secret)).status, 400, 'no stake');
    assert.equal((await call('answer', {question: id, value: 'Cardiff', wager: 6}, owls.secret)).status, 400, 'over the most');
    await call('answer', {question: id, value: 'Cardiff', wager: 4}, owls.secret);
    await call('answer', {question: id, value: 'Swansea', wager: 3}, cats.secret);
    await call('answer', {question: id, value: 'Newport', wager: 0}, foxes.secret);
    await call('host/close', {expectedQuestion: id});
    const points = async t => (await call('state', {}, t.secret)).answer;
    assert.deepEqual([await points(owls), await points(cats), await points(foxes)].map(a => [a.points, a.wager]), [[4, 4], [-3, 3], [0, 0]]);
    assert.deepEqual((await call('host/state')).answers.map(a => a.wager).sort(), [0, 3, 4], 'the desk sees each stake');
  } finally {await quiz.close(); rmSync(dir, {recursive: true, force: true});}
});
