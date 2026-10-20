#!/usr/bin/env node
// Loads a rehearsal quiz into a running PubQuiz server: six rounds that between them use every question format
// and the main options (Evil Mode, fastest fingers first, go wide, buzzers, bingo, clips, music bingo, a sheet).
// Every picture and sound is generated here, so nothing needs downloading.
//
//   HOST_KEY=… node scripts/load-test-quiz.mjs [http://localhost:3000]   load into a running server
//   node scripts/load-test-quiz.mjs --json examples/test-quiz.json         write a quiz file with the media inside
//
// Loading adds the rounds to the saved quiz (rounds from an earlier run are replaced); nothing else is changed.
// The JSON file loads on the desk with Build quiz → Import quiz JSON, or End quiz & start next → Load a quiz file.
import {deflateSync, crc32} from 'node:zlib';
import {writeFileSync} from 'node:fs';
import {createInterface} from 'node:readline/promises';

const jsonOut = process.argv[2] === '--json' ? process.argv[3] || 'test-quiz.json' : null;
const base = (jsonOut ? '' : process.argv[2] || process.env.QUIZ_URL || 'http://localhost:3000').replace(/\/$/, '');
const PREFIX = 'test-';

// --- Generated media -------------------------------------------------------------------------------------------
function png(width, height, paint) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) raw.set(paint(x, y), y * (width * 3 + 1) + 1 + x * 3);
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]), length = Buffer.alloc(4), crc = Buffer.alloc(4);
    length.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(body)); return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const navy = [22, 32, 51], orange = [255, 155, 64], white = [243, 244, 246];
// A big orange triangle on navy.
const triangle = png(640, 400, (x, y) => y > 60 && y < 340 && Math.abs(x - 320) < (y - 60) * 0.85 ? orange : navy);
// A map-like grid with coloured dots; the red one is the pinpoint target.
const dots = [[0.18, 0.3, [61, 139, 226]], [0.42, 0.72, [31, 157, 85]], [0.72, 0.35, [226, 72, 61]], [0.86, 0.78, [226, 193, 61]], [0.3, 0.8, [160, 100, 220]]];
const pinMap = png(640, 400, (x, y) => {
  for (const [dx, dy, colour] of dots) if ((x - dx * 640) ** 2 + (y - dy * 400) ** 2 < 24 ** 2) return colour;
  return x % 64 < 2 || y % 64 < 2 ? [60, 74, 98] : navy;
});
// Mono 16-bit WAV from a list of [frequency Hz (0 = silence), seconds].
function wav(notes) {
  // 8 kHz keeps the quiz file small; these are only beeps and simple tunes.
  const rate = 8000, samples = notes.flatMap(([freq, seconds]) => Array.from({length: Math.round(rate * seconds)}, (_, i) => {
    const fade = Math.min(1, i / 300, (rate * seconds - i) / 300);
    return freq ? Math.round(Math.sin(2 * Math.PI * freq * i / rate) * 9000 * fade) : 0;
  }));
  const data = Buffer.alloc(samples.length * 2); samples.forEach((s, i) => data.writeInt16LE(s, i * 2));
  const head = Buffer.alloc(44);
  head.write('RIFF'); head.writeUInt32LE(36 + data.length, 4); head.write('WAVEfmt ', 8); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
  head.writeUInt32LE(rate, 24); head.writeUInt32LE(rate * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34); head.write('data', 36); head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}
const beeps = (count, freq = 880) => wav([[0, 0.4], ...Array.from({length: count}, () => [[freq, 0.25], [0, 0.35]]).flat()]);
// Thirty short, original "songs" for music bingo (a ticket holds 15, so teams get different ones): each title has its
// own little tune, built from a seed so it is the same every time.
const titles = ['Rising Scale', 'Falling Scale', 'Doorbell Waltz', 'Siren Song', 'Three Blind Beeps', 'Up and Down', 'Low Hum', 'High Twinkle', 'Morse Code', 'The Long Note',
  'Fifths Forever', 'Bouncing Ball', 'Lullaby Steps', 'Fanfare', 'Last Orders', 'Pub Garden Polka', 'Quiz Night Blues', 'Pint Glass Waltz', 'Jukebox Jive', 'Bar Stool Boogie',
  'Darts Final', 'Crisps and Gravy', 'Closing Time Shuffle', 'The Landlord’s March', 'Beer Mat Bossa', 'Raffle Ticket Rag', 'Snug Bar Serenade', 'Table Seven Tango', 'Happy Hour Hop', 'Encore'];
const scale = [262, 294, 330, 349, 392, 440, 494, 523, 587, 659];
const songs = titles.map((title, n) => {
  let seed = n * 7919 + 13; const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const notes = Array.from({length: 6 + (n % 3)}, () => scale[Math.floor(next() * scale.length)]);
  return [title, wav(notes.flatMap(f => [[f, 0.3], [0, 0.05]]))];
});

// --- Server calls (or, with --json, media embedded as data: URLs) --------------------------------------------------
let key = process.env.HOST_KEY;
if (!key && !jsonOut) {const rl = createInterface({input: process.stdin, output: process.stdout}); key = await rl.question('Quizmaster key: '); rl.close();}
async function api(route, body, headers = {}) {
  let response;
  try {response = await fetch(base + '/api/' + route, {method: 'POST', headers: {'Content-Type': 'application/json', ...headers}, body: Buffer.isBuffer(body) ? body : JSON.stringify(body)});}
  catch {console.error(`Could not reach ${base}. Start the quiz server first (./scripts/start.sh).`); process.exit(1);}
  const data = await response.json();
  if (!response.ok) {console.error(`${route}: ${data.error}`); process.exit(1);}
  return data;
}
const session = jsonOut ? null : (await api('login', {key})).key, auth = {Authorization: 'Bearer ' + session};
const upload = async (name, data) => jsonOut ? `data:${name.endsWith('.png') ? 'image/png' : 'audio/wav'};base64,${data.toString('base64')}`
  : (await api('host/media?name=' + encodeURIComponent(name), data, auth)).media;
if (!jsonOut) console.log('Uploading generated pictures and sounds…');
const media = {triangle: await upload('triangle.png', triangle), map: await upload('map.png', pinMap), fourBeeps: await upload('four-beeps.wav', beeps(4, 660))};
const clipBeeps = [2, 5, 3, 1, 4], clips = [];
for (const [i, n] of clipBeeps.entries()) clips.push({media: await upload(`clip-${i + 1}.wav`, beeps(n, 520 + i * 90)), label: `${n} beeps`});
const songList = [];
for (const [title, data] of songs) songList.push({title, media: await upload(title.toLowerCase().replace(/\W+/g, '-') + '.wav', data)});

// --- The quiz ----------------------------------------------------------------------------------------------------
let n = 0;
const q = (type, text, fields) => ({id: `${PREFIX}q${++n}`, type, text, seconds: 30, points: 1, ...fields});
const rounds = [
  {title: 'Round 1 · Keypad warm-up', questions: [
    q('choice', 'Which planet is known as the Red Planet?', {seconds: 20, options: ['Venus', 'Mars', 'Jupiter', 'Saturn'], answer: 'Mars', answerNote: 'Iron oxide (rust) in its soil makes it red.'}),
    q('multi', 'Tick every prime number', {seconds: 25, points: 3, options: ['2', '4', '7', '9', '11', '15'], correct: ['2', '7', '11']}),
    q('letter', 'Tap the first letter of the capital of Italy', {seconds: 15, answer: 'R', answerNote: 'Rome'}),
    q('number', 'How many sides does a hexagon have?', {seconds: 15, answer: '6'}),
    q('sequence', 'Put these planets in order, nearest the Sun first', {seconds: 30, points: 2, items: ['Mercury', 'Venus', 'Earth', 'Mars']}),
  ]},
  {title: 'Round 2 · Eyes and ears', questions: [
    q('text', 'What is the capital of Australia?', {answer: 'Canberra', answerNote: 'Not Sydney!'}),
    q('picture', 'What shape is on the screen?', {media: media.triangle, answer: 'Triangle', aliases: ['A triangle']}),
    q('audio', 'Listen: how many beeps do you hear?', {media: media.fourBeeps, answer: '4', aliases: ['four'], answerNote: 'Four beeps'}),
    q('vote', 'Vote: the best pub snack?', {seconds: 20, points: 0, options: ['Crisps', 'Pork scratchings', 'Peanuts', 'Scampi fries']}),
  ]},
  {title: 'Round 3 · Speed and skill', questions: [
    q('nearest', 'Nearest wins: in what year did the Titanic sink?', {answer: '1912', points: 3, places: 3}),
    q('pinpoint', 'Tap the red dot on the map', {media: media.map, points: 2, target: {x: 0.72, y: 0.35, r: 0.05, aspect: 0.625}, goWide: true, goWidePoints: 1}),
    q('wordsnake', 'Trace the capital of England', {seconds: 45, points: 2, answer: 'LONDON', goWide: true, goWidePoints: 1}),
    q('tiles', 'Rebuild the answer: a famous London clock', {seconds: 45, points: 2, answer: 'Big Ben'}),
    q('choice', 'FASTEST FINGERS: Which is the largest ocean?', {seconds: 20, options: ['Atlantic', 'Indian', 'Pacific', 'Arctic'], answer: 'Pacific', fastestFingers: true, speedBonus: 3}),
    q('text', 'EVIL MODE: What is the chemical symbol for gold? (A wrong answer loses 2 points, and only the single fastest right answer gets the 2-point bonus)', {points: 2, answer: 'Au', evil: true, fastestFingers: true, speedBonus: 2, bonusMode: 'fixed', bonusPlaces: 1}),
  ]},
  {title: 'Round 4 · On the buzzer', questions: [
    q('buzzer', 'Classic buzzer: which band sang “Wonderwall”?', {seconds: 20, points: 2, answer: 'Oasis', variation: 'classic', penalty: 1}),
    q('buzzer', 'Advanced buzzer: what is the largest planet in the Solar System?', {seconds: 20, points: 2, answer: 'Jupiter', variation: 'advanced', penalty: 1, passPenalty: 0, agreePoints: 1, agreeSeconds: 10}),
  ]},
  {title: 'Round 5 · Games', questions: [
    q('clips', 'Sound clips: tap during the clip with THREE beeps', {seconds: 300, points: 3, clips, targetClip: clipBeeps.indexOf(3), fastestFingers: true, speedBonus: 2}),
    q('bingo', 'Bingo! Eyes down — a full game: one line, two lines, then full house', {seconds: 1800, mode: 'progressive', stagePoints: [2, 3, 5], fastestFingers: true, speedBonus: 2}),
    q('musicbingo', 'Music bingo: dab each tune as you recognise it — line, two lines, then full house', {seconds: 1800, mode: 'progressive', stagePoints: [2, 3, 5], songs: songList, revealNow: false, startAt: 0, songSeconds: 4, autoNext: true}),
  ]},
  {title: 'Round 6 · Paper round', questions: [
    q('sheet', 'Five quick ones — fill in the sheet', {seconds: 180, items: ['Capital of France', 'What is 2 + 2 × 2?', 'Who wrote Hamlet?', 'Chemical formula for water', 'How many continents are there?'],
      itemAnswers: ['Paris', '6', 'Shakespeare', 'H2O', '7']}),
  ]},
].map((round, i) => ({id: `${PREFIX}round-${i + 1}`, ...round}));

if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify({title: 'Test quiz', rounds}) + '\n');
  console.log(`Wrote ${jsonOut}: ${rounds.length} rounds, ${n} questions, pictures and sounds included.`);
  process.exit(0);
}
const library = await api('host/library', {}, auth);
const kept = library.rounds.filter(r => !r.id.startsWith(PREFIX));
const saved = await api('host/library/save', {revision: library.revision, quiz: {title: library.rounds.length && kept.length ? library.title : 'Test quiz', rounds: [...kept, ...rounds]}}, auth);
console.log(`Loaded ${rounds.length} test rounds (${n} questions) into “${saved.title}”${kept.length ? `, after your ${kept.length} existing round${kept.length === 1 ? '' : 's'}` : ''}.`);
console.log('Open the desk (Build quiz) to look through them, or press Start next question on Run quiz.');
