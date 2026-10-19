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
export const mediaPattern = /^\/media\/[a-zA-Z0-9_-][a-zA-Z0-9_.-]*\.(png|jpg|jpeg|webp|mp3|ogg|wav)$/i;

export function validateQuestion(q, mediaDir) {
  requireValue(q && typeof q === 'object', 'Question required');
  requireValue(text(q.text, 1000), 'Question text must be 1–1,000 characters');
  requireValue(['text', 'choice', 'picture', 'audio', 'sheet'].includes(q.type), 'Unknown question type');
  requireValue(integer(q.seconds, 5, 7200), 'Duration must be 5–7,200 seconds');
  requireValue(integer(q.points, 0, 100), 'Points must be a whole number from 0 to 100');
  requireValue(q.answer === undefined || text(q.answer, 300, false), 'Invalid correct answer');
  const aliases = q.aliases ?? [];
  requireValue(Array.isArray(aliases) && aliases.length <= 20 && aliases.every(a => text(a, 300)), 'Invalid alternative answers');
  const result = {text: q.text.trim(), type: q.type, seconds: q.seconds, points: q.points,
    answer: q.answer?.trim() || '', aliases, options: [], items: [], itemAnswers: [], media: null,
    speedBonus: q.speedBonus ?? 0, round: typeof q.round === 'string' ? q.round.slice(0, 100) : ''};
  requireValue(integer(result.speedBonus, 0, 100) && (q.type !== 'sheet' || result.speedBonus === 0), 'Speed bonus must be 0–100 (zero for sheets)');
  if (q.type === 'choice') {
    requireValue(Array.isArray(q.options) && q.options.length >= 2 && q.options.length <= 8 && q.options.every(o => text(o, 200)) && new Set(q.options).size === q.options.length, 'Supply 2–8 distinct choices');
    requireValue(!result.answer || q.options.includes(result.answer), 'Correct answer must match a choice');
    result.options = q.options;
  }
  if (q.type === 'picture' || q.type === 'audio') {
    requireValue(typeof q.media === 'string' && mediaPattern.test(q.media) && existsSync(path.join(mediaDir, path.basename(q.media))), 'Upload or select an existing media file');
    const extension = path.extname(q.media).toLowerCase();
    requireValue((q.type === 'picture' ? ['.png', '.jpg', '.jpeg', '.webp'] : ['.mp3', '.ogg', '.wav']).includes(extension), 'Media format does not match question type');
    result.media = q.media;
  }
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

export function validateLibrary(input, mediaDir) {
  if (Array.isArray(input)) input = {title: 'Imported quiz', rounds: [{id: 'imported', title: 'Round 1', questions: input.map((q, i) => ({...q, id: `q-${i + 1}`}))}]};
  requireValue(input && text(input.title, 100) && Array.isArray(input.rounds) && input.rounds.length <= 30, 'Quiz needs a title and up to 30 rounds');
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
      requireValue(++count <= 300, 'Maximum 300 questions per quiz');
      return {...validateQuestion(q, mediaDir), id: id(q.id)};
    });
    return {id: roundId, title: round.title.trim(), questions};
  });
  return {title: input.title.trim(), rounds};
}
