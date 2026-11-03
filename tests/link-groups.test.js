// Link groups: teams sort the items (shown shuffled together) into groups and name each link; a group put together
// exactly scores the points, its link named scores linkPoints.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createQuiz} from '../server/server.js';
import {validateQuestion, basePoints, isCorrect, answerValue} from '../server/model.js';

const base = {text: 'Find the groups.', type: 'links', seconds: 90, points: 2, linkPoints: 1,
  linkGroups: [{link: 'Planets', items: ['Mercury', 'Mars', 'Venus']}, {link: 'Chess pieces | Chessmen', items: ['Bishop', 'Knight', 'Rook']}]};
const place = (groups, links) => ({items: Object.fromEntries(groups.flatMap((g, n) => g.map(i => [i, String(n + 1)]))), links});

test('a group found scores the points, its link named the link points; groups in any order', () => {
  const q = validateQuestion(base), value = v => answerValue(v, q);
  assert.equal(basePoints(value(place([['Bishop', 'Knight', 'Rook'], ['Mercury', 'Mars', 'Venus']], ['chessmen', 'Planets'])), q), 6);
  assert.equal(isCorrect(value(place([['Bishop', 'Knight', 'Rook'], ['Mercury', 'Mars', 'Venus']], ['chessmen', 'Planets'])), q), true);
  assert.equal(basePoints(value(place([['Bishop', 'Knight', 'Rook'], ['Mercury', 'Mars', 'Venus']], ['Pieces', ''])), q), 4, 'groups without links');
  assert.equal(basePoints(value(place([['Bishop', 'Knight', 'Mars'], ['Mercury', 'Rook', 'Venus']], ['Chess pieces', 'Planets'])), q), 0, 'a group must be exact');
  assert.equal(basePoints(value(place([['Mercury', 'Mars', 'Venus', 'Bishop', 'Knight', 'Rook']], ['Planets'])), q), 0, 'one big pile finds nothing');
  assert.throws(() => answerValue({items: {Pluto: '1'}, links: []}, q), /groups/);
  assert.throws(() => validateQuestion({...base, linkGroups: [base.linkGroups[0]]}), /2–4 groups/);
  assert.throws(() => validateQuestion({...base, linkGroups: [base.linkGroups[0], {link: 'Again', items: ['Mars', 'Earth']}]}), /different/);
  assert.equal(validateQuestion({...base, linkPoints: undefined}).linkPoints, 2, 'link points default to the points');
});

test('played: the items shuffled the same on every phone; the groups hidden until the reveal', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'quiz-links-')); let time = 1000000;
  const quiz = createQuiz({plan: 'pro', hostKey: 'link-groups-test-key', database: path.join(dir, 'q.sqlite'), mediaDir: dir, packDir: path.join(dir, 'x'), soundsDir: path.join(dir, 'x'), now: () => time});
  await new Promise(r => quiz.server.listen(0, '127.0.0.1', r));
  const call = async (route, body = {}, key = route.startsWith('host/') ? host : '') => {
    const r = await fetch(`http://127.0.0.1:${quiz.server.address().port}/api/${route}`, {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + key}, body: JSON.stringify(body)});
    return {status: r.status, ...await r.json()};
  };
  const host = (await call('login', {key: 'link-groups-test-key'})).key;
  try {
    await call('host/settings', {waitingRoom: false});
    const team = await call('join', {name: 'Owls'});
    const {id} = await call('host/open', base);
    const before = (await call('state', {}, team.secret)).question;
    assert.deepEqual([[...before.linkItems].sort(), before.groupCount, before.linkGroups], [['Bishop', 'Knight', 'Mars', 'Mercury', 'Rook', 'Venus'], 2, undefined]);
    await call('answer', {question: id, value: place([['Mercury', 'Mars', 'Venus'], ['Bishop', 'Knight', 'Rook']], ['planets', 'board games'])}, team.secret);
    await call('host/close', {expectedQuestion: id}); await call('host/reveal', {question: id}); time += 10000;
    const after = await call('state', {}, team.secret);
    assert.deepEqual([after.answer.points, after.question.linkGroups.length], [5, 2]);
  } finally {await quiz.close(); rmSync(dir, {recursive: true, force: true});}
});
