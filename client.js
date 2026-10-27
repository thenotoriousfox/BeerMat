import {qrMatrix} from './qr.js';
import {t, setLanguage, language, languages, translatePage} from './i18n.js';
import {$, element, api, message, readStorage, writeStorage, renderMedia, renderBoard, renderSolution, timeText, letters, live, enableSound, buzzSound, useSounds, playSound, playClip, playEnding, stopSound, wheelTicks, stopWheelTicks, buzzerNames, renderPinpoint, selectOptions, bingoCall, seededOrder, fanfare, avatar, adjacent, renderSnake, tileWord} from './app.js';
const role = document.body.dataset.role;
let secret = readStorage('beermat-team'), current = null, renderedQuestion = 'unset', offset = 0, online = false, submitting = false, draftTimer, draftGeneration = 0;
let build = null, reloading = false, firstArmed = null, firstTimer, localDraft = null, inputRevision = 0, inFlight = false, lastBuzzer = '', wheelId = null, wheelTurn = 0, winnerShown = '';
const inputs = () => [...$('inputs').querySelectorAll('input,select')];
const draftKey = id => `beermat-draft:${secret}:${id}`;
const keypad = type => ['choice', 'vote', 'letter'].includes(type);
const listValue = type => ['sequence', 'multi', 'pinpoint', 'wordsnake', 'tiles'].includes(type);
const modes = {progressive: 'Full game', line: 'One line', twoLines: 'Two lines', fullHouse: 'Full house'}, mode = m => t(modes[m]);
// What the bingo game is playing for now, and who won the latest prize.
const stageText = g => g.over ? t('Game over') : g.mode === 'progressive' ? t('Playing for {stage}', {stage: mode(g.playingFor)}) : mode(g.mode);
const winText = g => {
  const names = g.winners.join(', ');
  if (g.mode !== 'progressive') return t('BINGO! {names}', {names});
  return t('{stage}: {names}', {stage: mode(g.lastStage), names}) + (g.over ? ' 🎉' : ' · ' + t('Playing for {stage}', {stage: mode(g.playingFor)}));
};
// Calls of "bingo!" waiting for the quizmaster, or one just turned down (until the next number), take over the status line.
const callCount = g => g.music ? g.played : g.count;
const shoutText = g => {
  const waiting = g.shouts.filter(x => x.status === 'pending').map(x => x.name);
  if (waiting.length) return t('🔔 {names} called BINGO! Checking…', {names: waiting.join(', ')});
  const last = g.shouts.at(-1);
  return last?.status === 'wrong' && last.seq === callCount(g) ? t('✗ {name}: not a bingo — eyes down, play on', {name: last.name}) : '';
};
function saveIdentity(code) {
  secret = code; current = null; renderedQuestion = 'unset'; localDraft = null; inputRevision = 0;
  if (!writeStorage('beermat-team', code)) $('storageWarning').textContent = t('Browser storage is unavailable. Write down your recovery code before closing this window.');
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
  $('submit').hidden = !q?.live || !!current.answer;
  $('awayNote').hidden = !(q?.open && !current.answer);
  $('status').textContent = q ? timeText(q, offset) : '';
  $('answerState').textContent = current.settings.ended ? t('Quiz finished') : q?.type === 'buzzer' || !q?.live ? '' : current.answer ? t('✓ Final answer saved') : q?.paused ? t('Paused') : '';
  // Timer bar: how much answering time is left (not shown for host-driven games).
  const timed = q && !['buzzer', 'bingo', 'musicbingo', 'clips'].includes(q.type) && (q.open || q.paused);
  $('timerBar').hidden = !timed;
  if (timed) {
    const left = q.paused ? q.remaining : Math.max(0, q.deadline - Date.now() - offset), fraction = Math.min(1, left / (q.seconds * 1000));
    $('timerBar').firstChild.style.width = `${fraction * 100}%`; $('timerBar').classList.toggle('low', fraction < 0.2);
  }
  if (q?.type === 'buzzer') renderBuzzer(q);
  if (q?.bingo) renderBingo(q);
  if (q?.type === 'clips') {
    const c = q.clipGame;
    $('tap').disabled = !(online && q.live && !q.paused && c.playing !== null && !c.tapped && !current.settings.ended);
    $('clipStatus').textContent = c.tapped ? t('You tapped: {clip}', {clip: c.tapped}) : c.playing ? t('🎵 Clip {n} of {count}', {n: c.playing, count: c.count}) : q.live ? t('Get ready — listen for the clips') : t('Clips finished');
  }
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
  if (q.type === 'wordsnake') {
    renderSnake($('snakeArea'), q.grid, list, q.wideCells || null, i => {
      if ($('submit').disabled || q.wideCells?.length && !q.wideCells.includes(i)) return;
      const last = list.at(-1), path = last === undefined || (!list.includes(i) && adjacent(last, i, q.grid.size)) ? [...list, i] : [i];
      pick(JSON.stringify(path));
    });
    $('snakeWord').textContent = list.map(i => q.grid.letters[i]).join('') || 'Tap the first letter';
    if ($('goWide')) $('goWide').hidden = !!q.wideCells;
  }
  if (q.type === 'tiles') {
    $('tileWord').textContent = tileWord(list.map(i => q.pieces[i]).join(''), q.wordLengths);
    $('inputs').querySelectorAll('[data-index]').forEach(b => b.classList.toggle('picked', list.includes(Number(b.dataset.index))));
  }
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
  try {
    const parsed = current.question.type === 'sheet' || listValue(current.question.type) ? JSON.parse(value) : value;
    return current.question.type === 'wordsnake' && parsed?.path ? parsed.path : parsed; // stored final answers carry {path, wide}
  } catch {return null;}
}
function buildInputs(q) {
  const box = $('inputs');
  // Scrambled keypads put buttons in a different place on every team's phone, so neighbours cannot copy taps.
  const order = length => current.settings.scrambleKeypads ? seededOrder(length, `${current.team.id}:${q.id}`) : Array.from({length}, (_, i) => i);
  if (q.type === 'buzzer' || q.type === 'bingo') return;
  const hiddenInput = () => {const hidden = element('input'); hidden.type = 'hidden'; hidden.name = 'answer-0'; box.append(hidden);};
  if (q.type === 'multi') {
    hiddenInput(); const pad = element('div', undefined, 'keypad');
    pad.append(...order(q.options.length).map(i => {const option = q.options[i], b = element('button', `${letters[i]}. ${option}`); b.type = 'button'; b.dataset.value = option; b.className = `opt o${i}`; b.onclick = () => {
      const picked = inputValue(); pick(JSON.stringify(picked.includes(option) ? picked.filter(p => p !== option) : [...picked, option]));
    }; return b;}));
    box.append(element('p', t('Tick every right answer — wrong ticks cost points'), 'muted'), pad); return;
  }
  if (q.type === 'wordsnake') {
    hiddenInput(); const area = element('div'); area.id = 'snakeArea';
    const word = element('p', '', 'tile-word'); word.id = 'snakeWord';
    const clear = element('button', t('Start again'), 'subtle'); clear.type = 'button'; clear.onclick = () => pick('[]');
    box.append(element('p', t('Trace the answer: each letter touches the last, diagonals too. Tapping a letter that does not touch starts again.'), 'muted'), area, word, clear);
    if (q.goWide) {
      const wide = element('button', t('Go wide (scores {n})', {n: q.goWidePoints}), 'subtle'); wide.type = 'button'; wide.id = 'goWide';
      wide.onclick = async () => {
        if (!confirm(t('Go wide? The decoy letters disappear, but a right answer scores {wide} instead of {full}.', {wide: q.goWidePoints, full: q.points}))) return;
        try {await api('gowide', {question: q.id}, secret); pick('[]'); await updates.update();} catch (e) {message(e.message, true);}
      };
      box.append(wide);
    }
    return;
  }
  if (q.type === 'tiles') {
    hiddenInput(); const word = element('p', '', 'tile-word'); word.id = 'tileWord';
    const pad = element('div', undefined, 'keypad tiles');
    // Tiles always appear in a different order on each team's phone.
    pad.append(...seededOrder(q.pieces.length, `${current.team.id}:${q.id}`).map(i => {
      const b = element('button', q.pieces[i]); b.type = 'button'; b.dataset.index = String(i);
      b.onclick = () => {const picked = inputValue(); if (!picked.includes(i)) pick(JSON.stringify([...picked, i]));}; return b;
    }));
    const undo = element('button', t('Undo last'), 'subtle'); undo.type = 'button'; undo.onclick = () => pick(JSON.stringify(inputValue().slice(0, -1)));
    box.append(element('p', t('Tap the tiles in order to build the answer'), 'muted'), word, pad, undo); return;
  }
  if (q.type === 'pinpoint') {
    hiddenInput(); const area = element('div'); area.id = 'pinArea';
    const undo = element('button', t('Undo tap'), 'subtle'); undo.type = 'button'; undo.onclick = () => pick(JSON.stringify(inputValue().slice(0, -1)));
    box.append(element('p', q.goWide ? t('Tap the picture. Go wide: a second tap scores {n} if your first misses.', {n: q.goWidePoints}) : t('Tap the picture to place your answer'), 'muted'), area, undo); return;
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
    if (q.type === 'letter') pad.append(...order(26).map(i => letters[i]).map(l => {const b = element('button', l); b.type = 'button'; b.dataset.value = l; b.onclick = () => pick(l); return b;}));
    else if (q.type === 'sequence') {
      pad.append(...order(q.order.length).map(i => q.order[i]).map(i => {const b = element('button', q.items[i]); b.type = 'button'; b.dataset.index = String(i); b.onclick = () => {
        const picked = inputValue(); if (!picked.includes(i)) pick(JSON.stringify([...picked, i]));
      }; return b;}));
      const chosen = element('ol', undefined, 'picked'); chosen.id = 'picked';
      const undo = element('button', t('Undo last'), 'subtle'); undo.type = 'button'; undo.onclick = () => pick(JSON.stringify(inputValue().slice(0, -1)));
      box.append(element('p', t('Tap the items in order'), 'muted'), pad, chosen, undo); return;
    } else pad.append(...order(q.options.length).map(i => {const option = q.options[i], b = element('button', `${letters[i]}. ${option}`); b.type = 'button'; b.dataset.value = option; b.className = `opt o${i}`; b.onclick = () => pick(option); return b;}));
    box.append(pad); return;
  }
  const label = element('label', q.type === 'nearest' ? t('Your number (closest wins)') : q.type === 'number' ? t('Your number') : t('Your answer')), input = element('input');
  input.name = 'answer-0'; input.autocomplete = 'off'; input.maxLength = 300; input.type = 'text';
  if (q.type === 'number' || q.type === 'nearest') {input.inputMode = 'decimal'; input.pattern = '-?[0-9]+(\\.[0-9]+)?';}
  label.append(input); box.append(label);
}
function renderBuzzer(q) {
  const b = q.buzz, mine = b.buzzed, queue = b.queue.filter(x => ['active', 'queued'].includes(x.status));
  const position = queue.findIndex(x => x.team === current.team.id) + 1;
  // Passed on to this team after another's wrong answer: their turn now.
  if (mine === 'active' && myTurn !== q.id) {myTurn = q.id; nudge([200, 80, 200]);}
  $('buzz').disabled = !(online && q.open && !q.paused && !mine && !b.lockedOut && !current.settings.ended);
  $('buzzStatus').textContent = b.lockedOut ? t('Locked out — wrong answer on the last buzzer question') : mine === 'active' ? t('You buzzed first — give your answer!') :
    mine === 'queued' ? t('Buzzed · you are #{n} in the queue', {n: position}) : mine === 'wrong' ? t('Ruled wrong') : mine === 'passed' ? t('Passed') : mine === 'correct' ? t('Correct!') :
    b.active ? t('{name} is answering', {name: b.active.name}) : q.open ? t('Buzz when you know it!') : q.live ? t('Buzzing closed') : '';
  const canAgree = b.agreeOpen && !['active', 'passed', 'wrong'].includes(mine);
  $('agreeBox').hidden = !b.agreeOpen;
  $('agreeText').textContent = b.active ? t('{name} answered “{answer}”. Do you agree?', {name: b.active.name, answer: b.announced || '…'}) : '';
  $('agree').disabled = !canAgree || b.agreed; $('agree').textContent = b.agreed ? t('✓ You agreed') : t('I agree');
}
// Teams dab their own ticket, as on paper; dabs stay on this phone.
const dabKey = id => `beermat-dabs:${secret}:${id}`;
function buildTicket(q) {
  let dabs = []; try {dabs = JSON.parse(readStorage(dabKey(q.id)) || '[]');} catch {}
  $('ticket').classList.toggle('music', !!q.bingo.music);
  $('ticket').replaceChildren(...q.bingo.card.map(row => {
    const tr = element('div', undefined, 'ticket-row');
    tr.append(...row.map(n => {
      if (n === null) return element('span', '', 'blank');
      const b = element('button', String(n)); b.type = 'button'; if (q.bingo.colours) b.dataset.colour = q.bingo.colours[n - 1]; b.classList.toggle('dabbed', dabs.includes(n));
      b.onclick = () => {dabs = dabs.includes(n) ? dabs.filter(x => x !== n) : [...dabs, n]; writeStorage(dabKey(q.id), JSON.stringify(dabs)); b.classList.toggle('dabbed', dabs.includes(n));};
      return b;
    }));
    return tr;
  }));
}
function renderBingo(q) {
  const b = q.bingo;
  if (b.music) {
    $('bingoMode').textContent = t('Music bingo · {mode} · {n} played', {mode: stageText(b), n: b.played});
    delete $('bingoLast').dataset.colour; $('bingoLast').textContent = b.played ? t('Song {n}', {n: b.played}) : '–'; $('bingoPhrase').textContent = b.titles.length ? t('Revealed: {title}', {title: b.titles.at(-1)}) : '';
  } else {
    $('bingoMode').textContent = t('{mode} · {n} called', {mode: stageText(b), n: b.count});
    $('bingoLast').dataset.colour = b.last && b.colours?.[b.last - 1] || ''; $('bingoLast').textContent = b.last ?? '–'; $('bingoPhrase').textContent = current.settings.bingoPhrases && b.last ? b.phrase ?? bingoCall(b.last) : '';
  }
  const mine = b.myShout, checking = mine?.status === 'pending', turnedDown = mine?.status === 'wrong' && mine.seq === callCount(b);
  $('claimBingo').disabled = !(online && q.live && !q.paused && !b.claimed && !b.over && !current.settings.ended && !checking && !turnedDown);
  $('bingoStatus').textContent = b.claimed ? t('✓ Bingo! The quizmaster says yes.') : checking ? t('Your BINGO call is being checked…') : turnedDown ? t('Not a bingo this time — keep playing') : shoutText(b) || (b.winners.length ? winText(b) : '');
}
function playerState(s) {
  current = s; writeStorage('beermat-event', s.event || ''); offset = s.serverTime - Date.now(); $('join').hidden = true; $('game').hidden = false;
  $('team').textContent = s.team.name; $('code').textContent = secret; const q = s.question;
  // Once the quiz is finished, a player may keep the team's result (signed by the quiz laptop) in an online profile.
  $('keepResult').hidden = !s.settings.ended || s.team.waiting || !(appPlatform || s.settings.onlineService);
  // A team in the waiting room sees only a holding screen until the quizmaster lets it in.
  const shown = s.team.waiting ? 'waiting' : q?.id;
  if (shown !== renderedQuestion) {
    // A new question while this page was already showing one: a short buzz in the pocket.
    if (q?.open && !s.team.waiting && seenQuestion !== null && seenQuestion !== q.id) nudge([120, 60, 120]);
    if (q) seenQuestion = q.id; else seenQuestion ??= 0;
    clearTimeout(draftTimer); draftGeneration++; localDraft = null; inputRevision = 0;
    renderedQuestion = shown; $('inputs').replaceChildren(); $('draftStatus').textContent = '';
    $('question').textContent = s.team.waiting ? t('You’re in the waiting room — the quizmaster will let you in shortly') : q ? q.text : t('You’re in! Waiting for the quiz to start'); $('round').textContent = q?.round || '';
    $('game').classList.toggle('idle', !q);
    renderMedia($('media'), q?.type === 'pinpoint' ? null : q);
    const bingo = q?.type === 'bingo' || q?.type === 'musicbingo';
    $('answerForm').hidden = !q || bingo || ['buzzer', 'clips'].includes(q?.type); $('buzzBox').hidden = q?.type !== 'buzzer'; $('bingoBox').hidden = !bingo; $('clipBox').hidden = q?.type !== 'clips';
    if (bingo) buildTicket(q);
    if (q) {
      buildInputs(q); syncPicks();
      const saved = readStorage(draftKey(q.id));
      if (saved) {try {localDraft = JSON.parse(saved);} catch {}}
      if (localDraft !== null) writeInputs(localDraft);
      else if (s.draft) {localDraft = parseSaved(s.draft.value); writeInputs(localDraft);}
      if (localDraft !== null) $('draftStatus').textContent = t('Draft restored — submit when ready');
    }
  }
  // Until the quiz starts (or while a team waits to be let in) the phone shows the waiting screen, with the team's
  // photo and buzzer sound on it; after that they are in the team menu.
  const lobby = s.team.waiting || !q;
  $('waitingSetup').hidden = !lobby;
  if (lobby && !$('waitingSetup').contains($('teamSetup'))) $('waitingSetup').append($('teamSetup'));
  if (!lobby && !$('teamMenu').contains($('teamSetup'))) $('code').nextElementSibling.after($('teamSetup'));
  $('photoDetails').hidden = !s.settings.teamPhotos; $('myPhoto').hidden = !s.team.photo;
  if (s.team.photo && $('myPhoto').getAttribute('src') !== s.team.photo) $('myPhoto').src = s.team.photo;
  $('photoStatus').textContent = !s.team.photo ? t('Add a team photo to appear on the big screen. The quizmaster approves it first.') : s.team.photoStatus === 'approved' ? t('✓ Approved — showing on the big screen') : t('Waiting for the quizmaster to approve it');
  selectOptions($('sound'), buzzerNames().map((label, i) => [String(i), label]), document.activeElement === $('sound') ? undefined : String(s.team.sound ?? ''));
  if (s.answer && !['buzzer', 'bingo', 'musicbingo', 'clips'].includes(q?.type)) {writeInputs(parseSaved(s.answer.value)); $('draftStatus').textContent = s.answer.points === undefined ? (q.secret && !q.live ? t('Secret round: you find out how you did when the quiz ends.') : t('Your final answer is safely stored on the quiz laptop.')) : ''; localDraft = null; writeStorage(draftKey(q.id), '');}
  renderResult(s);
  // Between questions the phone shows the leaderboard; during one, only the question.
  $('boardSection').hidden = !!q?.live;
  const me = s.teams.find(team => team.id === s.team.id);
  $('myScore').textContent = !me ? '' : me.score === null ? t('#{rank}', {rank: me.rank}) : t('#{rank} · {score} pts', {rank: me.rank, score: me.score});
  $('menuButton').hidden = false;
  if (q && listValue(q.type)) syncPicks();
  renderSolution($('solution'), q); updateControls();
}
// After a question: a clear ✓ / ✗ card with the points it earned.
function renderResult(s) {
  const q = s.question, a = s.answer, done = q && !q.live && q.type !== 'vote';
  $('resultCard').hidden = !done || (a && a.points === undefined);
  if (!done) return;
  const points = a?.points ?? 0;
  $('resultCard').className = `result-card ${points > 0 ? 'good' : 'bad'}`;
  $('resultMark').textContent = !a ? '–' : points > 0 ? '✓' : '✗';
  $('resultPoints').textContent = !a ? t('No answer this time') : points > 0 ? (points === 1 ? t('+1 point') : t('+{n} points', {n: points})) : points < 0 ? t('{n} points', {n: points}) : t('No points this time');
}
function sharedState(s) {
  // Phones may be on a sign-in probe address (hotspot-detect.html and the like), so they come back to the quiz's own page.
  if (build && s.build !== build) {if (!reloading) {reloading = true; if (role === 'player') location.replace('/'); else location.reload();} return;}
  build = s.build;
  useSounds(s.sounds);
  // The quizmaster's look for this question (colours only; see style.css).
  document.documentElement.dataset.look = s.look || 'stage';
  $('title').textContent = s.settings.title; document.title = s.settings.title + ' — ' + (role === 'player' ? 'Team' : 'Projector');
  renderBoard($('leaderboard'), s.teams); if (role === 'display') applyReveal(s);
  $('boardStatus').textContent = s.settings.secretRound ? t('Secret round: the scores stay hidden until the end of the quiz.') : !s.settings.leaderboardVisible ? t('The quizmaster has hidden scores for now.') : s.settings.ended ? t('Final standings') : s.teams.length ? t('Ties share the same rank.') : t('Waiting for teams');
}
function renderQr(container, text) {
  if (container.dataset.qr === text) return;
  container.dataset.qr = text;
  const m = qrMatrix(text), n = m.length, ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg'), path = document.createElementNS(ns, 'path');
  svg.setAttribute('viewBox', `-4 -4 ${n + 8} ${n + 8}`); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'QR code: ' + text); svg.setAttribute('shape-rendering', 'crispEdges');
  path.setAttribute('d', m.flatMap((row, y) => row.map((dark, x) => dark ? `M${x} ${y}h1v1h-1z` : '')).join(''));
  svg.append(path); container.replaceChildren(svg);
}
function displayState(s) {
  current = s; offset = s.serverTime - Date.now();
  const {joinSsid, joinUrl, joinPassword, registrationOpen, ended, online} = s.settings, joining = registrationOpen && !ended, address = joinUrl.replace(/^https?:\/\//, '');
  // The code always opens the quiz page; on the quiz Wi-Fi or the venue's network, phones join that Wi-Fi first.
  const lan = !online && s.settings.joinMode === 'lan', locked = !online && !lan && !!joinPassword;
  $('projection').hidden = s.view === 'blank';
  $('joinSection').hidden = s.view !== 'join';
  if (s.view === 'join') {
    renderQr($('quizQr'), joinUrl);
    $('joinStepWifi').hidden = !!online;
    $('joinStepWifi').textContent = online ? '' : locked ? t('Join the “{ssid}” Wi-Fi (password: {password})', {ssid: joinSsid, password: joinPassword}) : t('Join the “{ssid}” Wi-Fi first', {ssid: joinSsid});
    $('joinStepUrl').textContent = t('Or go to {url}', {url: address});
    $('joinWifiNote').hidden = !!online || lan;
    $('joinStatus').textContent = !joining ? t('Registration is closed — ask the quizmaster to join') : s.teams.length ? (s.teams.length === 1 ? t('1 team has joined') : t('{n} teams have joined', {n: s.teams.length})) : t('Be the first team to join!');
  }
  $('joinHint').textContent = !joining ? '' : online ? t('Join: {url}', {url: address}) : t('Join: Wi-Fi “{ssid}” → {url}', {ssid: joinSsid, url: address});
  $('boardSection').hidden = s.view !== 'leaderboard'; $('projectQuestion').hidden = s.view !== 'question';
  const q = s.question; $('question').textContent = q?.text || t('Waiting for the quizmaster'); $('round').textContent = q?.round || ''; $('status').textContent = timeText(q, offset);
  if (q?.type === 'pinpoint') renderPinpoint($('media'), q); else renderMedia($('media'), q);
  renderSolution($('solution'), q); $('projectQuestion').classList.toggle('revealed', !!q?.revealed);
  renderFirst(q);
  if (q?.id !== renderedQuestion) {
    renderedQuestion = q?.id;
    const items = q?.type === 'choice' || q?.type === 'vote' || q?.type === 'multi' ? q.options.map((o, i) => `${letters[i]}. ${o}`) : q?.type === 'sequence' ? q.order.map(i => q.items[i]) : q?.type === 'sheet' ? q.items : q?.type === 'tiles' ? [tileWord('', q.wordLengths), q.pieces.join('  ·  ')] : [];
    $('projectItems').replaceChildren(...items.map(text => element('li', text)));
    // Answer options show as coloured tiles matching the phone keypad.
    $('projectItems').classList.toggle('options', ['choice', 'vote', 'multi'].includes(q?.type));
  }
  $('projectSnake').hidden = q?.type !== 'wordsnake';
  if (q?.type === 'wordsnake') renderSnake($('projectSnake'), q.grid, q.revealed ? q.snakePath : []);
  const c = q?.clipGame; $('projectClips').hidden = !c;
  if (c) {$('clipNow').textContent = c.playing ? t('🎵 Clip {n} of {count}', {n: c.playing, count: c.count}) : q.live ? t('Listen carefully…') : t('Clips finished'); $('clipTaps').textContent = t('{n} teams have tapped', {n: c.taps});}
  const g = q?.bingo; $('projectBingo').hidden = !g;
  if (g) {
    $('bingoBoard').classList.toggle('music', !!g.music); $('bingoBoard').hidden = !g.board;
    if (g.music) {
      delete $('bingoBig').dataset.colour; $('bingoBig').textContent = g.played ? '🎵 ' + t('Song {n}', {n: g.played}) : '🎵'; $('bingoCallText').textContent = g.titles.length ? t('Last revealed: {title}', {title: g.titles.at(-1)}) : '';
      $('bingoWinners').textContent = shoutText(g) || (g.winners.length ? winText(g) : t('Music bingo · {mode}', {mode: stageText(g)}));
      $('bingoBoard').replaceChildren(...[...g.titles].reverse().map(title => element('span', title, 'called')));
    } else {
      $('bingoBig').dataset.colour = g.last && g.colours?.[g.last - 1] || ''; $('bingoBig').textContent = g.last ?? '–'; $('bingoCallText').textContent = s.settings.bingoPhrases && g.last ? g.phrase ?? bingoCall(g.last) : '';
      $('bingoWinners').textContent = shoutText(g) || (g.winners.length ? winText(g) : t('{mode} · {n} called', {mode: stageText(g), n: g.count}));
      if ($('bingoBoard').children.length !== 90 || $('bingoBoard').firstChild.textContent !== '1') $('bingoBoard').replaceChildren(...Array.from({length: 90}, (_, i) => element('span', String(i + 1))));
      [...$('bingoBoard').children].forEach((cell, i) => {cell.classList.toggle('called', !!g.called?.includes(i + 1)); cell.dataset.colour = g.colours?.[i] || '';});
    }
  }
  $('wheelSection').hidden = s.view !== 'wheel';
  if (s.view !== 'wheel') stopWheelTicks();
  $('leaderboard').classList.toggle('cols', s.teams.length > 10);
  renderCountdown(); fitTitle(); fitStage(); soundCues(s);
  $('winnerSection').hidden = s.view !== 'winner';
  if (s.view === 'winner') renderWinner(s); else winnerShown = '';
  if (s.view === 'wheel' && s.wheel) renderWheel(s.wheel, s.serverTime - s.wheel.spun < 3000);
  const b = q?.buzz; $('projectBuzz').hidden = !b;
  if (b) {
    $('buzzLeader').textContent = b.active ? `🔔 ${b.active.name}` : q.open ? t('Buzzers open') : '';
    if (b.active?.photo) $('buzzLeader').prepend(avatar(b.active.photo));
    $('buzzDetail').textContent = b.agreeOpen ? `“${b.announced}” — agree now! ${b.agreeCount} agreed` : b.queue.filter(x => x.status === 'queued').map(x => x.name).join(' · ');
    const leader = b.active?.name || ''; if (leader && leader !== lastBuzzer) buzzSound(leader, b.active.sound); lastBuzzer = leader;
  }
}
// Fastest fingers and closest wins: at the reveal, the team that came first fills the TV for a few seconds with its
// photo, name and buzzer sound. Only a reveal seen happening does this, not one already shown when the page loads.
function renderFirst(q) {
  if (q && !q.revealed) firstArmed = q.id;
  if (String(q?.id) !== $('firstPlace').dataset.question) {clearTimeout(firstTimer); $('firstPlace').hidden = true;}
  if (!q?.revealed || firstArmed !== q.id) return;
  firstArmed = null;
  const f = q.first; if (!f) return;
  const box = $('firstPlace'); box.dataset.question = q.id;
  $('firstKind').textContent = f.kind === 'tieBreaker' ? t('TIE-BREAKER WINNER') : f.kind === 'nearest' ? t('CLOSEST ANSWER') : t('FASTEST FINGERS');
  $('firstPhoto').replaceChildren(f.photo ? avatar(f.photo) : element('span', [...f.name][0].toUpperCase(), 'avatar first-initial'));
  $('firstName').textContent = f.name;
  $('firstDetail').textContent = f.kind !== 'fastest' ? t('Answered {answer}', {answer: f.answer}) : t('{s}s', {s: (f.ms / 1000).toFixed(1)});
  box.hidden = false; box.classList.remove('show'); void box.offsetWidth; box.classList.add('show');
  buzzSound(f.name, f.sound);
  clearTimeout(firstTimer); firstTimer = setTimeout(() => {box.hidden = true;}, 7000);
}
// First place's turn in the leaderboard reveal: it fills the TV for a few seconds (photo, name, points, buzzer sound)
// with the whole board behind it. Teams tied for first share the moment.
function showLeader(s) {
  const top = s.teams.filter(team => team.rank === 1).slice(0, 4); if (!top.length) return;
  const box = $('firstPlace'); box.dataset.question = String(s.question?.id);
  $('firstKind').textContent = top.length > 1 ? t('TIED FOR FIRST') : t('IN FIRST PLACE');
  $('firstPhoto').replaceChildren(...top.map(team => team.photo ? avatar(team.photo) : element('span', [...team.name][0].toUpperCase(), 'avatar first-initial')));
  $('firstName').textContent = top.map(team => team.name).join(' & ');
  $('firstDetail').textContent = top[0].score === null ? '' : t('{n} points', {n: top[0].score});
  box.hidden = false; box.classList.remove('show'); void box.offsetWidth; box.classList.add('show');
  cheerLeaders(top, 600);
  clearTimeout(firstTimer); firstTimer = setTimeout(() => {box.hidden = true;}, 5000 + (top.length - 1) * 2500);
}
// The leaderboard revealed from the desk, position by position from the bottom: rows wait hidden until their turn,
// and first place gets the spotlight (showLeader, from soundCues) when its turn comes.
function applyReveal(s) {
  const r = s.reveal, rows = [...$('leaderboard').children], shown = r && !r.done ? r.shown : Infinity;
  rows.forEach((li, i) => li.classList.toggle('shown', rows.length - i <= shown));
  $('leaderboard').classList.toggle('revealing', shown !== Infinity);
}
// The wheel always turns forwards and stops with the server's chosen segment under the pointer. It clicks each time
// a segment edge passes the pointer, so the clicks slow down with the wheel.
const wheelSpinMs = 6000, wheelEasing = [0.12, 0.6, 0.15, 1];
// When (ms into the spin) each segment edge passes the pointer, following the same cubic-bezier the CSS uses.
// Edges sit at whole multiples of `slice` degrees of turn.
function wheelCrossings(from, to, slice) {
  const [x1, y1, x2, y2] = wheelEasing, curve = (u, a, b) => 3 * a * u * (1 - u) ** 2 + 3 * b * u * u * (1 - u) + u ** 3;
  const times = []; let lastTime = 0, lastTurn = from;
  for (let i = 1; i <= 4000; i++) {
    const u = i / 4000, time = curve(u, x1, x2), turn = from + (to - from) * curve(u, y1, y2);
    for (let k = Math.floor(lastTurn / slice) + 1; k * slice <= turn; k++) times.push((lastTime + (time - lastTime) * (k * slice - lastTurn) / (turn - lastTurn)) * wheelSpinMs);
    lastTime = time; lastTurn = turn;
  }
  return times;
}
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
  const target = 360 - (wheel.result + 0.5) * slice, from = wheelTurn;
  wheelTurn = first ? target : wheelTurn - (wheelTurn % 360) + 360 * 6 + target;
  $('wheelResult').textContent = first ? wheel.items[wheel.result] : '';
  spin.style.transition = first ? 'none' : `transform ${wheelSpinMs}ms cubic-bezier(${wheelEasing})`;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    spin.style.transform = `rotate(${wheelTurn}deg)`;
    if (first) return;
    wheelTicks(wheelCrossings(from, wheelTurn, slice));
    setTimeout(() => {if (wheelId === wheel.id) $('wheelResult').textContent = `🎉 ${wheel.items[wheel.result]}`;}, wheelSpinMs + 100);
  }));
}
// Sound effects on the TV, from the quizmaster's imported files: each plays when the quiz state changes, never on
// first load. Music loops while a question without its own audio is open.
let heard = null, musicOn = false, countdownFor = null;
// The final countdown is timed to end at the deadline; the answering music stops when it starts.
function countdownCue() {
  const q = current?.question, timed = !!q?.open && !q.paused && !quiet(q);
  const left = q?.deadline - Date.now() - offset;
  // At time's up the countdown rings out; it is cut short only if the question closes early or pauses.
  if (!timed) {if (countdownFor !== null) {if (!q || q.paused || left > 300) stopSound('countdown'); countdownFor = null;} return;}
  if (countdownFor !== q.id && left > 300 && playEnding('countdown', left)) {countdownFor = q.id; stopSound('timerMusic'); musicOn = false;}
}
const silentTypes = ['audio', 'clips', 'musicbingo', 'buzzer', 'bingo'];
// Questions with their own sound (a file or a Spotify song) get no answering music or countdown over it.
const quiet = q => silentTypes.includes(q.type) || q.playsSong || /\.(mp3|ogg|wav)$/i.test(q.media || '');
function soundCues(s) {
  const q = s.question, before = heard;
  heard = {id: q?.id, round: q?.round, open: !!q?.open, revealing: !!q?.revealing, revealed: !!q?.revealed, calls: q?.bingo?.count ?? 0, shouts: Object.fromEntries((q?.bingo?.shouts || []).map(x => [x.id, x.status])),
    buzz: Object.fromEntries((q?.buzz?.queue || []).map(b => [b.team, b.status])), view: s.view, boardDone: s.reveal?.done ? s.reveal.question : null};
  const music = !!q?.open && !q.paused && !quiet(q) && countdownFor !== q.id;
  if (music !== musicOn) {musicOn = music; if (music) playSound('timerMusic', true); else stopSound('timerMusic');}
  if (!before) return;
  if (s.view === 'leaderboard' && before.view === 'question' && s.settings.displayMode === 'auto') playSound('endRound');
  if (s.reveal?.done && before.boardDone !== s.reveal.question) showLeader(s);
  if (q && q.id !== before.id && q.live) {if (!(q.round && q.round !== before.round && playSound('startRound'))) playSound('questionStart');}
  if (q?.id !== before.id) return;
  // A countdown that ran to the end has its own ring-out, so time's up only sounds without one.
  if (before.open && !heard.open && !['buzzer', 'bingo', 'musicbingo', 'clips'].includes(q.type) && countdownFor !== q.id) playSound('timeUp');
  // The drum roll plays while the reveal is held back; the answer appears as it ends.
  if (heard.revealing && !before.revealing) playSound('reveal');
  for (const [team, status] of Object.entries(heard.buzz)) if (status !== before.buzz[team]) {if (status === 'correct') playSound('correct'); if (status === 'wrong') playSound('wrong');}
  // A called number: its chime, then the caller saying the call.
  if (q?.type === 'bingo' && heard.calls > before.calls) {playSound('bingoCall'); const voice = q.bingo.voice; if (voice) setTimeout(() => playClip(voice), 250);}
  // A shout of "bingo!" sounds straight away; the quizmaster's verdict then sounds right or wrong.
  for (const [id, status] of Object.entries(heard.shouts)) if (status !== before.shouts[id]) {
    if (status === 'pending') playSound('bingo'); else {stopSound('bingo'); playSound(status === 'correct' ? 'correct' : 'wrong');}
  }
}
// The event name stays on one line on the TV: its text shrinks until it fits beside the countdown and buttons.
let titleFit = '';
function fitTitle() {
  const h1 = $('title'); if (role !== 'display' || !h1) return;
  // Only when the name, the countdown or the screen changes.
  const key = `${h1.textContent}|${$('countdown').hidden}|${innerWidth}x${innerHeight}`; if (key === titleFit) return; titleFit = key;
  h1.style.fontSize = '';
  for (let size = parseFloat(getComputedStyle(h1).fontSize); h1.scrollWidth > h1.clientWidth && size > 14; size -= 1) h1.style.fontSize = size - 1 + 'px';
}
// The TV never scrolls: the visible view is scaled down until it fits the space under the header.
// A narrower scale makes the view wider, so text reflows shorter; a few rounds settle it.
function fitStage() {
  const stage = $('stage'), section = stage && [...stage.children].find(s => !s.hidden);
  if (!section) return;
  let fit = 1;
  for (let i = 0; i < 4; i++) {
    section.style.setProperty('--fit', fit);
    const next = Math.min(1, Math.floor(stage.clientHeight / section.offsetHeight * 1000) / 1000);
    if (Math.abs(next - fit) < 0.005) break;
    fit = next;
  }
  section.style.setProperty('--fit', fit);
  while (section.offsetHeight * fit > stage.clientHeight && fit > 0.2) section.style.setProperty('--fit', fit -= 0.02);
}
// The quizmaster's countdown sits over every TV view; at zero it says so and beeps once.
let countdownDone = null;
function renderCountdown() {
  const timer = current?.timer, box = $('countdown');
  box.hidden = !timer;
  if (!timer) return;
  const left = timer.endsAt === null ? timer.remaining : Math.max(0, timer.endsAt - Date.now() - offset), secs = Math.ceil(left / 1000);
  $('countdownLabel').textContent = timer.label;
  $('countdownTime').textContent = left > 0 ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` : t('Time’s up!');
  box.classList.toggle('paused', timer.endsAt === null); box.classList.toggle('low', left > 0 && left <= 10000); box.classList.toggle('done', left <= 0);
  if (left <= 0 && countdownDone !== timer.id) {countdownDone = timer.id; if (timer.endsAt !== null && Date.now() + offset - timer.endsAt < 3000 && !playSound('timeUp')) buzzSound('', 3);}
  else if (left > 0 && countdownDone === timer.id) countdownDone = null;
}
// The team in first place hears its own buzzer sound when the leaderboard comes up and when it wins; teams tied for
// first take turns.
function cheerLeaders(teams, delay) {
  teams.filter(team => team.rank === 1).slice(0, 4).forEach((team, i) => setTimeout(() => buzzSound(team.name, team.sound), delay + i * 2500));
}
function renderWinner(s) {
  const top = s.teams.filter(t => t.rank === 1), names = top.map(t => t.name).join(' & ');
  $('winnerName').textContent = !s.settings.leaderboardVisible ? t('Scores are hidden for now') : names || t('No teams yet');
  $('winnerPhotos').replaceChildren(...(s.settings.leaderboardVisible ? top.filter(t => t.photo).map(t => avatar(t.photo)) : []));
  $('winnerScore').textContent = top.length && s.settings.leaderboardVisible && top[0].score !== null ? t(top.length > 1 ? '{n} points — a tie!' : '{n} points', {n: top[0].score}) : '';
  $('podium').replaceChildren(...s.teams.filter(t => t.rank > 1 && t.rank <= 3).map(t => {const li = element('li'); li.append(element('span', `${t.rank === 2 ? '🥈' : '🥉'} ${t.name}`), element('strong', t.score === null ? '' : `${t.score} pts`)); return li;}));
  if (names && names !== winnerShown) {
    winnerShown = names; fanfare(); cheerLeaders(s.teams, 2500);
    // Confetti pieces fall once; reduced-motion users see a still screen (see style.css).
    $('confetti').replaceChildren(...Array.from({length: 80}, (_, i) => {
      const piece = element('span'); piece.style.left = `${Math.random() * 100}%`; piece.style.animationDelay = `${Math.random() * 1.5}s`;
      piece.style.animationDuration = `${2.5 + Math.random() * 2}s`; piece.className = 'c' + (i % 5); return piece;
    }));
  }
}
async function publicState() {
  const response = await fetch('/api/leaderboard', {signal: AbortSignal.timeout(8000)}); if (!response.ok) throw Error(t('Cannot reach quiz server')); return response.json();
}
let initialised = false, deviceChecked = false, lastSettings = null;
// Inside the BeerMat app (its web view adds BeerMatApp/<version> to the user agent): a way back to the app's
// own screens, and results handed to it for the player's profile. Everyone else plays exactly the same in a browser.
const appPlatform = /BeerMatApp\/[\d.]+ \((ios|android)\)/.exec(navigator.userAgent)?.[1] || null;
const appHome = appPlatform === 'ios' ? 'capacitor://localhost/' : appPlatform ? 'http://localhost/' : null;
// Vibration (where the phone supports it): on by default in the app, off in a browser until switched on.
const vibrateOn = () => (readStorage('beermat-vibrate') || (appPlatform ? '1' : '0')) === '1';
const nudge = pattern => {if (vibrateOn()) navigator.vibrate?.(pattern);};
let seenQuestion = null, myTurn = null;
// A phone that already joined (for example in the Wi-Fi sign-in window) is offered its team back.
async function checkDevice() {
  deviceChecked = true;
  try {
    const {team} = await api('device');
    $('continueBox').hidden = !team;
    if (team) {$('continueText').textContent = t('This phone was playing as {name}.', {name: team.name}); $('continueTeam').textContent = t('Continue as {name}', {name: team.name});}
  } catch {}
}
// Leaving the page during an open question (switching app, locking the phone) is reported to the quizmaster.
function reportAway(state) {
  const q = current?.question;
  if (!secret || !q?.live || current.answer) return;
  fetch('/api/away', {method: 'POST', keepalive: true, headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + secret}, body: JSON.stringify({question: q.id, state})}).catch(() => {});
}
async function refresh() {
  try {
    const asTeam = role === 'player' ? secret : '';
    const s = asTeam ? await api('state', {}, asTeam) : await publicState();
    // A team joined or switched while this was loading; the refresh that follows has its state.
    if (role === 'player' && asTeam !== secret) return;
    online = true; $('connection').classList.remove('offline');
    // The TV follows the quizmaster's language setting; a change after load reloads the page in the new language.
    if (role === 'display' && s.settings.language !== language()) {if (initialised) return location.reload(); setLanguage(s.settings.language); translatePage();}
    initialised = true;
    $('connection').textContent = t('● Connected'); lastSettings = s.settings; sharedState(s);
    // Online there is no quiz Wi-Fi to warn about.
    for (const tip of document.querySelectorAll('.wifi-tip')) tip.hidden = !!s.settings.online || s.settings.joinMode === 'lan';
    if (role === 'display') displayState(s);
    else if (secret) playerState(s);
    else {
      $('boardSection').hidden = true;
      if (!deviceChecked) checkDevice();
      $('joinButton').disabled = !s.settings.registrationOpen || s.settings.ended; $('registrationState').textContent = s.settings.ended ? t('This quiz has finished.') : s.settings.registrationOpen ? t('Registration is open') : t('Registration closed — existing teams can still recover below.');}
    if (role === 'player' && online && localDraft !== null) flushDraft();
  } catch (e) {
    // A bug while drawing the page would otherwise look like a lost connection; log it for the browser console.
    if (!e.status && !(e instanceof TypeError && /fetch|network/i.test(e.message))) console.error(e);
    online = false; $('connection').textContent = t('● Connection lost — retrying'); $('connection').classList.add('offline');
    if (role === 'player') {
      if (e.status === 401) {secret = ''; writeStorage('beermat-team', ''); current = null; $('join').hidden = false; $('game').hidden = true; $('menuButton').hidden = true; $('myScore').textContent = ''; updates.reconnect();
        // After the quizmaster starts the next quiz, every team joins afresh.
        const joined = readStorage('beermat-event');
        publicState().then(s => message(joined && s.event !== joined ? t('A new quiz has started — pick your team name again.') : t('Your old recovery code is no longer valid. Ask the quizmaster for a new one.'), !(joined && s.event !== joined))).catch(() => {});}
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
    if (generation === draftGeneration && revision === inputRevision && !current.answer) $('draftStatus').textContent = t('Draft saved — not sent yet');
  } catch {if (generation === draftGeneration && !current.answer) $('draftStatus').textContent = t('Draft kept in this browser — waiting for connection');}
  finally {inFlight = false; if (generation === draftGeneration && revision !== inputRevision) {clearTimeout(draftTimer); draftTimer = setTimeout(flushDraft, 400);}}
}
if (role === 'player') {
  if (appHome) {$('appHome').hidden = false; $('appHome').href = appHome; $('appHome').textContent = t('Quizzes');}
  $('vibrateToggle').checked = vibrateOn();
  $('vibrateToggle').onchange = () => {writeStorage('beermat-vibrate', $('vibrateToggle').checked ? '1' : '0'); if ($('vibrateToggle').checked) navigator.vibrate?.(60);};
  $('keepResultButton').onclick = async () => {
    try {
      const {claim} = await api('team/result', {}, secret);
      const packed = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(claim)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      if (appHome) location.href = appHome + '#claim=' + packed;
      else window.open(lastSettings.onlineService.replace(/\/$/, '') + '/app/#claim=' + packed, '_blank', 'noopener');
    } catch (e) {message(e.message, true);}
  };
  $('joinForm').onsubmit = async e => {
    e.preventDefault(); $('joinButton').disabled = true;
    try {
      const team = await api('join', {name: $('name').value}); saveIdentity(team.secret);
      message(team.waiting ? t('Nearly there! The quizmaster will let you in shortly. Keep this window open.') : t('You’re in! Keep this window open to play. If it closes, open {url} in your browser to carry on.', {url: (lastSettings?.joinUrl || 'http://10.42.0.1').replace(/^https?:\/\//, '')}));
      await refresh();
    } catch (e) {message(e.message, true);} finally {if (!secret) $('joinButton').disabled = false;}
  };
  $('recoverForm').onsubmit = async e => {
    e.preventDefault();
    try {
      // A 4-digit code from the quizmaster moves the team to this phone.
      let code = $('recovery').value.trim();
      if (/^\d{4}$/.test(code)) code = (await api('transfer', {code})).secret;
      await api('state', {}, code); saveIdentity(code); $('recovery').value = ''; message('Welcome back'); await refresh();
    } catch (e) {message(e.message, true);}
  };
  $('menuButton').onclick = () => $('teamMenu').showModal();
  $('switchTeam').onclick = () => {$('teamMenu').close(); if (!confirm(t('Switch teams on this browser? Save your current recovery code first.'))) return; clearTimeout(draftTimer); secret = ''; writeStorage('beermat-team', ''); current = null; renderedQuestion = 'unset'; $('join').hidden = false; $('game').hidden = true; $('menuButton').hidden = true; $('myScore').textContent = ''; updates.reconnect(); refresh();};
  $('inputs').oninput = () => {
    localDraft = inputValue(); inputRevision++; writeStorage(draftKey(current.question.id), JSON.stringify(localDraft));
    $('draftStatus').textContent = online ? t('Saving draft…') : t('Draft kept in this browser — waiting for connection');
    clearTimeout(draftTimer); draftTimer = setTimeout(flushDraft, 500);
  };
  $('answerForm').onsubmit = async e => {
    e.preventDefault(); if ($('submit').disabled) return;
    const value = inputValue(), q = current.question;
    if (q.type === 'sheet' && value.some(v => !v.trim()) && !confirm(t('Some sheet answers are blank. Submit this as your final sheet?'))) return;
    if ((q.type === 'sequence' && value.length !== q.items.length) || (typeof value === 'string' && !value.trim()) || (Array.isArray(value) && !value.length)) {
      return message(q.type === 'sequence' ? t('Place every item in order first') : q.type === 'pinpoint' ? t('Tap the picture first') : q.type === 'wordsnake' ? t('Trace the word first') : q.type === 'tiles' ? t('Place the tiles first') : keypad(q.type) || q.type === 'multi' ? t('Choose an answer first') : t('Type an answer first'), true);
    }
    submitting = true; updateControls(); clearTimeout(draftTimer);
    try {await api('answer', {question: q.id, value}, secret); message('Final answer received'); await refresh();}
    catch (e) {message(e.status ? e.message : t('Could not confirm submission. Reconnecting will check whether it was received.'), true); await refresh();}
    finally {submitting = false; updateControls();}
  };
  for (const [id, route, done] of [['buzz', 'buzz', t('Buzzed!')], ['agree', 'agree', t('Agreement recorded')], ['claimBingo', 'bingo', t('BINGO called — the quizmaster is checking')], ['tap', 'tap', t('Tap recorded')]]) $(id).onclick = async () => {
    $(id).disabled = true; enableSound();
    try {await api(route, {question: current.question.id}, secret); message(done); navigator.vibrate?.(80); if (id === 'buzz') buzzSound(current.team.name, current.team.sound);} catch (e) {message(e.message, true);}
    await updates.update();
  };
}
// Photos are cropped square and shrunk on the phone, so only a small JPEG ever reaches the laptop.
async function shrinkPhoto(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image(); img.src = url; await img.decode();
    const side = Math.min(img.naturalWidth, img.naturalHeight), canvas = document.createElement('canvas'); canvas.width = canvas.height = 360;
    canvas.getContext('2d').drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 360, 360);
    return await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  } finally {URL.revokeObjectURL(url);}
}
if (role === 'player') {
  // Phones use their own language unless the team picks one.
  const chosen = readStorage('beermat-lang'), browser = navigator.language.slice(0, 2);
  setLanguage(chosen || (languages[browser] ? browser : 'en')); translatePage();
  for (const select of document.querySelectorAll('.language')) {
    selectOptions(select, Object.entries(languages), language());
    select.onchange = () => {writeStorage('beermat-lang', select.value); location.reload();};
  }
  $('continueTeam').onclick = async () => {
    try {const {secret: code} = await api('device/continue'); saveIdentity(code); $('continueBox').hidden = true; message('Welcome back'); await refresh();} catch (e) {message(e.message, true);}
  };
  let leftAt = null;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {if (current?.question?.open && !current.answer) {leftAt = Date.now(); reportAway('left');}}
    else if (leftAt) {leftAt = null; reportAway('back');}
  });
  // A new photo from the camera, or one already on the phone.
  $('photoInput').onchange = $('photoPick').onchange = async e => {
    const file = e.target.files[0]; e.target.value = ''; if (!file) return;
    try {
      $('photoStatus').textContent = t('Uploading…');
      const response = await fetch('/api/team/photo', {method: 'POST', headers: {Authorization: 'Bearer ' + secret, 'Content-Type': 'image/jpeg'}, body: await shrinkPhoto(file), signal: AbortSignal.timeout(20000)});
      const data = await response.json(); if (!response.ok) throw Error(data.error);
      message('Photo sent — the quizmaster will approve it'); await updates.update();
    } catch (e) {message(e.message || t('That photo could not be used'), true);}
  };
  // Each buzzer sound plays on the phone as it is picked, once the phone's sound is running.
  const hear = async () => {await enableSound(); buzzSound('', Number($('sound').value));};
  $('hearSound').onclick = hear;
  $('sound').onchange = async () => {hear(); const sound = Number($('sound').value); try {await api('team/sound', {sound}, secret); message('Buzzer sound saved');} catch (e) {message(e.message, true);}};
}
if (role === 'display') {
  $('enableSound').onclick = () => {enableSound(); $('enableSound').hidden = true;};
  const toggleFullscreen = () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen().catch(() => message('Full screen is not available in this browser — try F11', true));
  $('fullscreen').onclick = toggleFullscreen;
  document.addEventListener('keydown', e => {if (e.key.toLowerCase() === 'f' && !e.ctrlKey && !e.metaKey && !e.altKey) toggleFullscreen();});
  document.addEventListener('fullscreenchange', () => {$('fullscreen').textContent = document.fullscreenElement ? t('✕ Exit full screen') : t('⛶ Full screen');});
  // Hide the pointer and screen buttons after a few seconds without movement.
  let idleTimer;
  const wake = () => {document.body.classList.remove('idle'); clearTimeout(idleTimer); idleTimer = setTimeout(() => document.body.classList.add('idle'), 3000);};
  for (const event of ['mousemove', 'pointerdown', 'keydown']) document.addEventListener(event, wake);
  wake();
  // Refit when the screen or header changes size, and when a picture or font finishes loading.
  new ResizeObserver(fitStage).observe($('stage'));
  $('stage').addEventListener('load', fitStage, true); document.fonts?.ready.then(() => {titleFit = ''; fitTitle(); fitStage();});
}
setInterval(() => {if (role === 'player') updateControls(); else if (current) {$('status').textContent = timeText(current.question, offset); renderCountdown(); fitTitle(); fitStage(); countdownCue();}}, 200);
const updates = live(refresh, () => role === 'player' ? secret : '');
