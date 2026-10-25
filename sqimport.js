// Converts SpeedQuizzing quiz files into PubQuiz questions, for interoperability with existing quiz packs.
// Round files (.sqb buzz-in, .sqq keypad, .sqn nearest wins, .sqt multi-tap, .sqw word snake, .sqp pinpoint)
// are small XML documents. Quick Questions
// keep the whole question in the file name, split by underscores.
const entities = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'"};
const decode = value => value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, code) => code[0] === '#' ? String.fromCodePoint(code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1))) : entities[code.toLowerCase()] ?? all).trim();
const tag = (xml, name) => {const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml); return m ? decode(m[1]) : '';};
const tags = (xml, name) => [...xml.matchAll(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'g'))].map(m => m[1]);
const numeric = value => /^-?\d{1,15}(\.\d{1,6})?$/.test(value.replace(/,/g, ''));
const letter = value => /^[a-z]$/i.test(value);
const clip = (value, max) => value.slice(0, max);

export function parseSqRound(text, fileName = 'SpeedQuizzing round') {
  const xml = text.slice(Math.max(0, text.indexOf('<')));
  if (!/<round>/.test(xml)) throw Error(`${fileName} is not a SpeedQuizzing round file`);
  const game = tag(xml, 'game').toLowerCase(), variation = tag(xml, 'game_variation').toLowerCase(), ext = (/\.(sq[a-z])$/i.exec(fileName)?.[1] || '').toLowerCase();
  const points = Math.min(100, Math.max(0, Number.parseInt(tag(xml, 'points_per_question'), 10) || 1));
  const speedBonus = tag(xml, 'speed_bonus') === 'true' ? points : 0;
  const skipped = [];
  const questions = tags(xml, 'question').map((q, n) => {
    const textValue = clip(tag(q, 'q'), 1000), short = tag(q, 'short_answer'), long = tag(q, 'long_answer'), view = tag(q, 'user_view').toLowerCase();
    const options = tags(q, 'option').map(decode).filter(Boolean).slice(0, 8).map(o => clip(o, 200));
    if (!textValue) {skipped.push(`question ${n + 1} has no text`); return null;}
    if (tag(q, 'picture')) skipped.push(`question ${n + 1} used a picture that is not inside the file — upload it in Build quiz`);
    const common = {text: textValue, points, answerNote: clip(long, 300)};
    // Pinpoint targets live on a picture that is not inside the file, so those questions are rebuilt by hand.
    if (ext === 'sqp' || game.includes('pinpoint')) {skipped.push(`question ${n + 1} is a pinpoint question — upload its picture and set the target in Build quiz`); return null;}
    if (ext === 'sqw' || game.replace(/\s/g, '').includes('wordsnake')) {
      const word = short.toUpperCase().replace(/[^A-Z]/g, '');
      if (word.length >= 3 && word.length <= 20) return {...common, type: 'wordsnake', seconds: 45, speedBonus, fastestFingers: speedBonus > 0, answer: word, answerNote: clip(long && long.toUpperCase().replace(/[^A-Z]/g, '') !== word ? long : '', 300)};
    }
    if ((ext === 'sqt' || game.replace(/[\s-]/g, '').includes('multitap')) && options.length >= 2) {
      const correct = [...new Set((short.toUpperCase().match(/[A-H]/g) || []).map(l => options[l.charCodeAt(0) - 65]).filter(Boolean))];
      if (correct.length) return {...common, type: 'multi', seconds: 30, speedBonus, fastestFingers: speedBonus > 0, options: [...new Set(options)], correct};
    }
    if (game === 'buzzin') return {...common, type: 'buzzer', variation: variation === 'advanced' ? 'advanced' : 'classic', seconds: 60, answer: clip(long || short, 300), answerNote: '', agreePoints: Math.max(1, Math.round(points / 2))};
    if (game.startsWith('nearest')) return numeric(short) ? {...common, type: 'nearest', seconds: 20, answer: short.replace(/,/g, '')} : {...common, type: 'text', seconds: 30, answer: clip(long || short, 300)};
    if (view === 'multi' && options.length >= 2) {
      const index = letter(short) ? short.toUpperCase().charCodeAt(0) - 65 : -1;
      return {...common, type: 'choice', seconds: 30, speedBonus, fastestFingers: speedBonus > 0, options: [...new Set(options)], answer: options[index] ?? ''};
    }
    if (view === 'sequence' || (!short && options.length >= 2)) return {...common, type: 'sequence', seconds: 45, speedBonus, fastestFingers: speedBonus > 0, items: [...new Set(options)]};
    if (view === 'letters' && letter(short)) return {...common, type: 'letter', seconds: 30, speedBonus, fastestFingers: speedBonus > 0, answer: short.toUpperCase()};
    if (view === 'numbers' && numeric(short)) return {...common, type: 'number', seconds: 30, speedBonus, fastestFingers: speedBonus > 0, answer: short.replace(/,/g, '')};
    return {...common, type: 'text', seconds: 30, speedBonus, fastestFingers: speedBonus > 0, answer: clip(long || short, 300), answerNote: ''};
  }).filter(Boolean);
  return {title: clip(tag(xml, 'title') && !/^Generated from/i.test(tag(xml, 'title')) ? tag(xml, 'title') : fileName.replace(/\.[^.]+$/, ''), 100), questions, skipped};
}

// Characters Windows forbids in file names are written as pairs.
const unescapeName = value => value.replace(/\^\^/g, '?').replace(/''/g, '"').replace(/;;/g, ':').replace(/\+\+/g, '*').replace(/\{\{/g, '/').replace(/\}\}/g, '\\').replace(/\[\[/g, '<').replace(/\]\]/g, '>');
const choiceAt = (rest, fromEnd) => {
  const options = rest.length - fromEnd, value = rest.at(-fromEnd);
  return options >= 2 && options <= 8 && letter(value ?? '') && value.toUpperCase().charCodeAt(0) - 65 < options;
};
export const quickMedia = name => /\.(jpe?g|png)$/i.test(name) ? 'picture' : /\.(mp3|wav)$/i.test(name) ? 'audio' : null;

// folder: the containing folder name, whose QQFA/QQFC/QQFK/QQFN prefix says which game it was made for.
export function parseQuickQuestion(fileName, folder = '') {
  const base = fileName.replace(/^.*[\\/]/, ''), stem = base.replace(/\.[^.]+$/, '');
  const match = /^(QQV?)_(.*)$/i.exec(stem);
  if (!match) return null;
  const vote = match[1].toUpperCase() === 'QQV', sequence = stem.endsWith('__');
  const parts = unescapeName(sequence ? match[2].slice(0, -2) : match[2]).split('_').map(p => p.trim());
  const [text, ...rest] = parts, kind = folder.toUpperCase().slice(0, 4), media = quickMedia(base);
  if (!text || !rest.length) return null;
  const question = {text: clip(text, 1000), seconds: 30, points: 1};
  if (vote) Object.assign(question, {type: 'vote', options: [...new Set(rest.filter(Boolean))].slice(0, 8)});
  else if (sequence) Object.assign(question, {type: 'sequence', seconds: 45, items: [...new Set(rest.filter(Boolean))].slice(0, 8)});
  else if (choiceAt(rest, 1) || choiceAt(rest, 2)) {
    // Multiple choice ends with the answer letter, optionally followed by extra information.
    const extra = choiceAt(rest, 1) ? 0 : 1, options = rest.slice(0, rest.length - 1 - extra);
    Object.assign(question, {type: 'choice', options, answer: options[rest.at(-1 - extra).toUpperCase().charCodeAt(0) - 65], answerNote: extra ? clip(rest.at(-1), 300) : ''});
  } else if (rest.length === 2 && letter(rest[0])) Object.assign(question, {type: 'letter', answer: rest[0].toUpperCase(), answerNote: clip(rest[1], 300)});
  else if (rest.length === 2 && numeric(rest[0])) Object.assign(question, {type: kind === 'QQFN' ? 'nearest' : 'number', seconds: kind === 'QQFN' ? 20 : 30, answer: rest[0].replace(/,/g, ''), answerNote: clip(rest[1], 300)});
  else if (kind === 'QQFA' || kind === 'QQFC') Object.assign(question, {type: 'buzzer', variation: kind === 'QQFA' ? 'advanced' : 'classic', seconds: 60, answer: clip(rest.join(' '), 300), agreePoints: 1});
  else Object.assign(question, {type: media ?? 'text', answer: clip(rest.join(' '), 300)});
  return {question, media};
}
