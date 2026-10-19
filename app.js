export const $ = id => document.getElementById(id);
export const element = (tag, text, className) => {const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el;};
export function readStorage(key, session = false) {try {return (session ? sessionStorage : localStorage).getItem(key) || '';} catch {return '';}}
export function writeStorage(key, value, session = false) {try {(session ? sessionStorage : localStorage).setItem(key, value); return true;} catch {return false;}}
export async function api(route, body = {}, key = '') {
  const response = await fetch('/api/' + route, {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + key}, body: JSON.stringify(body), signal: AbortSignal.timeout(8000)});
  const data = await response.json();
  if (!response.ok) {const error = Error(data.error || 'Request failed'); error.status = response.status; throw error;}
  return data;
}
export function message(text, error = false) {$('message').textContent = text; $('message').classList.toggle('error', error);}
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
export function renderBoard(container, teams) {
  container.replaceChildren(...teams.map(team => {
    const li = element('li'); li.append(element('span', `${team.rank}. ${team.name}`), element('strong', `${team.score} pts`)); return li;
  }));
}
export function timeText(question, offset = 0) {
  if (!question) return 'Waiting for the quizmaster';
  if (question.type === 'bingo') return question.paused ? 'Paused' : question.live ? 'Eyes down — game in progress' : 'Game over';
  if (question.paused) return `Paused · ${Math.ceil(question.remaining / 1000)}s remaining`;
  if (!question.open || question.deadline <= Date.now() + offset) return 'Answers closed';
  return `${Math.max(0, Math.ceil((question.deadline - Date.now() - offset) / 1000))}s remaining`;
}
export const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export function renderSolution(container, question) {
  container.replaceChildren();
  if (!question?.revealed) return;
  container.append(element('h3', question.type === 'vote' ? 'Votes' : 'Answer reveal'));
  if (question.type === 'sheet') container.append(...question.items.map((item, i) => element('p', `${i + 1}. ${item} — ${question.itemAnswers?.[i] || 'Marked by quizmaster'}`)));
  else if (question.type === 'sequence') {const list = element('ol', undefined, 'solution'); list.append(...question.items.map(item => element('li', item))); container.append(list);}
  else if (question.type === 'choice') {const i = question.options.indexOf(question.answer); container.append(element('p', i < 0 ? 'Marked by quizmaster' : `${letters[i]}. ${question.answer}`, 'solution'));}
  else if (question.type !== 'vote') container.append(element('p', question.answer || 'Marked by quizmaster', 'solution'));
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
  if (question.type !== 'vote' && question.correctCount !== undefined) container.append(element('p', `${question.correctCount} ${question.correctCount === 1 ? 'team' : 'teams'} scored`, 'muted'));
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
