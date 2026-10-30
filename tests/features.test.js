import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createQuiz} from '../server/server.js';

const hostKey = 'a-secure-features-test-key';
async function fixture(fn, options = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'quiz-features-')); let time = 5000000; const sent = [];
  // The online service, as far as the quiz laptop is concerned: it records what it's sent.
  const fetchImpl = async (url, init) => {sent.push({url, body: JSON.parse(init.body)}); return {ok: true, status: 201, json: async () => ({})};};
  const quiz = createQuiz({plan: 'pro', hostKey, database: path.join(dir, 'quiz.sqlite'), mediaDir: dir, packDir: path.join(dir, 'no-pack'), soundsDir: path.join(dir, 'no-pack'), now: () => time, fetchImpl, ...options});
  await new Promise(resolve => quiz.server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${quiz.server.address().port}`;
  const {key: host} = await (await fetch(url + '/api/login', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({key: hostKey})})).json();
  const call = async (route, body = {}, key = route.startsWith('host/') ? host : '', headers = {}) => {
    const response = await fetch(url + '/api/' + route, {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + key, ...headers}, body: JSON.stringify(body)});
    return {status: response.status, ...await response.json()};
  };
  const tv = async () => (await fetch(url + '/api/leaderboard')).json();
  await call('host/settings', {waitingRoom: false});
  const teams = (...names) => Promise.all(names.map(name => call('join', {name})));
  const score = async team => (await call('host/state')).teams.find(t => t.id === team.id).score;
  try {await fn({call, tv, teams, score, dir, sent, tick: ms => time += ms});} finally {await quiz.close(); rmSync(dir, {recursive: true, force: true});}
}
const base = {seconds: 30, points: 10};
const picture = dir => {writeFileSync(path.join(dir, 'pic.png'), 'x'); return '/media/pic.png';};

test('Send Question: phones see nothing until the quizmaster sends it, and the clock starts then', () => fixture(async ({call, tv, teams, tick}) => {
  const [a] = await teams('Alpha');
  await call('host/settings', {sendQuestion: true});
  await call('host/open', {...base, text: 'Capital of France?', type: 'choice', options: ['Paris', 'Rome'], answer: 'Paris', fastestFingers: true, speedBonus: 10});
  let s = await call('state', {}, a.secret);
  assert.equal(s.question.held, true); assert.equal(s.question.text, ''); assert.deepEqual(s.question.options, []); assert.equal(s.question.open, false);
  assert.equal((await tv()).question.text, 'Capital of France?', 'the TV shows it as it is read out');
  assert.equal((await call('answer', {question: s.question.id, value: 'Paris'}, a.secret)).status, 409);
  tick(20000);
  assert.equal((await call('host/send')).status, 200);
  s = await call('state', {}, a.secret);
  assert.equal(s.question.held, undefined); assert.equal(s.question.text, 'Capital of France?'); assert.equal(s.question.remaining, 30000, 'the whole time, from the send');
  await call('answer', {question: s.question.id, value: 'Paris'}, a.secret);
  await call('host/close');
  assert.equal((await call('host/state')).teams[0].score, 20, 'answered straight after the send: the full speed bonus');
  assert.equal((await call('host/send')).status, 409);
}));

test('hidden wording, fixed six buttons and wipeout multi-tap', () => fixture(async ({call, tv, teams, score}) => {
  const [a, b] = await teams('Alpha', 'Bravo');
  await call('host/open', {...base, text: 'Which word means a baby kangaroo: joey?', type: 'text', answer: 'Joey', hideText: true});
  let s = await call('state', {}, a.secret);
  assert.equal(s.question.text, ''); assert.equal((await tv()).question.text, '');
  await call('host/close'); await call('host/reveal', {question: s.question.id});
  assert.equal((await tv()).question.text, 'Which word means a baby kangaroo: joey?', 'shown with the answer');

  await call('host/settings', {fixedSix: true});
  await call('host/open', {...base, text: 'Pick one', type: 'choice', options: ['Red', 'Green', 'Blue'], answer: 'Blue'});
  s = await call('state', {}, a.secret); assert.equal(s.question.fixedSix, true);
  assert.equal((await call('answer', {question: s.question.id, value: '#E'}, a.secret)).status, 200, 'a letter past the options is an answer');
  assert.equal((await call('answer', {question: s.question.id, value: '#B'}, b.secret)).status, 400, 'but not one standing for an option');
  await call('answer', {question: s.question.id, value: 'Blue'}, b.secret);
  await call('host/close'); assert.equal(await score(a), 0); assert.equal(await score(b), 10);

  await call('host/open', {...base, text: 'Primes', type: 'multi', options: ['2', '3', '4', '5'], correct: ['2', '3', '5'], wipeout: true});
  s = await call('state', {}, a.secret);
  await call('answer', {question: s.question.id, value: ['2', '3', '4']}, a.secret); await call('answer', {question: s.question.id, value: ['2', '3']}, b.secret);
  await call('host/close'); assert.equal(await score(a), 0, 'a wrong tick wipes it out'); assert.equal(await score(b), 17);
}));

test('a picture reveal is blur or tiles, only on a picture', ({}) => fixture(async ({call, dir}) => {
  const media = picture(dir);
  assert.equal((await call('host/open', {...base, text: 'Who?', type: 'picture', media, answer: 'Me', reveal: 'tiles'})).status, 200);
  assert.equal((await call('host/state')).question.reveal, 'tiles');
  await call('host/close');
  assert.equal((await call('host/open', {...base, text: 'Who?', type: 'text', answer: 'Me', reveal: 'blur'})).status, 400);
  assert.equal((await call('host/open', {...base, text: 'Who?', type: 'picture', media, answer: 'Me', reveal: 'swirl'})).status, 400);
}));

test('on the fly: asked without saving, its answer set after answers close', () => fixture(async ({call, teams, score}) => {
  const [a, b] = await teams('Alpha', 'Bravo');
  assert.equal((await call('host/fly', {type: 'choice', options: 3, seconds: 20, points: 2})).status, 200);
  let s = await call('state', {}, a.secret);
  assert.deepEqual(s.question.options, ['A', 'B', 'C']); assert.equal(s.question.onTheFly, true);
  await call('answer', {question: s.question.id, value: 'B'}, a.secret); await call('answer', {question: s.question.id, value: 'C'}, b.secret);
  assert.equal((await call('host/fly/answer', {question: s.question.id, answer: 'B'})).status, 409, 'not while answers are open');
  await call('host/close');
  assert.equal((await call('host/fly/answer', {question: s.question.id, answer: 'D'})).status, 400);
  assert.equal((await call('host/fly/answer', {question: s.question.id, answer: 'b'})).status, 200);
  assert.equal(await score(a), 2); assert.equal(await score(b), 0);
  await call('host/reveal', {question: s.question.id});
  assert.equal((await call('state', {}, b.secret)).question.answer, 'B');
}));

test('Fast Track: to first place, or the Fast Track wheel', () => fixture(async ({call, tv, teams, score}) => {
  const [a, b] = await teams('Alpha', 'Bravo');
  await call('host/open', {...base, text: 'Q', type: 'text', answer: 'yes'});
  const id = (await call('state', {}, a.secret)).question.id;
  await call('answer', {question: id, value: 'yes'}, a.secret); await call('host/close');
  assert.equal((await call('host/fasttrack', {team: b.id, action: 'first'})).points, 11);
  assert.equal(await score(b), 11); assert.equal((await tv()).fastTrack.name, 'Bravo');
  const wheel = await call('host/fasttrack', {team: a.id, action: 'wheel'});
  assert.equal(wheel.items.length, 8); assert.equal(wheel.title, 'Fast Track: Alpha'); assert.ok(wheel.note.startsWith('Alpha'));
  assert.ok(await score(a) >= 10);
}));

test('wheels: weighted teams, random numbers, saved lists and a rollover jackpot', () => fixture(async ({call, teams}) => {
  const [a] = await teams('Alpha', 'Bravo', 'Charlie');
  await call('host/adjust', {team: a.id, points: 5, reason: 'lead'});
  const weighted = await call('host/wheel', {kind: 'weighted'});
  assert.equal(weighted.items.filter(i => i === 'Alpha').length, 1, 'the leader gets one slice');
  assert.equal(weighted.items.length, 6, 'the others more');
  assert.deepEqual((await call('host/wheel', {kind: 'number', min: 1, max: 6})).items, ['1', '2', '3', '4', '5', '6']);
  assert.equal((await call('host/wheel', {kind: 'number', min: 1, max: 100})).status, 400);
  let {wheels} = await call('host/wheels', {action: 'save', wheel: {name: 'Jackpot', kind: 'rollover', prize: '£', base: 20, step: 10, slices: 2}});
  const id = wheels[0].id;
  for (let i = 0; i < 8; i++) {
    const before = (await call('host/state')).wheels[0].amount, spin = await call('host/wheel', {saved: id});
    assert.equal(spin.items[0], `🏆 £${before}`);
    assert.equal((await call('host/state')).wheels[0].amount, spin.result === 0 ? 20 : before + 10);
  }
  ({wheels} = await call('host/wheels', {action: 'save', wheel: {name: 'Forfeits', kind: 'custom', items: ['Sing', 'Dance']}}));
  assert.equal(wheels.length, 2);
  ({wheels} = await call('host/wheels', {action: 'delete', id}));
  assert.deepEqual(wheels.map(w => w.name), ['Forfeits']);
}));

test('music bingo reaction table: one go per song, the quickest right dab scores', () => fixture(async ({call, tv, teams, score, tick}) => {
  const [a, b] = await teams('Alpha', 'Bravo');
  const songs = Array.from({length: 15}, (_, i) => ({title: `Song ${i + 1}`}));
  await call('host/open', {seconds: 600, points: 5, text: 'Music bingo', type: 'musicbingo', mode: 'line', songs, reactions: true, reactionPoints: 2});
  const q = (await call('host/state')).question;
  const {number} = await call('host/bingo', {question: q.id}), title = `Song ${number}`;
  // Every ticket has all 15 songs, so both teams have it.
  tick(1200); assert.equal((await call('react', {question: q.id, title: 'Song 99'}, b.secret)).status, 200, 'a wrong dab is taken quietly');
  assert.equal((await call('react', {question: q.id, title}, b.secret)).status, 409, 'and uses the go');
  tick(300); assert.equal((await call('react', {question: q.id, title}, a.secret)).status, 200);
  const table = (await tv()).question.reactionTable;
  assert.deepEqual(table.now, [{name: 'Alpha', ms: 1500}]); assert.deepEqual(table.leaders, [{name: 'Alpha', songs: 1}]);
  await call('host/close'); assert.equal(await score(a), 2); assert.equal(await score(b), 0);
}));

test('bingo extras: several numbers a call, and speed bingo calls only numbers on a ticket', () => fixture(async ({call, teams}) => {
  await teams('Alpha');
  await call('host/open', {seconds: 600, points: 5, text: 'Bingo', type: 'bingo', mode: 'fullHouse', perCall: 3, speed: true});
  const q = (await call('host/state')).question;
  const {numbers} = await call('host/bingo', {question: q.id});
  assert.equal(numbers.length, 3);
  for (let i = 0; i < 4; i++) assert.equal((await call('host/bingo', {question: q.id})).numbers.length, 3);
  // One team's ticket holds 15 numbers: speed bingo has called them all.
  assert.equal((await call('host/bingo', {question: q.id})).status, 409);
  assert.equal((await call('host/open', {seconds: 60, points: 5, text: 'Music', type: 'musicbingo', mode: 'line', perCall: 2, songs: Array.from({length: 15}, (_, i) => ({title: `S${i}`}))})).status, 409, 'the live game first');
}));

test('groups, tables and the signal monitor', () => fixture(async ({call, tv}) => {
  await call('host/settings', {askTable: true, groupBoard: true});
  const a = await call('join', {name: 'Alpha', table: 4}), b = await call('join', {name: 'Bravo'}), c = await call('join', {name: 'Charlie'});
  assert.equal((await call('join', {name: 'Delta', table: 0})).status, 400);
  for (const [team, group] of [[a, 'Sales'], [b, 'Sales'], [c, 'Tech']]) await call('host/team', {id: team.id, action: 'group', group});
  await call('host/adjust', {team: a.id, points: 4, reason: 'x'}); await call('host/adjust', {team: c.id, points: 3, reason: 'x'});
  assert.deepEqual((await tv()).groups, [{name: 'Tech', teams: 1, average: 3, rank: 1}, {name: 'Sales', teams: 2, average: 2, rank: 2}]);
  await call('state', {}, a.secret, {'X-Beermat-Rtt': '120'});
  const alpha = (await call('host/state')).teams.find(t => t.name === 'Alpha');
  assert.equal(alpha.table_no, 4); assert.equal(alpha.rtt, 120); assert.equal(alpha.grp, 'Sales');
}));

test('slides between rounds, the question report, and the anonymous quiz count', () => fixture(async ({call, tv, teams, dir, sent, tick}) => {
  const [a] = await teams('Alpha');
  const media = picture(dir);
  await call('host/library/save', {revision: 0, quiz: {title: 'Q', rounds: [{id: 'r1', title: 'One', questions: [{id: 'q1', text: 'Two plus two', type: 'number', seconds: 30, points: 1, answer: '4'}]}, {id: 'r2', title: 'Two', questions: [{id: 'q2', text: 'Next', type: 'text', seconds: 30, points: 1, answer: 'x'}]}]}});
  assert.equal((await call('host/slides', {slides: [{media, seconds: 5}]})).slides.length, 1);
  await call('host/settings', {slidesAuto: true});
  await call('host/next', {expectedQuestion: null});
  const id = (await call('state', {}, a.secret)).question.id;
  tick(2000); await call('answer', {question: id, value: '4'}, a.secret); await call('host/close');
  assert.equal((await tv()).view, 'question');
  tick(61000); assert.equal((await tv()).view, 'slides', 'a minute after the round, with no leaderboard shown');
  assert.deepEqual((await tv()).slides, [{media, seconds: 5}]);
  assert.deepEqual((await call('host/report')).questions.map(({text, answered, scored, averageMs}) => ({text, answered, scored, averageMs})), [{text: 'Two plus two', answered: 1, scored: 1, averageMs: 2000}]);
  await call('host/settings', {ended: true});
  const {events} = await call('host/results');
  assert.equal((await call('host/report', {event: events[0].event})).questions.length, 1, 'kept with the results');
  assert.equal(events.length, 1);
  const count = sent.filter(s => s.url.endsWith('/v1/quiz-runs'));
  assert.equal(count.length, 1); assert.deepEqual(Object.keys(count[0].body), ['run'], 'nothing but a random id');
  assert.equal((await call('host/results')).pending, 0, 'the count is not a result waiting to send');
}));

test('the quiz count can be switched off', () => fixture(async ({call, teams, sent}) => {
  const [a] = await teams('Alpha');
  await call('host/settings', {countQuizzes: false});
  await call('host/open', {...base, text: 'Q', type: 'text', answer: 'y'});
  await call('answer', {question: (await call('state', {}, a.secret)).question.id, value: 'y'}, a.secret);
  await call('host/settings', {ended: true});
  assert.equal(sent.filter(s => s.url.endsWith('/v1/quiz-runs')).length, 0);
}));
