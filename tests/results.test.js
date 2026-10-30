import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createQuiz} from '../server/server.js';
import {teamResults} from '../server/results.js';
import {summarize, achievements, badges} from '../shared/achievements.js';
import {newVenueKey, signClaim, verifyClaim, canonical} from '../shared/claims.js';

const hostKey = 'a-secure-quiz-test-key';
const question = (id, fields = {}) => ({id, text: `Question ${id}?`, type: 'text', seconds: 30, points: 2, answer: 'Cardiff', ...fields});

test('team results come from server marking: answered, correct, fastest right answer, perfect rounds, categories', () => {
  const questions = [1, 2, 3, 4].map(id => ({id, opened: 1000 * id, data: {sourceId: 'q' + id, round: ''}}));
  const roundOf = d => ({q1: 'Music', q2: 'Music', q3: 'Music', q4: 'Sport'})[d.sourceId];
  const answers = [
    {team: 'a', question: 1, points: 2, submitted: 1000 + 2500}, {team: 'a', question: 2, points: 2, submitted: 2000 + 9000}, {team: 'a', question: 3, points: 1, submitted: 3000 + 4000},
    {team: 'a', question: 4, points: 0, submitted: 4000 + 1000},
    {team: 'b', question: 1, points: 0, submitted: 1000 + 1000}, {team: 'b', question: 4, points: 2, submitted: null},
  ];
  const [a, b] = teamResults({teams: [{id: 'a', name: 'Foxes', score: 5, rank: 1}, {id: 'b', name: 'Owls', score: 2, rank: 2}], questions, answers, roundOf});
  assert.deepEqual(a, {team: 'a', name: 'Foxes', rank: 1, teams: 2, points: 5, answered: 4, correct: 3, fastestMs: 2500, perfectRounds: 1,
    categories: {Music: {answered: 3, correct: 3}, Sport: {answered: 1, correct: 0}}});
  // A point awarded by the quizmaster without a submitted time counts as right but has no speed.
  assert.deepEqual([b.correct, b.fastestMs, b.perfectRounds], [1, null, 0]);
});

test('statistics and achievements are summed across quizzes and dated by the quiz that earned them', () => {
  const quiz = (date, venue, result) => ({event: 'e' + date, venue, venueName: venue.toUpperCase(), date, result: {rank: 4, teams: 8, points: 10, answered: 10, correct: 6, fastestMs: 8000, perfectRounds: 0, categories: {Music: {answered: 2, correct: 1}}, ...result}});
  const history = [quiz(1, 'lion', {}), quiz(2, 'lion', {rank: 2}), quiz(3, 'crown', {rank: 1, fastestMs: 2900, correct: 9}), ...[4, 5, 6, 7, 8, 9, 10].map(d => quiz(d, 'lion', {perfectRounds: d === 9 ? 1 : 0}))];
  const s = summarize(history);
  assert.equal(s.quizzes, 10); assert.equal(s.wins, 1); assert.equal(s.podiums, 2); assert.equal(s.answered, 100); assert.equal(s.correct, 63);
  assert.equal(s.accuracy, 63); assert.equal(s.fastestMs, 2900); assert.equal(s.perfectRounds, 1);
  assert.deepEqual(s.categories.Music, {answered: 20, correct: 10});
  assert.deepEqual(s.venues.lion, {name: 'LION', quizzes: 9, wins: 0, points: 90});
  const earned = Object.fromEntries(achievements(history).map(a => [a.id, a.earnedAt]));
  assert.deepEqual(earned, {'first-quiz': 1, 'first-win': 3, podium: 2, 'perfect-round': 9, 'fastest-finger': 3, 'ten-quizzes': 10, 'fifty-correct': 8, 'quiz-regular': 5});
  assert.equal(badges.length, 8);
  assert.deepEqual(achievements([]), []);
});

test('claims: signed by the venue key, any change breaks the signature, key order does not matter', () => {
  const key = newVenueKey(), claim = signClaim({v: 1, kind: 'beermat.result', event: 'e1', result: {points: 5, rank: 1}}, key);
  assert.equal(claim.venueKey, key.publicKey);
  assert.equal(verifyClaim(claim), true);
  assert.equal(verifyClaim({...claim, result: {points: 50, rank: 1}}), false);
  assert.equal(verifyClaim({...claim, venueKey: newVenueKey().publicKey}), false);
  assert.equal(verifyClaim({...claim, sig: 'nonsense'}), false);
  assert.equal(verifyClaim({...claim, sig: undefined}), false);
  assert.equal(verifyClaim(JSON.parse(JSON.stringify({sig: claim.sig, result: {rank: 1, points: 5}, event: 'e1', kind: 'beermat.result', v: 1, venueKey: claim.venueKey}))), true);
  assert.equal(canonical({b: 1, a: {d: [2, {f: 1, e: 0}], c: 3}}), '{"a":{"c":3,"d":[2,{"e":0,"f":1}]},"b":1}');
});

test('finishing a quiz keeps its results on the laptop, gives each team a signed result, and queues it for the online service until it is reachable', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'quiz-results-')); let time = 1000000, online = false;
  const sent = [];
  const fetchImpl = async (url, options) => {
    if (!online) throw new Error('getaddrinfo ENOTFOUND');
    sent.push({url, key: options.headers['Idempotency-Key'], body: JSON.parse(options.body)});
    return {ok: sent.length === 1, status: sent.length === 1 ? 201 : 409};
  };
  const quiz = createQuiz({plan: 'pro', hostKey, database: path.join(dir, 'quiz.sqlite'), mediaDir: dir, packDir: dir, soundsDir: dir, now: () => time, fetchImpl});
  await new Promise(r => quiz.server.listen(0, '127.0.0.1', r));
  const call = async (route, body = {}, key = route.startsWith('host/') ? host : '') => {
    const response = await fetch(`http://127.0.0.1:${quiz.server.address().port}/api/${route}`, {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + key}, body: JSON.stringify(body)});
    return {status: response.status, ...await response.json()};
  };
  let host;
  try {
    host = (await call('login', {key: hostKey})).key; await call('host/settings', {waitingRoom: false, countQuizzes: false});
    await call('host/library/save', {revision: 0, quiz: {title: 'Lion quiz', rounds: [{id: 'r1', title: 'Capitals', questions: [question('q1'), question('q2', {answer: 'Paris'})]}]}});
    const fox = await call('join', {name: 'Foxes'}), owl = await call('join', {name: 'Owls'});
    let last = null;
    for (const [id, answers] of [['q1', ['Cardiff', 'Swansea']], ['q2', ['Paris', 'Paris']]]) {
      const q = last = (await call('host/start', {id, expectedQuestion: last})).id; time += 4000;
      await call('answer', {question: q, value: answers[0]}, fox.secret); time += 1000;
      await call('answer', {question: q, value: answers[1]}, owl.secret);
      await call('host/close');
    }
    assert.equal((await call('team/result', {}, fox.secret)).status, 409);
    assert.equal((await call('host/settings', {onlineService: 'ftp://example.com'})).status, 400);
    await call('host/settings', {title: 'Lion quiz', onlineService: 'https://online.example', shareResults: true});
    await call('host/settings', {ended: true});

    const {claim} = await call('team/result', {}, fox.secret);
    assert.equal(verifyClaim(claim), true);
    assert.equal(claim.kind, 'beermat.result');
    assert.equal(claim.title, 'Lion quiz');
    assert.deepEqual(claim.result, {name: 'Foxes', rank: 1, teams: 2, points: 4, answered: 2, correct: 2, fastestMs: 4000, perfectRounds: 0, categories: {Capitals: {answered: 2, correct: 2}}});
    assert.equal(claim.team.length, 24);
    assert.notEqual(claim.team, fox.id);
    assert.equal(JSON.stringify(claim).includes(fox.secret), false);

    let history = await call('host/results');
    assert.deepEqual(history.events.map(e => [e.title, e.teams, e.winner]), [['Lion quiz', 2, 'Foxes']]);
    assert.equal(history.pending, 1);
    assert.match(history.lastError, /Not reachable/);

    online = true;
    assert.equal((await call('host/results/sync')).pending, 0);
    assert.equal(sent[0].url, 'https://online.example/v1/venue-results');
    assert.equal(verifyClaim(sent[0].body), true);
    assert.deepEqual(sent[0].body.teams.map(t => [t.name, t.rank, t.points]), [['Foxes', 1, 4], ['Owls', 2, 2]]);

    // Finishing again (after a resume) replaces the upload under the same key; a 409 "already have it" counts as sent.
    await call('host/settings', {ended: false}); await call('host/settings', {ended: true});
    await call('host/results/sync');
    assert.deepEqual(sent.map(s => s.key), ['event:' + claim.event, 'event:' + claim.event]);
    assert.equal((await call('host/results')).pending, 0);

    // Starting the next quiz keeps the history; it can be deleted from the desk.
    await call('host/new-event', {questions: 'keep', title: 'Next week'});
    assert.equal((await call('host/results')).events.length, 1);
    assert.equal((await call('team/result', {}, fox.secret)).status, 401);
    await call('host/results/delete', {all: true});
    assert.equal((await call('host/results')).events.length, 0);
  } finally {await quiz.close(); rmSync(dir, {recursive: true, force: true});}
});
