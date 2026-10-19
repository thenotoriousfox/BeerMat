import {$, element, api, message, readStorage, writeStorage, renderMedia, renderBoard, renderSolution, timeText} from './app.js';
const role = document.body.dataset.role;
let secret = readStorage('pubquiz-team'), current = null, renderedQuestion = undefined, offset = 0, online = false, submitting = false, draftTimer, draftGeneration = 0;
let localDraft = null, inputRevision = 0, inFlight = false;
const inputs = () => [...$('inputs').querySelectorAll('input,select')];
const draftKey = id => `pubquiz-draft:${secret}:${id}`;
function saveIdentity(code) {
  secret = code; current = null; renderedQuestion = undefined; localDraft = null; inputRevision = 0;
  if (!writeStorage('pubquiz-team', code)) $('storageWarning').textContent = 'Browser storage is unavailable. Write down your recovery code before closing this window.';
}
function inputValue() {const values = inputs().map(i => i.value); return current.question.type === 'sheet' ? values : values[0];}
function updateControls() {
  if (role !== 'player' || !current) return;
  const q = current.question;
  const canAnswer = !!(online && q?.open && !q.paused && q.deadline > Date.now() + offset && !current.settings.ended && !current.answer);
  inputs().forEach(input => input.disabled = !canAnswer || submitting);
  $('submit').disabled = !canAnswer || submitting;
  $('status').textContent = timeText(q, offset);
  $('answerState').textContent = current.settings.ended ? 'Quiz finished' : current.answer ? '✓ Final answer saved' : q?.paused ? 'Paused' : '';
}
function writeInputs(value) {
  const values = current.question.type === 'sheet' ? value : [value];
  inputs().forEach((input, i) => input.value = values?.[i] ?? '');
}
function parseSaved(value) {
  try {return current.question.type === 'sheet' ? JSON.parse(value) : value;} catch {return null;}
}
function playerState(s) {
  current = s; offset = s.serverTime - Date.now(); $('join').hidden = true; $('game').hidden = false;
  $('team').textContent = s.team.name; $('code').textContent = secret; const q = s.question;
  if (q?.id !== renderedQuestion) {
    clearTimeout(draftTimer); draftGeneration++; localDraft = null; inputRevision = 0;
    renderedQuestion = q?.id; $('inputs').replaceChildren(); $('draftStatus').textContent = '';
    $('question').textContent = q?.text || 'Waiting for the quizmaster'; $('round').textContent = q?.round || '';
    renderMedia($('media'), q);
    if (q) {
      const questions = q.type === 'sheet' ? q.items : ['Your answer'];
      questions.forEach((text, i) => {
        const label = element('label', q.type === 'sheet' ? `${i + 1}. ${text}` : text);
        const input = element(q.type === 'choice' ? 'select' : 'input'); input.name = `answer-${i}`; input.autocomplete = 'off';
        if (q.type === 'choice') {
          const blank = element('option', 'Choose an answer…'); blank.value = ''; input.append(blank);
          q.options.forEach(text => {const option = element('option', text); option.value = text; input.append(option);});
        } else {input.maxLength = 300; input.type = 'text';}
        label.append(input); $('inputs').append(label);
      });
      const saved = readStorage(draftKey(q.id));
      if (saved) {try {localDraft = JSON.parse(saved);} catch {}}
      if (localDraft !== null) writeInputs(localDraft);
      else if (s.draft) {localDraft = parseSaved(s.draft.value); writeInputs(localDraft);}
      if (localDraft !== null) $('draftStatus').textContent = 'Draft restored — submit when ready';
    }
  }
  if (s.answer) {writeInputs(parseSaved(s.answer.value)); $('draftStatus').textContent = 'Your final answer is safely stored on the quiz laptop.'; localDraft = null; writeStorage(draftKey(q.id), '');}
  renderSolution($('solution'), q); updateControls();
}
function sharedState(s) {
  $('title').textContent = s.settings.title; document.title = s.settings.title + ' — ' + (role === 'player' ? 'Team' : 'Projector');
  renderBoard($('leaderboard'), s.teams);
  $('boardStatus').textContent = !s.settings.leaderboardVisible ? 'The quizmaster has hidden scores for now.' : s.settings.ended ? 'Final standings' : s.teams.length ? 'Ties share the same rank.' : 'Waiting for teams';
}
function displayState(s) {
  current = s; offset = s.serverTime - Date.now();
  $('projection').hidden = s.settings.displayMode === 'blank';
  $('boardSection').hidden = s.settings.displayMode !== 'leaderboard'; $('projectQuestion').hidden = s.settings.displayMode !== 'question';
  const q = s.question; $('question').textContent = q?.text || 'Waiting for the quizmaster'; $('round').textContent = q?.round || ''; $('status').textContent = timeText(q, offset);
  renderMedia($('media'), q); renderSolution($('solution'), q);
  if (q?.id !== renderedQuestion) {renderedQuestion = q?.id; $('projectItems').replaceChildren(...(q?.type === 'choice' ? q.options : q?.type === 'sheet' ? q.items : []).map(text => element('li', text)));}
}
async function publicState() {
  const response = await fetch('/api/leaderboard', {signal: AbortSignal.timeout(8000)}); if (!response.ok) throw Error('Cannot reach quiz server'); return response.json();
}
async function refresh() {
  try {
    const s = role === 'player' && secret ? await api('state', {}, secret) : await publicState();
    online = true; $('connection').textContent = '● Connected'; sharedState(s);
    if (role === 'display') displayState(s);
    else if (secret) playerState(s);
    else {$('joinButton').disabled = !s.settings.registrationOpen || s.settings.ended; $('registrationState').textContent = s.settings.ended ? 'This quiz has finished.' : s.settings.registrationOpen ? 'Registration is open' : 'Registration closed — existing teams can still recover below.';}
  } catch (e) {
    online = false; $('connection').textContent = '● Connection lost — retrying';
    if (role === 'player') {
      if (e.status === 401) {secret = ''; writeStorage('pubquiz-team', ''); current = null; $('join').hidden = false; $('game').hidden = true; message('Your old recovery code is no longer valid. Ask the quizmaster for a new one.', true);}
      else if (e.status === 403) message(e.message, true);
      updateControls();
    }
  }
}
async function flushDraft() {
  if (!secret || !current?.question?.open || current.answer || !online || inFlight || localDraft === null) return;
  const generation = draftGeneration, revision = inputRevision, id = current.question.id, value = structuredClone(localDraft), code = secret;
  inFlight = true;
  try {
    await api('draft', {question: id, value}, code);
    if (generation === draftGeneration && revision === inputRevision && !current.answer) $('draftStatus').textContent = 'Draft saved on quiz laptop — final submission still required';
  } catch {if (generation === draftGeneration && !current.answer) $('draftStatus').textContent = 'Draft kept in this browser — waiting for connection';}
  finally {inFlight = false; if (generation === draftGeneration && revision !== inputRevision) {clearTimeout(draftTimer); draftTimer = setTimeout(flushDraft, 400);}}
}
if (role === 'player') {
  $('joinForm').onsubmit = async e => {
    e.preventDefault(); $('joinButton').disabled = true;
    try {const team = await api('join', {name: $('name').value}); saveIdentity(team.secret); message('Team registered. Keep your recovery code.'); await refresh();} catch (e) {message(e.message, true);} finally {if (!secret) $('joinButton').disabled = false;}
  };
  $('recoverForm').onsubmit = async e => {e.preventDefault(); try {const code = $('recovery').value.trim(); await api('state', {}, code); saveIdentity(code); message('Welcome back'); await refresh();} catch (e) {message(e.message, true);}};
  $('switchTeam').onclick = () => {if (!confirm('Switch teams on this browser? Save your current recovery code first.')) return; clearTimeout(draftTimer); secret = ''; writeStorage('pubquiz-team', ''); current = null; renderedQuestion = undefined; $('join').hidden = false; $('game').hidden = true; refresh();};
  $('inputs').oninput = () => {
    localDraft = inputValue(); inputRevision++; writeStorage(draftKey(current.question.id), JSON.stringify(localDraft));
    $('draftStatus').textContent = online ? 'Saving draft…' : 'Draft kept in this browser — waiting for connection';
    clearTimeout(draftTimer); draftTimer = setTimeout(flushDraft, 500);
  };
  $('answerForm').onsubmit = async e => {
    e.preventDefault(); if ($('submit').disabled) return;
    const value = inputValue();
    if (current.question.type === 'sheet' && value.some(v => !v.trim()) && !confirm('Some sheet answers are blank. Submit this as your final sheet?')) return;
    submitting = true; updateControls(); clearTimeout(draftTimer);
    try {await api('answer', {question: current.question.id, value}, secret); message('Final answer received'); await refresh();}
    catch (e) {message(e.status ? e.message : 'Could not confirm submission. Reconnecting will check whether it was received.', true); await refresh();}
    finally {submitting = false; updateControls();}
  };
}
setInterval(() => {if (role === 'player') updateControls(); else if (current) $('status').textContent = timeText(current.question, offset);}, 200);
async function poll() {await refresh(); if (role === 'player' && online && localDraft !== null) await flushDraft(); setTimeout(poll, 1500);} poll();
