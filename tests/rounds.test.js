import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {createQuiz} from '../server.js';

const hostKey = 'a-secure-rounds-test-key';
async function fixture(fn, options = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'quiz-rounds-')); let time = 5000000; let quiz, host;
  const start = async () => {quiz = createQuiz({hostKey, database: path.join(dir, 'quiz.sqlite'), mediaDir: dir, now: () => time, ...options}); await new Promise(r => quiz.server.listen(0, '127.0.0.1', r)); host = (await call('login', {key: hostKey})).key;};
  const url = () => `http://127.0.0.1:${quiz.server.address().port}`;
  const call = async (route, body = {}, key = route.startsWith('host/') ? host : '') => {
    const response = await fetch(url() + '/api/' + route, {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + key}, body: JSON.stringify(body)});
    return {status: response.status, ...await response.json()};
  };
  await start();
  const teams = async (...names) => Promise.all(names.map(name => call('join', {name})));
  const score = async (team) => (await call('host/state')).teams.find(t => t.id === team.id).score;
  try {await fn({call, url, teams, score, tick: ms => time += ms, restart: async () => {await quiz.close(); await start();}});} finally {await quiz.close(); rmSync(dir, {recursive: true, force: true});}
}
const base = {seconds: 30, points: 10};

test('keypad formats: letters, numbers, sequence and voting tallies', () => fixture(async ({call, teams, score}) => {
  const [a, b] = await teams('Alpha', 'Bravo');
  await call('host/open', {...base, text: 'Sonic is a what?', type: 'letter', answer: 'h', answerNote: 'Hedgehog'});
  let id = (await call('state', {}, a.secret)).question.id;
  assert.equal((await call('answer', {question: id, value: 'HH'}, a.secret)).status, 400);
  await call('answer', {question: id, value: 'h'}, a.secret); await call('answer', {question: id, value: 'G'}, b.secret);
  await call('host/close'); assert.equal(await score(a), 10); assert.equal(await score(b), 0);
  await call('host/reveal', {question: id});
  let s = await call('state', {}, b.secret); assert.equal(s.question.answerNote, 'Hedgehog'); assert.deepEqual(s.question.tally, {H: 1, G: 1}); assert.equal(s.question.correctCount, 1);

  await call('host/open', {...base, text: 'Baker\'s dozen?', type: 'number', answer: '13'});
  id = (await call('state', {}, a.secret)).question.id;
  assert.equal((await call('answer', {question: id, value: 'thirteen'}, a.secret)).status, 400);
  await call('answer', {question: id, value: '13.0'}, a.secret); await call('host/close'); assert.equal(await score(a), 20);

  await call('host/open', {...base, text: 'Order the oceans', type: 'sequence', items: ['Pacific', 'Atlantic', 'Indian']});
  s = await call('state', {}, a.secret); id = s.question.id;
  assert.equal(s.question.items.length, 3); assert.notDeepEqual(s.question.order, [0, 1, 2]);
  assert.equal((await call('answer', {question: id, value: [0, 1]}, a.secret)).status, 400);
  assert.equal((await call('draft', {question: id, value: [0]}, a.secret)).status, 200);
  await call('answer', {question: id, value: [0, 1, 2]}, a.secret); await call('answer', {question: id, value: [1, 0, 2]}, b.secret);
  await call('host/close'); assert.equal(await score(a), 30); assert.equal(await score(b), 0);

  await call('host/open', {...base, text: 'Best crisps?', type: 'vote', options: ['Salt', 'Vinegar']});
  id = (await call('state', {}, a.secret)).question.id;
  await call('answer', {question: id, value: 'Salt'}, a.secret); await call('answer', {question: id, value: 'Salt'}, b.secret);
  await call('host/close'); await call('host/reveal', {question: id});
  assert.deepEqual((await call('state', {}, a.secret)).question.tally, {Salt: 2}); assert.equal(await score(a), 30);
}));

test('nearest wins ranks by distance, breaks ties by time and scores on a sliding scale', () => fixture(async ({call, teams, score, tick}) => {
  const [a, b, c, d] = await teams('Alpha', 'Bravo', 'Charlie', 'Delta');
  await call('host/open', {...base, text: 'Days to Mars?', type: 'nearest', answer: '253', places: 2});
  const id = (await call('state', {}, a.secret)).question.id;
  await call('answer', {question: id, value: '250'}, a.secret); tick(10);
  await call('answer', {question: id, value: '256'}, b.secret); tick(10);
  await call('answer', {question: id, value: '300'}, c.secret);
  assert.equal(await score(a), 0, 'no points while answers are open');
  tick(31000); // expiry settles without the host closing
  assert.equal(await score(a), 10); assert.equal(await score(b), 5); assert.equal(await score(c), 0); assert.equal(await score(d), 0);
  assert.equal((await call('state', {}, a.secret)).answer.points, 10);
}));

test('speed bonus starts each team clock on delivery, capped by a grace period', () => fixture(async ({call, teams, tick}) => {
  const [early, late, sleepy] = await teams('Early', 'Late', 'Sleepy');
  await call('host/open', {...base, text: 'Capital of Wales?', type: 'text', answer: 'Cardiff', speedBonus: 30});
  const id = (await call('state', {}, early.secret)).question.id;
  tick(1500); await call('state', {}, late.secret);
  tick(8500); await call('state', {}, sleepy.secret);
  for (const t of [early, late, sleepy]) await call('answer', {question: id, value: 'Cardiff'}, t.secret);
  await call('host/close');
  const answers = (await call('host/review', {question: id})).answers, points = t => answers.find(a => a.team === t.id).points;
  // 10s into 30s: early keeps 20/30 of the bonus, late gets 1.5s back, sleepy only the 2s cap.
  assert.equal(points(early), 30); assert.equal(points(late), 31); assert.equal(points(sleepy), 32);
}));

test('classic buzzer: queue order, wrong answers pass on and lock out the next buzzer question', () => fixture(async ({call, teams, score}) => {
  const [a, b, c] = await teams('Alpha', 'Bravo', 'Charlie');
  await call('host/open', {...base, text: 'Who wrote The Green Mile?', type: 'buzzer', answer: 'Stephen King', penalty: 2});
  const id = (await call('state', {}, a.secret)).question.id;
  assert.equal((await call('answer', {question: id, value: 'x'}, a.secret)).status, 400);
  assert.equal((await call('buzz', {question: id}, b.secret)).position, 1);
  assert.equal((await call('buzz', {question: id}, a.secret)).position, 2);
  assert.equal((await call('buzz', {question: id}, a.secret)).status, 409);
  let s = await call('state', {}, a.secret); assert.equal(s.question.buzz.active.name, 'Bravo'); assert.equal(s.question.buzz.buzzed, 'queued');
  await call('host/buzz', {question: id, action: 'wrong'});
  s = await call('state', {}, a.secret); assert.equal(s.question.buzz.active.name, 'Alpha'); assert.equal(s.question.live, true);
  await call('host/buzz', {question: id, action: 'correct'});
  assert.equal((await call('state', {}, a.secret)).question.live, false);
  assert.equal(await score(a), 10); assert.equal(await score(b), -2); assert.equal(await score(c), 0);
  await call('host/open', {...base, text: 'Next', type: 'buzzer'});
  const next = (await call('state', {}, b.secret)).question;
  assert.equal(next.buzz.lockedOut, true);
  assert.equal((await call('buzz', {question: next.id}, b.secret)).status, 409);
  assert.equal((await call('buzz', {question: next.id}, c.secret)).status, 200);
}));

test('advanced buzzer: agree vote, pass penalty and agreement scoring', () => fixture(async ({call, teams, score}) => {
  const [a, b, c, d] = await teams('Alpha', 'Bravo', 'Charlie', 'Delta');
  await call('host/open', {...base, text: 'Tallest mammal?', type: 'buzzer', variation: 'advanced', penalty: 5, passPenalty: 3, agreePoints: 4, agreeSeconds: 10});
  const id = (await call('state', {}, a.secret)).question.id;
  await call('buzz', {question: id}, a.secret); await call('buzz', {question: id}, b.secret);
  assert.equal((await call('agree', {question: id}, c.secret)).status, 409, 'no vote before the answer is announced');
  await call('host/buzz', {question: id, action: 'pass'});
  assert.equal((await call('state', {}, c.secret)).question.buzz.active.name, 'Bravo');
  await call('host/buzz', {question: id, action: 'agree', announced: 'Giraffe'});
  let s = await call('state', {}, c.secret); assert.equal(s.question.buzz.agreeOpen, true); assert.equal(s.question.buzz.announced, 'Giraffe');
  assert.equal((await call('agree', {question: id}, b.secret)).status, 409, 'answering team cannot vote');
  assert.equal((await call('agree', {question: id}, c.secret)).status, 200);
  await call('host/buzz', {question: id, action: 'correct'});
  assert.equal(await score(a), -3); assert.equal(await score(b), 10); assert.equal(await score(c), 4); assert.equal(await score(d), 0);
}));

test('live updates stream to clients and host sessions survive a restart', () => fixture(async ({call, url, restart}) => {
  const team = (await call('join', {name: 'Streamer'}));
  const events = [];
  const request = http.get(url() + '/api/events?key=' + team.secret, res => {res.setEncoding('utf8'); res.on('data', chunk => events.push(chunk));});
  await new Promise(r => setTimeout(r, 100));
  assert.equal((await call('host/state')).teams[0].connected, true);
  const before = events.length;
  await call('host/open', {...base, text: 'Pushed?', type: 'text', answer: 'Yes'});
  await new Promise(r => setTimeout(r, 100));
  assert.ok(events.length > before, 'question open was pushed');
  assert.equal((await fetch(url() + '/api/events?key=wrong')).status, 401);
  request.destroy();
  await restart(); assert.equal((await call('host/state')).status, 200);
}));

test('allowed local addresses refuse other interfaces', () => fixture(async ({url}) => {
  assert.equal((await fetch(url() + '/')).status, 403);
}, {allowedAddresses: ['10.42.0.1']}));
