// Progressive clues: one more clue every clueSeconds (phones only get those showing); a right answer on the first clue
// scores the points, each later clue a share less, never below 1.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createQuiz} from '../server/server.js';
import {validateQuestion, cluePoints} from '../server/model.js';

const base = {text: 'Who am I?', type: 'clues', seconds: 60, points: 5, clueSeconds: 10, answer: 'Isaac Newton', aliases: ['Newton'],
  clues: ['Born on Christmas Day, 1642.', 'Master of the Royal Mint.', 'Wrote the Principia.', 'An apple fell near me.', 'Gravity.']};

test('checks: 2–8 clues, an answer, and time for every clue; points fall with each clue', () => {
  const q = validateQuestion(base);
  assert.deepEqual([1, 2, 3, 4, 5].map(n => cluePoints(q, n)), [5, 4, 3, 2, 1]);
  assert.deepEqual([1, 2, 3].map(n => cluePoints({...q, points: 2, clues: ['a', 'b', 'c']}, n)), [2, 1, 1], 'never below 1');
  assert.throws(() => validateQuestion({...base, clues: ['one']}), /2–8 clues/);
  assert.throws(() => validateQuestion({...base, answer: ''}), /answer/);
  assert.throws(() => validateQuestion({...base, seconds: 30}), /at least 45 seconds/);
});

test('played: phones see only the clues showing; an earlier answer scores more', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'quiz-clues-')); let time = 1000000;
  const quiz = createQuiz({plan: 'pro', hostKey: 'progressive-clues-test-key', database: path.join(dir, 'q.sqlite'), mediaDir: dir, packDir: path.join(dir, 'x'), soundsDir: path.join(dir, 'x'), now: () => time});
  await new Promise(r => quiz.server.listen(0, '127.0.0.1', r));
  const call = async (route, body = {}, key = route.startsWith('host/') ? host : '') => {
    const r = await fetch(`http://127.0.0.1:${quiz.server.address().port}/api/${route}`, {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + key}, body: JSON.stringify(body)});
    return {status: r.status, ...await r.json()};
  };
  const host = (await call('login', {key: 'progressive-clues-test-key'})).key;
  try {
    await call('host/settings', {waitingRoom: false});
    const [early, late, wrong] = [await call('join', {name: 'Early'}), await call('join', {name: 'Late'}), await call('join', {name: 'Wrong'})];
    const {id} = await call('host/open', base);
    let seen = (await call('state', {}, early.secret)).question;
    assert.deepEqual([seen.clues, seen.clueCount, seen.cluesShown, seen.cluePoints], [['Born on Christmas Day, 1642.'], 5, 1, 5], 'the first clue only');
    assert.equal((await call('host/state')).question.clues.length, 5, 'the desk sees them all');
    await call('answer', {question: id, value: 'newton'}, early.secret);
    time += 25000;
    seen = (await call('state', {}, late.secret)).question;
    assert.deepEqual([seen.clues.length, seen.cluePoints], [3, 3], 'two more after 20 seconds');
    await call('answer', {question: id, value: 'Isaac Newton'}, late.secret);
    await call('answer', {question: id, value: 'Einstein'}, wrong.secret);
    await call('host/close', {expectedQuestion: id});
    const points = async t => (await call('state', {}, t.secret)).answer.points;
    assert.deepEqual([await points(early), await points(late), await points(wrong)], [5, 3, 0]);
    assert.equal((await call('state', {}, wrong.secret)).question.clues.length, 5, 'every clue once answers close');
  } finally {await quiz.close(); rmSync(dir, {recursive: true, force: true});}
});
