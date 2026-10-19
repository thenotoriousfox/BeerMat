import {$, element, api, message, readStorage, writeStorage, download, renderMedia, renderSolution, timeText, selectOptions, letters, live, enableSound, buzzSound, renderPinpoint, bingoCall, avatar} from './app.js';
import {parseSqRound, parseQuickQuestion} from './sqimport.js';
let key = readStorage('pubquiz-host', true), state = null, library = null, editingId = null, tab = 'live', dirty = false, reviewId = '', reviewSignature = '', busy = false;
const uid = () => 'id-' + crypto.getRandomValues(new Uint32Array(4)).join('-');
const request = (p, body = {}) => api('host/' + p, body, key);
let offset = 0, selectedRoundId = '', lastBuzz = '', liveQuestion = null, pinTarget = null, clipItems = [], targetClip = 0, clipRun = null;
const speedTypes = ['text', 'choice', 'multi', 'letter', 'number', 'sequence', 'pinpoint', 'picture', 'audio', 'bingo', 'clips'];
const modes = {line: 'one line', twoLines: 'two lines', fullHouse: 'full house'};
let actionQueue = Promise.resolve();
function action(fn, success = 'Saved') {
  const task = actionQueue.then(async () => {
    busy = true;
    const buttons = [...document.querySelectorAll('button')].map(button => [button, button.disabled]);
    buttons.forEach(([button]) => button.disabled = true);
    try {const result = await fn(); message(typeof result === 'string' ? result : success);} catch (e) {message(e.message, true);} finally {
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
  const type = $('qType').value, show = (id, on) => {$(id).hidden = !on;};
  show('choiceFields', ['choice', 'vote', 'multi'].includes(type)); show('multiFields', type === 'multi'); show('sheetFields', type === 'sheet'); show('sequenceFields', type === 'sequence');
  show('nearestFields', type === 'nearest'); show('buzzerFields', type === 'buzzer'); show('pinpointFields', type === 'pinpoint'); show('bingoFields', type === 'bingo' || type === 'musicbingo'); show('musicFields', type === 'musicbingo'); show('clipsFields', type === 'clips');
  show('mediaFields', !['sheet', 'bingo', 'musicbingo', 'clips'].includes(type)); show('answerFields', !['sheet', 'vote', 'sequence', 'multi', 'pinpoint', 'bingo', 'musicbingo', 'clips'].includes(type)); show('aliasesLabel', ['text', 'picture', 'audio'].includes(type)); show('noteLabel', type !== 'sheet');
  show('pointsLabel', type !== 'sheet'); show('speedLabel', speedTypes.includes(type));
  $('answerLabel').textContent = {choice: 'Correct choice (copy one line from above; blank for manual marking)', letter: 'Correct letter (A–Z)', number: 'Correct number', nearest: 'Correct number', buzzer: 'Expected answer (shown only to you)'}[type] || 'Correct answer (blank for manual marking)';
  $('pointsText').textContent = {nearest: 'Points for the closest team', buzzer: 'Points for a correct buzz', vote: 'Points (votes score nothing)', multi: 'Points for every right tick', pinpoint: 'Points for a first-tap hit', bingo: 'Points for a valid bingo', musicbingo: 'Points for a valid bingo', clips: 'Points for tapping the right clip'}[type] || 'Correct answer points';
  $('speedText').textContent = type === 'bingo' || type === 'musicbingo' ? 'Bonus for the first claim' : 'Maximum speed bonus';
  $('mediaLabel').textContent = type === 'picture' || type === 'pinpoint' ? 'Picture file (required)' : type === 'audio' ? 'Audio file (required)' : 'Optional picture or audio clip';
  renderPinTarget();
  document.querySelectorAll('.advanced-only').forEach(el => {el.hidden = $('qVariation').value !== 'advanced';});
  $('sheetItems').querySelectorAll('input').forEach(input => input.disabled = type !== 'sheet');
  $('mediaUpload').accept = type === 'picture' || type === 'pinpoint' ? 'image/png,image/jpeg,image/webp' : type === 'audio' ? 'audio/mpeg,audio/ogg,audio/wav' : 'image/png,image/jpeg,image/webp,audio/mpeg,audio/ogg,audio/wav';
}
function renderClipList() {
  $('clipList').replaceChildren(...clipItems.map((clip, i) => {
    const li = element('li', undefined, 'clip-row'), pick = element('input'), name = element('input'), play = element('audio'), remove = element('button', 'Remove', 'subtle');
    pick.type = 'radio'; pick.name = 'targetClip'; pick.checked = i === targetClip; pick.title = 'The right clip'; pick.onchange = () => {targetClip = i; editorChanged();};
    name.value = clip.label; name.maxLength = 100; name.oninput = () => {clip.label = name.value;}; name.setAttribute('aria-label', `Clip ${i + 1} name`);
    play.src = clip.media; play.controls = true; play.preload = 'none';
    remove.type = 'button'; remove.onclick = () => {clipItems.splice(i, 1); targetClip = Math.min(targetClip, Math.max(0, clipItems.length - 1)); renderClipList(); editorChanged();};
    li.append(pick, name, play, remove); return li;
  }));
}
$('songUpload').onchange = () => action(async () => {
  const added = [];
  for (const file of $('songUpload').files) added.push(`${file.name.replace(/\.[^.]+$/, '').replace(/[_|]+/g, ' ').trim().slice(0, 100)} | ${await uploadMedia(file)}`);
  $('songUpload').value = ''; $('qSongs').value = [$('qSongs').value.trim(), ...added].filter(Boolean).join('\n'); editorChanged();
  return `${added.length} songs uploaded — check the titles, then save the question`;
});
$('clipUpload').onchange = () => action(async () => {
  for (const file of $('clipUpload').files) clipItems.push({media: await uploadMedia(file), label: file.name.replace(/\.[^.]+$/, '').slice(0, 100)});
  $('clipUpload').value = ''; renderClipList(); editorChanged();
}, 'Clips uploaded — pick the right one, then save the question');
function renderPinTarget() {
  const media = $('qMedia').value;
  if ($('qType').value !== 'pinpoint' || !media || /\.(mp3|ogg|wav)$/i.test(media)) return $('pinTarget').replaceChildren();
  renderPinpoint($('pinTarget'), {media, target: pinTarget}, [], (point, img) => {
    pinTarget = {x: point[0], y: point[1], r: Number($('qRadius').value) / 100, aspect: Math.round(1000 * img.naturalHeight / img.naturalWidth) / 1000 || 1};
    editorChanged(); renderPinTarget();
  });
}
$('qRadius').oninput = () => {if (pinTarget) {pinTarget = {...pinTarget, r: Number($('qRadius').value) / 100}; renderPinTarget();}};
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
  $('qNote').value = q?.answerNote || ''; $('qItems').value = q?.type === 'sequence' ? q.items.join('\n') : ''; $('qPlaces').value = q?.places ?? 1;
  $('qCorrect').value = (q?.correct || []).join('\n'); pinTarget = q?.target || null; $('qRadius').value = Math.round((q?.target?.r ?? 0.08) * 100);
  $('qSongs').value = (q?.songs || []).map(s => s.media ? `${s.title} | ${s.media}` : s.title).join('\n'); $('qRevealNow').checked = !!q?.revealNow;
  clipItems = structuredClone(q?.clips || []); targetClip = q?.targetClip ?? 0; renderClipList();
  $('qGoWide').checked = !!q?.goWide; $('qGoWidePoints').value = q?.goWidePoints ?? 0; $('qMode').value = q?.mode || 'line';
  $('qVariation').value = q?.variation || 'classic'; $('qPenalty').value = q?.penalty ?? 0; $('qPassPenalty').value = q?.passPenalty ?? 0; $('qAgreePoints').value = q?.agreePoints ?? 1; $('qAgreeSeconds').value = q?.agreeSeconds ?? 10;
  $('sheetItems').replaceChildren(); (q?.type === 'sheet' ? q.items : ['']).forEach((item, i) => addSheetItem(item, q?.itemAnswers?.[i] || ''));
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
  const type = $('qType').value, rows = [...$('sheetItems').children], lines = id => $(id).value.split('\n').map(s => s.trim()).filter(Boolean);
  const q = {id: editingId || uid(), text: $('qText').value.trim(), type, seconds: Number($('qSeconds').value), points: Number($('qPoints').value),
    speedBonus: speedTypes.includes(type) ? Number($('qSpeed').value) : 0, answer: $('qAnswer').value.trim(), answerNote: $('qNote').value.trim(), aliases: lines('qAliases'), media: $('qMedia').value};
  if (['choice', 'vote', 'multi'].includes(type)) q.options = lines('qOptions');
  if (type === 'multi') q.correct = lines('qCorrect');
  if (type === 'pinpoint') Object.assign(q, {target: pinTarget, goWide: $('qGoWide').checked, goWidePoints: Number($('qGoWidePoints').value)});
  if (type === 'bingo') Object.assign(q, {mode: $('qMode').value, media: ''});
  if (type === 'musicbingo') Object.assign(q, {mode: $('qMode').value, revealNow: $('qRevealNow').checked, media: '', songs: lines('qSongs').map(line => {
    const [title, media] = line.split(/\s*\|\s*(?=\/media\/)/); return {title: title.trim(), media: media?.trim() || null};
  })});
  if (type === 'clips') Object.assign(q, {clips: clipItems.map(c => ({media: c.media, label: c.label.trim()})), targetClip, media: ''});
  if (type === 'sequence') q.items = lines('qItems');
  if (type === 'sheet') Object.assign(q, {items: rows.map(row => row.querySelectorAll('input')[0].value.trim()), itemAnswers: rows.map(row => row.querySelectorAll('input')[1].value.trim()), answerNote: '', media: ''});
  if (type === 'nearest') q.places = Number($('qPlaces').value);
  if (type === 'buzzer') Object.assign(q, {variation: $('qVariation').value, penalty: Number($('qPenalty').value), passPenalty: Number($('qPassPenalty').value), agreePoints: Number($('qAgreePoints').value), agreeSeconds: Number($('qAgreeSeconds').value)});
  return q;
}
$('questionForm').oninput = editorChanged;
$('qType').onchange = $('qVariation').onchange = () => {formTypes(); editorChanged();};
$('clearMedia').onclick = () => {$('qMedia').value = ''; renderMedia($('mediaPreview'), null); pinTarget = null; renderPinTarget(); editorChanged();};
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
async function uploadMedia(file) {
  if (file.size > 20 * 1024 * 1024) throw Error(`${file.name}: maximum media file size is 20 MB`);
  const response = await fetch('/api/host/media?name=' + encodeURIComponent(file.name), {method: 'POST', headers: {Authorization: 'Bearer ' + key, 'Content-Type': 'application/octet-stream'}, body: file, signal: AbortSignal.timeout(60000)});
  const data = await response.json(); if (!response.ok) throw Error(`${file.name}: ${data.error}`);
  return data.media;
}
$('mediaUpload').onchange = () => action(async () => {
  const file = $('mediaUpload').files[0]; if (!file) return;
  $('qMedia').value = await uploadMedia(file); renderMedia($('mediaPreview'), {media: $('qMedia').value}); pinTarget = null; renderPinTarget(); editorChanged();
}, 'Media uploaded — save the question to keep it in your quiz');
// SpeedQuizzing rounds and Quick Questions are added as new rounds; nothing existing is replaced.
async function importSpeedQuizzing(input) {
  const files = [...input.files]; input.value = ''; if (!files.length || !guardEditor()) return;
  const next = cloneLibrary(), rounds = new Map(), notes = []; let count = 0;
  const roundFor = title => {
    if (!rounds.has(title)) {const r = {id: uid(), title: title.slice(0, 100) || 'Imported round', questions: []}; rounds.set(title, r); next.rounds.push(r);}
    return rounds.get(title);
  };
  for (const file of files) {
    const folder = (file.webkitRelativePath || '').split('/').slice(-2, -1)[0] || '';
    if (/\.sq[bqn]$/i.test(file.name)) {
      if (file.size > 4 * 1024 * 1024) throw Error(`${file.name} is too large`);
      const round = parseSqRound(await file.text(), file.name), target = roundFor(round.title);
      target.questions.push(...round.questions.map(q => ({...q, id: uid()}))); count += round.questions.length;
      notes.push(...round.skipped.map(note => `${file.name}: ${note}`)); continue;
    }
    const parsed = parseQuickQuestion(file.name, folder);
    if (!parsed) {if (!/\.(txt|ini|db)$/i.test(file.name) || /^QQ/i.test(file.name)) notes.push(`${file.name}: not a Quick Question`); continue;}
    if (parsed.media) parsed.question.media = await uploadMedia(file);
    roundFor(folder ? folder.replace(/^QQF[ACKN]\s*/i, '') : 'Quick Questions').questions.push({...parsed.question, id: uid()}); count++;
  }
  if (!count) throw Error('No SpeedQuizzing questions found in those files');
  await saveLibrary(next, [...rounds.values()][0].id);
  return `Imported ${count} questions into ${rounds.size} ${rounds.size === 1 ? 'round' : 'rounds'}.` + (notes.length ? `\nCheck: ${notes.slice(0, 8).join('; ')}${notes.length > 8 ? ` (+${notes.length - 8} more)` : ''}` : '');
}
$('importSq').onchange = () => action(() => importSpeedQuizzing($('importSq')));
$('importSqFolder').onchange = () => action(() => importSpeedQuizzing($('importSqFolder')));
$('playSelected').onclick = () => action(async () => {
  if (dirty) throw Error('Save the question before playing it');
  const played = state.history.some(q => q.sourceId === editingId);
  if (played && !confirm('This question has already played. Open a fresh copy?')) return;
  await request('start', {id: editingId, expectedQuestion: state.question?.id || null, repeat: played}); chooseTab('live');
}, 'Question opened');
$('next').onclick = () => action(() => request('next', {expectedQuestion: state.question?.id || null}), 'Next question opened');
for (const id of ['close', 'pause', 'resume']) $(id).onclick = () => action(() => request(id, {expectedQuestion: state.question?.id || null}), id === 'close' ? 'Answers closed' : id === 'pause' ? 'Timer paused' : 'Timer resumed');
for (const [id, act, done] of [['buzzCorrect', 'correct', 'Marked correct'], ['buzzWrong', 'wrong', 'Marked wrong'], ['buzzPass', 'pass', 'Passed to the next buzzer'], ['startAgree', 'agree', 'Agree countdown started']]) {
  $(id).onclick = () => action(() => request('buzz', {question: state.question.id, action: act, announced: $('announced').value}), done);
}
// The desk plays the clips in order and tells the server when each one starts and ends.
function stopClips() {
  $('clipAudio').pause();
  if (clipRun) request('clip', {question: clipRun.question, clip: -1}).catch(() => {});
  clipRun = null; if (state) renderClipsPanel(state.question);
}
function playClip(i) {
  const q = state.question;
  if (!q?.live || q.type !== 'clips' || i >= q.clips.length) return stopClips();
  const run = clipRun = {question: q.id, index: i}, audio = $('clipAudio'); let started = false;
  audio.src = q.clips[i].media;
  audio.onplaying = () => {if (!started && clipRun === run) {started = true; request('clip', {question: q.id, clip: i}).catch(e => message(e.message, true));}};
  audio.onended = async () => {
    if (clipRun !== run) return;
    await request('clip', {question: q.id, clip: -1}).catch(() => {});
    setTimeout(() => {if (clipRun === run) playClip(i + 1);}, 1500);
  };
  audio.play().catch(() => message('The browser blocked audio — press Play clips again', true));
  renderClipsPanel(q);
}
function renderClipsPanel(q) {
  const c = q?.clipGame; $('clipsPanel').hidden = !c || !q.live;
  if (!c) return;
  const i = clipRun?.question === q.id ? clipRun.index : null;
  $('clipInfo').textContent = i === null ? `${c.count} clips ready · ${c.taps} taps` : `Playing clip ${i + 1}: ${q.clips[i].label || '(unnamed)'}${i === q.targetClip ? ' — ✓ the right clip' : ''} · ${c.taps} taps`;
  $('playClips').disabled = i !== null || busy; $('stopClips').disabled = i === null;
}
$('playClips').onclick = () => {enableSound(); playClip(0);};
$('stopClips').onclick = stopClips;
$('callNumber').onclick = () => action(async () => {
  const q = state.question, {number} = await request('bingo', {question: q.id});
  if (q.type !== 'musicbingo') return `Called ${number}`;
  const song = q.songs[number - 1], audio = $('songAudio');
  audio.hidden = !song.media;
  if (song.media) {audio.src = song.media; audio.play().catch(() => message('Press play on the song player', true));}
  return `Song ${q.bingo.played + 1}: ${song.title}${song.media ? '' : ' — play it from your own music player'}`;
});
$('spinWheel').onclick = () => action(async () => {
  const items = $('wheelItems').value.split('\n').map(s => s.trim()).filter(Boolean);
  if (state.settings.displayMode !== 'wheel') await request('settings', {displayMode: 'wheel'});
  const wheel = await request('wheel', items.length ? {items} : {});
  $('wheelLast').textContent = `Last spin: ${wheel.items[wheel.result]}`; return 'Wheel spinning on the projector';
});
// Single-key shortcuts, also usable from a Stream Deck or presenter remote that sends key presses.
const shortcuts = {n: 'next', c: 'close', r: 'reveal', 1: 'buzzCorrect', 2: 'buzzWrong', 3: 'buzzPass', a: 'startAgree', b: 'callNumber', w: 'spinWheel'};
document.addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || $('panel').hidden || e.target.closest('input,textarea,select,dialog')) return;
  const key = e.key.toLowerCase(), id = key === 'p' ? (state?.question?.paused ? 'resume' : 'pause') : shortcuts[key];
  const button = id && $(id);
  if (!button || button.disabled || button.closest('[hidden]')) return;
  e.preventDefault(); if (tab !== 'live') chooseTab('live'); button.click();
});
$('reveal').onclick = () => action(() => request('reveal', {question: state.question.id, revealed: !state.question.revealed}), 'Reveal updated');
$('joinDetails').onsubmit = e => {e.preventDefault(); action(() => request('settings', {joinSsid: $('joinSsidInput').value, joinUrl: $('joinUrlInput').value}), 'Join details saved — shown on the projector join screen');};
$('titleForm').onsubmit = e => {e.preventDefault(); action(() => request('settings', {title: $('eventName').value}));};
$('registration').onclick = () => action(() => request('settings', {registrationOpen: !state.settings.registrationOpen}));
$('visibility').onclick = () => action(() => request('settings', {leaderboardVisible: !state.settings.leaderboardVisible}));
$('scramble').onclick = () => action(() => request('settings', {scrambleKeypads: !state.settings.scrambleKeypads}), 'Keypad scrambling updated — applies from the next question');
$('phrases').onclick = () => action(() => request('settings', {bingoPhrases: !state.settings.bingoPhrases}));
$('photos').onclick = () => action(() => request('settings', {teamPhotos: !state.settings.teamPhotos}));
$('blockedForm').onsubmit = e => {e.preventDefault(); action(() => request('settings', {blockedWords: $('blockedWords').value}), 'Blocked words saved');};
$('displayMode').onchange = () => action(() => request('settings', {displayMode: $('displayMode').value}));
$('finish').onclick = () => action(async () => {
  if (!state.settings.ended && !confirm('Finish this quiz and close answers and registration? You can resume it later.')) return;
  // Finishing goes straight to the winner celebration on the projector.
  await request('settings', state.settings.ended ? {ended: false} : {ended: true, displayMode: 'winner'});
}, 'Quiz status updated');
document.addEventListener('pointerdown', enableSound);
$('loginForm').onsubmit = async e => {e.preventDefault(); await action(async () => {
  key = (await api('login', {key: $('key').value})).key; writeStorage('pubquiz-host', key, true); $('key').value = ''; updates.reconnect(); await loadLibrary();
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
  const paper = $('paper'), line = () => element('p', 'Answer: __________________________________________________');
  paper.replaceChildren(element('h1', library.title), element('p', 'Team name: __________________________________'));
  for (const r of library.rounds) {paper.append(element('h2', r.title)); for (const [i, q] of r.questions.entries()) {
    if (q.type === 'sheet') {paper.append(element('h3', q.text)); q.items.forEach((item, n) => paper.append(element('p', `${n + 1}. ${item}`), line()));}
    else if (['buzzer', 'bingo', 'musicbingo', 'pinpoint', 'clips'].includes(q.type)) continue;
    else {
      paper.append(element('p', `${i + 1}. ${q.text}`));
      if (['choice', 'vote', 'multi'].includes(q.type)) paper.append(element('p', q.options.map((o, n) => `${letters[n]}. ${o}`).join('    ')));
      if (q.type === 'sequence') paper.append(element('p', 'Put in order: ' + [...q.items].sort(() => Math.random() - 0.5).join(' · ')));
      paper.append(line());
    }
  }} window.print();
};
function teamControls(team) {
  const box = element('article', undefined, 'card'); box.append(element('h3', team.name), element('p', `${team.score} pts · ${team.enabled ? team.connected ? 'Connected' : 'Disconnected' : 'Disabled'}`));
  const photoActions = team.photo ? (team.photo_status === 'pending' ? [['Approve photo', 'approvePhoto'], ['Reject photo', 'rejectPhoto']] : [['Remove photo', 'rejectPhoto']]) : [];
  if (team.photo) box.append(avatar(team.photo), element('p', team.photo_status === 'pending' ? 'Photo waiting for approval' : 'Photo approved', 'muted'));
  for (const [label, actionName] of [...photoActions, ['Rename', 'rename'], ['Issue recovery code', 'recover'], [team.enabled ? 'Disable' : 'Restore', team.enabled ? 'disable' : 'restore']]) {
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
function answerKey(q) {
  if (q.type === 'vote') return 'Vote — no right answer';
  if (q.type === 'sequence') return 'Order: ' + q.items.join(' → ');
  if (q.type === 'multi') return 'Right ticks: ' + q.correct.join(', ');
  if (q.type === 'pinpoint') return `Pinpoint target set${q.goWide ? ` · go wide scores ${q.goWidePoints}` : ''}`;
  if (q.type === 'bingo') return `Bingo — ${modes[q.mode]} wins`;
  if (q.type === 'musicbingo') return `Music bingo — ${q.songs.length} songs, ${modes[q.mode]} wins`;
  if (q.type === 'clips') return `Right clip: ${q.targetClip + 1}. ${q.clips[q.targetClip].label || '(unnamed)'}`;
  if (q.type === 'sheet') return `${q.items.length} sheet questions`;
  const i = q.options?.indexOf(q.answer);
  return `Answer: ${q.type === 'choice' && i >= 0 ? `${letters[i]}. ` : ''}${q.answer || '(manual marking)'}${q.answerNote ? ` · ${q.answerNote}` : ''}${q.type === 'nearest' ? ` · top ${q.places} score` : ''}`;
}
function renderBuzzPanel(q) {
  const b = q?.buzz; $('buzzPanel').hidden = !b || !q.live;
  if (!b) return;
  $('buzzActive').textContent = b.active ? `🔔 ${b.active.name} is answering` : q.open ? 'Waiting for a buzz…' : 'Buzzing closed — end the question when ready';
  $('buzzQueue').replaceChildren(...b.queue.map(x => {const li = element('li', `${x.name} — ${x.status}`); if (x.status === 'active') li.className = 'active'; return li;}));
  $('advancedControls').hidden = b.variation !== 'advanced';
  $('agreeInfo').textContent = b.agreeOpen ? `Agree countdown running · ${b.agreeCount} agreed so far` : b.announced ? `Agree vote closed · ${b.agreeCount} agreed with “${b.announced}”` : '';
  for (const id of ['buzzCorrect', 'buzzWrong', 'buzzPass']) $(id).disabled = !b.active || busy;
  $('startAgree').disabled = !b.active || b.agreeOpen || busy;
  const leader = b.active?.name || ''; if (leader && leader !== lastBuzz) buzzSound(leader, b.active.sound); lastBuzz = leader;
}
function renderBingoPanel(q) {
  const g = q?.bingo; $('bingoPanel').hidden = !g || !q.live;
  if (!g) return;
  $('callNumber').textContent = g.music ? 'Play next song' : 'Call next number';
  if (!q.live) $('songAudio').pause();
  if (g.music) {
    $('bingoInfo').textContent = g.winners.length ? `BINGO: ${g.winners.join(', ')} — end the game when ready` : g.current ? `Song ${g.played}: ${g.current.title}` : 'No songs played yet';
    $('bingoCalls').textContent = `${g.played} of ${q.songs.length} songs played`;
    $('callNumber').disabled = busy || !!g.winners.length || !!q.paused || g.played >= q.songs.length;
    return;
  }
  $('bingoInfo').textContent = g.winners.length ? `BINGO: ${g.winners.join(', ')} — end the game when ready` : g.last ? `Last call: ${g.last}${state.settings.bingoPhrases ? ` — ${bingoCall(g.last)}` : ''} · ${g.called.length} called` : 'No numbers called yet';
  $('bingoCalls').textContent = g.called.join(' · ');
  $('callNumber').disabled = busy || !!g.winners.length || !!q.paused || g.called.length >= 90;
}
function shownValue(q, value) {
  if (q.type === 'multi') {try {return JSON.parse(value).join(', ') || '(nothing ticked)';} catch {return value;}}
  if (q.type === 'pinpoint') {try {return JSON.parse(value).map((p, i) => `${i ? 'Go-wide tap' : 'Tap'} at ${Math.round(p[0] * 100)}%, ${Math.round(p[1] * 100)}%`).join(' · ');} catch {return value;}}
  if (q.type === 'sequence') {try {return JSON.parse(value).map(i => q.items[i]).join(' → ');} catch {return value;}}
  const i = q.options?.indexOf(value);
  return (q.type === 'choice' || q.type === 'vote') && i >= 0 ? `${letters[i]}. ${value}` : value;
}
function renderState(s) {
  state = s; offset = s.serverTime - Date.now();
  $('eventTitle').textContent = s.settings.title; $('eventState').textContent = s.settings.ended ? 'Quiz finished' : 'Quiz in progress';
  if (!$('eventName').value) $('eventName').value = s.settings.title;
  if (!$('joinDetails').contains(document.activeElement)) {$('joinSsidInput').value = s.settings.joinSsid; $('joinUrlInput').value = s.settings.joinUrl;}
  const q = s.question, pending = q?.live;
  $('liveRound').textContent = q?.round || ''; $('liveText').textContent = q?.text || 'Ready when you are'; $('liveTimer').textContent = timeText(q, offset);
  $('liveKey').textContent = q ? answerKey(q) : '';
  if (q?.id !== liveQuestion) {liveQuestion = q?.id; $('announced').value = '';}
  renderBuzzPanel(q); renderBingoPanel(q);
  if (clipRun && (q?.id !== clipRun.question || !q.live)) stopClips(); else renderClipsPanel(q);
  $('liveCount').textContent = q ? `${s.answers.length} answers received · ${s.teams.filter(t => t.enabled).length} active teams` : 'Add rounds in Build quiz, then start your first question.';
  renderMedia($('liveMedia'), q); renderSolution($('liveSolution'), q);
  $('next').disabled = !!q?.live || s.settings.ended; $('close').textContent = ['buzzer', 'bingo', 'musicbingo', 'clips'].includes(q?.type) ? 'End game' : 'Close answers'; $('close').disabled = !pending; $('pause').disabled = !q?.open; $('resume').disabled = !q?.paused; $('reveal').disabled = !q || !!pending;
  $('reveal').textContent = q?.revealed ? 'Hide answer reveal' : 'Reveal answer';
  $('registration').textContent = s.settings.registrationOpen ? 'Close registration' : 'Open registration'; $('registration').disabled = s.settings.ended;
  $('visibility').textContent = s.settings.leaderboardVisible ? 'Hide leaderboard' : 'Show leaderboard';
  $('photos').textContent = `Team photos: ${s.settings.teamPhotos ? 'on' : 'off'}`;
  $('scramble').textContent = `Scramble keypads: ${s.settings.scrambleKeypads ? 'on' : 'off'}`; $('phrases').textContent = `Bingo phrases: ${s.settings.bingoPhrases ? 'on' : 'off'}`;
  if (!$('blockedForm').contains(document.activeElement)) $('blockedWords').value = s.blockedWords.join('\n'); $('displayMode').value = s.settings.displayMode; $('finish').textContent = s.settings.ended ? 'Resume quiz' : 'Finish quiz';
  const offline = s.teams.filter(t => t.enabled && !t.connected), photos = s.teams.filter(t => t.photo_status === 'pending').length;
  $('alerts').textContent = [offline.length ? `⚠ Disconnected: ${offline.map(t => t.name).join(', ')}` : '', photos ? `📷 ${photos} team ${photos === 1 ? 'photo' : 'photos'} waiting for approval in Teams & results` : ''].filter(Boolean).join(' · ');
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
  $('reviewKey').textContent = q.type === 'sheet' ? 'One point per item. Review any items without a key.' : answerKey(q) + (q.aliases?.length ? ' · Also accepts: ' + q.aliases.join(', ') : '');
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
    } else card.append(element('p', answer ? shownValue(q, answer.value) : '(no answer)', 'submitted-answer'));
    const points = element('input'); points.type = 'number'; points.min = '-200'; points.max = '200'; points.step = '1'; points.required = true; points.value = answer?.points || 0;
    if (q.type !== 'sheet') {const label = element('label', 'Total points'); label.append(points); card.append(label);}
    const save = element('button', 'Save mark'); save.disabled = q.live;
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
const updates = live(refresh, () => key);
