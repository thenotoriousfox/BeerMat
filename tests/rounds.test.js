import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {createQuiz} from '../server/server.js';

const hostKey = 'a-secure-rounds-test-key';
async function fixture(fn, options = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'quiz-rounds-')); let time = 5000000; let quiz, host;
  const start = async () => {quiz = createQuiz({plan: 'pro', hostKey, database: path.join(dir, 'quiz.sqlite'), mediaDir: dir, packDir: path.join(dir, 'no-pack'), soundsDir: path.join(dir, 'no-pack'), now: () => time, ...options}); await new Promise(r => quiz.server.listen(0, '127.0.0.1', r)); host = (await call('login', {key: hostKey})).key;};
  const url = () => `http://127.0.0.1:${quiz.server.address().port}`;
  const call = async (route, body = {}, key = route.startsWith('host/') ? host : '') => {
    const response = await fetch(url() + '/api/' + route, {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + key}, body: JSON.stringify(body)});
    return {status: response.status, ...await response.json()};
  };
  await start(); await call('host/settings', {waitingRoom: false});
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
  // Answers stay private until the reveal; then the board shows what each team put, and the closest team comes first.
  assert.ok((await call('state', {}, a.secret)).teams.every(t => !('answer' in t)));
  await call('host/reveal', {question: id});
  const s = await call('state', {}, d.secret);
  assert.deepEqual(Object.fromEntries(s.teams.map(t => [t.name, t.answer])), {Alpha: '250', Bravo: '256', Charlie: '300', Delta: null});
  assert.deepEqual(s.question.scorers.map(x => [x.name, x.answer]), [['Alpha', '250'], ['Bravo', '256']]);
  assert.equal(s.question.first.name, 'Alpha'); assert.equal(s.question.first.answer, '250');
  assert.ok((await call('host/open', {...base, text: 'Next', type: 'text', answer: 'Yes'})).id); assert.ok((await call('state', {}, a.secret)).teams.every(t => !('answer' in t)));
}));

test('speed bonus starts each team clock on delivery, capped by a grace period', () => fixture(async ({call, teams, tick}) => {
  const [early, late, sleepy] = await teams('Early', 'Late', 'Sleepy');
  await call('host/open', {...base, text: 'Capital of Wales?', type: 'text', answer: 'Cardiff', fastestFingers: true, speedBonus: 30});
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

test('allowed local addresses refuse other interfaces, except the TV page (a TV on the venue Wi-Fi)', () => fixture(async ({url}) => {
  // Players, joining and the desk: only on the quiz Wi-Fi.
  for (const [method, p] of [['GET', '/'], ['GET', '/host'], ['GET', '/host.js'], ['POST', '/api/join'], ['POST', '/api/login'], ['POST', '/api/host/state'], ['POST', '/api/state'], ['POST', '/api/leaderboard']])
    assert.equal((await fetch(url() + p, {method, ...(method === 'POST' && {body: '{}'})})).status, 403, `${method} ${p}`);
  assert.equal((await fetch(url() + '/api/events?key=' + 'a'.repeat(22) + '==')).status, 403, 'a team’s live updates');
  // The TV page, what it loads and the room's live updates: on every network.
  for (const p of ['/tv', '/client.js', '/app.js', '/style.css', '/themes.css', '/i18n.js', '/qr.js', '/brand/mark.svg', '/api/leaderboard', '/api/hello'])
    assert.equal((await fetch(url() + p)).status, 200, p);
  const events = await fetch(url() + '/api/events', {signal: AbortSignal.timeout(1500)});
  assert.equal(events.status, 200, 'the TV’s live updates');
  await events.body.cancel();
}, {allowedAddresses: ['10.42.0.1']}));

test('multi-tap scores right ticks minus wrong ticks; pinpoint scores taps and go-wide', () => fixture(async ({call, teams, score, url}) => {
  const [a, b, c] = await teams('Alpha', 'Bravo', 'Charlie');
  await call('host/open', {...base, text: 'Tick the primes', type: 'multi', options: ['2', '3', '4', '5'], correct: ['2', '3', '5'], points: 9, fastestFingers: true, speedBonus: 3});
  let id = (await call('state', {}, a.secret)).question.id;
  assert.equal((await call('answer', {question: id, value: ['7']}, a.secret)).status, 400);
  await call('answer', {question: id, value: ['5', '3', '2']}, a.secret);
  await call('answer', {question: id, value: ['2', '3', '4']}, b.secret);
  await call('answer', {question: id, value: ['4']}, c.secret);
  await call('host/close'); assert.equal(await score(a), 12); assert.equal(await score(b), 3); assert.equal(await score(c), 0);
  await call('host/reveal', {question: id}); assert.deepEqual((await call('state', {}, c.secret)).question.tally, {2: 2, 3: 2, 4: 2, 5: 1});

  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9sAAAAASUVORK5CYII=', 'base64');
  const media = (await (await fetch(url() + '/api/host/media?name=map.png', {method: 'POST', headers: {Authorization: 'Bearer ' + (await call('login', {key: hostKey})).key}, body: png})).json()).media;
  assert.equal((await call('host/open', {...base, text: 'Where is Cardiff?', type: 'pinpoint', media})).status, 400, 'target required');
  await call('host/open', {...base, text: 'Where is Cardiff?', type: 'pinpoint', media, target: {x: 0.5, y: 0.5, r: 0.1, aspect: 2}, goWide: true, goWidePoints: 4});
  const q = (await call('state', {}, a.secret)).question; id = q.id; assert.equal(q.target, undefined, 'target hidden while live');
  await call('answer', {question: id, value: [[0.55, 0.52]]}, a.secret);          // inside (dy scaled by aspect: 0.04)
  await call('answer', {question: id, value: [[0.5, 0.58], [0.5, 0.5]]}, b.secret); // first miss (0.16 > 0.1), second hit
  assert.equal((await call('answer', {question: id, value: [[0.1, 0.1], [0.2, 0.2], [0.3, 0.3]]}, c.secret)).status, 400);
  await call('host/close'); assert.equal(await score(a), 22); assert.equal(await score(b), 7);
}));

test('bingo: seeded tickets, host calls, false and valid claims, first claim bonus', () => fixture(async ({call, teams, score}) => {
  const [a, b] = await teams('Alpha', 'Bravo');
  await call('host/open', {...base, text: 'Bingo — one line', type: 'bingo', mode: 'line', points: 5, fastestFingers: true, speedBonus: 3});
  let s = await call('state', {}, a.secret); const id = s.question.id, card = s.question.bingo.card;
  assert.deepEqual((await call('state', {}, a.secret)).question.bingo.card, card, 'ticket is stable');
  assert.equal(card.flat().filter(Boolean).length, 15); assert.ok(card.every(row => row.filter(Boolean).length === 5));
  // A team can call bingo at any time; the quizmaster checks the ticket and says whether it is right.
  await call('host/bingo', {question: id});
  assert.equal((await call('bingo', {question: id}, a.secret)).pending, true);
  let shouts = (await call('host/state')).question.bingo.shouts;
  assert.deepEqual(shouts.map(x => [x.name, x.status, x.stage, x.checks]), [['Alpha', 'pending', 'line', false]], 'the desk sees the ticket does not check out');
  assert.deepEqual((await call('state', {}, b.secret)).question.bingo.shouts.map(x => [x.name, x.status, x.checks]), [['Alpha', 'pending', undefined]], 'teams see the call, not the check');
  assert.equal((await call('bingo', {question: id}, a.secret)).status, 409, 'one call at a time');
  assert.equal((await call('host/bingo', {question: id})).status, 409, 'no numbers while a call is checked');
  assert.equal((await call('host/bingo-verdict', {shout: shouts[0].id, correct: false})).correct, false);
  assert.equal((await call('host/bingo-verdict', {shout: shouts[0].id, correct: true})).status, 409, 'one verdict per call');
  assert.deepEqual((await call('state', {}, a.secret)).question.bingo.myShout, {status: 'wrong', seq: 1});
  assert.equal((await call('bingo', {question: id}, a.secret)).status, 409, 'after a wrong call, wait for the next number');
  // Teams have to listen: they get the latest number and a count, not the list, unless the board is switched on.
  s = await call('state', {}, a.secret); assert.deepEqual([s.question.bingo.called, s.question.bingo.count, s.question.bingo.board], [null, 1, false]);
  await call('host/settings', {bingoBoard: true}); assert.equal((await call('state', {}, a.secret)).question.bingo.called.length, 1);
  await call('host/settings', {bingoBoard: false});
  const row = new Set(card[0].filter(Boolean)); let calls = 1, h = await call('host/state');
  while ([...row].some(n => !(h.question.bingo.called.includes(n)))) {assert.equal((await call('host/bingo', {question: id})).status, 200); calls++; h = await call('host/state');}
  assert.equal(new Set(h.question.bingo.called).size, calls);
  await call('bingo', {question: id}, a.secret); shouts = (await call('host/state')).question.bingo.shouts;
  assert.equal(shouts.at(-1).checks, true);
  assert.equal((await call('host/bingo-verdict', {shout: shouts.at(-1).id, correct: true})).first, true);
  assert.equal((await call('bingo', {question: id}, a.secret)).status, 409, 'one claim per team');
  assert.equal((await call('host/bingo', {question: id})).status, 409, 'no more calls after a winner');
  assert.deepEqual((await call('state', {}, b.secret)).question.bingo.winners, ['Alpha']);
  await call('host/close'); assert.equal(await score(a), 8); assert.equal(await score(b), 0);
}));

test('spin the wheel picks a server-side result and teams can choose a buzzer sound', () => fixture(async ({call, teams, url}) => {
  const [a] = await teams('Alpha', 'Bravo');
  assert.equal((await call('host/wheel', {items: ['Only one']})).status, 400);
  const wheel = await call('host/wheel'); assert.deepEqual([...wheel.items].sort(), ['Alpha', 'Bravo']); assert.ok(wheel.result >= 0 && wheel.result < 2);
  assert.equal((await call('host/settings', {displayMode: 'wheel'})).displayMode, 'wheel');
  assert.equal((await (await fetch(url() + '/api/leaderboard')).json()).wheel.id, wheel.id);
  assert.equal((await call('team/sound', {sound: 9}, a.secret)).status, 400);
  await call('team/sound', {sound: 3}, a.secret); assert.equal((await call('state', {}, a.secret)).team.sound, 3);
}));

test('join details for the projector are validated and public', () => fixture(async ({call, url}) => {
  assert.equal((await call('host/settings', {joinSsid: ''})).status, 400);
  assert.equal((await call('host/settings', {joinUrl: 'javascript:alert(1)'})).status, 400);
  await call('host/settings', {joinSsid: 'Fox Quiz', joinUrl: 'http://10.42.0.1', displayMode: 'join'});
  const board = await (await fetch(url() + '/api/leaderboard')).json();
  assert.equal(board.settings.joinSsid, 'Fox Quiz'); assert.equal(board.settings.displayMode, 'join');
  assert.equal((await fetch(url() + '/qr.js')).status, 200);
}));

test('blocked names, keypad scrambling and bingo phrase settings', () => fixture(async ({call}) => {
  assert.equal((await call('join', {name: 'Sh1t Hot'})).status, 400);
  await call('host/settings', {blockedWords: 'llama\nalpaca'});
  assert.deepEqual((await call('host/state')).blockedWords, ['llama', 'alpaca']);
  assert.equal((await call('join', {name: 'Llama Drama'})).status, 400);
  assert.equal((await call('join', {name: 'Scunthorpe Quizzers'})).status, 200);
  assert.equal((await call('host/settings', {scrambleKeypads: 'yes'})).status, 400);
  const settings = await call('host/settings', {scrambleKeypads: true, bingoPhrases: false, displayMode: 'winner'});
  assert.deepEqual([settings.scrambleKeypads, settings.bingoPhrases, settings.displayMode], [true, false, 'winner']);
}));

test('team photos stay private until approved and are deleted when rejected', () => fixture(async ({call, url, teams}) => {
  const [a] = await teams('Alpha');
  const upload = (body, key = a.secret) => fetch(url() + '/api/team/photo', {method: 'POST', headers: {Authorization: 'Bearer ' + key}, body}).then(async r => ({status: r.status, ...await r.json()}));
  assert.equal((await upload(Buffer.from('not a jpeg'))).status, 400);
  assert.equal((await upload(Buffer.from([255, 216, 255, 224, 1, 2]), 'wrong')).status, 401);
  const {photo} = await upload(Buffer.from([255, 216, 255, 224, 1, 2]));
  assert.equal((await fetch(url() + photo)).status, 200);
  const board = async () => (await (await fetch(url() + '/api/leaderboard')).json()).teams[0].photo;
  assert.equal(await board(), null, 'pending photo hidden'); assert.equal((await call('state', {}, a.secret)).team.photoStatus, 'pending');
  await call('host/team', {id: a.id, action: 'approvePhoto'}); assert.equal(await board(), photo);
  await call('host/settings', {teamPhotos: false}); assert.equal(await board(), null);
  assert.equal((await upload(Buffer.from([255, 216, 255, 224]))).status, 403);
  await call('host/settings', {teamPhotos: true}); await call('host/team', {id: a.id, action: 'rejectPhoto'});
  assert.equal(await board(), null); assert.equal((await fetch(url() + photo)).status, 404);
}));

test('returning teams: a PIN from the quizmaster brings a team back with its photo and buzzer sound', () => fixture(async ({call, url, teams}) => {
  const [a, b] = await teams('Alpha', 'Bravo');
  const photo = (await fetch(url() + '/api/team/photo', {method: 'POST', headers: {Authorization: 'Bearer ' + a.secret}, body: Buffer.from([255, 216, 255, 224, 1, 2])}).then(r => r.json())).photo;
  await call('host/team', {id: a.id, action: 'approvePhoto'}); await call('team/sound', {sound: 5}, a.secret);
  const {id} = await call('host/open', {text: 'Capital of Wales?', type: 'text', seconds: 30, points: 1, answer: 'Cardiff'});
  await call('answer', {question: id, value: 'Cardiff'}, a.secret); await call('host/close');
  // Only teams that answered are remembered, when the quiz finishes.
  assert.deepEqual((await call('host/results')).regulars, []);
  await call('host/settings', {ended: true});
  const [alpha, ...others] = (await call('host/results')).regulars;
  assert.deepEqual([alpha.name, others.length, alpha.photo], ['Alpha', 0, photo]); assert.match(alpha.pin, /^\d{4}$/);
  // A new quiz: the photo is kept for the returning team, the PIN rejoins as the same team, straight past the waiting room.
  await call('host/new-event', {questions: 'keep'}); await call('host/settings', {waitingRoom: true});
  assert.equal((await fetch(url() + photo)).status, 200);
  const back = await call('transfer', {code: alpha.pin});
  const me = (await call('state', {}, back.secret)).team;
  assert.deepEqual([me.name, me.sound, me.photo, me.photoStatus, me.waiting], ['Alpha', 5, photo, 'approved', false]);
  // The PIN again (a second phone) gets the same team, not a second one.
  assert.equal((await call('transfer', {code: alpha.pin})).secret, back.secret);
  assert.equal((await call('host/state')).teams.length, 1);
  // Registration closed, or the name taken by a new team: the PIN says so.
  await call('host/new-event', {questions: 'keep'}); await call('host/settings', {waitingRoom: false});
  await teams('alpha'); assert.equal((await call('transfer', {code: alpha.pin})).status, 409);
  await call('host/new-event', {questions: 'keep'}); await call('host/settings', {registrationOpen: false});
  assert.equal((await call('transfer', {code: alpha.pin})).status, 409);
  // Forgetting a team stops its PIN and deletes its photo.
  await call('host/regulars/forget', {id: alpha.id});
  assert.equal((await call('transfer', {code: alpha.pin})).status, 403); assert.equal((await fetch(url() + photo)).status, 404);
  assert.equal(b.waiting, false);
}));

test('a new team waits to be let in unless the quizmaster switches the waiting room off', async () => {
  const quiz = createQuiz({plan: 'pro', database: ':memory:', hostKey, packDir: '/nonexistent', soundsDir: '/nonexistent'}); await new Promise(r => quiz.server.listen(0, '127.0.0.1', r));
  try {
    const team = await (await fetch(`http://127.0.0.1:${quiz.server.address().port}/api/join`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({name: 'Newcomers'})})).json();
    assert.equal(team.waiting, true);
  } finally {await quiz.close();}
});

test('sound clips: taps score only during the right clip, with a fading bonus', () => fixture(async ({call, url, teams, score, tick}) => {
  const [a, b, c] = await teams('Alpha', 'Bravo', 'Charlie');
  const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE'), Buffer.alloc(40)]);
  const key = (await call('login', {key: hostKey})).key, clips = [];
  for (let i = 0; i < 3; i++) clips.push({media: (await (await fetch(url() + `/api/host/media?name=c${i}.wav`, {method: 'POST', headers: {Authorization: 'Bearer ' + key}, body: wav})).json()).media, label: `Song ${i}`});
  assert.equal((await call('host/open', {...base, text: 'Tap for Song 1', type: 'clips', clips, targetClip: 5})).status, 400);
  await call('host/open', {...base, text: 'Tap for Song 1', type: 'clips', clips, targetClip: 1, points: 5, fastestFingers: true, speedBonus: 5});
  const q = (await call('state', {}, a.secret)).question;
  assert.equal(q.clips, undefined, 'clip files and labels hidden from phones'); assert.equal(q.clipGame.count, 3);
  assert.equal((await call('tap', {question: q.id}, a.secret)).status, 409, 'nothing playing yet');
  await call('host/clip', {question: q.id, clip: 0}); tick(500);
  await call('tap', {question: q.id}, c.secret);
  await call('host/clip', {question: q.id, clip: 1}); tick(2500);
  assert.equal((await call('tap', {question: q.id}, a.secret)).clip, 2);
  assert.equal((await call('tap', {question: q.id}, a.secret)).status, 409, 'one tap per team');
  assert.equal((await call('state', {}, a.secret)).question.clipGame.playing, 2);
  await call('host/clip', {question: q.id, clip: -1}); await call('tap', {question: q.id}, b.secret);
  await call('host/close');
  assert.equal(await score(a), 7); assert.equal(await score(b), 0); assert.equal(await score(c), 0);
}));

test('music bingo: song-title tickets, hidden current song, verified claims', () => fixture(async ({call, teams, score}) => {
  const [a] = await teams('Alpha');
  const songs = Array.from({length: 16}, (_, i) => ({title: `Song title ${i + 1}`}));
  assert.equal((await call('host/open', {...base, text: 'Music bingo', type: 'musicbingo', songs: songs.slice(0, 10)})).status, 400, 'needs 15 songs');
  await call('host/open', {...base, text: 'Music bingo', type: 'musicbingo', songs, mode: 'line', points: 4, fastestFingers: true, speedBonus: 2});
  let s = await call('state', {}, a.secret); const id = s.question.id, card = s.question.bingo.card;
  assert.equal(s.question.songs, undefined); assert.equal(card.length, 3); assert.equal(new Set(card.flat()).size, 15);
  const row = card[0]; let played = [];
  while (!row.every(t => played.includes(t))) {
    const {number} = await call('host/bingo', {question: id}); played.push(songs[number - 1].title);
    s = await call('state', {}, a.secret);
    assert.deepEqual(s.question.bingo.titles, played.slice(-2, -1), 'the song now playing stays hidden, and only the last one is shown');
    assert.equal((await call('host/state')).question.bingo.current.title, played.at(-1));
  }
  await call('bingo', {question: id}, a.secret);
  assert.equal((await call('host/bingo-verdict', {shout: (await call('host/state')).question.bingo.shouts[0].id, correct: true})).first, true);
  await call('host/close'); assert.equal(await score(a), 6);
  assert.deepEqual((await call('state', {}, a.secret)).question.bingo.titles, played, 'all titles shown once the game ends');
}));

test('word trail: adjacent traces only, go wide scores less; tiles assemble the answer', () => fixture(async ({call, teams, score}) => {
  const [a, b, c] = await teams('Alpha', 'Bravo', 'Charlie');
  await call('host/open', {...base, text: 'Tallest animal', type: 'wordsnake', answer: 'gir affe', points: 6, goWide: true, goWidePoints: 2});
  let s = await call('state', {}, a.secret); const id = s.question.id;
  assert.equal(s.question.snakePath, undefined); assert.equal(s.question.grid.letters.length, 16); assert.equal(s.question.answer, undefined);
  const path = (await call('host/state')).question.snakePath; assert.equal(path.map(i => s.question.grid.letters[i]).join(''), 'GIRAFFE');
  await call('answer', {question: id, value: path}, a.secret);
  assert.deepEqual((await call('gowide', {question: id}, b.secret)).cells, path);
  assert.deepEqual((await call('state', {}, b.secret)).question.wideCells, path);
  await call('answer', {question: id, value: path}, b.secret);
  const broken = [...path]; [broken[0], broken[broken.length - 1]] = [broken[broken.length - 1], broken[0]];
  await call('answer', {question: id, value: broken}, c.secret);
  await call('host/close'); assert.equal(await score(a), 6); assert.equal(await score(b), 2); assert.equal(await score(c), 0);

  await call('host/open', {...base, text: 'Disney film', type: 'tiles', answer: 'The Lion King', points: 5});
  s = await call('state', {}, a.secret); const tid = s.question.id;
  assert.deepEqual(s.question.wordLengths, [3, 4, 4]); assert.equal(s.question.tiles, undefined); assert.equal(s.question.pieces.join('').length, 11);
  const {tiles, pieces} = (await call('host/state')).question, used = new Set();
  const order = tiles.map(t => {const i = pieces.findIndex((p, j) => p === t && !used.has(j)); used.add(i); return i;});
  await call('answer', {question: tid, value: order}, a.secret); await call('answer', {question: tid, value: [...order].reverse()}, b.secret);
  await call('host/close'); assert.equal(await score(a), 11); assert.equal(await score(b), 2);
}));

test('50/50: half the wrong choices go for that team only; a right answer then scores the 50/50 points', () => fixture(async ({call, teams, score}) => {
  const [a, b, c] = await teams('Alpha', 'Bravo', 'Charlie');
  const options = ['Venus', 'Mars', 'Jupiter', 'Saturn'];
  assert.equal((await call('host/open', {...base, text: 'Red planet', type: 'choice', options: ['Venus', 'Mars'], answer: 'Mars', points: 3, fiftyFifty: true, fiftyPoints: 1})).status, 400, 'two choices: nothing to take away');
  await call('host/open', {...base, text: 'Red planet', type: 'choice', options, answer: 'Mars', points: 3, fiftyFifty: true, fiftyPoints: 1, fastestFingers: true, speedBonus: 2});
  let s = await call('state', {}, b.secret); const id = s.question.id;
  assert.equal(s.question.fiftyFifty, true); assert.equal(s.question.fiftyPoints, 1); assert.equal(s.question.fiftyRemoved, undefined);
  const {removed} = await call('fifty', {question: id}, b.secret);
  assert.equal(removed.length, 2); assert.ok(!removed.includes('Mars'), 'the right answer stays');
  assert.deepEqual(removed, [...removed].sort((x, y) => options.indexOf(x) - options.indexOf(y)));
  assert.deepEqual((await call('state', {}, b.secret)).question.fiftyRemoved, removed, 'the same each time');
  assert.equal((await call('state', {}, a.secret)).question.fiftyRemoved, undefined, 'only for the team that took it');
  await call('answer', {question: id, value: 'Mars'}, a.secret);
  await call('answer', {question: id, value: 'Mars'}, b.secret);
  assert.equal((await call('fifty', {question: id}, a.secret)).status, 409, 'not after answering');
  await call('fifty', {question: id}, c.secret); await call('answer', {question: id, value: 'Venus'}, c.secret);
  await call('host/close');
  assert.ok(await score(a) > 3, 'full points and a speed bonus without it');
  assert.equal(await score(b), 1, 'the 50/50 points, no speed bonus');
  assert.equal(await score(c), 0);
}));

test('4-digit codes move a team to a new phone once; notes and stats stay on the desk', () => fixture(async ({call, teams, tick}) => {
  const [a] = await teams('Alpha');
  const {code} = await call('host/team', {id: a.id, action: 'transfer'}); assert.match(code, /^\d{4}$/);
  assert.equal((await call('transfer', {code: code === '1234' ? '4321' : '1234'})).status, 403);
  assert.equal((await call('transfer', {code})).secret, a.secret);
  assert.equal((await call('transfer', {code})).status, 403, 'one use only');
  const late = (await call('host/team', {id: a.id, action: 'transfer'})).code; tick(5 * 60 * 1000 + 1);
  assert.equal((await call('transfer', {code: late})).status, 403, 'expires after five minutes');
  await call('host/team', {id: a.id, action: 'note', note: 'Table 4, birthday'});
  await call('host/open', {...base, text: 'Q', type: 'text', answer: 'yes'}); const id = (await call('state', {}, a.secret)).question.id;
  tick(1500); await call('answer', {question: id, value: 'yes'}, a.secret); await call('host/close');
  const t = (await call('host/state')).teams[0];
  assert.equal(t.note, 'Table 4, birthday'); assert.deepEqual(t.stats, {answered: 1, scored: 1, fastest: 1500});
  const board = await call('state', {}, a.secret); assert.equal(board.teams[0].note, undefined);
  for (let i = 0; i < 9; i++) await call('transfer', {code: '0000'});
  assert.equal((await call('transfer', {code: '0000'})).status, 429, 'guessing is rate limited');
}));

test('joined phones get "online" answers to OS checks, can continue in another browser, and leaving is reported', () => fixture(async ({call, url, tick}) => {
  const as = ip => ({'X-Test-Ip': ip});
  const post = (route, body, ip, key = '') => fetch(url() + '/api/' + route, {method: 'POST', headers: {...as(ip), Authorization: 'Bearer ' + key}, body: JSON.stringify(body)}).then(async r => ({status: r.status, ...await r.json()}));
  let r = await fetch(url() + '/generate_204', {headers: as('10.42.0.50')}); assert.equal(r.status, 200, 'unknown phone sees the sign-in page');
  const team = await post('join', {name: 'Phone team'}, '10.42.0.50');
  r = await fetch(url() + '/generate_204', {headers: as('10.42.0.50')}); assert.equal(r.status, 204);
  r = await fetch(url() + '/hotspot-detect.html', {headers: as('10.42.0.50')}); assert.match(await r.text(), /<TITLE>Success<\/TITLE>/);
  assert.equal((await fetch(url() + '/generate_204', {headers: as('10.42.0.51')})).status, 200, 'other phones still see the sign-in page');
  assert.equal((await fetch(url() + '/generate_204', {headers: as('127.0.0.1')})).status, 200, 'the laptop itself is never a team phone');
  assert.deepEqual((await post('device', {}, '10.42.0.50')).team, {name: 'Phone team'});
  assert.equal((await post('device', {}, '10.42.0.51')).team, null);
  assert.equal((await post('device/continue', {}, '10.42.0.50')).secret, team.secret);
  assert.equal((await post('device/continue', {}, '10.42.0.51')).status, 404);
  await call('host/settings', {onlineAfterJoin: false});
  assert.equal((await fetch(url() + '/generate_204', {headers: as('10.42.0.50')})).status, 200);

  await call('host/open', {...base, text: 'Q', type: 'text', answer: 'yes'}); const id = (await call('state', {}, team.secret)).question.id;
  await post('away', {question: id, state: 'left'}, '10.42.0.50', team.secret); tick(4000);
  let away = (await call('host/state')).away; assert.deepEqual(away, [{name: 'Phone team', count: 1, ms: 4000, awayNow: true}]);
  await post('away', {question: id, state: 'back'}, '10.42.0.50', team.secret);
  await post('away', {question: id, state: 'left'}, '10.42.0.50', team.secret); tick(1000); await call('host/close'); tick(9000);
  away = (await call('host/review', {question: id})).away; assert.deepEqual(away, [{name: 'Phone team', count: 2, ms: 5000, awayNow: false}], 'stops counting when the question closes');
}, {clientAddress: req => req.headers['x-test-ip'] || '127.0.0.1'}));

test('music bingo song timing: start time, play time and auto-next are validated and kept', async () => {
  const {validateQuestion} = await import('../server/model.js');
  const songs = Array.from({length: 15}, (_, i) => ({title: `Song ${i + 1}`}));
  const base = {text: 'Music bingo', type: 'musicbingo', seconds: 600, points: 1, songs, mode: 'line'};
  const q = validateQuestion({...base, startAt: 30, songSeconds: 20, autoNext: true}, '.');
  assert.deepEqual([q.startAt, q.songSeconds, q.autoNext], [30, 20, true]);
  assert.deepEqual((({startAt, songSeconds, autoNext}) => [startAt, songSeconds, autoNext])(validateQuestion(base, '.')), [0, 0, false]);
  assert.throws(() => validateQuestion({...base, autoNext: true}, '.'), /move on automatically/);
  assert.throws(() => validateQuestion({...base, songSeconds: 2}, '.'), /3–600 seconds/);
  // Each song can carry a Spotify link with its own start point and play time; links are stored as track ids.
  const id = '4uLU6hMCjMI75M1A2tKUQC', timed = songs.map((song, i) => ({...song, spotify: i % 2 ? `spotify:track:${id}` : `https://open.spotify.com/intl-gb/track/${id}?si=abc`, start: 30 + i, seconds: 20}));
  const checked = validateQuestion({...base, songs: timed, autoNext: true}, '.');
  assert.deepEqual(checked.songs[0], {title: songs[0].title, media: null, spotify: `spotify:track:${id}`, start: 30, seconds: 20});
  assert.equal(checked.autoNext, true, 'per-song play times allow auto-next');
  assert.throws(() => validateQuestion({...base, songs: [{...timed[0], spotify: 'https://example.com/track/x'}, ...timed.slice(1)]}, '.'), /Invalid Spotify track/);
  assert.throws(() => validateQuestion({...base, songs: [{...timed[0], seconds: 1}, ...timed.slice(1)]}, '.'), /3–600 seconds/);
});

test('full bingo game: line, then two lines, then full house, each paying its own points', () => fixture(async ({call, teams, score}) => {
  const players = await teams('Alpha', 'Bravo', 'Charlie');
  assert.equal((await call('host/open', {...base, text: 'Bingo', type: 'bingo', mode: 'progressive', stagePoints: [1, 2]})).status, 400);
  const {id} = await call('host/open', {...base, text: 'Full game', type: 'bingo', mode: 'progressive', stagePoints: [1, 2, 5]});
  const cards = await Promise.all(players.map(async p => (await call('state', {}, p.secret)).question.bingo.card));
  const lines = (card, called) => card.filter(row => row.every(n => n === null || called.includes(n))).length;
  const need = {line: 1, twoLines: 2, fullHouse: 3}, won = [], expected = new Map(players.map(p => [p.id, 0]));
  let skipped = false;
  for (let calls = 0; calls < 90; calls++) {
    assert.equal((await call('host/bingo', {question: id})).status, 200);
    const b = (await call('host/state')).question.bingo;
    for (const [i, p] of players.entries()) {
      if (lines(cards[i], b.called) < need[b.playingFor]) continue;
      // Bravo misses the first line it could claim: once the next number is called, that stage has moved on.
      if (i === 1 && b.playingFor === 'line' && !skipped && !b.stageWins.length) {skipped = true; continue;}
      assert.equal((await call('bingo', {question: id}, p.secret)).pending, true);
      const result = await call('host/bingo-verdict', {shout: (await call('host/state')).question.bingo.shouts.at(-1).id, correct: true});
      assert.equal(result.correct, true); won.push(result.stage); expected.set(p.id, expected.get(p.id) + {line: 1, twoLines: 2, fullHouse: 5}[result.stage]);
      assert.equal((await call('bingo', {question: id}, p.secret)).status, 409, 'one claim per stage');
    }
    if ((await call('state', {}, players[0].secret)).question.bingo.over) break;
  }
  const b = (await call('state', {}, players[2].secret)).question.bingo;
  assert.deepEqual([...new Set(won)], ['line', 'twoLines', 'fullHouse'], 'stages are won in order');
  assert.deepEqual(b.stageWins.map(w => w.stage), ['line', 'twoLines', 'fullHouse']); assert.equal(b.over, true); assert.equal(b.playingFor, null);
  assert.equal((await call('host/bingo', {question: id})).status, 409, 'no calls after the full house');
  await call('host/close');
  for (const p of players) assert.equal(await score(p), expected.get(p.id));
}));

test('sheet answers take alternatives; a tie-breaker scores nothing but orders teams level on points', () => fixture(async ({call, teams, score}) => {
  const [a, b, c] = await teams('Alpha', 'Bravo', 'Charlie');
  const sheet = await call('host/open', {...base, text: 'Sheet', type: 'sheet', items: ['Who wrote Hamlet?', 'Capital of Wales?'], itemAnswers: ['Shakespeare', 'Cardiff'], itemAliases: [['William Shakespeare'], []]});
  for (const [team, value] of [[a, ['william shakespeare', 'Cardiff']], [b, ['Shakespeare', 'Swansea']], [c, ['Marlowe', 'cardiff']]]) {await call('state', {}, team.secret); await call('answer', {question: sheet.id, value}, team.secret);}
  await call('host/close');
  assert.deepEqual([await score(a), await score(b), await score(c)], [2, 1, 1], 'an alternative answer counts');
  const tie = await call('host/open', {...base, text: 'Tie-breaker: the year of the Battle of Hastings?', type: 'nearest', answer: '1066', tieBreaker: true});
  for (const [team, value] of [[a, '2000'], [b, '1100'], [c, '1060']]) {await call('state', {}, team.secret); await call('answer', {question: tie.id, value}, team.secret);}
  const ranks = async () => (await call('host/state')).teams.map(t => [t.name, t.rank]);
  assert.deepEqual(await ranks(), [['Alpha', 1], ['Bravo', 2], ['Charlie', 2]], 'level until the tie-breaker closes');
  await call('host/close');
  assert.deepEqual([await score(a), await score(b), await score(c)], [2, 1, 1], 'the tie-breaker scores nothing');
  assert.deepEqual(await ranks(), [['Alpha', 1], ['Charlie', 2], ['Bravo', 3]], 'closest of the level teams goes ahead');
  await call('host/reveal', {question: tie.id});
  const q = (await call('state', {}, a.secret)).question;
  assert.deepEqual(q.scorers.map(s => [s.name, s.answer]), [['Charlie', '1060'], ['Bravo', '1100'], ['Alpha', '2000']], 'every answer, closest first');
  assert.deepEqual([q.first.kind, q.first.name, q.first.answer], ['tieBreaker', 'Charlie', '1060'], 'the winner fills the TV');
}));

test('audio questions can play a Spotify clip instead of a file', async () => {
  const {validateQuestion} = await import('../server/model.js');
  const id = '4uLU6hMCjMI75M1A2tKUQC', base = {text: 'Name the artist', type: 'audio', seconds: 30, points: 1, answer: 'Queen'};
  assert.deepEqual(validateQuestion({...base, clip: {spotify: `https://open.spotify.com/track/${id}?si=x`, start: 60, seconds: 15}}, '.').clip, {spotify: `spotify:track:${id}`, start: 60, seconds: 15});
  assert.deepEqual(validateQuestion({...base, clip: {spotify: `spotify:track:${id}`}}, '.').clip, {spotify: `spotify:track:${id}`, start: 0, seconds: 30});
  assert.throws(() => validateQuestion(base, '.'), /media file/, 'needs a file or a clip');
  assert.throws(() => validateQuestion({...base, clip: {spotify: 'https://example.com/x'}}, '.'), /Spotify clip/);
  assert.throws(() => validateQuestion({...base, clip: {spotify: `spotify:track:${id}`, seconds: 1}}, '.'), /Spotify clip/);
});

test('one song, artist and title marked separately: each part a point, the points shared, or all-or-nothing', () => fixture(async ({call, teams, score}) => {
  const [a, b] = await teams('Alpha', 'Bravo'), clip = {spotify: 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC', start: 50, seconds: 20};
  const song = scoring => ({text: 'Name the artist and the song', type: 'sheet', seconds: 30, points: 1, clip, items: ['Artist', 'Title'], itemAnswers: ['Queen', 'Bohemian Rhapsody'], itemAliases: [[], ['Bohemian Rhapsody (Remastered)']], partScoring: scoring});
  const play = async (scoring, answers) => {
    const before = [await score(a), await score(b)], {id} = await call('host/open', song(scoring));
    for (const [team, value] of [[a, answers[0]], [b, answers[1]]]) {await call('state', {}, team.secret); await call('answer', {question: id, value}, team.secret);}
    await call('host/close');
    return [(await score(a)) - before[0], (await score(b)) - before[1]];
  };
  assert.deepEqual(await play('each', [['queen', 'Bohemian Rhapsody'], ['Queen', 'We Will Rock You']]), [2, 1]);
  assert.deepEqual(await play('split', [['queen', 'bohemian rhapsody (remastered)'], ['Queen', 'We Will Rock You']]), [1, 0.5]);
  assert.deepEqual(await play('all', [['Queen', 'Bohemian Rhapsody'], ['Queen', 'Radio Ga Ga']]), [1, 0]);
  // The desk can correct a part by hand; the question's scoring still applies.
  const {id} = await call('host/open', song('split'));
  await call('state', {}, b.secret); await call('answer', {question: id, value: ['Freddie Mercury', 'Bohemian Rhapsody']}, b.secret); await call('host/close');
  const before = await score(b); await call('host/mark', {question: id, team: b.id, marks: [1, 1]});
  assert.equal(await score(b), before + 0.5);
  assert.equal((await call('state', {}, a.secret)).question.clip, undefined, 'phones never see the track');
}));
