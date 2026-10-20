import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createQuiz} from '../server.js';

const hostKey = 'a-secure-quiz-test-key';
const question = (fields = {}) => ({text: 'What is the capital of Wales?', type: 'text', seconds: 30, points: 2, answer: 'Cardiff', ...fields});
async function fixture(fn) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'quiz-hosting-')); let time = 1000000;
  const quiz = createQuiz({hostKey, database: path.join(dir, 'quiz.sqlite'), mediaDir: dir, now: () => time});
  await new Promise(r => quiz.server.listen(0, '127.0.0.1', r));
  const call = async (route, body = {}, key = route.startsWith('host/') ? host : '') => {
    const response = await fetch(`http://127.0.0.1:${quiz.server.address().port}/api/${route}`, {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + key}, body: JSON.stringify(body)});
    return {status: response.status, ...await response.json()};
  };
  const host = (await call('login', {key: hostKey})).key;
  const board = async () => (await fetch(`http://127.0.0.1:${quiz.server.address().port}/api/leaderboard`)).json();
  try {await fn({call, board, tick: ms => time += ms});} finally {await quiz.close(); rmSync(dir, {recursive: true, force: true});}
}
const score = (s, name) => s.teams.find(t => t.name === name).score;

test('Evil Mode: wrong answers lose the points, no answer loses nothing', () => fixture(async ({call}) => {
  const [right, wrong, silent] = [await call('join', {name: 'Right'}), await call('join', {name: 'Wrong'}), await call('join', {name: 'Silent'})];
  const {id} = await call('host/open', question({evil: true}));
  await call('answer', {question: id, value: 'Cardiff'}, right.secret);
  await call('answer', {question: id, value: 'Swansea'}, wrong.secret);
  await call('host/close');
  const s = await call('host/state');
  assert.deepEqual([score(s, 'Right'), score(s, 'Wrong'), score(s, 'Silent')], [2, -2, 0]);
  assert.equal((await call('state', {}, wrong.secret)).answer.points, -2);
  // Without a correct answer to mark against, Evil Mode is refused.
  assert.equal((await call('host/open', question({evil: true, answer: ''}))).status, 400);
  assert.equal((await call('host/open', question({type: 'vote', options: ['A', 'B'], evil: true}))).status, 400);
}));

test('fixed speed bonus goes only to the fastest correct answers', () => fixture(async ({call, tick}) => {
  const teams = [];
  for (const name of ['First', 'Second', 'Third', 'Wrong']) teams.push(await call('join', {name}));
  const {id} = await call('host/open', question({speedBonus: 5, bonusMode: 'fixed', bonusPlaces: 2}));
  for (const t of teams) await call('state', {}, t.secret);
  await call('answer', {question: id, value: 'Swansea'}, teams[3].secret); tick(1000);
  for (const t of teams.slice(0, 3)) {await call('answer', {question: id, value: 'Cardiff'}, t.secret); tick(1000);}
  // Scores are only final once answers stop.
  assert.equal((await call('state', {}, teams[0].secret)).answer.points, undefined);
  await call('host/close');
  const s = await call('host/state');
  assert.deepEqual(['First', 'Second', 'Third', 'Wrong'].map(n => score(s, n)), [7, 7, 2, 0]);
  assert.equal((await call('host/open', question({speedBonus: 5, bonusMode: 'fixed', answer: ''}))).status, 400);
  assert.equal((await call('host/open', question({bonusMode: 'sometimes'}))).status, 400);
}));

test('waiting room holds new teams until let in; max teams caps joining', () => fixture(async ({call, board}) => {
  const early = await call('join', {name: 'Early'});
  await call('host/settings', {waitingRoom: true, maxTeams: 3});
  const late = await call('join', {name: 'Late'}), later = await call('join', {name: 'Later'});
  assert.equal(late.waiting, true);
  assert.equal((await call('join', {name: 'Too many'})).status, 409);
  let s = await call('state', {}, late.secret);
  assert.equal(s.team.waiting, true); assert.equal(s.question, null);
  assert.deepEqual((await board()).teams.map(t => t.name), ['Early']);
  const {id} = await call('host/open', question());
  assert.equal((await call('answer', {question: id, value: 'Cardiff'}, late.secret)).status, 403);
  assert.equal((await call('state', {}, early.secret)).question.id, id);
  const lateId = (await call('host/state')).teams.find(t => t.name === 'Late').id;
  await call('host/team', {id: lateId, action: 'admit'});
  s = await call('state', {}, late.secret);
  assert.equal(s.team.waiting, false); assert.equal(s.question.id, id);
  assert.equal((await call('answer', {question: id, value: 'Cardiff'}, late.secret)).ok, true);
  await call('host/admit');
  assert.equal((await call('state', {}, later.secret)).team.waiting, false);
  // Turning a team away frees its place.
  await call('host/team', {id: lateId, action: 'disable'});
  assert.equal((await call('join', {name: 'Replacement'})).waiting, true);
  assert.equal((await call('host/settings', {maxTeams: 251})).status, 400);
}));

test('positions-only board hides scores everywhere but the desk', () => fixture(async ({call, board}) => {
  const team = await call('join', {name: 'Fox'}), other = await call('join', {name: 'Owl'});
  const {id} = await call('host/open', question());
  await call('answer', {question: id, value: 'Cardiff'}, team.secret); await call('host/close');
  await call('host/settings', {showScores: false});
  const b = await board();
  assert.deepEqual(b.teams.map(t => [t.name, t.rank, t.score]), [['Fox', 1, null], ['Owl', 2, null]]);
  assert.equal((await call('state', {}, other.secret)).teams[0].score, null);
  assert.equal(score(await call('host/state'), 'Fox'), 2);
  await call('host/settings', {showScores: true});
  assert.equal((await board()).teams[0].score, 2);
}));

test('TV countdown: start, pause, resume, stop', () => fixture(async ({call, board, tick}) => {
  assert.equal((await call('host/timer', {action: 'pause'})).status, 409);
  const started = await call('host/timer', {action: 'start', seconds: 300, label: 'Hand in sheets'});
  assert.equal(started.endsAt - (await board()).serverTime, 300000);
  tick(60000);
  await call('host/timer', {action: 'pause'});
  let timer = (await board()).timer; assert.equal(timer.endsAt, null); assert.equal(timer.remaining, 240000); assert.equal(timer.label, 'Hand in sheets');
  tick(60000);
  await call('host/timer', {action: 'resume'});
  timer = (await board()).timer; assert.equal(timer.endsAt - (await board()).serverTime, 240000);
  await call('host/timer', {action: 'stop'});
  assert.equal((await board()).timer, null);
  assert.equal((await call('host/timer', {action: 'start', seconds: 0})).status, 400);
}));
