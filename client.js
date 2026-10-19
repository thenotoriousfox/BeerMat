import {$, element, api, message, readStorage, writeStorage, renderMedia, renderBoard, renderSolution, timeText, letters, live, enableSound, buzzSound, sounds, renderPinpoint, selectOptions} from './app.js';
const role = document.body.dataset.role;
let secret = readStorage('pubquiz-team'), current = null, renderedQuestion = undefined, offset = 0, online = false, submitting = false, draftTimer, draftGeneration = 0;
let localDraft = null, inputRevision = 0, inFlight = false, lastBuzzer = '', wheelId = null, wheelTurn = 0;
const inputs = () => [...$('inputs').querySelectorAll('input,select')];
const draftKey = id => `pubquiz-draft:${secret}:${id}`;
const keypad = type => ['choice', 'vote', 'letter'].includes(type);
const listValue = type => ['sequence', 'multi', 'pinpoint'].includes(type);
const modes = {line: 'One line', twoLines: 'Two lines', fullHouse: 'Full house'};
function saveIdentity(code) {
  secret = code; current = null; renderedQuestion = undefined; localDraft = null; inputRevision = 0;
  if (!writeStorage('pubquiz-team', code)) $('storageWarning').textContent = 'Browser storage is unavailable. Write down your recovery code before closing this window.';
  updates?.reconnect();
}
function inputValue() {
  const q = current.question, values = inputs().map(i => i.value);
  if (q.type === 'sheet') return values;
  if (listValue(q.type)) {try {return JSON.parse(values[0] || '[]');} catch {return [];}}
  return values[0];
}
function updateControls() {
  if (role !== 'player' || !current) return;
  const q = current.question;
  const canAnswer = !!(online && q?.open && !q.paused && q.deadline > Date.now() + offset && !current.settings.ended && !current.answer);
  inputs().forEach(input => input.disabled = !canAnswer || submitting);
  $('inputs').querySelectorAll('button').forEach(button => button.disabled = !canAnswer || submitting);
  $('submit').disabled = !canAnswer || submitting;
  $('status').textContent = timeText(q, offset);
  $('answerState').textContent = current.settings.ended ? 'Quiz finished' : q?.type === 'buzzer' ? '' : current.answer ? '✓ Final answer saved' : q?.paused ? 'Paused' : '';
  if (q?.type === 'buzzer') renderBuzzer(q);
  if (q?.type === 'bingo') renderBingo(q);
}
// Keypad and sequence buttons write to one hidden input so drafts work the same as typed answers.
function syncPicks() {
  const q = current?.question; if (!q) return;
  const hidden = $('inputs').querySelector('input[type=hidden]'); if (!hidden) return;
  if (keypad(q.type)) $('inputs').querySelectorAll('[data-value]').forEach(b => b.classList.toggle('picked', b.dataset.value === hidden.value));
  let list = []; try {list = listValue(q.type) ? JSON.parse(hidden.value || '[]') : [];} catch {}
  if (q.type === 'multi') $('inputs').querySelectorAll('[data-value]').forEach(b => b.classList.toggle('picked', list.includes(b.dataset.value)));
  if (q.type === 'pinpoint') renderPinpoint($('pinArea'), q, list, point => {
    if ($('submit').disabled) return;
    pick(JSON.stringify(list.length < (q.goWide ? 2 : 1) ? [...list, point] : [...list.slice(0, -1), point]));
  });
  if (q.type === 'sequence') {
    const picked = list;
    $('picked').replaceChildren(...picked.map(i => element('li', q.items[i])));
    $('inputs').querySelectorAll('[data-index]').forEach(b => b.classList.toggle('picked', picked.includes(Number(b.dataset.index))));
  }
}
function pick(value) {
  const hidden = $('inputs').querySelector('input[type=hidden]'); hidden.value = value; syncPicks();
  hidden.dispatchEvent(new Event('input', {bubbles: true}));
}
function writeInputs(value) {
  const q = current.question;
  if (listValue(q.type)) {$('inputs').querySelector('input[type=hidden]').value = JSON.stringify(value || []); return syncPicks();}
  const values = q.type === 'sheet' ? value : [value];
  inputs().forEach((input, i) => input.value = values?.[i] ?? '');
  syncPicks();
}
function parseSaved(value) {
  try {return current.question.type === 'sheet' || listValue(current.question.type) ? JSON.parse(value) : value;} catch {return null;}
}
function buildInputs(q) {
  const box = $('inputs');
  if (q.type === 'buzzer' || q.type === 'bingo') return;
  const hiddenInput = () => {const hidden = element('input'); hidden.type = 'hidden'; hidden.name = 'answer-0'; box.append(hidden);};
  if (q.type === 'multi') {
    hiddenInput(); const pad = element('div', undefined, 'keypad');
    pad.append(...q.options.map((option, i) => {const b = element('button', `${letters[i]}. ${option}`); b.type = 'button'; b.dataset.value = option; b.onclick = () => {
      const picked = inputValue(); pick(JSON.stringify(picked.includes(option) ? picked.filter(p => p !== option) : [...picked, option]));
    }; return b;}));
    box.append(element('p', 'Tick every right answer — wrong ticks cost points', 'muted'), pad); return;
  }
  if (q.type === 'pinpoint') {
    hiddenInput(); const area = element('div'); area.id = 'pinArea';
    const undo = element('button', 'Undo tap', 'subtle'); undo.type = 'button'; undo.onclick = () => pick(JSON.stringify(inputValue().slice(0, -1)));
    box.append(element('p', q.goWide ? `Tap the picture. Go wide: a second tap scores ${q.goWidePoints} if your first misses.` : 'Tap the picture to place your answer', 'muted'), area, undo); return;
  }
  if (q.type === 'sheet') {
    q.items.forEach((text, i) => {
      const label = element('label', `${i + 1}. ${text}`), input = element('input'); input.name = `answer-${i}`; input.autocomplete = 'off'; input.maxLength = 300; input.type = 'text';
      label.append(input); box.append(label);
    });
    return;
  }
  if (keypad(q.type) || q.type === 'sequence') {
    const hidden = element('input'); hidden.type = 'hidden'; hidden.name = 'answer-0'; box.append(hidden);
    const pad = element('div', undefined, q.type === 'letter' ? 'keypad letters' : 'keypad');
    if (q.type === 'letter') pad.append(...[...letters].map(l => {const b = element('button', l); b.type = 'button'; b.dataset.value = l; b.onclick = () => pick(l); return b;}));
    else if (q.type === 'sequence') {
      pad.append(...q.order.map(i => {const b = element('button', q.items[i]); b.type = 'button'; b.dataset.index = String(i); b.onclick = () => {
        const picked = inputValue(); if (!picked.includes(i)) pick(JSON.stringify([...picked, i]));
      }; return b;}));
      const chosen = element('ol', undefined, 'picked'); chosen.id = 'picked';
      const undo = element('button', 'Undo last', 'subtle'); undo.type = 'button'; undo.onclick = () => pick(JSON.stringify(inputValue().slice(0, -1)));
      box.append(element('p', 'Tap the items in order', 'muted'), pad, chosen, undo); return;
    } else pad.append(...q.options.map((option, i) => {const b = element('button', `${letters[i]}. ${option}`); b.type = 'button'; b.dataset.value = option; b.onclick = () => pick(option); return b;}));
    box.append(pad); return;
  }
  const label = element('label', q.type === 'nearest' ? 'Your number (closest wins)' : q.type === 'number' ? 'Your number' : 'Your answer'), input = element('input');
  input.name = 'answer-0'; input.autocomplete = 'off'; input.maxLength = 300; input.type = 'text';
  if (q.type === 'number' || q.type === 'nearest') {input.inputMode = 'decimal'; input.pattern = '-?[0-9]+(\\.[0-9]+)?';}
  label.append(input); box.append(label);
}
function renderBuzzer(q) {
  const b = q.buzz, mine = b.buzzed, queue = b.queue.filter(x => ['active', 'queued'].includes(x.status));
  const position = queue.findIndex(x => x.team === current.team.id) + 1;
  $('buzz').disabled = !(online && q.open && !q.paused && !mine && !b.lockedOut && !current.settings.ended);
  $('buzzStatus').textContent = b.lockedOut ? 'Locked out — wrong answer on the last buzzer question' : mine === 'active' ? 'You buzzed first — give your answer!' :
    mine === 'queued' ? `Buzzed · you are #${position} in the queue` : mine === 'wrong' ? 'Ruled wrong' : mine === 'passed' ? 'Passed' : mine === 'correct' ? 'Correct!' :
    b.active ? `${b.active.name} is answering` : q.open ? 'Buzz when you know it!' : q.live ? 'Buzzing closed' : '';
  const canAgree = b.agreeOpen && !['active', 'passed', 'wrong'].includes(mine);
  $('agreeBox').hidden = !b.agreeOpen;
  $('agreeText').textContent = b.active ? `${b.active.name} answered “${b.announced || '…'}”. Do you agree?` : '';
  $('agree').disabled = !canAgree || b.agreed; $('agree').textContent = b.agreed ? '✓ You agreed' : 'I agree';
}
// Teams dab their own ticket, as on paper; dabs stay on this phone.
const dabKey = id => `pubquiz-dabs:${secret}:${id}`;
function buildTicket(q) {
  let dabs = []; try {dabs = JSON.parse(readStorage(dabKey(q.id)) || '[]');} catch {}
  $('ticket').replaceChildren(...q.bingo.card.map(row => {
    const tr = element('div', undefined, 'ticket-row');
    tr.append(...row.map(n => {
      if (n === null) return element('span', '', 'blank');
      const b = element('button', String(n)); b.type = 'button'; b.classList.toggle('dabbed', dabs.includes(n));
      b.onclick = () => {dabs = dabs.includes(n) ? dabs.filter(x => x !== n) : [...dabs, n]; writeStorage(dabKey(q.id), JSON.stringify(dabs)); b.classList.toggle('dabbed', dabs.includes(n));};
      return b;
    }));
    return tr;
  }));
}
function renderBingo(q) {
  const b = q.bingo;
  $('bingoMode').textContent = `${modes[b.mode]} · ${b.called.length} called`;
  $('bingoLast').textContent = b.last ?? '–';
  $('claimBingo').disabled = !(online && q.live && !q.paused && !b.claimed && !current.settings.ended);
  $('bingoStatus').textContent = b.claimed ? '✓ Bingo! Your claim was checked and counted.' : b.winners.length ? `Bingo called by ${b.winners.join(', ')} — claim now only if you have it on this number` : '';
}
function playerState(s) {
  current = s; offset = s.serverTime - Date.now(); $('join').hidden = true; $('game').hidden = false;
  $('team').textContent = s.team.name; $('code').textContent = secret; const q = s.question;
  if (q?.id !== renderedQuestion) {
    clearTimeout(draftTimer); draftGeneration++; localDraft = null; inputRevision = 0;
    renderedQuestion = q?.id; $('inputs').replaceChildren(); $('draftStatus').textContent = '';
    $('question').textContent = q?.text || 'Waiting for the quizmaster'; $('round').textContent = q?.round || '';
    renderMedia($('media'), q?.type === 'pinpoint' ? null : q);
    $('answerForm').hidden = ['buzzer', 'bingo'].includes(q?.type); $('buzzBox').hidden = q?.type !== 'buzzer'; $('bingoBox').hidden = q?.type !== 'bingo';
    if (q?.type === 'bingo') buildTicket(q);
    if (q) {
      buildInputs(q); syncPicks();
      const saved = readStorage(draftKey(q.id));
      if (saved) {try {localDraft = JSON.parse(saved);} catch {}}
      if (localDraft !== null) writeInputs(localDraft);
      else if (s.draft) {localDraft = parseSaved(s.draft.value); writeInputs(localDraft);}
      if (localDraft !== null) $('draftStatus').textContent = 'Draft restored — submit when ready';
    }
  }
  selectOptions($('sound'), sounds.map(([label], i) => [String(i), label]), document.activeElement === $('sound') ? undefined : String(s.team.sound ?? ''));
  if (s.answer && !['buzzer', 'bingo'].includes(q?.type)) {writeInputs(parseSaved(s.answer.value)); $('draftStatus').textContent = s.answer.points === undefined ? 'Your final answer is safely stored on the quiz laptop.' : `Your answer scored ${s.answer.points} ${Math.abs(s.answer.points) === 1 ? 'point' : 'points'}.`; localDraft = null; writeStorage(draftKey(q.id), '');}
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
  if (q?.type === 'pinpoint') renderPinpoint($('media'), q); else renderMedia($('media'), q);
  renderSolution($('solution'), q);
  if (q?.id !== renderedQuestion) {
    renderedQuestion = q?.id;
    const items = q?.type === 'choice' || q?.type === 'vote' ? q.options.map((o, i) => `${letters[i]}. ${o}`) : q?.type === 'sequence' ? q.order.map(i => q.items[i]) : q?.type === 'sheet' ? q.items : [];
    $('projectItems').replaceChildren(...items.map(text => element('li', text)));
  }
  const g = q?.bingo; $('projectBingo').hidden = !g;
  if (g) {
    $('bingoBig').textContent = g.last ?? '–'; $('bingoWinners').textContent = g.winners.length ? `BINGO! ${g.winners.join(', ')}` : `${modes[g.mode]} · ${g.called.length} called`;
    if ($('bingoBoard').children.length !== 90) $('bingoBoard').replaceChildren(...Array.from({length: 90}, (_, i) => element('span', String(i + 1))));
    [...$('bingoBoard').children].forEach((cell, i) => cell.classList.toggle('called', g.called.includes(i + 1)));
  }
  $('wheelSection').hidden = s.settings.displayMode !== 'wheel';
  if (s.settings.displayMode === 'wheel' && s.wheel) renderWheel(s.wheel, s.serverTime - s.wheel.spun < 3000);
  const b = q?.buzz; $('projectBuzz').hidden = !b;
  if (b) {
    $('buzzLeader').textContent = b.active ? `🔔 ${b.active.name}` : q.open ? 'Buzzers open' : '';
    $('buzzDetail').textContent = b.agreeOpen ? `“${b.announced}” — agree now! ${b.agreeCount} agreed` : b.queue.filter(x => x.status === 'queued').map(x => x.name).join(' · ');
    const leader = b.active?.name || ''; if (leader && leader !== lastBuzzer) buzzSound(leader, b.active.sound); lastBuzzer = leader;
  }
}
// The wheel always turns forwards and stops with the server's chosen segment under the pointer.
function renderWheel(wheel, fresh) {
  if (wheel.id === wheelId) return;
  const first = !fresh; wheelId = wheel.id;
  const svg = $('wheel'), n = wheel.items.length, ns = 'http://www.w3.org/2000/svg', slice = 360 / n;
  const node = (tag, attrs) => {const el = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); return el;};
  const spin = node('g', {}); spin.id = 'wheelSpin';
  wheel.items.forEach((item, i) => {
    const a = (i * slice - 90) * Math.PI / 180, b = ((i + 1) * slice - 90) * Math.PI / 180;
    spin.append(node('path', {d: `M0 0 L${100 * Math.cos(a)} ${100 * Math.sin(a)} A100 100 0 ${slice > 180 ? 1 : 0} 1 ${100 * Math.cos(b)} ${100 * Math.sin(b)} Z`, class: `slice s${i % 6}`}));
    const label = node('text', {x: 58, y: 0, transform: `rotate(${(i + 0.5) * slice - 90})`, class: 'wheel-label', 'dominant-baseline': 'middle', 'text-anchor': 'middle'}); label.textContent = item.length > 14 ? item.slice(0, 13) + '…' : item; spin.append(label);
  });
  svg.replaceChildren(spin, node('polygon', {points: '-7,-108 7,-108 0,-92', class: 'pointer'}));
  const target = 360 - (wheel.result + 0.5) * slice;
  wheelTurn = first ? target : wheelTurn - (wheelTurn % 360) + 360 * 6 + target;
  $('wheelResult').textContent = first ? wheel.items[wheel.result] : '';
  spin.style.transition = first ? 'none' : 'transform 6s cubic-bezier(.12,.6,.15,1)';
  requestAnimationFrame(() => requestAnimationFrame(() => {spin.style.transform = `rotate(${wheelTurn}deg)`;}));
  if (!first) setTimeout(() => {if (wheelId === wheel.id) $('wheelResult').textContent = `🎉 ${wheel.items[wheel.result]}`;}, 6100);
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
    if (role === 'player' && online && localDraft !== null) flushDraft();
  } catch (e) {
    online = false; $('connection').textContent = '● Connection lost — retrying';
    if (role === 'player') {
      if (e.status === 401) {secret = ''; writeStorage('pubquiz-team', ''); current = null; $('join').hidden = false; $('game').hidden = true; message('Your old recovery code is no longer valid. Ask the quizmaster for a new one.', true); updates.reconnect();}
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
  $('switchTeam').onclick = () => {if (!confirm('Switch teams on this browser? Save your current recovery code first.')) return; clearTimeout(draftTimer); secret = ''; writeStorage('pubquiz-team', ''); current = null; renderedQuestion = undefined; $('join').hidden = false; $('game').hidden = true; updates.reconnect(); refresh();};
  $('inputs').oninput = () => {
    localDraft = inputValue(); inputRevision++; writeStorage(draftKey(current.question.id), JSON.stringify(localDraft));
    $('draftStatus').textContent = online ? 'Saving draft…' : 'Draft kept in this browser — waiting for connection';
    clearTimeout(draftTimer); draftTimer = setTimeout(flushDraft, 500);
  };
  $('answerForm').onsubmit = async e => {
    e.preventDefault(); if ($('submit').disabled) return;
    const value = inputValue(), q = current.question;
    if (q.type === 'sheet' && value.some(v => !v.trim()) && !confirm('Some sheet answers are blank. Submit this as your final sheet?')) return;
    if ((q.type === 'sequence' && value.length !== q.items.length) || (typeof value === 'string' && !value.trim()) || (Array.isArray(value) && !value.length)) {
      return message(q.type === 'sequence' ? 'Place every item in order first' : q.type === 'pinpoint' ? 'Tap the picture first' : keypad(q.type) || q.type === 'multi' ? 'Choose an answer first' : 'Type an answer first', true);
    }
    submitting = true; updateControls(); clearTimeout(draftTimer);
    try {await api('answer', {question: q.id, value}, secret); message('Final answer received'); await refresh();}
    catch (e) {message(e.status ? e.message : 'Could not confirm submission. Reconnecting will check whether it was received.', true); await refresh();}
    finally {submitting = false; updateControls();}
  };
  for (const [id, route, done] of [['buzz', 'buzz', 'Buzzed!'], ['agree', 'agree', 'Agreement recorded'], ['claimBingo', 'bingo', 'BINGO! Checked and counted']]) $(id).onclick = async () => {
    $(id).disabled = true; enableSound();
    try {await api(route, {question: current.question.id}, secret); message(done); navigator.vibrate?.(80); if (id === 'buzz') buzzSound(current.team.name, current.team.sound);} catch (e) {message(e.message, true);}
    await updates.update();
  };
}
if (role === 'player') {
  $('sound').onchange = async () => {enableSound(); const sound = Number($('sound').value); buzzSound('', sound); try {await api('team/sound', {sound}, secret); message('Buzzer sound saved');} catch (e) {message(e.message, true);}};
}
if (role === 'display') $('enableSound').onclick = () => {enableSound(); $('enableSound').hidden = true;};
setInterval(() => {if (role === 'player') updateControls(); else if (current) $('status').textContent = timeText(current.question, offset);}, 200);
const updates = live(refresh, () => role === 'player' ? secret : '');
