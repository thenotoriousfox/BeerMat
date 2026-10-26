// Makes the Halloween sound theme (sounds/Themes/Halloween/) from scratch: pipe organ, church bells, theremin, a music
// box and timpani, all synthesised here, so the files are PubQuiz's own (CC0, see sounds/CREDITS.md).
// Needs ffmpeg. Run again after changing it: node scripts/halloween-sounds.mjs
import {writeFileSync, mkdirSync, rmSync, mkdtempSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';

const RATE = 44100, out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'sounds', 'Themes', 'Halloween');
const note = name => {
  const [, letter, accidental, octave] = /^([A-G])(#|b)?(\d)$/.exec(name);
  const semis = {C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2}[letter] + (accidental === '#' ? 1 : accidental === 'b' ? -1 : 0);
  return 440 * 2 ** ((semis + (Number(octave) - 4) * 12) / 12);
};
const buffer = seconds => new Float64Array(Math.ceil(seconds * RATE));
// A fixed-seed generator, so every run makes the same files.
let seed = 1;
const random = () => ((seed = Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x6d2b79f5 | 0) >>> 0) / 2 ** 32;

// Adds a tone into `buf` at `at` seconds: `partials` are [ratio, level, decay per second].
function tone(buf, at, freq, length, {partials = [[1, 1, 0]], attack = .01, release = .2, vibrato = 0, rate = 5, glide = null, level = .3} = {}) {
  const start = Math.floor(at * RATE), n = Math.floor((length + release) * RATE), phases = partials.map(() => random() * Math.PI * 2);
  for (let i = 0; i < n && start + i < buf.length; i++) {
    const t = i / RATE, f = (glide ? freq * (glide / freq) ** Math.min(1, t / length) : freq) * (1 + vibrato * Math.sin(2 * Math.PI * rate * t));
    const env = Math.min(1, t / attack) * (t > length ? Math.max(0, 1 - (t - length) / release) : 1);
    let s = 0;
    partials.forEach(([ratio, amp, decay], k) => {phases[k] += 2 * Math.PI * f * ratio / RATE; s += amp * Math.exp(-decay * t) * Math.sin(phases[k]);});
    buf[start + i] += level * env * s;
  }
}
const organ = {partials: [[.5, .5, 0], [1, 1, 0], [2, .6, 0], [3, .35, 0], [4, .25, 0], [6, .12, 0], [8, .08, 0]], attack: .03, release: .35, vibrato: .002, rate: 6};
// A church bell's partials: hum, prime, minor third, fifth, nominal and above, the higher ones fading faster.
const bell = {partials: [[.5, .7, .6], [1, 1, .9], [1.19, .55, 1.2], [1.5, .35, 1.4], [2, .5, 1.6], [2.51, .25, 2.2], [3.01, .2, 2.8], [4.07, .1, 3.5]], attack: .004, release: .3};
const musicBox = {partials: [[1, 1, 3], [2.01, .35, 6], [4.03, .15, 9], [5.4, .08, 14]], attack: .002, release: .15};
const theremin = {partials: [[1, 1, 0], [2, .08, 0], [3, .04, 0]], attack: .12, release: .25, vibrato: .012, rate: 6.2};

function noiseHit(buf, at, length, {level = .4, low = .02} = {}) {
  const start = Math.floor(at * RATE); let lp = 0;
  for (let i = 0; i < length * RATE && start + i < buf.length; i++) {lp += low * ((random() * 2 - 1) - lp); buf[start + i] += level * lp * Math.exp(-6 * i / RATE / length);}
}
function timpani(buf, at, freq, level = .5) {tone(buf, at, freq, .02, {partials: [[1, 1, 3], [1.5, .5, 5], [1.99, .3, 6], [2.44, .2, 8]], release: 1.2, level}); noiseHit(buf, at, .25, {level: level * 1.6, low: .05});}
// A large-room echo: a few feedback delays mixed back in.
function hall(buf, mix = .3) {
  const taps = [[.043, .5], [.071, .45], [.113, .4], [.157, .35]].map(([s, g]) => [Math.floor(s * RATE), g]), wet = new Float64Array(buf.length);
  for (const [d, g] of taps) {const line = new Float64Array(buf.length); for (let i = 0; i < buf.length; i++) {line[i] = buf[i] + (i >= d ? g * line[i - d] : 0); wet[i] += line[i] / taps.length;}}
  for (let i = 0; i < buf.length; i++) buf[i] = buf[i] * (1 - mix) + wet[i] * mix;
}
function write(name, buf, {loop = false} = {}) {
  // As loud as the standard sounds (about -16 dB average), never clipping.
  let peak = 0, power = 0; for (const s of buf) {peak = Math.max(peak, Math.abs(s)); power += s * s;}
  const gain = Math.min(.89 / (peak || 1), 10 ** (-16 / 20) / (Math.sqrt(power / buf.length) || 1)), fade = Math.floor((loop ? .01 : .05) * RATE), pcm = Buffer.alloc(44 + buf.length * 2);
  for (let i = 0; i < buf.length; i++) {const edge = Math.min(1, i / (loop ? fade : 1), (buf.length - 1 - i) / fade); pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, buf[i] * gain * edge)) * 32767), 44 + i * 2);}
  pcm.write('RIFF', 0); pcm.writeUInt32LE(36 + buf.length * 2, 4); pcm.write('WAVEfmt ', 8); pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(1, 22);
  pcm.writeUInt32LE(RATE, 24); pcm.writeUInt32LE(RATE * 2, 28); pcm.writeUInt16LE(2, 32); pcm.writeUInt16LE(16, 34); pcm.write('data', 36); pcm.writeUInt32LE(buf.length * 2, 40);
  const wav = path.join(work, name + '.wav'); writeFileSync(wav, pcm);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', wav, '-ac', '1', '-codec:a', 'libmp3lame', '-q:a', '4', path.join(out, name + '.mp3')]);
  console.log(`${name}.mp3  ${(buf.length / RATE).toFixed(1)} s`);
}

const work = mkdtempSync(path.join(os.tmpdir(), 'pubquiz-halloween-'));
mkdirSync(out, {recursive: true});
try {
  // Start of a round: the organ's famous-sounding flourish and a D minor chord.
  let b = buffer(5);
  [['A5', 0, .12], ['G5', .14, .12], ['A5', .28, .7], ['G5', 1.1, .1], ['F5', 1.22, .1], ['E5', 1.34, .1], ['D5', 1.46, .1], ['C#5', 1.58, .35], ['D5', 2.05, .4]]
    .forEach(([n, at, len]) => {tone(b, at, note(n), len, organ); tone(b, at, note(n) / 2, len, {...organ, level: .2});});
  for (const n of ['D3', 'A3', 'D4', 'F4', 'A4', 'D5']) tone(b, 2.5, note(n), 1.6, {...organ, level: .16, release: .9});
  hall(b, .35); write('start_round', b);

  // A question opens: one toll of a deep bell.
  b = buffer(3.5); tone(b, 0, note('E3'), .01, {...bell, release: 3.3, level: .5}); hall(b, .25); write('question_start', b);

  // While teams answer: a music box in A minor over a low drone, made to loop (24 s).
  b = buffer(24);
  const tune = ['E5', 'A5', 'C6', 'B5', 'A5', 'E5', 'F5', 'E5', 'D5', 'E5', 'C5', 'B4', 'A4', 'C5', 'E5', 'D#5', 'E5', 'B4', 'C5', 'A4', 'G#4', 'B4', 'E5', 'E4'];
  tune.forEach((n, i) => {tone(b, i * 1, note(n), .02, {...musicBox, release: .95, level: .22}); if (i % 3 === 0) tone(b, i + .5, note(n) / 2, .02, {...musicBox, release: .9, level: .12});});
  for (const [n, at] of [['A2', 0], ['F2', 6], ['D2', 12], ['E2', 18]]) tone(b, at, note(n), 5.6, {partials: [[1, 1, 0], [1.5, .3, 0], [2, .2, 0]], attack: 1.2, release: .4, vibrato: .003, rate: .3, level: .1});
  write('question_music', b, {loop: true});

  // Time's up: midnight strikes (three tolls).
  b = buffer(5.5); for (const at of [0, 1.2, 2.4]) tone(b, at, note('C3'), .01, {...bell, release: 3, level: .45}); hall(b, .3); write('time_up', b);

  // End of a round: an organ cadence, minor plagal into D minor.
  b = buffer(4.5);
  [[['G3', 'Bb3', 'D4', 'G4'], 0, .8], [['A3', 'C#4', 'E4', 'A4'], .9, .8], [['D3', 'A3', 'D4', 'F4', 'A4'], 1.8, 1.6]]
    .forEach(([chord, at, len]) => chord.forEach(n => tone(b, at, note(n), len, {...organ, level: .14})));
  hall(b, .35); write('end_round', b);

  // Right answer: a spell going off (a rising minor arpeggio with a shimmer).
  b = buffer(1.6);
  ['A4', 'C5', 'E5', 'A5', 'C6'].forEach((n, i) => tone(b, i * .07, note(n), .25, {partials: [[1, 1, 2], [2, .3, 4], [3, .15, 6]], release: .5, vibrato: .006, rate: 9, level: .25}));
  tone(b, .35, note('E6'), .5, {partials: [[1, 1, 3], [2.76, .3, 6]], release: .4, vibrato: .01, rate: 12, level: .12});
  hall(b, .25); write('correct', b);

  // Wrong answer: a theremin sliding down, "woo-ooo".
  b = buffer(1.6); tone(b, 0, note('E5'), 1.1, {...theremin, glide: note('A3'), level: .45}); hall(b, .2); write('incorrect', b);

  // Before a reveal: a timpani roll growing to a hit and an organ stab (about 3 s, so the reveal waits briefly).
  b = buffer(3.6);
  for (let t = 0, i = 0; t < 2.4; t += .055 - t * .008, i++) timpani(b, t, note('D2'), .08 + .3 * (t / 2.4));
  timpani(b, 2.5, note('D2'), .7);
  for (const n of ['D3', 'F3', 'A3', 'D4']) tone(b, 2.5, note(n), .5, {...organ, level: .12, release: .5});
  hall(b, .25); write('drum_roll', b);
} finally {rmSync(work, {recursive: true, force: true});}
