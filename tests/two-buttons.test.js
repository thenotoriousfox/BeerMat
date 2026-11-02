// Two-button Multiple choice (pair): true or false, before or after. The server sets its two choices (English values;
// phones and TVs label them in the quiz's language), takes the answer in any case, and never pads it to A–F.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createQuiz} from '../server/server.js';
import {validateQuestion, isCorrect} from '../server/model.js';

const base = {text: 'True or false: Q', type: 'choice', seconds: 15, points: 1};

test('the server sets the two choices; the answer is matched whatever its case; no 50/50', () => {
  const q = validateQuestion({...base, pair: 'trueFalse', options: ['Yes', 'No', 'Maybe'], answer: 'false', fiftyFifty: true, fiftyPoints: 1});
  assert.deepEqual([q.pair, q.options, q.answer, q.fiftyFifty], ['trueFalse', ['True', 'False'], 'False', false]);
  assert.deepEqual([isCorrect('False', q), isCorrect('True', q)], [true, false]);
  assert.deepEqual(validateQuestion({...base, pair: 'beforeAfter', answer: 'After'}).options, ['Before', 'After'], 'no choices needed');
  assert.throws(() => validateQuestion({...base, pair: 'trueFalse', answer: 'Perhaps'}), /match a choice/);
  assert.throws(() => validateQuestion({...base, pair: 'higherLower', answer: 'Higher'}), /true or false/);
});

test('played: never padded to six letters, and marked', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'quiz-pair-'));
  const quiz = createQuiz({plan: 'pro', hostKey: 'two-buttons-test-key', database: path.join(dir, 'q.sqlite'), mediaDir: dir, packDir: path.join(dir, 'x'), soundsDir: path.join(dir, 'x')});
  await new Promise(r => quiz.server.listen(0, '127.0.0.1', r));
  const call = async (route, body = {}, key = route.startsWith('host/') ? host : '') => {
    const r = await fetch(`http://127.0.0.1:${quiz.server.address().port}/api/${route}`, {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + key}, body: JSON.stringify(body)});
    return {status: r.status, ...await r.json()};
  };
  const host = (await call('login', {key: 'two-buttons-test-key'})).key;
  try {
    await call('host/settings', {waitingRoom: false, fixedSix: true});
    const team = await call('join', {name: 'Owls'});
    const {id} = await call('host/open', {...base, pair: 'trueFalse', answer: 'False'});
    const seen = (await call('state', {}, team.secret)).question;
    assert.deepEqual([seen.pair, seen.options, seen.fixedSix ?? false], ['trueFalse', ['True', 'False'], false], 'two buttons even with A–F on');
    await call('answer', {question: id, value: 'False'}, team.secret);
    await call('host/close', {expectedQuestion: id});
    assert.equal((await call('state', {}, team.secret)).answer.points, 1);
  } finally {await quiz.close(); rmSync(dir, {recursive: true, force: true});}
});
