import {existsSync} from 'node:fs';
import path from 'node:path';

export class QuizError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export const requireValue = (condition, message, status = 400) => {
  if (!condition) throw new QuizError(message, status);
};
const text = (value, max, required = true) => typeof value === 'string' && value.length <= max && (!required || value.trim().length > 0);
const integer = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
export const normalise = value => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-GB');
export const matches = (value, answers) => answers.some(answer => normalise(value) === normalise(answer));
export const numberPattern = /^-?\d{1,15}(\.\d{1,6})?$/;
// Moments the TV can play a sound for; the quizmaster supplies the files (e.g. a SpeedQuizzing sound theme).
export const soundSlots = ['startRound', 'questionStart', 'timerMusic', 'countdown', 'timeUp', 'endRound', 'correct', 'wrong', 'reveal', 'bingoCall', 'bingo', 'applause'];
export const audioPath = media => typeof media === 'string' && mediaPattern.test(media) && /\.(mp3|ogg|wav)$/i.test(media);
export const spotifyPattern = /^spotify:track:[A-Za-z0-9]{22}$/;
// A Spotify track as a spotify:track: id or an open.spotify.com link (as "Share → Copy song link" gives), stored as the id.
export const spotifyTrack = value => {
  const match = typeof value === 'string' && /^(?:spotify:track:|https:\/\/open\.spotify\.com\/(?:intl-[a-z-]+\/)?track\/)([A-Za-z0-9]{22})(?:[?#].*)?$/.exec(value.trim());
  return match ? `spotify:track:${match[1]}` : null;
};
export const mediaPattern = /^\/media\/[a-zA-Z0-9_-][a-zA-Z0-9_.-]*\.(png|jpg|jpeg|webp|mp3|ogg|wav)$/i;
const pictureExtensions = ['.png', '.jpg', '.jpeg', '.webp'], audioExtensions = ['.mp3', '.ogg', '.wav'];

// Question types. Keypad formats follow common pub-quiz handset conventions:
// letters (first letter of the answer), numbers, multiple choice and sequence.
export const types = ['text', 'choice', 'multi', 'letter', 'number', 'nearest', 'sequence', 'pinpoint', 'wordsnake', 'tiles', 'vote', 'buzzer', 'bingo', 'musicbingo', 'clips', 'picture', 'audio', 'sheet'];
export const speedTypes = ['text', 'choice', 'multi', 'letter', 'number', 'sequence', 'pinpoint', 'wordsnake', 'tiles', 'picture', 'audio', 'bingo', 'musicbingo', 'clips'];
// Buzzer questions stay open until the quizmaster rules on them; the timer only limits buzzing.
// Formats the server marks right or wrong by itself: these can use Evil Mode and a fixed speed bonus.
export const autoMarked = q => ['multi', 'sequence', 'pinpoint', 'wordsnake', 'tiles'].includes(q.type) || (['text', 'choice', 'letter', 'number', 'picture', 'audio'].includes(q.type) && !!q.answer);
export const speedBonusOf = q => q.fastestFingers ? q.speedBonus || 0 : 0;
export const hostDriven = type => ['buzzer', 'bingo', 'musicbingo', 'clips'].includes(type);
export const isBingo = type => type === 'bingo' || type === 'musicbingo';

export function validateQuestion(q, mediaDir) {
  requireValue(q && typeof q === 'object', 'Question required');
  requireValue(text(q.text, 1000), 'Question text must be 1–1,000 characters');
  requireValue(types.includes(q.type), 'Unknown question type');
  requireValue(integer(q.seconds, 5, 7200), 'Duration must be 5–7,200 seconds');
  // A full bingo game's points come from its stage points, so `points` may be left out.
  if (q.mode === 'progressive' && isBingo(q.type) && q.points === undefined) q = {...q, points: Array.isArray(q.stagePoints) ? q.stagePoints[2] : 3};
  requireValue(integer(q.points, 0, 100), 'Points must be a whole number from 0 to 100');
  requireValue(q.answer === undefined || text(q.answer, 300, false), 'Invalid correct answer');
  requireValue(q.answerNote === undefined || text(q.answerNote, 300, false), 'Answer note must be up to 300 characters');
  const aliases = q.aliases ?? [];
  requireValue(Array.isArray(aliases) && aliases.length <= 20 && aliases.every(a => text(a, 300)), 'Invalid alternative answers');
  const result = {text: q.text.trim(), type: q.type, seconds: q.seconds, points: q.points,
    answer: q.answer?.trim() || '', answerNote: q.answerNote?.trim() || '', aliases: [], options: [], items: [], itemAnswers: [], media: null,
    speedBonus: q.speedBonus ?? 0, round: typeof q.round === 'string' ? q.round.slice(0, 100) : ''};
  requireValue(integer(result.speedBonus, 0, 100) && (speedTypes.includes(q.type) || result.speedBonus === 0), 'Speed bonus must be 0–100 (zero for this format)');
  // Fastest fingers first: without it, answering quickly earns nothing extra (the bonus value is kept but unused).
  result.fastestFingers = q.fastestFingers === true;
  // Speed bonus: sliding (fades over the time allowed) or fixed (only the fastest correct answers get it).
  result.bonusMode = q.bonusMode ?? 'sliding'; result.bonusPlaces = q.bonusPlaces ?? 1;
  requireValue(['sliding', 'fixed'].includes(result.bonusMode), 'Speed bonus must be sliding or fixed');
  requireValue(integer(result.bonusPlaces, 1, 50), 'Fastest answers given the fixed bonus must be 1–50');
  // Evil Mode: a wrong answer loses the question's points.
  result.evil = q.evil === true;
  if (['text', 'picture', 'audio'].includes(q.type)) result.aliases = aliases;
  if (q.type === 'choice' || q.type === 'vote' || q.type === 'multi') {
    requireValue(Array.isArray(q.options) && q.options.length >= 2 && q.options.length <= 8 && q.options.every(o => text(o, 200)) && new Set(q.options).size === q.options.length, 'Supply 2–8 distinct choices');
    result.options = q.options.map(o => o.trim());
    if (q.type === 'vote') result.answer = '';
    else if (q.type === 'multi') {
      requireValue(Array.isArray(q.correct) && q.correct.length >= 1 && q.correct.every(c => result.options.includes(c)) && new Set(q.correct).size === q.correct.length, 'Tick at least one correct choice');
      result.correct = result.options.filter(o => q.correct.includes(o)); result.answer = result.correct.join(', ');
    }
    else requireValue(!result.answer || result.options.includes(result.answer), 'Correct answer must match a choice');
  }
  if (q.type === 'letter') {
    requireValue(/^[a-z]?$/i.test(result.answer), 'Letter answer must be a single letter A–Z');
    result.answer = result.answer.toUpperCase();
  }
  if (q.type === 'number' || q.type === 'nearest') {
    requireValue(q.type === 'number' && !result.answer || numberPattern.test(result.answer), 'Correct answer must be a number');
  }
  if (q.type === 'nearest') {
    result.places = q.places ?? 1;
    requireValue(integer(result.places, 1, 20), 'Places scored must be 1–20');
    // A tie-breaker scores nothing: it only orders teams level on points, closest first.
    result.tieBreaker = q.tieBreaker === true;
    if (result.tieBreaker) result.points = 0;
  }
  if (q.type === 'sequence') {
    requireValue(Array.isArray(q.items) && q.items.length >= 2 && q.items.length <= 8 && q.items.every(i => text(i, 200)) && new Set(q.items).size === q.items.length, 'Supply 2–8 distinct items in their correct order');
    result.items = q.items.map(i => i.trim());
    result.answer = '';
  }
  if (q.type === 'pinpoint') {
    const t = q.target, fraction = v => typeof v === 'number' && v >= 0 && v <= 1;
    requireValue(t && fraction(t.x) && fraction(t.y) && typeof t.r === 'number' && t.r >= 0.01 && t.r <= 0.5, 'Click the picture to set the target area');
    requireValue(t.aspect === undefined || (typeof t.aspect === 'number' && t.aspect >= 0.1 && t.aspect <= 10), 'Invalid picture shape');
    result.target = {x: t.x, y: t.y, r: t.r, aspect: t.aspect ?? 1};
  }
  if (q.type === 'wordsnake') {
    result.answer = result.answer.toUpperCase().replace(/[^A-Z]/g, '');
    requireValue(result.answer.length >= 3 && result.answer.length <= 20, 'Word snake answers need 3–20 letters (A–Z)');
  }
  if (q.type === 'wordsnake' || q.type === 'pinpoint') {
    result.goWide = q.goWide === true; result.goWidePoints = q.goWidePoints ?? 0;
    requireValue(integer(result.goWidePoints, 0, 100), 'Go-wide points must be 0–100');
  }
  if (q.type === 'tiles') {
    const letters = result.answer.toUpperCase().replace(/[^A-Z ]/g, '').replace(/\s+/g, ' ').trim();
    requireValue(letters.replace(/ /g, '').length >= 4 && letters.length <= 40, 'Tile answers need 4–40 letters');
    result.tiles = splitTiles(letters.replace(/ /g, '')); result.wordLengths = letters.split(' ').map(w => w.length);
  }
  if (q.type === 'clips') {
    requireValue(Array.isArray(q.clips) && q.clips.length >= 2 && q.clips.length <= 30, 'Add 2–30 audio clips');
    // A clip is an uploaded audio file, or a Spotify track played from a start time for clipSeconds.
    result.clips = q.clips.map(c => {
      requireValue(c && typeof c === 'object', 'Invalid clip');
      const spotify = c.spotify && spotifyTrack(c.spotify);
      if (c.spotify) {
        requireValue(spotify && integer(c.start ?? 0, 0, 3600), 'Spotify clips need a track and a start time of 0–3,600 seconds');
        requireValue(c.seconds === undefined || integer(c.seconds, 3, 60), 'A clip plays for 3–60 seconds');
      } else requireValue(typeof c.media === 'string' && mediaPattern.test(c.media) && audioExtensions.includes(path.extname(c.media).toLowerCase()) && existsSync(path.join(mediaDir, path.basename(c.media))), 'Each clip needs an uploaded audio file or a Spotify track');
      requireValue(c.label === undefined || text(c.label, 100, false), 'Clip names must be up to 100 characters');
      return c.spotify ? {spotify, start: c.start ?? 0, ...(c.seconds !== undefined && {seconds: c.seconds}), label: c.label?.trim() || ''} : {media: c.media, label: c.label?.trim() || ''};
    });
    result.clipSeconds = q.clipSeconds ?? 15;
    requireValue(integer(result.clipSeconds, 3, 60), 'Spotify clip length must be 3–60 seconds');
    result.targetClip = q.targetClip;
    requireValue(integer(q.targetClip, 0, result.clips.length - 1), 'Pick which clip teams should tap for');
  }
  if (q.type === 'musicbingo') {
    requireValue(Array.isArray(q.songs) && q.songs.length >= 15 && q.songs.length <= 300, 'Music bingo needs 15–300 songs');
    result.songs = q.songs.map(song => {
      requireValue(song && text(song.title, 100), 'Every song needs a title of up to 100 characters');
      const media = song.media || null, spotify = song.spotify ? spotifyTrack(song.spotify) : null;
      requireValue(!media || (typeof media === 'string' && mediaPattern.test(media) && audioExtensions.includes(path.extname(media).toLowerCase()) && existsSync(path.join(mediaDir, path.basename(media)))), 'Song audio must be an uploaded MP3, Ogg or WAV');
      requireValue(!song.spotify || spotify, 'Invalid Spotify track — use a spotify:track: id or an open.spotify.com/track/ link');
      requireValue(!(media && spotify), 'A song plays either an uploaded file or Spotify, not both');
      // A song can have its own start point and play time, instead of the game's.
      requireValue(song.start === undefined || integer(song.start, 0, 3600), 'A song\'s start time must be 0–3,600 seconds');
      requireValue(song.seconds === undefined || integer(song.seconds, 3, 600), 'A song plays for 3–600 seconds');
      return {title: song.title.trim(), media, ...(spotify ? {spotify} : {}), ...(song.start !== undefined && {start: song.start}), ...(song.seconds !== undefined && {seconds: song.seconds})};
    });
    // Each song starts this far in (e.g. at the chorus) and plays for songSeconds (0 = the whole song);
    // with autoNext the desk then plays the next song by itself.
    result.startAt = q.startAt ?? 0; result.songSeconds = q.songSeconds ?? 0; result.autoNext = q.autoNext === true;
    requireValue(integer(result.startAt, 0, 600), 'Song start time must be 0–600 seconds');
    requireValue(result.songSeconds === 0 || integer(result.songSeconds, 3, 600), 'Play each song for 3–600 seconds, or 0 for the whole song');
    requireValue(!result.autoNext || result.songSeconds > 0 || result.songs.every(s => s.seconds), 'Set how long each song plays to move on automatically');
    requireValue(new Set(result.songs.map(s => s.title.toLowerCase())).size === result.songs.length, 'Song titles must all be different');
    result.revealNow = q.revealNow === true;
  }
  if (isBingo(q.type)) {
    result.mode = q.mode ?? 'line';
    requireValue(['progressive', 'line', 'twoLines', 'fullHouse'].includes(result.mode), 'Bingo needs a full game, one line, two lines or full house');
    // Full game: points for the line, two lines and full house (the question's points are the full house's).
    if (result.mode === 'progressive') {
      result.stagePoints = q.stagePoints ?? [Math.max(1, Math.round(q.points / 3)), Math.max(1, Math.round(q.points * 2 / 3)), q.points];
      requireValue(Array.isArray(result.stagePoints) && result.stagePoints.length === 3 && result.stagePoints.every(p => integer(p, 0, 100)), 'Set points for the line, two lines and full house (0–100 each)');
      result.points = result.stagePoints[2];
    }
  }
  if (q.type === 'buzzer') {
    result.variation = q.variation ?? 'classic';
    requireValue(['classic', 'advanced'].includes(result.variation), 'Buzzer variation must be classic or advanced');
    for (const [field, fallback, max] of [['penalty', 0, 100], ['passPenalty', 0, 100], ['agreePoints', 0, 100], ['agreeSeconds', 10, 60]]) {
      result[field] = q[field] ?? fallback;
      requireValue(integer(result[field], field === 'agreeSeconds' ? 5 : 0, max), `Invalid ${field}`);
    }
  }
  if (q.media !== undefined && q.media !== null && q.media !== '') {
    requireValue(q.type !== 'sheet', 'Answer sheets cannot have media');
    requireValue(typeof q.media === 'string' && mediaPattern.test(q.media) && existsSync(path.join(mediaDir, path.basename(q.media))), 'Upload or select an existing media file');
    const extension = path.extname(q.media).toLowerCase();
    requireValue(q.type === 'picture' ? pictureExtensions.includes(extension) : q.type === 'audio' ? audioExtensions.includes(extension) : true, 'Media format does not match question type');
    result.media = q.media;
  }
  // An audio question can play a Spotify track instead of a file: the desk plays it from `start` for `seconds`.
  if (q.type === 'audio' && q.clip !== undefined && q.clip !== null) {
    const c = q.clip, spotify = c && spotifyTrack(c.spotify);
    requireValue(spotify && integer(c.start ?? 0, 0, 3600) && integer(c.seconds ?? 30, 3, 600), 'A Spotify clip needs a track, a start time of 0–3,600 seconds and a play time of 3–600 seconds');
    requireValue(!result.media, 'An audio question plays either a file or Spotify, not both');
    result.clip = {spotify, start: c.start ?? 0, seconds: c.seconds ?? 30};
  }
  requireValue(!['picture', 'audio', 'pinpoint'].includes(q.type) || result.media || result.clip, 'Upload or select an existing media file');
  requireValue(q.type !== 'pinpoint' || pictureExtensions.includes(path.extname(result.media).toLowerCase()), 'Pinpoint needs a picture');
  if (q.type === 'sheet') {
    requireValue(Array.isArray(q.items) && q.items.length >= 1 && q.items.length <= 50 && q.items.every(i => text(i, 500)), 'Supply 1–50 sheet questions');
    result.items = q.items;
    const answers = q.itemAnswers ?? q.items.map(() => '');
    requireValue(Array.isArray(answers) && answers.length === q.items.length && answers.every(a => text(a, 300, false)), 'Sheet answers must match its questions');
    result.itemAnswers = answers.map(a => a.trim());
    // Other accepted answers for each item, as `aliases` are for a typed answer.
    const itemAliases = q.itemAliases ?? q.items.map(() => []);
    requireValue(Array.isArray(itemAliases) && itemAliases.length === q.items.length && itemAliases.every(list => Array.isArray(list) && list.length <= 20 && list.every(a => text(a, 300))), 'Sheet alternative answers must match its questions (up to 20 each)');
    result.itemAliases = itemAliases.map(list => list.map(a => a.trim()));
    // Every sheet item is worth one point. Missing keys are left for the host to mark.
    result.points = q.items.length;
  }
  requireValue(!result.evil || autoMarked(result), 'Evil Mode needs a format with a correct answer set, so wrong answers can be spotted');
  requireValue(result.bonusMode === 'sliding' || autoMarked(result), 'A fixed speed bonus needs a format with a correct answer set');
  return result;
}

// Parses and checks a submitted value. Drafts (final=false) may be incomplete.
export function answerValue(value, q, final = true) {
  if (q.type === 'sheet') {
    requireValue(Array.isArray(value) && value.length === q.items.length && value.every(x => typeof x === 'string' && x.length <= 300), 'Answer sheet must contain one answer per question');
    return JSON.stringify(value.map(x => x.trim()));
  }
  if (q.type === 'sequence') {
    requireValue(Array.isArray(value) && value.every(i => integer(i, 0, q.items.length - 1)) && new Set(value).size === value.length, 'Invalid sequence');
    requireValue(!final || value.length === q.items.length, 'Place every item in order');
    return JSON.stringify(value);
  }
  if (q.type === 'multi') {
    requireValue(Array.isArray(value) && value.every(v => q.options.includes(v)) && new Set(value).size === value.length && (!final || value.length), 'Tick at least one choice');
    return JSON.stringify(q.options.filter(o => value.includes(o)));
  }
  if (q.type === 'wordsnake' || q.type === 'tiles') {
    const max = q.type === 'tiles' ? q.tiles.length : 25;
    requireValue(Array.isArray(value) && value.every(i => integer(i, 0, max - 1)) && new Set(value).size === value.length, q.type === 'tiles' ? 'Invalid tiles' : 'Invalid letters');
    requireValue(!final || value.length, q.type === 'tiles' ? 'Place the tiles first' : 'Trace the word first');
    return JSON.stringify(value);
  }
  if (q.type === 'pinpoint') {
    const point = p => Array.isArray(p) && p.length === 2 && p.every(v => typeof v === 'number' && v >= 0 && v <= 1);
    requireValue(Array.isArray(value) && value.length <= (q.goWide ? 2 : 1) && value.every(point) && (!final || value.length), 'Tap the picture');
    return JSON.stringify(value.map(p => p.map(v => Math.round(v * 10000) / 10000)));
  }
  requireValue(!['buzzer', 'bingo', 'musicbingo', 'clips'].includes(q.type), 'Use the buttons for this question');
  requireValue(typeof value === 'string' && value.length <= 300 && (!final || value.trim()), 'Answer must contain 1–300 characters');
  if (!final && value === '') return '';
  if (q.type === 'choice' || q.type === 'vote') requireValue(q.options.includes(value), 'Select a valid choice');
  if (q.type === 'letter') requireValue(/^[a-z]$/i.test(value.trim()), 'Choose a single letter');
  if (q.type === 'number' || q.type === 'nearest') requireValue(numberPattern.test(value.trim()), 'Enter a number');
  return q.type === 'letter' ? value.trim().toUpperCase() : value.trim();
}

// Whether a single answer is correct, or null when only the quizmaster (or a ranking) can decide.
export function isCorrect(value, q) {
  if (q.type === 'sequence') return JSON.stringify(JSON.parse(value)) === JSON.stringify(q.items.map((_, i) => i));
  if (q.type === 'multi') return JSON.parse(value).join('\n') === q.correct.join('\n');
  if (q.type === 'pinpoint') return hits(JSON.parse(value)[0], q.target);
  if (q.type === 'wordsnake') {const {path} = JSON.parse(value); return validSnake(path, q.snake) && path.map(i => q.snake.grid[i]).join('') === q.answer;}
  if (q.type === 'tiles') return JSON.parse(value).map(i => q.pieces[i]).join('') === q.tiles.join('');
  if (['vote', 'nearest', 'buzzer', 'bingo', 'musicbingo', 'clips', 'sheet'].includes(q.type) || !q.answer) return null;
  if (q.type === 'number') return Number(value) === Number(q.answer);
  if (q.type === 'choice' || q.type === 'letter') return value === q.answer;
  return matches(value, [q.answer, ...(q.aliases || [])]);
}

// Pinpoint coordinates are fractions of the picture; the target circle's radius is a fraction of its width.
// aspect is the picture's height / width, which turns vertical fractions into width units.
export const hits = (point, target) => !!point && Math.hypot(point[0] - target.x, (point[1] - target.y) * (target.aspect || 1)) <= target.r;

// Points before any speed bonus. Multi-tap: right picks minus wrong picks, as a share of the points.
// Pinpoint: full points for the first tap, go-wide points if only the second tap lands.
export function basePoints(value, q) {
  if (q.type === 'multi') {
    const picks = JSON.parse(value), right = picks.filter(p => q.correct.includes(p)).length;
    return Math.max(0, Math.round(q.points * (right - (picks.length - right)) / q.correct.length));
  }
  if (q.type === 'wordsnake') return isCorrect(value, q) ? JSON.parse(value).wide ? q.goWidePoints : q.points : 0;
  if (q.type === 'pinpoint') {
    const [first, second] = JSON.parse(value);
    return hits(first, q.target) ? q.points : hits(second, q.target) ? q.goWidePoints : 0;
  }
  return isCorrect(value, q) ? q.points : 0;
}

// Seven Squares-style tiles: the answer's letters cut into at most seven pieces, longest first.
export function splitTiles(letters) {
  const count = Math.min(7, letters.length), base = Math.floor(letters.length / count), extra = letters.length % count, tiles = [];
  for (let i = 0, at = 0; i < count; i++) {const size = base + (i < extra ? 1 : 0); tiles.push(letters.slice(at, at + size)); at += size;}
  return tiles;
}
// Tiles are shown shuffled (chosen when the question opens); the stored order is the answer.
export function shuffleTiles(tiles, random = Math.random) {
  const pieces = [...tiles];
  for (let i = pieces.length - 1; i > 0; i--) {const j = Math.floor(random() * (i + 1)); [pieces[i], pieces[j]] = [pieces[j], pieces[i]];}
  return pieces.join('') === tiles.join('') ? [...pieces.slice(1), pieces[0]] : pieces;
}
// Word snake: the answer runs through the grid one neighbouring square at a time (diagonals allowed);
// every other square holds a decoy letter.
const neighbours = (i, size) => {
  const r = Math.floor(i / size), c = i % size, out = [];
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) if ((dr || dc) && r + dr >= 0 && r + dr < size && c + dc >= 0 && c + dc < size) out.push((r + dr) * size + c + dc);
  return out;
};
export function snakeGrid(word, random = Math.random) {
  const size = word.length <= 9 ? 4 : 5, cells = size * size;
  const shuffle = list => {for (let i = list.length - 1; i > 0; i--) {const j = Math.floor(random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]];} return list;};
  const walk = path => {
    if (path.length === word.length) return path;
    for (const next of shuffle(neighbours(path.at(-1), size).filter(n => !path.includes(n)))) {const found = walk([...path, next]); if (found) return found;}
    return null;
  };
  let path = null;
  for (const start of shuffle(Array.from({length: cells}, (_, i) => i))) if ((path = walk([start]))) break;
  const decoys = 'EEAAIOTNSRLDUCMHGBPKYW' + word;
  const grid = Array.from({length: cells}, () => decoys[Math.floor(random() * decoys.length)]);
  path.forEach((cell, i) => {grid[cell] = word[i];});
  return {size, grid, path};
}
export const validSnake = (path, snake) => Array.isArray(path) && new Set(path).size === path.length && path.every((cell, i) => Number.isInteger(cell) && cell >= 0 && cell < snake.grid.length && (i === 0 || neighbours(path[i - 1], snake.size).includes(cell)));

// UK-style 90-ball ticket: 3 rows of 9 columns, 5 numbers per row, column c holds c*10..c*10+9 (1–9, 80–90).
// Seeded so a team always sees the same ticket for a question without storing it.
export function bingoCard(seed) {
  let h = 2166136261; for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const random = () => {h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); h ^= h >>> 16; return (h >>> 0) / 4294967296;};
  const pick = (list, n) => {const copy = [...list]; for (let i = copy.length - 1; i > 0; i--) {const j = Math.floor(random() * (i + 1)); [copy[i], copy[j]] = [copy[j], copy[i]];} return copy.slice(0, n);};
  let columns;
  do columns = [0, 1, 2].map(() => pick([0, 1, 2, 3, 4, 5, 6, 7, 8], 5)); while (new Set(columns.flat()).size < 9);
  const rows = [[], [], []].map(() => Array(9).fill(null));
  for (let c = 0; c < 9; c++) {
    const used = [0, 1, 2].filter(r => columns[r].includes(c)), low = c === 0 ? 1 : c * 10, high = c === 8 ? 90 : c * 10 + 9;
    const numbers = pick(Array.from({length: high - low + 1}, (_, i) => low + i), used.length).sort((a, b) => a - b);
    used.forEach((r, i) => {rows[r][c] = numbers[i];});
  }
  return rows;
}
// Music bingo ticket: 3 rows of 5 different songs (1-based song numbers), seeded per team.
export function musicCard(seed, songs) {
  let h = 2166136261; for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const pool = Array.from({length: songs}, (_, i) => i + 1);
  for (let i = pool.length - 1; i > 0; i--) {h = Math.imul(h ^ (h >>> 15), 2246822507) ^ i; const j = (h >>> 0) % (i + 1); [pool[i], pool[j]] = [pool[j], pool[i]];}
  return [0, 1, 2].map(r => pool.slice(r * 5, r * 5 + 5));
}
export const bingoLines = (card, called) => card.filter(row => row.every(n => n === null || called.has(n))).length;
export const bingoNeeded = mode => ({line: 1, twoLines: 2, fullHouse: 3})[mode];
// A full game plays line, two lines and full house in turn; the other modes are a single prize.
export const bingoStages = mode => mode === 'progressive' ? ['line', 'twoLines', 'fullHouse'] : [mode];
export const stagePoints = q => q.mode === 'progressive' ? q.stagePoints : [q.points];

// Nearest wins: rank by distance, ties to the earlier answer; top places score on a sliding scale.
export function rankNearest(q, answers) {
  const target = Number(q.answer);
  const ranked = answers.filter(a => numberPattern.test(a.value)).map(a => ({...a, distance: Math.abs(Number(a.value) - target)}))
    .sort((a, b) => a.distance - b.distance || a.submitted - b.submitted);
  return ranked.map((a, i) => ({team: a.team, distance: a.distance, points: i < q.places ? Math.round(q.points * (q.places - i) / q.places) : 0}));
}

export function validateLibrary(input, mediaDir) {
  if (Array.isArray(input)) input = {title: 'Imported quiz', rounds: [{id: 'imported', title: 'Round 1', questions: input.map((q, i) => ({...q, id: `q-${i + 1}`}))}]};
  requireValue(input && text(input.title, 100) && Array.isArray(input.rounds) && input.rounds.length <= 60, 'Quiz needs a title and up to 60 rounds');
  const ids = new Set(); let count = 0;
  const id = value => {
    requireValue(typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value) && !ids.has(value), 'Quiz and round IDs must be unique');
    ids.add(value); return value;
  };
  const rounds = input.rounds.map(round => {
    requireValue(round && typeof round === 'object', 'Invalid round');
    const roundId = id(round.id);
    requireValue(text(round.title, 100) && Array.isArray(round.questions), 'Round needs a title and question list');
    const questions = round.questions.map(q => {
      requireValue(++count <= 1000, 'Maximum 1,000 questions per quiz');
      return {...validateQuestion(q, mediaDir), id: id(q.id)};
    });
    return {id: roundId, title: round.title.trim(), questions};
  });
  return {title: input.title.trim(), rounds};
}
