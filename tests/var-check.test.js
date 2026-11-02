// VAR Check: after a reveal a team appeals its marking (within the quiz's limit: one a round by default, one a night,
// no limit, or off); the quizmaster rules overturned (the points) or decision stands, and the TV shows the decision.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createQuiz} from '../server/server.js';

const hostKey = 'a-secure-var-check-test-key';
async function fixture(fn) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'quiz-var-')); let time = 1000000;
  const quiz = createQuiz({plan: 'pro', hostKey, database: path.join(dir, 'quiz.sqlite'), mediaDir: dir, packDir: path.join(dir, 'x'), soundsDir: path.join(dir, 'x'), now: () => time});
  await new Promise(r => quiz.server.listen(0, '127.0.0.1', r));
  const call = async (route, body = {}, key = route.startsWith('host/') ? host : '') => {
    const response = await fetch(`http://127.0.0.1:${quiz.server.address().port}/api/${route}`, {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + key}, body: JSON.stringify(body)});
    return {status: response.status, ...await response.json()};
  };
  const host = (await call('login', {key: hostKey})).key; await call('host/settings', {waitingRoom: false});
  const tick = ms => {time += ms;};
  // A question in a round, answered by the given teams, closed and revealed (after its drum roll).
  const play = async (round, answers) => {
    const {id} = await call('host/open', {text: 'Capital of Wales?', type: 'text', answer: 'Cardiff', seconds: 30, points: 2, round});
    for (const [team, value] of answers) await call('answer', {question: id, value}, team.secret);
    await call('host/close', {expectedQuestion: id}); await call('host/reveal', {question: id}); tick(10000);
    return id;
  };
  try {await fn({call, play, tick});} finally {await quiz.close(); rmSync(dir, {recursive: true, force: true});}
}

test('a team appeals after the reveal; overturned gives the points and the TV shows the decision', () => fixture(async ({call, play, tick}) => {
  const owls = await call('join', {name: 'Owls'}), cats = await call('join', {name: 'Cats'});
  const id = await play('Round 1', [[owls, 'Cardif'], [cats, 'Swansea']]);
  let mine = (await call('state', {}, owls.secret)).myVar;
  assert.deepEqual([mine.canAsk, mine.left, mine.status], [true, 1, null]);
  assert.equal((await call('state', {}, owls.secret)).answer.points, 0);
  assert.deepEqual(await call('team/var', {question: id}, owls.secret), {status: 200, ok: true});
  assert.equal((await call('team/var', {question: id}, owls.secret)).status, 409, 'once per question');
  const [check] = (await call('host/state')).varChecks;
  assert.deepEqual([check.name, check.answer, check.points, check.full], ['Owls', 'Cardif', 0, 2]);
  assert.equal((await call('state')).varCheck ?? null, null, 'nothing on the TV until it is ruled');
  await call('host/var', {id: check.id, decision: 'overturned'});
  const tv = (await call('state', {}, cats.secret)).varCheck;
  assert.deepEqual([tv.team, tv.status, tv.points], ['Owls', 'overturned', 2]);
  mine = (await call('state', {}, owls.secret)).myVar;
  assert.deepEqual([mine.status, mine.points, mine.canAsk, mine.left], ['overturned', 2, false, 0]);
  assert.equal((await call('state', {}, owls.secret)).answer.points, 2, 'the points are given');
  assert.equal((await call('host/state')).teams.find(t => t.name === 'Owls').score, 2);
  assert.deepEqual((await call('host/state')).varChecks, []);
  assert.equal((await call('host/var', {id: check.id, decision: 'stands'})).status, 404, 'ruled once');
  tick(10000);
  assert.equal((await call('state', {}, cats.secret)).varCheck ?? null, null, 'the TV moment passes');
}));

test('limits: one a round by default, one a night, no limit, or off; only for an answer sent and revealed', () => fixture(async ({call, play}) => {
  const owls = await call('join', {name: 'Owls'}), cats = await call('join', {name: 'Cats'});
  // Not before the reveal, not without an answer.
  const {id: open} = await call('host/open', {text: 'Q', type: 'text', answer: 'A', seconds: 30, points: 1, round: 'Round 1'});
  await call('answer', {question: open, value: 'B'}, owls.secret);
  assert.equal((await call('team/var', {question: open}, owls.secret)).status, 409, 'not while it is open');
  await call('host/close', {expectedQuestion: open});
  assert.equal((await call('team/var', {question: open}, owls.secret)).status, 409, 'not before the reveal');
  const q1 = await play('Round 1', [[owls, 'B']]);
  assert.equal((await call('team/var', {question: q1}, cats.secret)).status, 409, 'Cats sent nothing');
  assert.equal((await call('team/var', {question: q1}, owls.secret)).status, 200);
  const q2 = await play('Round 1', [[owls, 'B']]);
  assert.equal((await call('state', {}, owls.secret)).myVar.left, 0);
  assert.equal((await call('team/var', {question: q2}, owls.secret)).status, 409, 'one a round');
  const q3 = await play('Round 2', [[owls, 'B']]);
  assert.equal((await call('team/var', {question: q3}, owls.secret)).status, 200, 'a new round, a new one');
  await call('host/settings', {varCheck: 'night'});
  const q4 = await play('Round 3', [[owls, 'B'], [cats, 'B']]);
  assert.equal((await call('team/var', {question: q4}, owls.secret)).status, 409, 'one a night: used');
  assert.equal((await call('team/var', {question: q4}, cats.secret)).status, 200);
  await call('host/settings', {varCheck: 'any'});
  const q5 = await play('Round 3', [[owls, 'B']]);
  assert.equal((await call('state', {}, owls.secret)).myVar.left, null);
  assert.equal((await call('team/var', {question: q5}, owls.secret)).status, 200, 'no limit');
  await call('host/settings', {varCheck: 'off'});
  const q6 = await play('Round 3', [[owls, 'B']]);
  assert.equal((await call('state', {}, owls.secret)).myVar, null);
  assert.equal((await call('team/var', {question: q6}, owls.secret)).status, 403);
  assert.equal((await call('host/settings', {varCheck: 'sometimes'})).status, 400);
  // Decision stands: no points change, and the TV says so.
  const pending = (await call('host/state')).varChecks;
  assert.equal(pending.length, 4);
  await call('host/var', {id: pending[0].id, decision: 'stands'});
  assert.deepEqual([(await call('state', {}, cats.secret)).varCheck.status, (await call('state', {}, owls.secret)).answer.points], ['stands', 0]);
  assert.equal((await call('host/var', {id: pending[1].id, decision: 'overturned', points: 3})).status, 200, 'other points can be given');
  // The next quiz clears teams and questions, VAR Checks with them (they refer to both).
  assert.equal((await call('host/new-event', {questions: 'keep'})).status, 200);
  assert.deepEqual([(await call('host/state')).teams, (await call('host/state')).varChecks], [[], []]);
}));
