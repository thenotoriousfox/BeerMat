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

test('multi-tap scores right ticks minus wrong ticks; pinpoint scores taps and go-wide', () => fixture(async ({call, teams, score, url}) => {
  const [a, b, c] = await teams('Alpha', 'Bravo', 'Charlie');
  await call('host/open', {...base, text: 'Tick the primes', type: 'multi', options: ['2', '3', '4', '5'], correct: ['2', '3', '5'], points: 9, speedBonus: 3});
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
  await call('host/open', {...base, text: 'Bingo — one line', type: 'bingo', mode: 'line', points: 5, speedBonus: 3});
  let s = await call('state', {}, a.secret); const id = s.question.id, card = s.question.bingo.card;
  assert.deepEqual((await call('state', {}, a.secret)).question.bingo.card, card, 'ticket is stable');
  assert.equal(card.flat().filter(Boolean).length, 15); assert.ok(card.every(row => row.filter(Boolean).length === 5));
  assert.equal((await call('bingo', {question: id}, a.secret)).status, 409, 'false claim refused');
  const row = new Set(card[0].filter(Boolean)); let calls = 0;
  while ([...row].some(n => !(s.question.bingo.called.includes(n)))) {assert.equal((await call('host/bingo', {question: id})).status, 200); calls++; s = await call('state', {}, a.secret);}
  assert.equal(new Set(s.question.bingo.called).size, calls);
  assert.equal((await call('bingo', {question: id}, a.secret)).first, true);
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

test('sound clips: taps score only during the right clip, with a fading bonus', () => fixture(async ({call, url, teams, score, tick}) => {
  const [a, b, c] = await teams('Alpha', 'Bravo', 'Charlie');
  const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE'), Buffer.alloc(40)]);
  const key = (await call('login', {key: hostKey})).key, clips = [];
  for (let i = 0; i < 3; i++) clips.push({media: (await (await fetch(url() + `/api/host/media?name=c${i}.wav`, {method: 'POST', headers: {Authorization: 'Bearer ' + key}, body: wav})).json()).media, label: `Song ${i}`});
  assert.equal((await call('host/open', {...base, text: 'Tap for Song 1', type: 'clips', clips, targetClip: 5})).status, 400);
  await call('host/open', {...base, text: 'Tap for Song 1', type: 'clips', clips, targetClip: 1, points: 5, speedBonus: 5});
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
  await call('host/open', {...base, text: 'Music bingo', type: 'musicbingo', songs, mode: 'line', points: 4, speedBonus: 2});
  let s = await call('state', {}, a.secret); const id = s.question.id, card = s.question.bingo.card;
  assert.equal(s.question.songs, undefined); assert.equal(card.length, 3); assert.equal(new Set(card.flat()).size, 15);
  const row = card[0]; let played = [];
  while (!row.every(t => played.includes(t))) {
    const {number} = await call('host/bingo', {question: id}); played.push(songs[number - 1].title);
    s = await call('state', {}, a.secret);
    assert.deepEqual(s.question.bingo.titles, played.slice(0, -1), 'the song now playing stays hidden');
    assert.equal((await call('host/state')).question.bingo.current.title, played.at(-1));
  }
  assert.equal((await call('bingo', {question: id}, a.secret)).first, true);
  await call('host/close'); assert.equal(await score(a), 6);
  assert.deepEqual((await call('state', {}, a.secret)).question.bingo.titles, played, 'all titles shown once the game ends');
}));

test('word snake: adjacent traces only, go wide scores less; tiles assemble the answer', () => fixture(async ({call, teams, score}) => {
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
