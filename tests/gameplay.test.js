import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {createQuiz} from '../server/server.js';

const hostKey = 'a-secure-quiz-test-key';
const question = (id, fields = {}) => ({id, text: 'What is the capital of Wales?', type: 'text', seconds: 30, points: 2, answer: 'Cardiff', ...fields});
async function fixture(fn) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'quiz-game-')); let time = 1000000; let quiz, host;
  const start = async () => {quiz = createQuiz({plan: 'pro', hostKey, database: path.join(dir, 'quiz.sqlite'), mediaDir: dir, now: () => time}); await new Promise(r => quiz.server.listen(0, '127.0.0.1', r)); host = (await call('login', {key: hostKey})).key;};
  const url = () => `http://127.0.0.1:${quiz.server.address().port}`;
  const call = async (route, body = {}, key = route.startsWith('host/') ? host : '') => {
    const response = await fetch(url() + '/api/' + route, {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + key}, body: JSON.stringify(body)});
    return {status: response.status, ...await response.json()};
  };
  await start(); await call('host/settings', {waitingRoom: false});
  try {await fn({call, url, dir, tick: ms => time += ms, restart: async () => {await quiz.close(); await start();}});} finally {await quiz.close(); rmSync(dir, {recursive: true, force: true});}
}

test('saved quiz: revisions, ordering, start/next protection and restart persistence', () => fixture(async ({call, restart}) => {
  const library = {title: 'Fox quiz', rounds: [{id: 'round-1', title: 'General knowledge', questions: [question('q1'), question('q2', {text: 'Second question'})]}]};
  assert.equal((await call('host/library/save', {revision: 0, quiz: library})).revision, 1);
  assert.equal((await call('host/library/save', {revision: 0, quiz: library})).status, 409);
  assert.equal((await call('host/next', {expectedQuestion: null})).id, 1);
  let state = await call('host/state'); assert.equal(state.question.round, 'General knowledge'); assert.equal(state.question.sourceId, 'q1');
  assert.equal((await call('host/next', {expectedQuestion: null})).status, 409);
  await call('host/close');
  assert.equal((await call('host/next', {expectedQuestion: 1})).id, 2);
  await call('host/close');
  assert.equal((await call('host/next', {expectedQuestion: 2})).status, 409);
  assert.equal((await call('host/start', {expectedQuestion: 2, id: 'q1'})).status, 409);
  assert.equal((await call('host/start', {expectedQuestion: 2, id: 'q1', repeat: true})).id, 3);
  await restart(); assert.equal((await call('host/library')).title, 'Fox quiz'); assert.equal((await call('host/state')).history.length, 3);
}));

test('pause, expiry, speed scoring, hidden keys, explicit reveal and finish/resume', () => fixture(async ({call, tick, restart, url}) => {
  const team = await call('join', {name: 'Fox'});
  await call('host/open', question('q', {fastestFingers: true, speedBonus: 10, aliases: ['Caerdydd']}));
  const qid = (await call('state', {}, team.secret)).question.id;
  tick(5000); await call('host/pause'); tick(60000);
  let s = await call('state', {}, team.secret); assert.equal(s.question.paused, true); assert.equal(s.question.remaining, 25000);
  assert.equal((await call('answer', {question: qid, value: 'Cardiff'}, team.secret)).status, 409);
  assert.equal((await call('host/mark', {team: team.id, question: qid, points: 1})).status, 409);
  assert.equal((await call('host/reveal', {question: qid})).status, 409);
  await restart(); assert.equal((await call('state', {}, team.secret)).question.paused, true);
  await call('host/resume'); tick(5000);
  await call('answer', {question: qid, value: ' CAERDYDD '}, team.secret);
  s = await call('state', {}, team.secret); assert.equal(s.answer.points, undefined); assert.equal(s.teams[0].score, 0); assert.equal(s.question.aliases, undefined);
  await call('host/close'); s = await call('state', {}, team.secret); assert.equal(s.answer.points, 8); assert.equal(s.teams[0].score, 8);
  await call('host/reveal', {question: qid}); s = await call('state', {}, team.secret); assert.equal(s.question.answer, 'Cardiff');
  await call('host/reveal', {question: qid, revealed: false}); assert.equal((await call('state', {}, team.secret)).question.answer, undefined);
  await call('host/settings', {leaderboardVisible: false, displayMode: 'blank'}); assert.deepEqual((await (await fetch(url() + '/api/leaderboard')).json()).teams, []);
  await call('host/settings', {ended: true}); assert.equal((await call('join', {name: 'Late team'})).status, 409); assert.equal((await call('host/open', question('next'))).status, 409);
  await call('host/settings', {ended: false, registrationOpen: true}); assert.equal((await call('host/open', question('next'))).status, 200);
}));

test('one-item sheets, server drafts, per-item automatic/manual marks and historical marking', () => fixture(async ({call, restart}) => {
  const team = await call('join', {name: 'Sheet team'});
  const q = question('sheet', {type: 'sheet', items: ['Capital?'], itemAnswers: ['Cardiff'], points: 1});
  await call('host/open', q); const id = (await call('state', {}, team.secret)).question.id;
  assert.equal((await call('draft', {question: id, value: ['draft answer']}, team.secret)).status, 200);
  await restart(); assert.equal((await call('state', {}, team.secret)).draft.value, '["draft answer"]');
  assert.equal((await call('answer', {question: id, value: ['Cardiff']}, team.secret)).status, 200);
  assert.equal((await call('state', {}, team.secret)).draft, null);
  await call('host/close');
  assert.equal((await call('host/review', {question: id})).answers[0].points, 1);
  assert.equal((await call('host/mark', {team: team.id, question: id, marks: [1, 0]})).status, 400);
  await call('host/mark', {team: team.id, question: id, marks: [0]}); assert.equal((await call('state', {}, team.secret)).teams[0].score, 0);
  await call('host/open', question('new'));
  assert.equal((await call('host/mark', {team: team.id, question: id, marks: [1]})).status, 200);
  assert.equal((await call('host/review', {question: id})).answers[0].points, 1);
}));

test('registration locks, recovery rotation, team moderation, absent paper marks and idempotent adjustments', () => fixture(async ({call}) => {
  const team = await call('join', {name: 'Original name'});
  await call('host/settings', {registrationOpen: false}); assert.equal((await call('join', {name: 'Blocked'})).status, 409);
  assert.equal((await call('state', {}, team.secret)).status, 200);
  const recovered = await call('host/team', {id: team.id, action: 'recover'});
  assert.equal((await call('state', {}, team.secret)).status, 401); assert.equal((await call('state', {}, recovered.secret)).team.id, team.id);
  await call('host/team', {id: team.id, action: 'rename', name: 'Recovered team'});
  await call('host/team', {id: team.id, action: 'disable'}); assert.equal((await call('state', {}, recovered.secret)).status, 403);
  await call('host/team', {id: team.id, action: 'restore'}); assert.equal((await call('state', {}, recovered.secret)).team.name, 'Recovered team');
  await call('host/open', question('paper')); await call('host/close');
  const id = (await call('host/state')).question.id;
  await call('host/mark', {team: team.id, question: id, points: 4});
  const adjustment = {team: team.id, points: 3, reason: 'Paper round', requestId: 'unique-paper-adjustment'};
  const first = await call('host/adjust', adjustment); const second = await call('host/adjust', adjustment); assert.equal(first.id, second.id);
  assert.equal((await call('state', {}, recovered.secret)).teams[0].score, 7);
  const exported = await call('host/export'); assert.equal(exported.adjustments.length, 1); assert.equal(exported.teams[0].secret, undefined);
  const login = await call('login', {key: hostKey}); await call('host/logout', {}, login.key); assert.equal((await call('host/state', {}, login.key)).status, 403);
}));

test('authenticated media upload, format validation and byte-range audio playback', () => fixture(async ({call, url}) => {
  const key = (await call('login', {key: hostKey})).key;
  const headers = {Authorization: 'Bearer ' + key};
  const data = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE'), Buffer.alloc(100)]);
  let r = await fetch(url() + '/api/host/media?name=clip.wav', {method: 'POST', body: data}); assert.equal(r.status, 403);
  r = await fetch(url() + '/api/host/media?name=clip.wav', {method: 'POST', headers, body: 'fake audio'}); assert.equal(r.status, 400);
  r = await fetch(url() + '/api/host/media?name=clip.wav', {method: 'POST', headers, body: data}); const media = (await r.json()).media;
  assert.equal(r.status, 200); assert.match(media, /^\/media\/.*\.wav$/);
  r = await fetch(url() + media, {headers: {Range: 'bytes=0-11'}}); assert.equal(r.status, 206); assert.equal((await r.arrayBuffer()).byteLength, 12); assert.equal(r.headers.get('content-type'), 'audio/wav');
  r = await fetch(url() + media, {headers: {Range: 'bytes=9999-'}}); assert.equal(r.status, 416);
  r = await fetch(url() + media, {method: 'HEAD'}); assert.equal(r.status, 200); assert.equal((await r.arrayBuffer()).byteLength, 0);
  assert.equal((await call('host/open', question('audio', {type: 'audio', media}))).status, 200);
}));

test('legacy prototype database migrates without losing teams or scores', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'quiz-legacy-')), filename = path.join(dir, 'legacy.sqlite');
  const db = new DatabaseSync(filename);
  db.exec(`CREATE TABLE teams(id TEXT PRIMARY KEY,name TEXT UNIQUE COLLATE NOCASE,secret TEXT UNIQUE,seen INTEGER);
    CREATE TABLE questions(id INTEGER PRIMARY KEY AUTOINCREMENT,data TEXT,opened INTEGER,deadline INTEGER,closed INTEGER DEFAULT 0);
    CREATE TABLE answers(team TEXT,question INTEGER,value TEXT,points INTEGER DEFAULT 0,PRIMARY KEY(team,question));
    CREATE TABLE adjustments(id INTEGER PRIMARY KEY,team TEXT,points INTEGER,reason TEXT);
    INSERT INTO teams VALUES('old-team','Old team','old-secret',0);
    INSERT INTO questions(data,opened,deadline,closed) VALUES('{"text":"Old question","type":"text","seconds":30,"points":1,"answer":"Old answer"}',0,30,1);
    INSERT INTO answers VALUES('old-team',1,'Old answer',1);`); db.close();
  const quiz = createQuiz({plan: 'pro', database: filename, hostKey}); await new Promise(r => quiz.server.listen(0, '127.0.0.1', r));
  try {const response = await fetch(`http://127.0.0.1:${quiz.server.address().port}/api/state`, {method: 'POST', headers: {Authorization: 'Bearer old-secret'}, body: '{}'}); const data = await response.json(); assert.equal(data.teams[0].score, 1); assert.equal(data.team.name, 'Old team');}
  finally {await quiz.close(); rmSync(dir, {recursive: true, force: true});}
});

test('malformed host payloads are rejected without internal errors', () => fixture(async ({call}) => {
  for (const [route, body] of [
    ['host/review', {question: {bad: true}}],
    ['host/team', {id: {bad: true}}],
    ['host/adjust', {team: {}, points: 1, reason: 'Bad team'}],
    ['host/library/save', {revision: 0, quiz: {title: 'Bad quiz', rounds: [null]}}],
    ['host/library/save', {revision: 0, quiz: {title: 'Bad quiz', rounds: [{id: 'a', title: 'R', questions: [null]}]}}]
  ]) {const result = await call(route, body); assert.ok(result.status >= 400 && result.status < 500, route);}
}));
