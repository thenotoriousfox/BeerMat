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
export function renderMedia(container, question) {
  const value = question?.media || '';
  if (container.dataset.media === value) return;
  container.dataset.media = value; container.replaceChildren();
  if (!value) return;
  const media = element(question.type === 'audio' ? 'audio' : 'img'); media.src = value;
  if (question.type === 'audio') {media.controls = true; media.preload = 'metadata';} else media.alt = 'Quiz picture';
  container.append(media);
}
export function renderBoard(container, teams) {
  container.replaceChildren(...teams.map(team => {
    const li = element('li'); li.append(element('span', `${team.rank}. ${team.name}`), element('strong', `${team.score} pts`)); return li;
  }));
}
export function timeText(question, offset = 0) {
  if (!question) return 'Waiting for the quizmaster';
  if (question.paused) return `Paused · ${Math.ceil(question.remaining / 1000)}s remaining`;
  if (!question.open || question.deadline <= Date.now() + offset) return 'Answers closed';
  return `${Math.max(0, Math.ceil((question.deadline - Date.now() - offset) / 1000))}s remaining`;
}
export function renderSolution(container, question) {
  container.replaceChildren();
  if (!question?.revealed) return;
  container.append(element('h3', 'Answer reveal'));
  if (question.type === 'sheet') container.append(...question.items.map((item, i) => element('p', `${i + 1}. ${item} — ${question.itemAnswers?.[i] || 'Marked by quizmaster'}`)));
  else container.append(element('p', question.answer || 'Marked by quizmaster', 'solution'));
}
export function selectOptions(select, entries, chosen) {
  const signature = JSON.stringify(entries);
  if (select.dataset.options !== signature) {
    select.dataset.options = signature;
    select.replaceChildren(...entries.map(([value, label]) => {const o = element('option', label); o.value = value; return o;}));
  }
  if (chosen !== undefined && [...select.options].some(o => o.value === String(chosen))) select.value = chosen;
}
