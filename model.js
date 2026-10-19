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
export const mediaPattern = /^\/media\/[a-zA-Z0-9_-][a-zA-Z0-9_.-]*\.(png|jpg|jpeg|webp|mp3|ogg|wav)$/i;
const pictureExtensions = ['.png', '.jpg', '.jpeg', '.webp'], audioExtensions = ['.mp3', '.ogg', '.wav'];

// Question types. Keypad formats follow common pub-quiz handset conventions:
// letters (first letter of the answer), numbers, multiple choice and sequence.
export const types = ['text', 'choice', 'letter', 'number', 'nearest', 'sequence', 'vote', 'buzzer', 'picture', 'audio', 'sheet'];
export const speedTypes = ['text', 'choice', 'letter', 'number', 'sequence', 'picture', 'audio'];
// Buzzer questions stay open until the quizmaster rules on them; the timer only limits buzzing.
export const hostDriven = type => type === 'buzzer';

export function validateQuestion(q, mediaDir) {
  requireValue(q && typeof q === 'object', 'Question required');
  requireValue(text(q.text, 1000), 'Question text must be 1–1,000 characters');
  requireValue(types.includes(q.type), 'Unknown question type');
  requireValue(integer(q.seconds, 5, 7200), 'Duration must be 5–7,200 seconds');
  requireValue(integer(q.points, 0, 100), 'Points must be a whole number from 0 to 100');
  requireValue(q.answer === undefined || text(q.answer, 300, false), 'Invalid correct answer');
  requireValue(q.answerNote === undefined || text(q.answerNote, 300, false), 'Answer note must be up to 300 characters');
  const aliases = q.aliases ?? [];
  requireValue(Array.isArray(aliases) && aliases.length <= 20 && aliases.every(a => text(a, 300)), 'Invalid alternative answers');
  const result = {text: q.text.trim(), type: q.type, seconds: q.seconds, points: q.points,
    answer: q.answer?.trim() || '', answerNote: q.answerNote?.trim() || '', aliases: [], options: [], items: [], itemAnswers: [], media: null,
    speedBonus: q.speedBonus ?? 0, round: typeof q.round === 'string' ? q.round.slice(0, 100) : ''};
  requireValue(integer(result.speedBonus, 0, 100) && (speedTypes.includes(q.type) || result.speedBonus === 0), 'Speed bonus must be 0–100 (zero for this format)');
  if (['text', 'picture', 'audio'].includes(q.type)) result.aliases = aliases;
  if (q.type === 'choice' || q.type === 'vote') {
    requireValue(Array.isArray(q.options) && q.options.length >= 2 && q.options.length <= 8 && q.options.every(o => text(o, 200)) && new Set(q.options).size === q.options.length, 'Supply 2–8 distinct choices');
    result.options = q.options.map(o => o.trim());
    if (q.type === 'vote') result.answer = '';
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
  }
  if (q.type === 'sequence') {
    requireValue(Array.isArray(q.items) && q.items.length >= 2 && q.items.length <= 8 && q.items.every(i => text(i, 200)) && new Set(q.items).size === q.items.length, 'Supply 2–8 distinct items in their correct order');
    result.items = q.items.map(i => i.trim());
    result.answer = '';
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
  requireValue(!['picture', 'audio'].includes(q.type) || result.media, 'Upload or select an existing media file');
  if (q.type === 'sheet') {
    requireValue(Array.isArray(q.items) && q.items.length >= 1 && q.items.length <= 50 && q.items.every(i => text(i, 500)), 'Supply 1–50 sheet questions');
    result.items = q.items;
    const answers = q.itemAnswers ?? q.items.map(() => '');
    requireValue(Array.isArray(answers) && answers.length === q.items.length && answers.every(a => text(a, 300, false)), 'Sheet answers must match its questions');
    result.itemAnswers = answers.map(a => a.trim());
    // Every sheet item is worth one point. Missing keys are left for the host to mark.
    result.points = q.items.length;
  }
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
  requireValue(q.type !== 'buzzer', 'Use the buzzer for this question');
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
  if (['vote', 'nearest', 'buzzer', 'sheet'].includes(q.type) || !q.answer) return null;
  if (q.type === 'number') return Number(value) === Number(q.answer);
  if (q.type === 'choice' || q.type === 'letter') return value === q.answer;
  return matches(value, [q.answer, ...(q.aliases || [])]);
}

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
