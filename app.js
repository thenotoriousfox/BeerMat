import {t} from './i18n.js';
export const $ = id => document.getElementById(id);
export const element = (tag, text, className) => {const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el;};
export function readStorage(key, session = false) {try {return (session ? sessionStorage : localStorage).getItem(key) || '';} catch {return '';}}
export function writeStorage(key, value, session = false) {try {(session ? sessionStorage : localStorage).setItem(key, value); return true;} catch {return false;}}
export async function api(route, body = {}, key = '') {
  const response = await fetch('/api/' + route, {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + key}, body: JSON.stringify(body), signal: AbortSignal.timeout(8000)});
  const data = await response.json();
  if (!response.ok) {const error = Error(t(data.error || 'Request failed')); error.status = response.status; throw error;}
  return data;
}
export function message(text, error = false) {$('message').textContent = t(text); $('message').classList.toggle('error', error);}
export function download(name, data) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'}));
  const link = element('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const isAudio = media => /\.(mp3|ogg|wav)$/i.test(media || '');
export function renderMedia(container, question) {
  const value = question?.media || '';
  if (container.dataset.media === value) return;
  delete container.dataset.pinpoint; container.dataset.media = value; container.replaceChildren();
  if (!value) return;
  const media = element(isAudio(value) ? 'audio' : 'img'); media.src = value;
  if (isAudio(value)) {media.controls = true; media.preload = 'metadata';} else media.alt = 'Quiz picture';
  container.append(media);
}
export function avatar(src) {const img = element('img', undefined, 'avatar'); img.src = src; img.alt = ''; return img;}
// Leaderboard rows slide from their old position to the new one when the order changes.
export function renderBoard(container, teams) {
  const key = JSON.stringify(teams);
  if (container.dataset.board === key) return;
  container.dataset.board = key;
  const before = new Map([...container.children].map(li => [li.dataset.team, li.getBoundingClientRect().top]));
  container.replaceChildren(...teams.map(team => {
    const li = element('li'), name = element('span', `${team.rank}. ${team.name}`, 'team-name');
    if (team.photo) name.prepend(avatar(team.photo));
    li.append(name, element('strong', `${team.score} pts`)); li.dataset.team = team.id; return li;
  }));
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  for (const li of container.children) {
    const old = before.get(li.dataset.team), now = li.getBoundingClientRect().top;
    if (old === undefined) li.animate([{opacity: 0, transform: 'translateX(-24px)'}, {opacity: 1, transform: 'none'}], {duration: 500, easing: 'ease-out'});
    else if (old !== now) li.animate([{transform: `translateY(${old - now}px)`}, {transform: 'none'}], {duration: 800, easing: 'cubic-bezier(.2,.8,.2,1)'});
  }
}
export function timeText(question, offset = 0) {
  if (!question) return t('Waiting for the quizmaster');
  if (question.type === 'bingo' || question.type === 'musicbingo') return t(question.paused ? 'Paused' : question.live ? 'Eyes down — game in progress' : 'Game over');
  if (question.paused) return t('Paused · {n}s remaining', {n: Math.ceil(question.remaining / 1000)});
  if (!question.open || question.deadline <= Date.now() + offset) return t('Answers closed');
  return t('{n}s remaining', {n: Math.max(0, Math.ceil((question.deadline - Date.now() - offset) / 1000))});
}
export const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export function renderSolution(container, question) {
  // Only rebuild when the reveal changes, so its entrance animation plays once.
  const key = question?.revealed ? JSON.stringify([question.id, question.answer, question.tally, question.correctCount, question.answerNote]) : '';
  if (container.dataset.reveal === key) return;
  container.dataset.reveal = key; container.replaceChildren();
  if (!question?.revealed) return;
  container.classList.remove('reveal'); void container.offsetWidth; container.classList.add('reveal');
  container.append(element('h3', t(question.type === 'vote' ? 'Votes' : 'Answer reveal')));
  if (question.type === 'sheet') container.append(...question.items.map((item, i) => element('p', `${i + 1}. ${item} — ${question.itemAnswers?.[i] || t('Marked by quizmaster')}`)));
  else if (question.type === 'sequence') {const list = element('ol', undefined, 'solution'); list.append(...question.items.map(item => element('li', item))); container.append(list);}
  else if (question.type === 'choice') {const i = question.options.indexOf(question.answer); container.append(element('p', i < 0 ? t('Marked by quizmaster') : `${letters[i]}. ${question.answer}`, 'solution'));}
  else if (question.type !== 'vote') container.append(element('p', question.answer || t('Marked by quizmaster'), 'solution'));
  if (question.answerNote) container.append(element('p', question.answerNote, 'muted'));
  if (question.tally) {
    const keys = question.type === 'choice' || question.type === 'vote' ? question.options : Object.keys(question.tally).sort();
    const total = Object.values(question.tally).reduce((a, b) => a + b, 0) || 1, list = element('ul', undefined, 'tally');
    for (const [i, key] of keys.entries()) {
      const count = question.tally[key] || 0, li = element('li'), bar = element('span', undefined, 'bar');
      bar.style.width = `${Math.round(100 * count / total)}%`;
      li.append(element('span', question.options.length ? `${letters[i]}. ${key}` : key), bar, element('strong', String(count))); list.append(li);
    }
    container.append(list);
  }
  if (question.type !== 'vote' && question.correctCount !== undefined) container.append(element('p', question.correctCount === 1 ? t('1 team scored') : t('{n} teams scored', {n: question.correctCount}), 'muted'));
}
export function selectOptions(select, entries, chosen) {
  const signature = JSON.stringify(entries);
  if (select.dataset.options !== signature) {
    select.dataset.options = signature;
    select.replaceChildren(...entries.map(([value, label]) => {const o = element('option', label); o.value = value; return o;}));
  }
  if (chosen !== undefined && [...select.options].some(o => o.value === String(chosen))) select.value = chosen;
}
// Live updates: a server-sent event nudges a refresh; a slow poll covers missed events and heartbeats.
export function live(refresh, key = () => '', slowPoll = 5000) {
  let source = null, currentKey = null, running = false, again = false;
  async function update() {
    if (running) {again = true; return;}
    running = true;
    try {await refresh();} finally {running = false; if (again) {again = false; update();}}
  }
  function connect() {
    const k = key();
    if (source && k === currentKey) return;
    source?.close(); currentKey = k;
    source = new EventSource('/api/events' + (k ? '?key=' + encodeURIComponent(k) : ''));
    source.onmessage = update;
  }
  async function loop() {connect(); await update(); setTimeout(loop, slowPoll);}
  loop();
  return {update, reconnect: () => {currentKey = null; connect();}};
}
let audio = null;
export function enableSound() {try {audio ||= new AudioContext(); audio.resume();} catch {}}
// Synthesised buzzer sounds teams can choose from; no audio files needed.
export const sounds = [['Classic buzz', 'square', [330, 495]], ['Doorbell', 'sine', [660, 523]], ['Siren', 'sawtooth', [440, 660, 440]], ['Beep beep', 'square', [880, 0, 880]],
  ['Low horn', 'sawtooth', [147, 147]], ['Chime', 'triangle', [784, 988, 1175]], ['Laser', 'square', [1200, 600, 300]], ['Boing', 'sine', [220, 440]]];
export function buzzSound(name = '', sound = null) {
  if (!audio || audio.state !== 'running') return;
  const [, wave, notes] = sounds[sound ?? [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % sounds.length];
  notes.forEach((freq, i) => {
    if (!freq) return;
    const osc = audio.createOscillator(), gain = audio.createGain(), t = audio.currentTime + i * 0.13;
    osc.type = wave; osc.frequency.value = freq; gain.gain.setValueAtTime(0.12, t); gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    osc.connect(gain).connect(audio.destination); osc.start(t); osc.stop(t + 0.23);
  });
}
// Picture with tap markers and, once known, the target circle. Coordinates are fractions of the picture.
export function renderPinpoint(container, question, taps = [], onTap = null) {
  const key = JSON.stringify([question.media, taps, question.target ?? null, !!onTap]);
  if (container.dataset.pinpoint === key) return;
  delete container.dataset.media; container.dataset.pinpoint = key; container.replaceChildren();
  const frame = element('div', undefined, 'pinpoint'), img = element('img'); img.src = question.media; img.alt = 'Tap the picture'; frame.append(img);
  const dot = (point, className) => {const d = element('span', undefined, className); d.style.left = `${point[0] * 100}%`; d.style.top = `${point[1] * 100}%`; return d;};
  if (question.target) {const t = question.target, ring = dot([t.x, t.y], 'target'); ring.style.width = `${t.r * 200}%`; ring.style.aspectRatio = '1'; frame.append(ring);}
  taps.forEach((point, i) => frame.append(dot(point, i ? 'tap wide' : 'tap')));
  if (onTap) frame.onclick = e => {const r = img.getBoundingClientRect(); onTap([Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))], img);};
  container.append(frame);
}
// Traditional UK bingo calls, shown with each number when bingo phrases are switched on.
const calls = ["Kelly's eye", 'One little duck', 'Cup of tea', 'Knock at the door', 'Man alive', 'Half a dozen', 'Lucky seven', 'Garden gate', "Doctor's orders", 'Cock and hen',
  'Legs eleven', 'One dozen', 'Unlucky for some', "Valentine's Day", 'Young and keen', 'Sweet sixteen', 'Dancing queen', 'Coming of age', 'Goodbye teens', 'One score',
  'Key of the door', 'Two little ducks', 'Thee and me', 'Two dozen', 'Duck and dive', 'Pick and mix', 'Gateway to heaven', 'Overweight', 'Rise and shine', 'Dirty Gertie',
  'Get up and run', 'Buckle my shoe', 'All the threes', 'Ask for more', 'Jump and jive', 'Three dozen', 'More than eleven', 'Christmas cake', 'Steps', 'Naughty forty',
  'Time for fun', 'Winnie the Pooh', 'Down on your knees', 'Droopy drawers', 'Halfway there', 'Up to tricks', 'Four and seven', 'Four dozen', 'PC', 'Half a century',
  'Tweak of the thumb', 'Danny La Rue', 'Stuck in the tree', 'Clean the floor', 'Snakes alive', 'Was she worth it?', 'Heinz varieties', 'Make them wait', 'Brighton line', 'Five dozen',
  "Baker's bun", 'Turn the screw', 'Tickle me sixty-three', 'Red raw', 'Old age pension', 'Clickety click', 'Stairway to heaven', 'Saving grace', 'Either way up', 'Three score and ten',
  'Bang on the drum', 'Six dozen', 'Queen bee', 'Candy store', 'Strive and strive', 'Trombones', 'Sunset strip', "Heaven's gate", 'One more time', 'Eight and blank',
  'Stop and run', 'Straight on through', 'Time for tea', 'Seven dozen', 'Staying alive', 'Between the sticks', 'Torquay in Devon', 'Two fat ladies', 'Nearly there', 'Top of the shop'];
export const bingoCall = n => calls[n - 1] ?? '';
// Same shuffle every time for a given seed, so a scrambled keypad stays put between refreshes.
export function seededOrder(length, seed) {
  let h = 2166136261; for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const order = Array.from({length}, (_, i) => i);
  for (let i = length - 1; i > 0; i--) {h = Math.imul(h ^ (h >>> 15), 2246822507) ^ i; const j = (h >>> 0) % (i + 1); [order[i], order[j]] = [order[j], order[i]];}
  return order;
}
export function fanfare() {
  if (!audio || audio.state !== 'running') return;
  [[523, 0], [659, 0.15], [784, 0.3], [1047, 0.45], [784, 0.7], [1047, 0.85]].forEach(([freq, offset]) => {
    const osc = audio.createOscillator(), gain = audio.createGain(), t = audio.currentTime + offset;
    osc.type = 'triangle'; osc.frequency.value = freq; gain.gain.setValueAtTime(0.15, t); gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    osc.connect(gain).connect(audio.destination); osc.start(t); osc.stop(t + 0.32);
  });
}
// Word snake grid. path: squares picked so far; shown: squares still visible after going wide (null = all).
export const adjacent = (a, b, size) => a !== b && Math.abs(Math.floor(a / size) - Math.floor(b / size)) <= 1 && Math.abs(a % size - b % size) <= 1;
export function renderSnake(container, grid, path = [], shown = null, onTap = null) {
  const key = JSON.stringify([grid.letters, path, shown, !!onTap]);
  if (container.dataset.snake === key) return;
  container.dataset.snake = key;
  const box = element('div', undefined, 'snake'); box.style.gridTemplateColumns = `repeat(${grid.size}, 1fr)`;
  box.append(...grid.letters.map((letter, i) => {
    const cell = element(onTap ? 'button' : 'span', letter); if (onTap) {cell.type = 'button'; cell.onclick = () => onTap(i);}
    cell.classList.toggle('picked', path.includes(i)); cell.classList.toggle('gone', !!shown && !shown.includes(i));
    if (path.includes(i)) cell.dataset.step = String(path.indexOf(i) + 1);
    return cell;
  }));
  container.replaceChildren(box);
}
// Tile answer pattern, e.g. "LION KI__" for word lengths [4, 4].
export function tileWord(letters, wordLengths) {
  const total = wordLengths.reduce((a, b) => a + b, 0), padded = letters.padEnd(total, '_');
  let at = 0; return wordLengths.map(n => padded.slice(at, at += n)).join(' ');
}
