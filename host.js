import {$, element, api, message, readStorage, writeStorage, download, renderMedia, renderSolution, timeText, selectOptions} from './app.js';
let key = readStorage('pubquiz-host', true), state = null, library = null, editingId = null, tab = 'live', dirty = false, reviewId = '', reviewSignature = '', busy = false;
const uid = () => 'id-' + crypto.getRandomValues(new Uint32Array(4)).join('-');
const request = (p, body = {}) => api('host/' + p, body, key);
let offset = 0, selectedRoundId = '';
let actionQueue = Promise.resolve();
function action(fn, success = 'Saved') {
  const task = actionQueue.then(async () => {
    busy = true;
    const buttons = [...document.querySelectorAll('button')].map(button => [button, button.disabled]);
    buttons.forEach(([button]) => button.disabled = true);
    try {await fn(); message(success);} catch (e) {message(e.message, true);} finally {
      buttons.forEach(([button, disabled]) => button.disabled = disabled);
      busy = false;
      await refresh();
    }
  });
  actionQueue = task.catch(() => {});
  return task;
}
function chooseTab(name) {
  tab = name;
  document.querySelectorAll('[data-pane]').forEach(el => el.hidden = el.dataset.pane !== name);
  document.querySelectorAll('[data-tab]').forEach(el => el.classList.toggle('selected', el.dataset.tab === name));
  if (name === 'mark') loadReview().catch(e => message(e.message, true));
}
document.querySelectorAll('[data-tab]').forEach(el => el.onclick = () => chooseTab(el.dataset.tab));
function round() {return library?.rounds.find(r => r.id === $('roundSelect').value);}
function savedQuestion() {return round()?.questions.find(q => q.id === editingId);}
function editorChanged() {dirty = true; $('editorStatus').textContent = 'Unsaved changes';}
function formTypes() {
  const type = $('qType').value;
  $('choiceFields').hidden = type !== 'choice'; $('sheetFields').hidden = type !== 'sheet';
  $('mediaFields').hidden = !['picture', 'audio'].includes(type);
  $('answerFields').hidden = type === 'sheet'; $('pointsLabel').hidden = type === 'sheet'; $('speedLabel').hidden = type === 'sheet';
  $('sheetItems').querySelectorAll('input').forEach(input => input.disabled = type !== 'sheet');
  $('mediaUpload').accept = type === 'picture' ? 'image/png,image/jpeg,image/webp' : 'audio/mpeg,audio/ogg,audio/wav';
}
function addSheetItem(text = '', answer = '') {
  const row = element('div', undefined, 'sheet-row');
  const label = element('label', 'Question'); const input = element('input'); input.maxLength = 500; input.value = text; input.required = true; label.append(input);
  const marking = element('label', 'Correct answer (optional)'); const key = element('input'); key.maxLength = 300; key.value = answer; marking.append(key);
  const remove = element('button', 'Remove', 'subtle'); remove.type = 'button'; remove.onclick = () => {row.remove(); editorChanged();};
  row.append(label, marking, remove); $('sheetItems').append(row);
}
function fillQuestion(q = null) {
  editingId = q?.id || null;
  $('qText').value = q?.text || ''; $('qType').value = q?.type || 'text'; $('qSeconds').value = q?.seconds ?? 30; $('qPoints').value = q?.points ?? 1; $('qSpeed').value = q?.speedBonus || 0;
  $('qAnswer').value = q?.answer || ''; $('qAliases').value = (q?.aliases || []).join('\n'); $('qOptions').value = (q?.options || []).join('\n'); $('qMedia').value = q?.media || '';
  $('sheetItems').replaceChildren(); (q?.items || ['']).forEach((item, i) => addSheetItem(item, q?.itemAnswers?.[i] || ''));
  $('mediaUpload').value = ''; renderMedia($('mediaPreview'), q); formTypes(); dirty = false;
  $('editorStatus').textContent = q ? 'Saved question loaded' : 'New question — save it to a round';
  $('playSelected').disabled = !q; $('deleteQuestion').disabled = !q;
}
function guardEditor() {return !dirty || confirm('Discard unsaved question changes?');}
function roundOptions(preferredRound, preferredQuestion) {
  selectOptions($('roundSelect'), library.rounds.map(r => [r.id, r.title]), preferredRound);
  selectedRoundId = $('roundSelect').value;
  const r = round();
  selectOptions($('questionSelect'), [['', 'New question'], ...(r?.questions || []).map((q, i) => [q.id, `${i + 1}. ${q.text}`])], preferredQuestion ?? '');
  fillQuestion(r?.questions.find(q => q.id === $('questionSelect').value));
  $('libraryStatus').textContent = `${library.rounds.length} ${library.rounds.length === 1 ? 'round' : 'rounds'} · ${library.rounds.reduce((n, r) => n + r.questions.length, 0)} questions · saved on this laptop`;
}
async function loadLibrary() {library = await request('library'); $('quizTitle').value = library.title; roundOptions();}
async function saveLibrary(next, roundId, questionId) {
  library = await request('library/save', {revision: library.revision, quiz: next});
  $('quizTitle').value = library.title; roundOptions(roundId, questionId);
}
const cloneLibrary = () => structuredClone(library);
function readQuestion() {
  const rows = [...$('sheetItems').children];
  return {id: editingId || uid(), text: $('qText').value.trim(), type: $('qType').value, seconds: Number($('qSeconds').value), points: Number($('qPoints').value),
    speedBonus: $('qType').value === 'sheet' ? 0 : Number($('qSpeed').value), answer: $('qAnswer').value.trim(), aliases: $('qAliases').value.split('\n').map(s => s.trim()).filter(Boolean),
    options: $('qOptions').value.split('\n').map(s => s.trim()).filter(Boolean), media: $('qMedia').value,
    items: rows.map(row => row.querySelectorAll('input')[0].value.trim()), itemAnswers: rows.map(row => row.querySelectorAll('input')[1].value.trim())};
}
$('questionForm').oninput = editorChanged;
$('qType').onchange = () => {formTypes(); editorChanged();};
$('addSheetItem').onclick = () => {addSheetItem(); editorChanged();};
$('questionForm').onsubmit = e => {e.preventDefault(); action(async () => {
  if (!round()) throw Error('Add a round first');
  const q = readQuestion(), next = cloneLibrary(), r = next.rounds.find(r => r.id === round().id), index = r.questions.findIndex(old => old.id === q.id);
  if (index < 0) r.questions.push(q); else r.questions[index] = q;
  await saveLibrary(next, r.id, q.id);
}, 'Question saved');};
$('roundSelect').onchange = () => {if (!guardEditor()) {$('roundSelect').value = selectedRoundId; return;} roundOptions($('roundSelect').value);};
$('questionSelect').onchange = () => {if (!guardEditor()) {$('questionSelect').value = editingId || ''; return;} fillQuestion(round()?.questions.find(q => q.id === $('questionSelect').value));};
$('newQuestion').onclick = () => {if (guardEditor()) {$('questionSelect').value = ''; fillQuestion();}};
$('addRound').onclick = () => action(async () => {
  if (!guardEditor()) return; const title = prompt('Round name', `Round ${library.rounds.length + 1}`); if (!title?.trim()) return;
  const next = cloneLibrary(), id = uid(); next.rounds.push({id, title, questions: []}); await saveLibrary(next, id);
});
$('renameRound').onclick = () => action(async () => {const r = round(); if (!r || !guardEditor()) return; const title = prompt('Round name', r.title); if (!title?.trim()) return; const next = cloneLibrary(); next.rounds.find(x => x.id === r.id).title = title; await saveLibrary(next, r.id, editingId);});
$('deleteRound').onclick = () => action(async () => {const r = round(); if (!r || !confirm(`Delete ${r.title} and its saved questions? Played history is retained.`)) return; const next = cloneLibrary(); next.rounds = next.rounds.filter(x => x.id !== r.id); await saveLibrary(next);});
$('deleteQuestion').onclick = () => action(async () => {if (!savedQuestion() || !confirm('Delete this saved question? Played history is retained.')) return; const next = cloneLibrary(); next.rounds.find(r => r.id === round().id).questions = round().questions.filter(q => q.id !== editingId); await saveLibrary(next, round().id);});
for (const [id, delta] of [['moveUp', -1], ['moveDown', 1]]) $(id).onclick = () => action(async () => {
  if (!savedQuestion() || !guardEditor()) return; const next = cloneLibrary(), r = next.rounds.find(r => r.id === round().id), i = r.questions.findIndex(q => q.id === editingId), to = i + delta;
  if (to < 0 || to >= r.questions.length) return; [r.questions[i], r.questions[to]] = [r.questions[to], r.questions[i]]; await saveLibrary(next, r.id, editingId);
});
$('saveTitle').onclick = () => action(async () => {if (!guardEditor()) return; const next = cloneLibrary(); next.title = $('quizTitle').value; await saveLibrary(next, round()?.id, editingId);});
$('reloadLibrary').onclick = () => action(async () => {if (guardEditor()) await loadLibrary();});
$('importQuiz').onchange = () => action(async () => {
  const file = $('importQuiz').files[0]; if (!file) return;
  if (file.size > 1024 * 1024) throw Error('Quiz JSON must be under 1 MB');
  if (!confirm('Replace the saved quiz with this file? Played history and scores are retained.')) return;
  await saveLibrary(JSON.parse(await file.text()));
}, 'Quiz imported');
$('exportQuiz').onclick = () => download('pubquiz-questions.json', library);
$('mediaUpload').onchange = () => action(async () => {
  const file = $('mediaUpload').files[0]; if (!file) return; if (file.size > 20 * 1024 * 1024) throw Error('Maximum media file size is 20 MB');
  const response = await fetch('/api/host/media?name=' + encodeURIComponent(file.name), {method: 'POST', headers: {Authorization: 'Bearer ' + key, 'Content-Type': 'application/octet-stream'}, body: file, signal: AbortSignal.timeout(60000)});
  const data = await response.json(); if (!response.ok) throw Error(data.error);
  $('qMedia').value = data.media; renderMedia($('mediaPreview'), {type: $('qType').value, media: data.media}); editorChanged();
}, 'Media uploaded — save the question to keep it in your quiz');
$('playSelected').onclick = () => action(async () => {
  if (dirty) throw Error('Save the question before playing it');
  const played = state.history.some(q => q.sourceId === editingId);
  if (played && !confirm('This question has already played. Open a fresh copy?')) return;
  await request('start', {id: editingId, expectedQuestion: state.question?.id || null, repeat: played}); chooseTab('live');
}, 'Question opened');
$('next').onclick = () => action(() => request('next', {expectedQuestion: state.question?.id || null}), 'Next question opened');
for (const id of ['close', 'pause', 'resume']) $(id).onclick = () => action(() => request(id, {expectedQuestion: state.question?.id || null}), id === 'close' ? 'Answers closed' : id === 'pause' ? 'Timer paused' : 'Timer resumed');
$('reveal').onclick = () => action(() => request('reveal', {question: state.question.id, revealed: !state.question.revealed}), 'Reveal updated');
$('titleForm').onsubmit = e => {e.preventDefault(); action(() => request('settings', {title: $('eventName').value}));};
$('registration').onclick = () => action(() => request('settings', {registrationOpen: !state.settings.registrationOpen}));
$('visibility').onclick = () => action(() => request('settings', {leaderboardVisible: !state.settings.leaderboardVisible}));
$('displayMode').onchange = () => action(() => request('settings', {displayMode: $('displayMode').value}));
$('finish').onclick = () => action(async () => {
  if (!state.settings.ended && !confirm('Finish this quiz and close answers and registration? You can resume it later.')) return;
  await request('settings', {ended: !state.settings.ended});
}, 'Quiz status updated');
$('loginForm').onsubmit = async e => {e.preventDefault(); await action(async () => {
  key = (await api('login', {key: $('key').value})).key; writeStorage('pubquiz-host', key, true); $('key').value = ''; await loadLibrary();
}, 'Quiz desk unlocked');};
$('logout').onclick = () => action(async () => {await request('logout'); key = ''; writeStorage('pubquiz-host', '', true); $('panel').hidden = true; $('login').hidden = false;}, 'Quiz desk locked');
let adjustRequest = null;
$('adjustForm').oninput = () => {adjustRequest = null;};
$('adjustForm').onsubmit = e => {e.preventDefault(); action(async () => {
  adjustRequest ||= uid(); await request('adjust', {team: $('adjustTeam').value, points: Number($('adjustPoints').value), reason: $('adjustReason').value, requestId: adjustRequest});
  adjustRequest = null; $('adjustReason').value = '';
}, 'Adjustment recorded');};
$('exportResults').onclick = () => action(async () => download('pubquiz-results.json', await request('export')), 'Results downloaded');
$('printSheets').onclick = () => {
  const paper = $('paper'); paper.replaceChildren(element('h1', library.title), element('p', 'Team name: __________________________________'));
  for (const r of library.rounds) {paper.append(element('h2', r.title)); for (const [i, q] of r.questions.entries()) {
    if (q.type === 'sheet') {paper.append(element('h3', q.text)); q.items.forEach((item, n) => paper.append(element('p', `${n + 1}. ${item}`), element('p', 'Answer: __________________________________________________')));}
    else paper.append(element('p', `${i + 1}. ${q.text}`), element('p', 'Answer: __________________________________________________'));
  }} window.print();
};
function teamControls(team) {
  const box = element('article', undefined, 'card'); box.append(element('h3', team.name), element('p', `${team.score} pts · ${team.enabled ? team.connected ? 'Connected' : 'Disconnected' : 'Disabled'}`));
  for (const [label, actionName] of [['Rename', 'rename'], ['Issue recovery code', 'recover'], [team.enabled ? 'Disable' : 'Restore', team.enabled ? 'disable' : 'restore']]) {
    const button = element('button', label, 'subtle'); button.onclick = () => action(async () => {
      const body = {id: team.id, action: actionName};
      if (actionName === 'rename') {body.name = prompt('Team name', team.name); if (!body.name) return;}
      if (actionName === 'recover' && !confirm(`Revoke the old recovery code for ${team.name}?`)) return;
      const result = await request('team', body);
      if (result.secret) {$('recoveryName').textContent = team.name; $('recoveryCode').textContent = result.secret; $('recoveryDialog').showModal();}
    }); box.append(button);
  } return box;
}
let teamsSignature = '';
function renderState(s) {
  state = s; offset = s.serverTime - Date.now();
  $('eventTitle').textContent = s.settings.title; $('eventState').textContent = s.settings.ended ? 'Quiz finished' : 'Quiz in progress';
  if (!$('eventName').value) $('eventName').value = s.settings.title;
  const q = s.question, pending = q?.open || q?.paused;
  $('liveRound').textContent = q?.round || ''; $('liveText').textContent = q?.text || 'Ready when you are'; $('liveTimer').textContent = timeText(q, offset);
  $('liveCount').textContent = q ? `${s.answers.length} answers received · ${s.teams.filter(t => t.enabled).length} active teams` : 'Add rounds in Build quiz, then start your first question.';
  renderMedia($('liveMedia'), q); renderSolution($('liveSolution'), q);
  $('next').disabled = !!pending || s.settings.ended; $('close').disabled = !pending; $('pause').disabled = !q?.open; $('resume').disabled = !q?.paused; $('reveal').disabled = !q || !!pending;
  $('reveal').textContent = q?.revealed ? 'Hide answer reveal' : 'Reveal answer';
  $('registration').textContent = s.settings.registrationOpen ? 'Close registration' : 'Open registration'; $('registration').disabled = s.settings.ended;
  $('visibility').textContent = s.settings.leaderboardVisible ? 'Hide leaderboard' : 'Show leaderboard'; $('displayMode').value = s.settings.displayMode; $('finish').textContent = s.settings.ended ? 'Resume quiz' : 'Finish quiz';
  const offline = s.teams.filter(t => t.enabled && !t.connected); $('alerts').textContent = offline.length ? `⚠ Disconnected: ${offline.map(t => t.name).join(', ')}` : '';
  const played = new Set(s.history.map(q => q.sourceId)); const all = library?.rounds.flatMap(r => r.questions) || [];
  $('progress').textContent = `${all.filter(q => played.has(q.id)).length} of ${all.length} saved questions played`;
  if (library && library.revision !== s.libraryRevision) $('libraryStatus').textContent = 'Saved quiz changed in another window. Reload before editing.';
  selectOptions($('reviewSelect'), s.history.map(q => [String(q.id), `${q.id}. ${q.round ? q.round + ' · ' : ''}${q.text}`]), reviewId || String(q?.id || ''));
  const teamSignature = JSON.stringify(s.teams.map(({seen, ...t}) => t));
  if (teamSignature !== teamsSignature) {teamsSignature = teamSignature; $('teamCards').replaceChildren(...s.teams.map(teamControls));}
  selectOptions($('adjustTeam'), s.teams.filter(t => t.enabled).map(t => [t.id, t.name]), $('adjustTeam').value);
}
$('reviewSelect').onchange = () => {
  if ($('markCards').querySelector('[data-dirty=true]') && !confirm('Discard unsaved marks and change question?')) {$('reviewSelect').value = reviewId || String(state.question?.id || ''); return;}
  $('markCards').querySelectorAll('[data-dirty]').forEach(card => card.dataset.dirty = 'false');
  reviewId = $('reviewSelect').value; reviewSignature = ''; loadReview().catch(e => message(e.message, true));};
async function loadReview() {
  const id = $('reviewSelect').value; if (!id || busy) return;
  const r = await request('review', {question: Number(id)});
  if (busy || $('reviewSelect').value !== id) return;
  const signature = JSON.stringify([r, state.teams.map(t => [t.id, t.name])]); if (signature === reviewSignature) return;
  // Polling must not replace a mark that is being edited.
  if ($('markCards').contains(document.activeElement) || $('markCards').querySelector('[data-dirty=true]')) return;
  reviewSignature = signature; const q = r.question;
  $('reviewKey').textContent = q.type === 'sheet' ? 'One point per item. Review any items without a key.' : `Correct answer: ${q.answer || '(manual marking)'}${q.aliases?.length ? ' · Also accepts: ' + q.aliases.join(', ') : ''}`;
  renderMedia($('reviewMedia'), q);
  $('markCards').replaceChildren(...state.teams.map(team => {
    const answer = r.answers.find(a => a.team === team.id), card = element('form', undefined, 'card');
    card.oninput = card.onchange = () => {card.dataset.dirty = 'true';};
    card.append(element('h3', team.name), element('p', answer ? `Saved score: ${answer.points}` : 'No final answer submitted'));
    let marks = [];
    if (q.type === 'sheet') {
      const values = answer ? JSON.parse(answer.value) : []; let saved = [];
      try {saved = JSON.parse(answer?.marks || '[]') || [];} catch {}
      q.items.forEach((item, i) => {const row = element('label', `${i + 1}. ${item} · Answer: ${values[i] || '(blank)'} · Key: ${q.itemAnswers?.[i] || '(manual)'}`); const select = element('select');
        selectOptions(select, [['0', '0 — incorrect / blank'], ['1', '1 — correct']], String(saved[i] ?? 0)); row.append(select); card.append(row); marks.push(select);
      });
    } else card.append(element('p', answer?.value || '(no answer)', 'submitted-answer'));
    const points = element('input'); points.type = 'number'; points.min = '-200'; points.max = '200'; points.step = '1'; points.required = true; points.value = answer?.points || 0;
    if (q.type !== 'sheet') {const label = element('label', 'Total points'); label.append(points); card.append(label);}
    const save = element('button', 'Save mark'); save.disabled = q.open || q.paused;
    card.append(save); card.onsubmit = e => {e.preventDefault(); action(async () => {
      await request('mark', {team: team.id, question: q.id, ...(q.type === 'sheet' ? {marks: marks.map(m => Number(m.value))} : {points: Number(points.value)})});
      card.dataset.dirty = 'false'; reviewSignature = ''; save.blur();
    }, 'Mark saved');}; return card;
  }));
}
async function refresh() {
  if (busy) return;
  if (!key) {$('connection').textContent = 'Desk locked'; return;}
  try {
    const s = await request('state'); if (busy) return; if (!library) await loadLibrary();
    $('login').hidden = true; $('panel').hidden = false; $('connection').textContent = '● Server connected'; renderState(s);
    if (tab === 'mark') await loadReview();
  } catch (e) {
    if (e.status === 403) {key = ''; writeStorage('pubquiz-host', '', true); $('panel').hidden = true; $('login').hidden = false; message('Log in to unlock the desk again.', true);}
    $('connection').textContent = '● Server unavailable — reconnecting';
    for (const id of ['next', 'close', 'pause', 'resume', 'reveal']) $(id).disabled = true;
  }
}
window.addEventListener('beforeunload', e => {if (dirty) {e.preventDefault(); e.returnValue = '';}});
setInterval(() => {if (state) $('liveTimer').textContent = timeText(state.question, offset);}, 200);
async function poll() {await refresh(); setTimeout(poll, 1500);} poll();
