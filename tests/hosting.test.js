import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createQuiz} from '../server/server.js';

const hostKey = 'a-secure-quiz-test-key';
const question = (fields = {}) => ({text: 'What is the capital of Wales?', type: 'text', seconds: 30, points: 2, answer: 'Cardiff', ...fields});
async function fixture(fn) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'quiz-hosting-')); let time = 1000000;
  const quiz = createQuiz({plan: 'pro', hostKey, database: path.join(dir, 'quiz.sqlite'), mediaDir: dir, packDir: path.join(dir, 'no-pack'), soundsDir: path.join(dir, 'no-pack'), now: () => time});
  await new Promise(r => quiz.server.listen(0, '127.0.0.1', r));
  const call = async (route, body = {}, key = route.startsWith('host/') ? host : '') => {
    const response = await fetch(`http://127.0.0.1:${quiz.server.address().port}/api/${route}`, {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + key}, body: JSON.stringify(body)});
    return {status: response.status, ...await response.json()};
  };
  const host = (await call('login', {key: hostKey})).key; await call('host/settings', {waitingRoom: false});
  const board = async () => (await fetch(`http://127.0.0.1:${quiz.server.address().port}/api/leaderboard`)).json();
  const upload = async (name, data) => (await (await fetch(`http://127.0.0.1:${quiz.server.address().port}/api/host/media?name=${name}`, {method: 'POST', headers: {Authorization: 'Bearer ' + host}, body: data})).json()).media;
  try {await fn({call, board, upload, tick: ms => time += ms});} finally {await quiz.close(); rmSync(dir, {recursive: true, force: true});}
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
  const {id} = await call('host/open', question({fastestFingers: true, speedBonus: 5, bonusMode: 'fixed', bonusPlaces: 2}));
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

test('the TV knows each team’s buzzer sound, so first place and the winner hear their own', () => fixture(async ({call, board}) => {
  const fox = await call('join', {name: 'Fox'}); await call('join', {name: 'Owl'});
  await call('team/sound', {sound: 6}, fox.secret);
  assert.deepEqual((await board()).teams.map(t => [t.name, t.sound]), [['Fox', 6], ['Owl', null]]);
}));

test('after a round, Next shows the leaderboard, reveals it from the bottom, then the leader, then second place, then starts the next round', () => fixture(async ({call, board}) => {
  const teams = {}; for (const name of ['Ant', 'Bee', 'Cat']) teams[name] = await call('join', {name});
  await call('host/library/save', {revision: 0, quiz: {title: 'Steps', rounds: [{id: 'r1', title: 'One', questions: [{id: 'a', ...question()}]}, {id: 'r2', title: 'Two', questions: [{id: 'b', ...question()}]}]}});
  let {id} = await call('host/next', {expectedQuestion: null});
  assert.equal((await call('host/state')).board.canShow, false, 'not while the question is open');
  await call('answer', {question: id, value: 'Cardiff'}, teams.Ant.secret); await call('host/close');
  const desk = (await call('host/state')).board;
  assert.deepEqual([desk.canShow, desk.active, desk.roundOver], [true, false, true]);
  await call('host/board', {action: 'show'});
  // Ant scored; Bee and Cat share second place, so there is nobody below second: the leader comes first.
  let tv = await board(); assert.equal(tv.view, 'leaderboard');
  assert.deepEqual(tv.reveal, {question: id, shown: 0, rest: 0, leader: false, second: false, done: false, hidden: ['Ant', 'Bee', 'Cat']});
  await call('host/board', {action: 'next'});
  tv = await board(); assert.deepEqual([tv.reveal.leader, tv.reveal.second, tv.reveal.done, tv.reveal.hidden], [true, true, false, ['Bee', 'Cat']], 'the leader, second place still hidden');
  await call('host/board', {action: 'next'}); assert.deepEqual([(await board()).reveal.done, (await board()).reveal.hidden], [true, []], 'second place completes the board');
  assert.equal((await call('host/board', {action: 'next'})).status, 409);
  // The next round's first question takes the TV back.
  ({id} = await call('host/next', {expectedQuestion: id})); tv = await board(); assert.deepEqual([tv.view, tv.reveal], ['question', null]);
  // No board at the end of the last round: finishing reveals the final standings instead.
  await call('host/close'); assert.equal((await call('host/state')).board.canShow, false);
  await call('host/settings', {ended: true}); await call('host/board', {action: 'show'});
  assert.equal((await board()).reveal.shown, 0);
  // Choosing a projector view ends the reveal.
  await call('host/settings', {displayMode: 'winner'}); tv = await board(); assert.deepEqual([tv.view, tv.reveal], ['winner', null]);
}));

test('the leaderboard reveal: bottom up to third, then the leader, then second place and the full board', () => fixture(async ({call, board}) => {
  const names = ['Ant', 'Bee', 'Cat', 'Dog', 'Eel'], teams = {};
  for (const [i, name] of names.entries()) {
    teams[name] = await call('join', {name});
    if (i < 4) await call('host/adjust', {team: teams[name].team?.id || teams[name].id, points: 10 - i, reason: 'Head start'});
  }
  await call('host/library/save', {revision: 0, quiz: {title: 'Steps', rounds: [{id: 'r1', title: 'One', questions: [{id: 'a', ...question()}]}, {id: 'r2', title: 'Two', questions: [{id: 'b', ...question()}]}]}});
  const {id} = await call('host/next', {expectedQuestion: null}); await call('host/close');
  assert.deepEqual((await board()).teams.map(t => [t.name, t.rank]), [['Ant', 1], ['Bee', 2], ['Cat', 3], ['Dog', 4], ['Eel', 5]]);
  await call('host/board', {action: 'show'});
  const steps = [];
  for (;;) {
    const r = (await board()).reveal, desk = (await call('host/state')).board;
    steps.push([r.hidden.join(','), r.leader, r.second, r.done, desk.shown === desk.rest]);
    if (r.done) break;
    assert.equal((await call('host/board', {action: 'next'})).status, 200);
  }
  assert.deepEqual(steps, [
    ['Ant,Bee,Cat,Dog,Eel', false, false, false, false],
    ['Ant,Bee,Cat,Dog', false, false, false, false],   // fifth
    ['Ant,Bee,Cat', false, false, false, false],       // fourth
    ['Ant,Bee', false, false, false, true],            // third; the next step is the leader
    ['Bee', true, true, false, false],                 // the leader (the TV's spotlight); second place next
    ['', true, false, true, false],                    // second place: the full board
  ]);
  assert.equal((await call('host/board', {action: 'next'})).status, 409);
  assert.equal((await board()).reveal.question, id);
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

test('automatic TV: join, question, the leaderboard when the quizmaster shows it, final leaderboard; a manual view overrides it', () => fixture(async ({call, board, tick}) => {
  const view = async () => (await board()).view;
  assert.equal(await view(), 'join');
  const saved = id => ({id, ...question({text: `Question ${id}`})});
  await call('host/library/save', {revision: 0, quiz: {title: 'Auto', rounds: [{id: 'r1', title: 'Round 1', questions: [saved('a'), saved('b')]}, {id: 'r2', title: 'Round 2', questions: [saved('c')]}]}});
  await call('host/next', {expectedQuestion: null}); assert.equal(await view(), 'question');
  await call('host/close'); tick(60000); assert.equal(await view(), 'question'); // round 1 not over yet
  await call('host/next', {expectedQuestion: 1}); await call('host/close');
  assert.equal(await view(), 'question'); tick(5000);
  await call('host/reveal', {question: 2}); tick(60000); assert.equal(await view(), 'question', 'the round is over, but the board waits for the quizmaster');
  await call('host/board', {action: 'show'}); assert.equal(await view(), 'leaderboard');
  await call('host/next', {expectedQuestion: 2}); assert.equal(await view(), 'question');
  tick(31000); assert.equal(await view(), 'question');
  await call('host/settings', {displayMode: 'wheel'}); assert.equal(await view(), 'wheel');
  // In Auto, a spin shows the wheel while it turns and its result shows, then Auto carries on.
  await call('host/settings', {displayMode: 'auto'}); await call('host/wheel', {items: ['Red', 'Blue']}); assert.equal(await view(), 'wheel');
  tick(15000); assert.equal(await view(), 'wheel'); tick(1500); assert.equal(await view(), 'question');
  await call('host/settings', {displayMode: 'auto', ended: true}); assert.equal(await view(), 'leaderboard');
}));

test('a secret round hides marks, the reveal and the leaderboard from teams and the TV until the quiz ends', () => fixture(async ({call, board}) => {
  const team = await call('join', {name: 'Owls'});
  await call('host/library/save', {revision: 0, quiz: {title: 'Secret', rounds: [{id: 'r1', title: 'Round 1', questions: [{id: 'a', ...question()}]}, {id: 'r2', title: 'Final', secret: true, questions: [{id: 'b', ...question({text: 'Capital of Scotland?', answer: 'Edinburgh'})}]}]}});
  assert.equal((await call('host/library')).rounds[1].secret, true);
  let {id} = await call('host/next', {expectedQuestion: null}); await call('answer', {question: id, value: 'Cardiff'}, team.secret); await call('host/close');
  assert.equal(score(await board(), 'Owls'), 2);
  ({id} = await call('host/next', {expectedQuestion: id})); await call('answer', {question: id, value: 'Edinburgh'}, team.secret);
  // Once the secret round starts the board is gone, even before any of its marks would count.
  let tv = await board(); assert.deepEqual(tv.teams, []); assert.equal(tv.settings.secretRound, true); assert.equal(tv.settings.leaderboardVisible, false);
  await call('host/close'); await call('host/reveal', {question: id});
  const mine = await call('state', {}, team.secret);
  assert.deepEqual(mine.answer, {value: 'Edinburgh'}); assert.deepEqual(mine.teams, []);
  assert.equal(mine.question.revealed, false); assert.equal(mine.question.answer, undefined); assert.equal(mine.question.scorers, undefined);
  tv = await board(); assert.equal(tv.question.revealed, false); assert.equal(tv.question.correctCount, undefined);
  // The desk still sees everything.
  const desk = await call('host/state');
  assert.equal(desk.question.answer, 'Edinburgh'); assert.equal(desk.teams.find(t => t.name === 'Owls').score, 4); assert.equal(desk.settings.leaderboardVisible, true);
  await call('host/settings', {ended: true});
  tv = await board(); assert.equal(score(tv, 'Owls'), 4); assert.equal(tv.settings.secretRound, undefined); assert.equal(tv.view, 'leaderboard');
  assert.equal((await call('state', {}, team.secret)).answer.points, 2);
}));

test('a tie for first after the last question: Next skips the tie-breaker, the desk offers it, and it settles first place', () => fixture(async ({call}) => {
  const [owls, foxes, bats] = [await call('join', {name: 'Owls'}), await call('join', {name: 'Foxes'}), await call('join', {name: 'Bats'})];
  const breaker = {id: 'tb', text: 'How tall is the Eiffel Tower in metres?', type: 'nearest', seconds: 30, points: 0, answer: '330', tieBreaker: true};
  await call('host/library/save', {revision: 0, quiz: {title: 'Tied', rounds: [{id: 'r', title: 'R', questions: [{id: 'a', ...question()}, breaker, {id: 'b', ...question({text: 'Capital of Scotland?', answer: 'Edinburgh'})}]}]}});
  let {id} = await call('host/next', {expectedQuestion: null});
  for (const t of [owls, foxes]) await call('answer', {question: id, value: 'Cardiff'}, t.secret);
  await call('host/close');
  assert.equal((await call('host/state')).tie, null, 'questions left: no prompt yet');
  ({id} = await call('host/next', {expectedQuestion: id}));
  assert.equal((await call('host/state')).question.sourceId, 'b', 'Next skipped the tie-breaker');
  await call('answer', {question: id, value: 'Leith'}, bats.secret);
  assert.equal((await call('host/state')).tie, null, 'nothing offered while a question is live');
  await call('host/close');
  const tie = (await call('host/state')).tie;
  assert.deepEqual(tie, {teams: ['Foxes', 'Owls'], points: 2, breaker: {id: 'tb', text: breaker.text}});
  assert.equal((await call('host/next', {expectedQuestion: id})).status, 409, 'Next has nothing left to open');
  ({id} = await call('host/start', {id: 'tb', expectedQuestion: id}));
  await call('answer', {question: id, value: '320'}, owls.secret); await call('answer', {question: id, value: '300'}, foxes.secret);
  await call('host/close');
  const s = await call('host/state');
  assert.equal(s.tie, null, 'first place settled');
  assert.deepEqual(s.teams.filter(t => t.rank === 1).map(t => t.name), ['Owls']);
}));

test('only a tie for first place counts, and with no tie-breaker saved the desk says so', () => fixture(async ({call}) => {
  const [a] = [await call('join', {name: 'Alpha'}), await call('join', {name: 'Beta'}), await call('join', {name: 'Gamma'})];
  await call('host/library/save', {revision: 0, quiz: {title: 'T', rounds: [{id: 'r', title: 'R', questions: [{id: 'a', ...question()}]}]}});
  const {id} = await call('host/next', {expectedQuestion: null});
  await call('answer', {question: id, value: 'Cardiff'}, a.secret); await call('host/close');
  assert.equal((await call('host/state')).tie, null, 'Beta and Gamma are level, but only for second place');
  await call('host/adjust', {team: (await call('host/state')).teams.find(t => t.name === 'Beta').id, points: 2, reason: 'Paper round'});
  assert.deepEqual((await call('host/state')).tie, {teams: ['Alpha', 'Beta'], points: 2, breaker: null});
}));

test('reveal lists who scored, quickest answer first, with their time', () => fixture(async ({call, tick}) => {
  const [slow, fast, wrong] = [await call('join', {name: 'Slow'}), await call('join', {name: 'Fast'}), await call('join', {name: 'Wrong'})];
  const {id} = await call('host/open', question({fastestFingers: true, speedBonus: 30}));
  for (const t of [slow, fast, wrong]) await call('state', {}, t.secret);
  tick(1200); await call('answer', {question: id, value: 'Cardiff'}, fast.secret);
  await call('answer', {question: id, value: 'Swansea'}, wrong.secret);
  tick(3000); await call('answer', {question: id, value: 'cardiff'}, slow.secret);
  await call('host/close'); await call('host/reveal', {question: id});
  const q = (await call('state', {}, wrong.secret)).question;
  assert.deepEqual(q.scorers.map(s => [s.name, s.ms]), [['Fast', 1200], ['Slow', 4200]]);
  assert.ok(q.scorers[0].points > q.scorers[1].points);
  // The fastest team fills the TV at the reveal, with its buzzer sound.
  assert.deepEqual(q.first, {kind: 'fastest', name: 'Fast', sound: null, photo: null, ms: 1200});
  await call('host/settings', {showScores: false});
  assert.equal((await call('state', {}, wrong.secret)).question.scorers[0].points, null);
}));

test('no speed bonus unless fastest fingers first is on', () => fixture(async ({call}) => {
  const team = await call('join', {name: 'Quick'});
  for (const [fastestFingers, expected] of [[false, 2], [true, 7]]) {
    const {id} = await call('host/open', question({speedBonus: 5, fastestFingers}));
    await call('state', {}, team.secret); await call('answer', {question: id, value: 'Cardiff'}, team.secret); await call('host/close');
    assert.equal((await call('state', {}, team.secret)).answer.points, expected);
  }
}));

test('end quiz and start next: results kept on the laptop, teams and scores cleared, questions kept or replaced', () => fixture(async ({call, board}) => {
  const team = await call('join', {name: 'Fox'});
  await call('host/library/save', {revision: 0, quiz: {title: 'Night one', rounds: [{id: 'r', title: 'R', questions: [{id: 'a', ...question()}]}]}});
  await call('host/settings', {title: 'Night one', joinSsid: 'Pub WiFi'});
  const {id} = await call('host/next', {expectedQuestion: null}); await call('answer', {question: id, value: 'Cardiff'}, team.secret);
  await call('host/close');
  // A bingo claim too, so every table that refers to teams is cleared.
  const bingo = await call('host/open', {text: 'Bingo', type: 'bingo', seconds: 600, mode: 'progressive', stagePoints: [1, 2, 3]});
  const row = (await call('state', {}, team.secret)).question.bingo.card[0].filter(Boolean);
  for (let called = []; !row.every(n => called.includes(n));) {await call('host/bingo', {question: bingo.id}); called = (await call('host/state')).question.bingo.called;}
  await call('bingo', {question: bingo.id}, team.secret);
  assert.equal((await call('host/bingo-verdict', {shout: (await call('host/state')).question.bingo.shouts[0].id, correct: true})).stage, 'line');
  await call('host/close'); await call('host/settings', {ended: true}); await call('host/timer', {action: 'start', seconds: 60});
  const before = (await board()).event;
  const ended = await call('host/new-event', {questions: 'keep', title: 'Night two'});
  assert.match(ended.saved, /^results\/.*Night-one\.json$/); assert.equal(ended.results.teams[0].name, 'Fox'); assert.equal(ended.results.answers.length, 2);
  const after = await board();
  assert.deepEqual([after.teams, after.question, after.timer, after.settings.ended, after.settings.registrationOpen, after.settings.title, after.settings.joinSsid, after.view], [[], null, null, false, true, 'Night two', 'Pub WiFi', 'join']);
  assert.notEqual(after.event, before);
  assert.equal((await call('state', {}, team.secret)).status, 401, 'old phones must join again');
  assert.equal((await call('join', {name: 'Fox'})).secret.length > 0, true, 'names are free again');
  assert.equal((await call('host/library')).rounds[0].questions[0].id, 'a');
  // Next quiz from a file, or empty.
  await call('host/new-event', {questions: 'load', quiz: {title: 'Night three', rounds: [{id: 'n', title: 'New', questions: [{id: 'b', ...question({text: 'New one'})}]}]}});
  assert.deepEqual([(await call('host/library')).title, (await board()).settings.title], ['Night three', 'Night three']);
  assert.equal((await call('host/new-event', {questions: 'load', quiz: {title: 'Bad', rounds: [{id: 'x', title: 'X', questions: [{id: 'c', type: 'nope'}]}]}})).status, 400);
  await call('host/new-event', {questions: 'empty'}); assert.equal((await call('host/library')).rounds.length, 0);
  // Question ids keep counting up so screens never mistake a new question for an old one.
  assert.ok((await call('host/open', question())).id > bingo.id);
}));


test('sound effects, extra buzzer sounds and custom bingo calls', () => fixture(async ({call, board, upload}) => {
  const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVEfmt '), Buffer.alloc(32)]);
  const [airhorn, quack, honk] = [await upload('airhorn.wav', wav), await upload('quack.wav', wav), await upload('honk.wav', wav)];
  await call('host/sounds', {slots: {bingo: airhorn, applause: airhorn}});
  await call('host/sounds', {slots: {applause: null}, buzzers: [{name: 'Quack', media: quack}, {name: 'Honk', media: honk}]});
  assert.deepEqual((await board()).sounds, {slots: {bingo: airhorn}, buzzers: [{name: 'Quack', media: quack}, {name: 'Honk', media: honk}]});
  assert.equal((await call('host/sounds', {slots: {nope: airhorn}})).status, 400);
  assert.equal((await call('host/sounds', {slots: {bingo: '/media/missing.mp3'}})).status, 400);
  // Teams can pick an added buzzer sound (after the 8 built-in ones); removing the sounds resets them.
  const team = await call('join', {name: 'Fox'});
  assert.equal((await call('team/sound', {sound: 9}, team.secret)).ok, true);
  assert.equal((await call('team/sound', {sound: 10}, team.secret)).status, 400);
  await call('host/sounds', {buzzers: []}); assert.equal((await call('state', {}, team.secret)).team.sound, null);
  // Custom bingo calls: the phrase for the last number comes from the quizmaster's list.
  const calls = Array.from({length: 90}, (_, i) => `Call for ${i + 1}`);
  assert.equal((await call('host/bingo-calls', {calls: calls.slice(1)})).status, 400);
  await call('host/bingo-calls', {calls});
  const {id} = await call('host/open', {text: 'Bingo', type: 'bingo', seconds: 600, points: 1, mode: 'line'});
  const {number} = await call('host/bingo', {question: id});
  assert.equal((await board()).question.bingo.phrase, `Call for ${number}`);
  assert.equal((await board()).question.bingo.colours, null, 'calls that name no colours leave the balls plain');
  // A colour named in a call colours that number; one that names none takes its neighbour's.
  const coloured = calls.map((c, i) => i === 5 ? 'Half a dozen, number 6' : `${i < 20 ? 'Red' : i < 40 ? 'blue' : 'Green'} number ${i + 1}`);
  await call('host/bingo-calls', {calls: coloured});
  const colours = (await board()).question.bingo.colours;
  assert.deepEqual([colours[0], colours[5], colours[19], colours[20], colours[89]], ['red', 'red', 'red', 'blue', 'green']);
  await call('host/bingo-calls', {calls: null}); assert.equal((await board()).question.bingo.phrase, null);
}));

test('a reveal can be held back while the TV plays its drum roll', () => fixture(async ({call, board, tick}) => {
  const {id} = await call('host/open', question()); await call('host/close');
  await call('host/reveal', {question: id, delay: 5000});
  let q = (await board()).question; assert.deepEqual([q.revealing, q.revealed, q.answer], [true, false, undefined], 'answer withheld during the drum roll');
  tick(5000); q = (await board()).question; assert.deepEqual([q.revealing, q.revealed, q.answer], [false, true, 'Cardiff']);
  assert.equal((await call('host/reveal', {question: id, delay: 20000})).status, 400);
  await call('host/reveal', {question: id, revealed: false}); assert.equal((await board()).question.revealed, false);
}));

test('looks: one for all, random for each question, or by question type', () => fixture(async ({call, board}) => {
  assert.equal((await board()).look, 'stage');
  await call('host/settings', {look: 'neon'}); assert.equal((await board()).look, 'neon');
  assert.equal((await call('host/settings', {look: 'tartan'})).status, 400);
  await call('host/settings', {look: '@type'});
  const open = async (fields) => {await call('host/close'); await call('host/open', question(fields));};
  await open({}); const typed = (await board()).look;
  await open({type: 'choice', options: ['Cardiff', 'Swansea']}); assert.notEqual((await board()).look, typed, 'keypad and typed questions look different');
  await call('host/settings', {lookByType: {choice: 'royal'}}); assert.equal((await board()).look, 'royal');
  assert.equal((await call('host/settings', {lookByType: {choice: 'tartan'}})).status, 400);
  await call('host/settings', {look: '@random'});
  const seen = new Set();
  for (let i = 0; i < 12; i++) {await open({}); const look = (await board()).look; assert.equal((await board()).look, look, 'a question keeps its look'); seen.add(look);}
  assert.ok(seen.size >= 3, `looks vary: ${[...seen]}`);
}));
