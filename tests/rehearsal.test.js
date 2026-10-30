// Rehearsals on a Free laptop: the whole rehearsal quiz (every round format) played by simulated teams through the
// normal player routes and scored by the normal engine, while a real phone joins, sees it is connected, and is refused
// every gameplay route; nothing from the rehearsal is kept or shared; and only Pro can go live.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {execFile} from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createQuiz} from '../server/server.js';
import {answerFor, fastSeconds} from '../server/rehearsal.js';
import {isCorrect, answerValue} from '../server/model.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function quizServer(plan) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'quiz-rehearsal-'));
  const quiz = createQuiz({plan, hostKey: 'rehearsal-test-key-0123', database: path.join(dir, 'quiz.sqlite'), mediaDir: path.join(dir, 'media'), packDir: dir, soundsDir: dir});
  await new Promise(r => quiz.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${quiz.server.address().port}`;
  const post = async (route, body = {}, key = '') => {
    const res = await fetch(base + route, {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + key}, body: JSON.stringify(body)});
    return {status: res.status, ...await res.json().catch(() => ({}))};
  };
  const host = (await post('/api/login', {key: 'rehearsal-test-key-0123'})).key;
  const call = (route, body) => post('/api/host/' + route, body, host);
  const until = async (fn, what, timeout = 10000) => {const end = Date.now() + timeout; while (Date.now() < end) {const v = await fn(); if (v) return v; await sleep(50);} throw Error('Timed out: ' + what);};
  return {dir, quiz, base, post, call, until, done: async () => {await quiz.close(); rmSync(dir, {recursive: true, force: true});}};
}

test('simulated answers: right ones pass the server’s own checks for every format that takes an answer', () => {
  const tiles = ['BIG', 'BEN'], snake = {size: 4, grid: [], path: [0, 1, 2]};
  const samples = [
    {type: 'choice', options: ['A', 'B'], answer: 'B'}, {type: 'multi', options: ['2', '3', '4'], correct: ['2', '3']}, {type: 'letter', answer: 'R'},
    {type: 'number', answer: '6'}, {type: 'sequence', items: ['x', 'y', 'z']}, {type: 'text', answer: 'Canberra', aliases: []},
    {type: 'pinpoint', target: {x: .3, y: .6, r: .05, aspect: 1}}, {type: 'tiles', tiles, pieces: ['BEN', 'BIG']},
  ];
  for (const q of samples) {
    const value = answerValue(answerFor(q, true), q);
    assert.equal(isCorrect(value, q), true, `${q.type}: right`);
    if (!['sequence'].includes(q.type)) assert.notEqual(isCorrect(answerValue(answerFor(q, false, () => .99), q), q), true, `${q.type}: wrong`);
  }
  assert.equal(answerFor({type: 'buzzer'}, true), null, 'buzzers use their button');
  assert.deepEqual([fastSeconds(30), fastSeconds(10)], [10, 5]);
  void snake;
});

test('a Free rehearsal: the whole quiz played by simulated teams while a real phone only tests its connection', async () => {
  const s = await quizServer('free');
  try {
    await new Promise((resolve, reject) => execFile('node', [path.join(root, 'scripts', 'load-test-quiz.mjs'), s.base], {env: {...process.env, HOST_KEY: 'rehearsal-test-key-0123'}}, e => e ? reject(e) : resolve()));
    const library = (await s.call('library'));
    const total = library.rounds.flatMap(r => r.questions).length;
    assert.ok(total >= 21, 'the rehearsal quiz loads on Free, with no question limit');
    assert.equal((await s.call('live')).status, 403, 'Free can’t host live');

    // Rehearse with eight simulated teams, driven by hand for a predictable run.
    const started = await s.call('rehearsal/start', {options: {teams: 8, auto: false, speed: 'fast'}});
    assert.equal(started.status, 200);
    let state = await s.call('state');
    assert.equal(state.rehearsal.mode, 'rehearsal');
    assert.equal(state.rehearsal.sims.length, 8, 'eight simulated teams joined');
    assert.equal(state.teams.length, 8, 'and they are the quiz’s teams');
    await s.until(async () => (await s.call('state')).rehearsal.sims.every(t => t.connected), 'simulated teams connected');
    const tv = await (await fetch(s.base + '/api/leaderboard')).json();
    assert.equal(tv.rehearsal, true, 'the TV knows it is a rehearsal');

    // A real phone joins through the normal join route...
    const phone = await s.post('/api/join', {name: 'Dan’s phone'});
    assert.equal(phone.status, 200); assert.equal(phone.rehearsal, true);
    // ...and a phone pretending to be a simulated team gets nowhere.
    const forged = await s.post('/api/join', {name: 'Forger', simToken: 'made-up-token'});
    assert.equal(forged.rehearsal, true, 'an unknown token joins as a test device');
    const phoneState = await s.post('/api/state', {}, phone.secret);
    assert.deepEqual([phoneState.rehearsal.device, phoneState.question, phoneState.teams], [true, null, []], 'a connection screen, no quiz');
    // It keeps a live connection, and the desk sees it apart from the teams.
    const stream = http.get(`${s.base}/api/events?key=${phone.secret}`, res => res.resume());
    await s.until(async () => (await s.call('state')).rehearsal.devices.find(d => d.name === 'Dan’s phone')?.connected, 'the phone shows as connected');
    state = await s.call('state');
    assert.equal(state.teams.length, 8, 'test phones are not teams');
    assert.deepEqual(state.rehearsal.devices.map(d => d.name).sort(), ['Dan’s phone', 'Forger']);

    // Every question, in order: three teams right, two wrong, one fault each time, then close and reveal.
    const sims = state.rehearsal.sims.map(t => t.name), act = (name, action) => s.call('rehearsal/team', {name, action});
    const blocked = [];
    for (let n = 0; n < total; n++) {
      const opened = await s.call('next', {expectedQuestion: (await s.call('state')).question?.id || null});
      assert.equal(opened.status, 200, `question ${n + 1} opens`);
      const q = (await s.call('state')).question;
      if (n === 0) assert.equal(q.seconds, fastSeconds(library.rounds[0].questions[0].seconds), 'fast timers');
      // The real phone tries everything a player can do.
      for (const [route, body] of [['/api/answer', {question: q.id, value: 'Mars'}], ['/api/draft', {question: q.id, value: 'M'}], ['/api/buzz', {question: q.id}],
        ['/api/agree', {question: q.id}], ['/api/bingo', {question: q.id}], ['/api/tap', {question: q.id}], ['/api/gowide', {question: q.id}], ['/api/fifty', {question: q.id}], ['/api/team/sound', {sound: 1}], ['/api/team/result', {}]]) {
        const r = await s.post(route, body, phone.secret); if (r.status !== 403) blocked.push(`${route} gave ${r.status}`);
      }
      assert.equal((await s.post('/api/state', {}, phone.secret)).question, null, 'no question reaches the phone');
      if (q.type === 'buzzer') {
        assert.equal((await act(sims[0], 'buzz')).result.ok, true, 'a simulated team buzzes');
        assert.equal((await act(sims[1], 'buzz')).result.ok, true, 'a second joins the queue');
        await s.call('buzz', {question: q.id, action: 'correct'});
      } else if (!['bingo', 'musicbingo', 'clips'].includes(q.type)) {
        for (const [i, action] of [[0, 'right'], [1, 'right'], [2, 'right'], [3, 'wrong'], [4, 'wrong']]) {
          const r = await act(sims[i], action);
          assert.equal(r.result.ok, true, `${q.type}: ${action} answer accepted (${r.result.detail})`);
        }
        assert.match((await act(sims[0], 'duplicate')).result.detail, /Already submitted/, 'a second answer is refused');
        assert.equal((await act(sims[5], 'invalid')).result.ok, false, 'an invalid answer is refused');
      }
      await s.call('close', {expectedQuestion: q.id});
      if (q.type !== 'buzzer') assert.equal((await act(sims[6], 'right')).result.ok, false, 'a late answer is refused');
      await s.call('reveal', {question: q.id, revealed: true, delay: 0});
    }
    assert.deepEqual(blocked, [], 'the real phone was refused every gameplay route');

    // Disconnecting and reconnecting a simulated team.
    await act(sims[7], 'disconnect');
    await s.until(async () => !(await s.call('state')).rehearsal.sims.find(t => t.name === sims[7]).connected, 'disconnected');
    await act(sims[7], 'reconnect');
    await s.until(async () => (await s.call('state')).rehearsal.sims.find(t => t.name === sims[7]).connected, 'reconnected');

    // Finish: the standings come from the normal scoring; the phone isn't on them.
    await s.call('settings', {ended: true, leaderboardVisible: true});
    state = await s.call('state');
    const board = state.teams.sort((a, b) => a.rank - b.rank);
    assert.ok(board[0].score > board.at(-1).score, `teams scored differently (${board.map(t => `${t.name} ${t.score}`).join(', ')})`);
    assert.ok(!board.some(t => t.name === 'Dan’s phone'));
    assert.equal(state.rehearsal.log.length, 50, 'the desk gets the latest 50 things the teams did');

    // Nothing kept or shared.
    for (const [table, n] of [['event_results', 0], ['regulars', 0], ['sync_outbox', 0]]) assert.equal(s.quiz.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n, n, `no ${table}`);
    const simSecret = s.quiz.db.prepare("SELECT secret FROM teams WHERE kind='sim'").get().secret;
    assert.equal((await s.post('/api/team/result', {}, simSecret)).status, 409, 'no signed results');

    // Preflight reports honestly.
    const {checks} = await s.call('preflight');
    assert.ok(checks.every(c => ['pass', 'warn', 'fail', 'unknown'].includes(c.status) && c.text));
    assert.deepEqual(['server', 'database', 'quiz', 'media', 'disk', 'network'].filter(id => !checks.some(c => c.id === id)), []);
    assert.equal(checks.find(c => c.id === 'quiz').status, 'pass');

    // Ending the rehearsal clears it and keeps the quiz.
    await s.call('rehearsal/stop');
    state = await s.call('state');
    assert.deepEqual([state.teams.length, state.rehearsal.sims.length, state.question], [0, 0, null]);
    assert.equal((await s.call('library')).rounds.flatMap(r => r.questions).length, total, 'the quiz is untouched');
    stream.destroy();
  } finally {await s.done();}
});

test('automatic simulated teams answer by themselves within the time, through the normal routes', async () => {
  const s = await quizServer('free');
  try {
    await s.call('library/save', {revision: 0, quiz: {title: 'Quick', rounds: [{id: 'r', title: 'Round', questions: [{id: 'q', text: 'Capital of France?', type: 'choice', options: ['Paris', 'Rome', 'Oslo'], answer: 'Paris', seconds: 6, points: 1}]}]}});
    await s.call('rehearsal/start', {options: {teams: 6, auto: true, accuracy: 1}});
    await s.call('next', {expectedQuestion: null});
    await s.until(async () => (await s.call('state')).answers.filter(a => a.submitted).length >= 3, 'automatic answers', 9000);
    const answers = (await s.call('state')).answers.filter(a => a.submitted);
    assert.ok(answers.every(a => a.value === 'Paris' && a.points >= 1), 'answered right, and scored by the server');
  } finally {await s.done();}
});

test('Pro rehearses and hosts live; a live quiz isn’t replaced by a rehearsal without saying so', async () => {
  const s = await quizServer('pro');
  try {
    await s.call('settings', {waitingRoom: false});
    await s.call('library/save', {revision: 0, quiz: {title: 'Q', rounds: [{id: 'r', title: 'R', questions: [{id: 'q', text: 'Two plus two?', type: 'number', answer: '4', seconds: 30, points: 1}]}]}});
    assert.equal((await s.call('state')).rehearsal.mode, 'live', 'Pro is live by default');
    const team = await s.post('/api/join', {name: 'Real team'});
    await s.call('next', {expectedQuestion: null});
    assert.equal((await s.post('/api/answer', {question: 1, value: '4'}, team.secret)).status, 200);
    assert.equal((await s.call('rehearsal/start', {options: {teams: 3}})).status, 409, 'not over a live quiz in progress');
    const swapped = await s.call('rehearsal/start', {options: {teams: 3, auto: false}, endLive: true});
    assert.ok(swapped.saved, 'the live quiz’s results were saved first');
    assert.equal(s.quiz.db.prepare('SELECT COUNT(*) n FROM event_results').get().n, 1);
    assert.equal((await s.post('/api/answer', {question: 1, value: '4'}, team.secret)).status, 401, 'the live team is gone');
    assert.equal((await s.call('state')).rehearsal.sims.length, 3);
    assert.equal((await s.call('live')).rehearsal.mode, 'live');
    const state = await s.call('state');
    assert.deepEqual([state.teams.length, state.rehearsal.sims.length], [0, 0], 'going live clears the rehearsal');
    const joined = await s.post('/api/join', {name: 'Another team'});
    assert.equal(joined.rehearsal, undefined, 'real phones are teams again');
  } finally {await s.done();}
});
