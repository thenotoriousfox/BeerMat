import {qrMatrix, wifiCode} from './qr.js';
import {t, setLanguage, language, languages, translatePage} from './i18n.js';
import {$, element, api, message, readStorage, writeStorage, renderMedia, renderBoard, renderSolution, timeText, letters, live, enableSound, buzzSound, useSounds, playSound, stopSound, buzzerNames, renderPinpoint, selectOptions, bingoCall, seededOrder, fanfare, avatar, adjacent, renderSnake, tileWord} from './app.js';
const role = document.body.dataset.role;
let secret = readStorage('pubquiz-team'), current = null, renderedQuestion = 'unset', offset = 0, online = false, submitting = false, draftTimer, draftGeneration = 0;
let localDraft = null, inputRevision = 0, inFlight = false, lastBuzzer = '', wheelId = null, wheelTurn = 0, winnerShown = '';
const inputs = () => [...$('inputs').querySelectorAll('input,select')];
const draftKey = id => `pubquiz-draft:${secret}:${id}`;
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
function saveIdentity(code) {
  secret = code; current = null; renderedQuestion = 'unset'; localDraft = null; inputRevision = 0;
  if (!writeStorage('pubquiz-team', code)) $('storageWarning').textContent = t('Browser storage is unavailable. Write down your recovery code before closing this window.');
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
const dabKey = id => `pubquiz-dabs:${secret}:${id}`;
function buildTicket(q) {
  let dabs = []; try {dabs = JSON.parse(readStorage(dabKey(q.id)) || '[]');} catch {}
  $('ticket').classList.toggle('music', !!q.bingo.music);
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
  if (b.music) {
    $('bingoMode').textContent = t('Music bingo · {mode} · {n} played', {mode: stageText(b), n: b.played});
    $('bingoLast').textContent = b.played ? t('Song {n}', {n: b.played}) : '–'; $('bingoPhrase').textContent = b.titles.length ? t('Revealed: {title}', {title: b.titles.at(-1)}) : '';
  } else {
    $('bingoMode').textContent = t('{mode} · {n} called', {mode: stageText(b), n: b.called.length});
    $('bingoLast').textContent = b.last ?? '–'; $('bingoPhrase').textContent = current.settings.bingoPhrases && b.last ? b.phrase ?? bingoCall(b.last) : '';
  }
  $('claimBingo').disabled = !(online && q.live && !q.paused && !b.claimed && !b.over && !current.settings.ended);
  $('bingoStatus').textContent = b.claimed ? t('✓ Bingo! Your claim was checked and counted.') : b.winners.length ? winText(b) : '';
}
function playerState(s) {
  current = s; writeStorage('pubquiz-event', s.event || ''); offset = s.serverTime - Date.now(); $('join').hidden = true; $('game').hidden = false;
  $('team').textContent = s.team.name; $('code').textContent = secret; const q = s.question;
  // A team in the waiting room sees only a holding screen until the quizmaster lets it in.
  const shown = s.team.waiting ? 'waiting' : q?.id;
  if (shown !== renderedQuestion) {
    clearTimeout(draftTimer); draftGeneration++; localDraft = null; inputRevision = 0;
    renderedQuestion = shown; $('inputs').replaceChildren(); $('draftStatus').textContent = '';
    $('question').textContent = s.team.waiting ? t('You’re in the waiting room — the quizmaster will let you in shortly') : q?.text || t('Waiting for the next question…'); $('round').textContent = q?.round || '';
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
  $('photoDetails').hidden = !s.settings.teamPhotos; $('myPhoto').hidden = !s.team.photo;
  if (s.team.photo && $('myPhoto').getAttribute('src') !== s.team.photo) $('myPhoto').src = s.team.photo;
  $('photoStatus').textContent = !s.team.photo ? t('Add a team photo to appear on the big screen. The quizmaster approves it first.') : s.team.photoStatus === 'approved' ? t('✓ Approved — showing on the big screen') : t('Waiting for the quizmaster to approve it');
  selectOptions($('sound'), buzzerNames().map((label, i) => [String(i), label]), document.activeElement === $('sound') ? undefined : String(s.team.sound ?? ''));
  if (s.answer && !['buzzer', 'bingo', 'musicbingo', 'clips'].includes(q?.type)) {writeInputs(parseSaved(s.answer.value)); $('draftStatus').textContent = s.answer.points === undefined ? t('Your final answer is safely stored on the quiz laptop.') : ''; localDraft = null; writeStorage(draftKey(q.id), '');}
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
  useSounds(s.sounds);
  $('title').textContent = s.settings.title; document.title = s.settings.title + ' — ' + (role === 'player' ? 'Team' : 'Projector');
  renderBoard($('leaderboard'), s.teams);
  $('boardStatus').textContent = !s.settings.leaderboardVisible ? t('The quizmaster has hidden scores for now.') : s.settings.ended ? t('Final standings') : s.teams.length ? t('Ties share the same rank.') : t('Waiting for teams');
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
  const {joinSsid, joinUrl, registrationOpen, ended} = s.settings, joining = registrationOpen && !ended;
  $('projection').hidden = s.view === 'blank';
  $('joinSection').hidden = s.view !== 'join';
  if (s.view === 'join') {
    // One code does it all: it joins the quiz Wi-Fi, and the phone's sign-in window then opens the quiz.
    renderQr($('wifiQr'), wifiCode(joinSsid));
    $('joinStepWifi').textContent = t('Join the “{ssid}” Wi-Fi when your phone offers it', {ssid: joinSsid});
    $('joinStepQuiz').textContent = t('Tap “Sign in” when your phone asks (iPhones open it straight away) — then pick a team name');
    $('joinFallback').textContent = t('Quiz not opening? On the {ssid} Wi-Fi, go to {url}', {ssid: joinSsid, url: joinUrl.replace(/^http:\/\//, '')});
    $('joinStatus').textContent = !joining ? t('Registration is closed — ask the quizmaster to join') : s.teams.length ? (s.teams.length === 1 ? t('1 team has joined') : t('{n} teams have joined', {n: s.teams.length})) : t('Be the first team to join!');
  }
  $('joinHint').textContent = joining ? t('Join: Wi-Fi “{ssid}” → {url}', {ssid: joinSsid, url: joinUrl.replace(/^http:\/\//, '')}) : '';
  $('boardSection').hidden = s.view !== 'leaderboard'; $('projectQuestion').hidden = s.view !== 'question';
  const q = s.question; $('question').textContent = q?.text || t('Waiting for the quizmaster'); $('round').textContent = q?.round || ''; $('status').textContent = timeText(q, offset);
  if (q?.type === 'pinpoint') renderPinpoint($('media'), q); else renderMedia($('media'), q);
  renderSolution($('solution'), q);
  if (q?.id !== renderedQuestion) {
    renderedQuestion = q?.id;
    const items = q?.type === 'choice' || q?.type === 'vote' || q?.type === 'multi' ? q.options.map((o, i) => `${letters[i]}. ${o}`) : q?.type === 'sequence' ? q.order.map(i => q.items[i]) : q?.type === 'sheet' ? q.items : q?.type === 'tiles' ? [tileWord('', q.wordLengths), q.pieces.join('  ·  ')] : [];
    $('projectItems').replaceChildren(...items.map(text => element('li', text)));
  }
  $('projectSnake').hidden = q?.type !== 'wordsnake';
  if (q?.type === 'wordsnake') renderSnake($('projectSnake'), q.grid, q.revealed ? q.snakePath : []);
  const c = q?.clipGame; $('projectClips').hidden = !c;
  if (c) {$('clipNow').textContent = c.playing ? t('🎵 Clip {n} of {count}', {n: c.playing, count: c.count}) : q.live ? t('Listen carefully…') : t('Clips finished'); $('clipTaps').textContent = t('{n} teams have tapped', {n: c.taps});}
  const g = q?.bingo; $('projectBingo').hidden = !g;
  if (g) {
    $('bingoBoard').classList.toggle('music', !!g.music);
    if (g.music) {
      $('bingoBig').textContent = g.played ? '🎵 ' + t('Song {n}', {n: g.played}) : '🎵'; $('bingoCallText').textContent = g.titles.length ? t('Last revealed: {title}', {title: g.titles.at(-1)}) : '';
      $('bingoWinners').textContent = g.winners.length ? winText(g) : t('Music bingo · {mode}', {mode: stageText(g)});
      $('bingoBoard').replaceChildren(...[...g.titles].reverse().map(title => element('span', title, 'called')));
    } else {
      $('bingoBig').textContent = g.last ?? '–'; $('bingoCallText').textContent = s.settings.bingoPhrases && g.last ? g.phrase ?? bingoCall(g.last) : '';
      $('bingoWinners').textContent = g.winners.length ? winText(g) : t('{mode} · {n} called', {mode: stageText(g), n: g.called.length});
      if ($('bingoBoard').children.length !== 90 || $('bingoBoard').firstChild.textContent !== '1') $('bingoBoard').replaceChildren(...Array.from({length: 90}, (_, i) => element('span', String(i + 1))));
      [...$('bingoBoard').children].forEach((cell, i) => cell.classList.toggle('called', g.called.includes(i + 1)));
    }
  }
  $('wheelSection').hidden = s.view !== 'wheel';
  $('leaderboard').classList.toggle('cols', s.teams.length > 10);
  renderCountdown(); fitStage(); soundCues(s);
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
// Sound effects on the TV, from the quizmaster's imported files: each plays when the quiz state changes, never on
// first load. Music loops while a question without its own audio is open.
let heard = null, musicOn = false;
const silentTypes = ['audio', 'clips', 'musicbingo', 'buzzer', 'bingo'];
function soundCues(s) {
  const q = s.question, before = heard;
  heard = {id: q?.id, round: q?.round, open: !!q?.open, revealed: !!q?.revealed, calls: q?.bingo?.called?.length ?? 0, winners: q?.bingo?.winners.length ?? 0,
    buzz: Object.fromEntries((q?.buzz?.queue || []).map(b => [b.team, b.status])), view: s.view, wheel: s.wheel?.id};
  const music = !!q?.open && !q.paused && !silentTypes.includes(q.type) && !/\.(mp3|ogg|wav)$/i.test(q.media || '');
  if (music !== musicOn) {musicOn = music; if (music) playSound('timerMusic', true); else stopSound('timerMusic');}
  if (!before) return;
  if (q && q.id !== before.id && q.live) {if (!(q.round && q.round !== before.round && playSound('startRound'))) playSound('questionStart');}
  if (q?.id !== before.id) return;
  if (before.open && !heard.open && !['buzzer', 'bingo', 'musicbingo', 'clips'].includes(q.type)) playSound('timeUp');
  if (heard.revealed && !before.revealed) playSound('reveal');
  for (const [team, status] of Object.entries(heard.buzz)) if (status !== before.buzz[team]) {if (status === 'correct') playSound('correct'); if (status === 'wrong') playSound('wrong');}
  if (q?.type === 'bingo' && heard.calls > before.calls) playSound('bingoCall');
  if (heard.winners > before.winners) playSound('bingo');
  if (heard.wheel !== before.wheel && s.view === 'wheel') playSound('wheel');
  if (s.view === 'leaderboard' && before.view === 'question' && s.settings.displayMode === 'auto') playSound('endRound');
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
function renderWinner(s) {
  const top = s.teams.filter(t => t.rank === 1), names = top.map(t => t.name).join(' & ');
  $('winnerName').textContent = !s.settings.leaderboardVisible ? t('Scores are hidden for now') : names || t('No teams yet');
  $('winnerPhotos').replaceChildren(...(s.settings.leaderboardVisible ? top.filter(t => t.photo).map(t => avatar(t.photo)) : []));
  $('winnerScore').textContent = top.length && s.settings.leaderboardVisible && top[0].score !== null ? t(top.length > 1 ? '{n} points — a tie!' : '{n} points', {n: top[0].score}) : '';
  $('podium').replaceChildren(...s.teams.filter(t => t.rank > 1 && t.rank <= 3).map(t => {const li = element('li'); li.append(element('span', `${t.rank === 2 ? '🥈' : '🥉'} ${t.name}`), element('strong', t.score === null ? '' : `${t.score} pts`)); return li;}));
  if (names && names !== winnerShown) {
    winnerShown = names; fanfare();
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
    const s = role === 'player' && secret ? await api('state', {}, secret) : await publicState();
    online = true; $('connection').classList.remove('offline');
    // The TV follows the quizmaster's language setting; a change after load reloads the page in the new language.
    if (role === 'display' && s.settings.language !== language()) {if (initialised) return location.reload(); setLanguage(s.settings.language); translatePage();}
    initialised = true;
    $('connection').textContent = t('● Connected'); lastSettings = s.settings; sharedState(s);
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
      if (e.status === 401) {secret = ''; writeStorage('pubquiz-team', ''); current = null; $('join').hidden = false; $('game').hidden = true; $('menuButton').hidden = true; $('myScore').textContent = ''; updates.reconnect();
        // After the quizmaster starts the next quiz, every team joins afresh.
        const joined = readStorage('pubquiz-event');
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
  $('joinForm').onsubmit = async e => {
    e.preventDefault(); $('joinButton').disabled = true;
    try {
      const team = await api('join', {name: $('name').value}); saveIdentity(team.secret);
      message(team.waiting ? t('Nearly there! The quizmaster will let you in shortly. Keep this window open.') : t('You’re in! Keep this window open to play. If it closes, open {url} in your browser to carry on.', {url: (lastSettings?.joinUrl || 'http://10.42.0.1').replace(/^http:\/\//, '')}));
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
  $('switchTeam').onclick = () => {$('teamMenu').close(); if (!confirm(t('Switch teams on this browser? Save your current recovery code first.'))) return; clearTimeout(draftTimer); secret = ''; writeStorage('pubquiz-team', ''); current = null; renderedQuestion = 'unset'; $('join').hidden = false; $('game').hidden = true; $('menuButton').hidden = true; $('myScore').textContent = ''; updates.reconnect(); refresh();};
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
  for (const [id, route, done] of [['buzz', 'buzz', t('Buzzed!')], ['agree', 'agree', t('Agreement recorded')], ['claimBingo', 'bingo', t('BINGO! Checked and counted')], ['tap', 'tap', t('Tap recorded')]]) $(id).onclick = async () => {
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
  const chosen = readStorage('pubquiz-lang'), browser = navigator.language.slice(0, 2);
  setLanguage(chosen || (languages[browser] ? browser : 'en')); translatePage();
  for (const select of document.querySelectorAll('.language')) {
    selectOptions(select, Object.entries(languages), language());
    select.onchange = () => {writeStorage('pubquiz-lang', select.value); location.reload();};
  }
  $('continueTeam').onclick = async () => {
    try {const {secret: code} = await api('device/continue'); saveIdentity(code); $('continueBox').hidden = true; message('Welcome back'); await refresh();} catch (e) {message(e.message, true);}
  };
  let leftAt = null;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {if (current?.question?.open && !current.answer) {leftAt = Date.now(); reportAway('left');}}
    else if (leftAt) {leftAt = null; reportAway('back');}
  });
  $('photoInput').onchange = async () => {
    const file = $('photoInput').files[0]; $('photoInput').value = ''; if (!file) return;
    try {
      $('photoStatus').textContent = t('Uploading…');
      const response = await fetch('/api/team/photo', {method: 'POST', headers: {Authorization: 'Bearer ' + secret, 'Content-Type': 'image/jpeg'}, body: await shrinkPhoto(file), signal: AbortSignal.timeout(20000)});
      const data = await response.json(); if (!response.ok) throw Error(data.error);
      message('Photo sent — the quizmaster will approve it'); await updates.update();
    } catch (e) {message(e.message || t('That photo could not be used'), true);}
  };
  $('sound').onchange = async () => {enableSound(); const sound = Number($('sound').value); buzzSound('', sound); try {await api('team/sound', {sound}, secret); message('Buzzer sound saved');} catch (e) {message(e.message, true);}};
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
  $('stage').addEventListener('load', fitStage, true); document.fonts?.ready.then(fitStage);
}
setInterval(() => {if (role === 'player') updateControls(); else if (current) {$('status').textContent = timeText(current.question, offset); renderCountdown(); fitStage();}}, 200);
const updates = live(refresh, () => role === 'player' ? secret : '');
