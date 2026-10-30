// Shared quizzes: what a quiz must be before BeerMat Online stores it or a laptop downloads it. A shared quiz is one
// BeerMat quiz file with its pictures and sounds inside it (data: URLs), as the desk's Save as file… writes it, so it
// loads on any laptop. Every question goes through the quiz engine's own checks (server/model.js validateLibrary), and
// every picture and sound is checked to be what it says it is; nothing the file says about itself is trusted.
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {createHash} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {validateLibrary} from '../server/model.js';

export const QUIZ_LIMITS = {bytes: 25 * 1024 * 1024, media: 8 * 1024 * 1024, description: 300};
const TYPES = {'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'audio/mpeg': '.mp3', 'audio/ogg': '.ogg', 'audio/wav': '.wav', 'audio/x-wav': '.wav', 'audio/wave': '.wav'};
const DATA_URL = /^data:([a-z/-]+);base64,([A-Za-z0-9+/]*={0,2})$/;
const FORMAT_NAMES = {text: 'Typed answer', choice: 'Multiple choice', multi: 'Tick all that apply', letter: 'Letter keypad', number: 'Number',
  nearest: 'Nearest wins', sequence: 'Put in order', pinpoint: 'Pinpoint', wordsnake: 'Word trail', tiles: 'Letter tiles', vote: 'Vote',
  buzzer: 'Buzzer', bingo: 'Bingo', musicbingo: 'Music bingo', clips: 'Sound clips', picture: 'Picture', audio: 'Audio', sheet: 'Answer sheet'};

// The bytes are the kind of file the data: URL says.
function looksLike(type, b) {
  const ascii = (from, to) => b.subarray(from, to).toString('latin1');
  if (type === 'image/png') return ascii(0, 4) === '\x89PNG';
  if (type === 'image/jpeg') return b[0] === 0xff && b[1] === 0xd8;
  if (type === 'image/webp') return ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
  if (type === 'audio/mpeg') return ascii(0, 3) === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0);
  if (type === 'audio/ogg') return ascii(0, 4) === 'OggS';
  return ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE';
}

// Every place a quiz keeps a picture or sound: a question's, a sound clip's, a music bingo song's.
const holders = quiz => {
  const questions = (Array.isArray(quiz?.rounds) ? quiz.rounds : []).flatMap(r => Array.isArray(r?.questions) ? r.questions.filter(q => q && typeof q === 'object') : []);
  return [...questions, ...questions.flatMap(q => [...(Array.isArray(q.clips) ? q.clips : []), ...(Array.isArray(q.songs) ? q.songs : [])].filter(x => x && typeof x === 'object'))];
};

/** The quiz, checked and cleaned (only what the quiz engine keeps), with a summary for the library. Throws an Error
 *  saying what's wrong. */
export function checkQuizFile(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Not a BeerMat quiz file');
  const quiz = JSON.parse(JSON.stringify(input));
  // Each picture and sound becomes a file the quiz engine can check (it checks files exist), then goes back inside.
  const dir = mkdtempSync(path.join(os.tmpdir(), 'beermat-shared-quiz-')), inside = new Map();
  try {
    for (const holder of holders(quiz)) {
      if (holder.media === undefined || holder.media === null || holder.media === '') continue;
      if (typeof holder.media !== 'string') throw Error('A picture or sound in the quiz isn’t one');
      if (inside.has(holder.media)) {holder.media = inside.get(holder.media).path; continue;}
      const match = DATA_URL.exec(holder.media);
      if (!match) throw Error('Every picture and sound must be inside the quiz file: save it from the desk’s Quizzes page with Save as file…');
      const [, type, base64] = match, bytes = Buffer.from(base64, 'base64');
      if (!TYPES[type]) throw Error(`${type} files can’t go in a shared quiz (PNG, JPEG, WebP, MP3, Ogg or WAV)`);
      if (bytes.length > QUIZ_LIMITS.media) throw Error(`A picture or sound is over ${QUIZ_LIMITS.media / 1024 / 1024} MB`);
      if (!looksLike(type, bytes)) throw Error(`A file in the quiz says it’s ${type} but isn’t`);
      const name = createHash('sha256').update(bytes).digest('hex').slice(0, 32) + TYPES[type];
      writeFileSync(path.join(dir, name), bytes);
      const original = holder.media;
      inside.set(original, {path: '/media/' + name, data: `data:${type === 'audio/x-wav' || type === 'audio/wave' ? 'audio/wav' : type};base64,${bytes.toString('base64')}`});
      holder.media = '/media/' + name;
    }
    let checked;
    try {checked = validateLibrary(quiz, dir);} catch (e) {throw Error(e.message);}
    const back = new Map([...inside.values()].map(m => [m.path, m.data]));
    for (const holder of holders(checked)) if (typeof holder.media === 'string' && back.has(holder.media)) holder.media = back.get(holder.media);
    const questions = checked.rounds.flatMap(r => r.questions);
    if (!questions.length) throw Error('The quiz has no questions');
    const formats = [...new Set(questions.map(q => q.type))].map(t => FORMAT_NAMES[t] || t);
    return {quiz: checked, title: checked.title, rounds: checked.rounds.length, questions: questions.length, formats, media: inside.size,
      bytes: Buffer.byteLength(JSON.stringify(checked))};
  } finally {rmSync(dir, {recursive: true, force: true});}
}

/** What the library shows of a quiz without giving it away: each round's title, how many questions, which formats. */
export const quizOutline = quiz => quiz.rounds.map(r => ({title: r.title, questions: r.questions.length, secret: !!r.secret,
  formats: [...new Set(r.questions.map(q => FORMAT_NAMES[q.type] || q.type))]}));
