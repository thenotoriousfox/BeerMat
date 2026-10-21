import {$, element, api, message, readStorage, writeStorage, download, renderMedia, renderSolution, timeText, selectOptions, letters, live, enableSound, useSounds, buzzSound, renderPinpoint, bingoCall, avatar} from './app.js';
import {parseSqRound, parseQuickQuestion} from './sqimport.js';
import {slotFiles} from './soundnames.js';
import {looks} from './looks.js';
let key = readStorage('pubquiz-host', true), state = null, library = null, editingId = null, tab = 'live', dirty = false, reviewId = '', reviewSignature = '', busy = false;
const uid = () => 'id-' + crypto.getRandomValues(new Uint32Array(4)).join('-');
const request = (p, body = {}) => api('host/' + p, body, key);
let offset = 0, selectedRoundId = '', lastBuzz = '', liveQuestion = null, pinTarget = null, clipItems = [], targetClip = 0, clipRun = null;
const speedTypes = ['text', 'choice', 'multi', 'letter', 'number', 'sequence', 'pinpoint', 'wordsnake', 'tiles', 'picture', 'audio', 'bingo', 'musicbingo', 'clips'];
// Formats marked right or wrong automatically (with a correct answer set): Evil Mode and a fixed bonus apply to these.
const markedTypes = ['text', 'choice', 'multi', 'letter', 'number', 'sequence', 'pinpoint', 'wordsnake', 'tiles', 'picture', 'audio'];
const modes = {progressive: 'full game (line, two lines, full house)', line: 'one line', twoLines: 'two lines', fullHouse: 'full house'}, stageNames = {line: 'Line', twoLines: 'Two lines', fullHouse: 'Full house'};
const isBingoType = type => type === 'bingo' || type === 'musicbingo';
// The desk's summary of a bingo game: who won the latest prize, and what is being played for now.
const bingoWins = g => g.mode === 'progressive' ? `${stageNames[g.lastStage]}: ${g.winners.join(', ')}${g.over ? ' — game over, end it when ready' : ` · now playing for ${modes[g.playingFor]}`}` : `BINGO: ${g.winners.join(', ')} — end the game when ready`;
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
  if (name === 'build') loadSpotify();
}
// Spotify: optional, for private quizzes. The server talks to Spotify; the desk only shows status and starts sign-in.
let spotify = null;
async function loadSpotify() {
  try {spotify = await request('spotify/status');} catch (e) {$('spotifyStatus').textContent = e.message; return;}
  $('spotifyRedirect').textContent = spotify.redirectUri;
  if (document.activeElement !== $('spotifyClientId')) $('spotifyClientId').value = spotify.clientId;
  $('spotifyStatus').textContent = spotify.connected ? `✓ Connected${spotify.user ? ' as ' + spotify.user : ''}${spotify.devices.length ? '' : ' · no player found: open the Spotify app on this laptop and play any song once, then Refresh players'}` : 'Not connected';
  $('spotifyDisconnect').disabled = !spotify.connected; $('spotifyDevice').disabled = $('spotifyRefresh').disabled = !spotify.connected;
  selectOptions($('spotifyDevice'), [['', 'Whichever Spotify player is active'], ...spotify.devices.map(d => [d.id, `${d.name} (${d.type})${d.active ? ' — active' : ''}`])], spotify.device);
  for (const id of ['spotifySongs', 'spotifyClips']) $(id).disabled = !spotify.connected;
  $('spotifyStartPlayer').disabled = !spotify.deskPlayer; showDeskPlayer();
}
$('spotifyForm').onsubmit = e => {e.preventDefault(); const clientId = $('spotifyClientId').value.trim(); action(async () => {
  const {url} = await request('spotify/connect', {clientId});
  if (!window.open(url, '_blank')) location.assign(url);
  return 'Finish signing in to Spotify in the new tab, then come back here';
});};
// Web Playback SDK: makes this desk tab a Spotify player called "PubQuiz desk". Spotify's script is only fetched when
// the quizmaster presses Start, and the click also unlocks audio in the browser.
let deskPlayer = null, deskReady = false;
function startDeskPlayer() {
  if (!spotify?.connected) return message('Connect Spotify first (Build quiz → Spotify)', true);
  if (!spotify.deskPlayer) return message('Press Connect Spotify again to allow playing on this desk (a permission was added)', true);
  if (deskPlayer) {deskPlayer.activateElement?.(); deskPlayer.connect(); return;}
  window.onSpotifyWebPlaybackSDKReady = () => {
    deskPlayer = new window.Spotify.Player({name: 'PubQuiz desk', volume: 0.9,
      getOAuthToken: done => request('spotify/token').then(t => done(t.accessToken)).catch(e => message(e.message, true))});
    deskPlayer.addListener('ready', ({device_id: id}) => {deskReady = true; request('spotify/device', {id}).then(loadSpotify).then(() => message('🎵 Spotify is playing through this desk')).catch(e => message(e.message, true)); showDeskPlayer();});
    deskPlayer.addListener('not_ready', () => {deskReady = false; showDeskPlayer(); message('The Spotify desk player went offline — check this laptop’s internet', true);});
    deskPlayer.addListener('initialization_error', () => message('This browser cannot play Spotify (it needs protected-media support). Use Chrome, Firefox or Edge, or the Spotify app.', true));
    deskPlayer.addListener('authentication_error', ({message: text}) => message(`Spotify sign-in problem: ${text}. Press Connect Spotify again.`, true));
    deskPlayer.addListener('account_error', () => message('Playing on the desk needs Spotify Premium.', true));
    deskPlayer.addListener('playback_error', ({message: text}) => message(`Spotify could not play: ${text}`, true));
    deskPlayer.activateElement?.(); deskPlayer.connect();
  };
  const script = element('script'); script.src = 'https://sdk.scdn.co/spotify-player.js';
  script.onerror = () => {window.onSpotifyWebPlaybackSDKReady = null; message('Could not load Spotify’s player. Is this laptop online?', true);};
  document.head.append(script); $('spotifyPlayerState').textContent = 'Starting…';
}
function showDeskPlayer() {
  $('spotifyPlayerState').textContent = deskReady ? '✓ Ready — playing through this desk' : '';
  const q = state?.question, wanted = spotify?.deskPlayer && !deskReady && q?.live && (q.songs || q.clips || []).some(x => x.spotify);
  $('spotifyStartLive').hidden = !wanted;
}
$('spotifyStartPlayer').onclick = $('spotifyStartLive').onclick = startDeskPlayer;
$('spotifyDisconnect').onclick = () => action(async () => {await request('spotify/disconnect'); await loadSpotify();}, 'Spotify disconnected');
$('spotifyRefresh').onclick = () => action(loadSpotify, 'Spotify players refreshed');
$('spotifyDevice').onchange = () => {const id = $('spotifyDevice').value; action(() => request('spotify/device', {id}), 'Spotify player chosen');};
window.addEventListener('focus', () => {if (tab === 'build') loadSpotify();});
const spotifyLinks = id => $(id).value.split('\n').map(s => s.trim()).filter(Boolean);
$('spotifySongs').onclick = () => {const links = spotifyLinks('spotifySongLinks'); action(async () => {
  const {songs} = await request('spotify/import', {links});
  $('qSongs').value = [$('qSongs').value.trim(), ...songs.map(s => `${s.title} | ${s.spotify}`)].filter(Boolean).join('\n'); $('spotifySongLinks').value = ''; editorChanged();
  return `${songs.length} songs added from Spotify — save the question to keep them`;
});};
$('spotifyClips').onclick = () => {const links = spotifyLinks('spotifyClipLinks'), start = Number($('spotifyClipStart').value); action(async () => {
  const {songs} = await request('spotify/import', {links});
  clipItems.push(...songs.map(s => ({spotify: s.spotify, start, label: s.title}))); $('spotifyClipLinks').value = ''; renderClipList(); editorChanged();
  return `${songs.length} Spotify clips added — pick the right one, then save the question`;
});};
document.querySelectorAll('[data-tab]').forEach(el => el.onclick = () => chooseTab(el.dataset.tab));
function round() {return library?.rounds.find(r => r.id === $('roundSelect').value);}
function savedQuestion() {return round()?.questions.find(q => q.id === editingId);}
function editorChanged() {dirty = true; $('editorStatus').textContent = 'Unsaved changes';}
function formTypes() {
  const type = $('qType').value, show = (id, on) => {$(id).hidden = !on;};
  show('choiceFields', ['choice', 'vote', 'multi'].includes(type)); show('multiFields', type === 'multi'); show('sheetFields', type === 'sheet'); show('sequenceFields', type === 'sequence');
  show('nearestFields', type === 'nearest'); show('buzzerFields', type === 'buzzer'); show('pinpointFields', type === 'pinpoint'); show('goWideFields', type === 'pinpoint' || type === 'wordsnake');
  $('goWideText').textContent = type === 'wordsnake' ? 'Allow go wide: teams can remove the decoy letters for fewer points' : 'Allow go wide: a second tap scores if the first misses'; show('bingoFields', type === 'bingo' || type === 'musicbingo'); show('stagePointsFields', (type === 'bingo' || type === 'musicbingo') && $('qMode').value === 'progressive');
  const songs = $('qSongs').value.split('\n').filter(l => l.trim()).length; $('songCount').textContent = `${songs} songs${songs < 30 ? ' — add at least 30 so each team gets a different mix (a ticket holds 15)' : ''}`; show('musicFields', type === 'musicbingo'); show('clipsFields', type === 'clips');
  show('mediaFields', !['sheet', 'bingo', 'musicbingo', 'clips'].includes(type)); show('answerFields', !['sheet', 'vote', 'sequence', 'multi', 'pinpoint', 'bingo', 'musicbingo', 'clips'].includes(type)); show('aliasesLabel', ['text', 'picture', 'audio'].includes(type)); show('noteLabel', type !== 'sheet');
  // Speed bonus settings only appear once fastest fingers first is ticked.
  const fastest = speedTypes.includes(type) && $('qFastest').checked;
  show('pointsLabel', type !== 'sheet' && !(isBingoType(type) && $('qMode').value === 'progressive')); show('fastestLabel', speedTypes.includes(type)); show('speedLabel', fastest);
  show('bonusModeLabel', fastest && markedTypes.includes(type)); show('bonusPlacesLabel', fastest && markedTypes.includes(type) && $('qBonusMode').value === 'fixed'); show('evilLabel', markedTypes.includes(type));
  $('answerLabel').textContent = {choice: 'Correct choice (copy one line from above; blank for manual marking)', letter: 'Correct letter (A–Z)', wordsnake: 'Answer word (letters only, 3–20; spaces are removed)', tiles: 'Answer (4–40 letters; spaces mark separate words)', number: 'Correct number', nearest: 'Correct number', buzzer: 'Expected answer (shown only to you)'}[type] || 'Correct answer (blank for manual marking)';
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
    const li = element('li', undefined, 'clip-row'), pick = element('input'), name = element('input'), remove = element('button', 'Remove', 'subtle');
    // Uploaded clips get a player; Spotify clips get their start time.
    const play = clip.spotify ? element('label', 'Spotify · start (s)') : element('audio');
    pick.type = 'radio'; pick.name = 'targetClip'; pick.checked = i === targetClip; pick.title = 'The right clip'; pick.onchange = () => {targetClip = i; editorChanged();};
    name.value = clip.label; name.maxLength = 100; name.oninput = () => {clip.label = name.value;}; name.setAttribute('aria-label', `Clip ${i + 1} name`);
    if (clip.spotify) {const start = element('input'); start.type = 'number'; start.min = '0'; start.max = '3600'; start.value = clip.start ?? 0; start.oninput = () => {clip.start = Number(start.value);}; play.append(start);}
    else {play.src = clip.media; play.controls = true; play.preload = 'none';}
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
  $('qSongs').value = (q?.songs || []).map(s => s.media || s.spotify ? `${s.title} | ${s.media || s.spotify}${s.start !== undefined || s.seconds !== undefined ? ` | ${s.start ?? ''} | ${s.seconds ?? ''}` : ''}` : s.title).join('\n'); $('qStartAt').value = q?.startAt ?? 0; $('qSongSeconds').value = q?.songSeconds ?? 0; $('qAutoNext').checked = !!q?.autoNext; $('qClipSeconds').value = q?.clipSeconds ?? 15; $('qRevealNow').checked = !!q?.revealNow;
  clipItems = structuredClone(q?.clips || []); targetClip = q?.targetClip ?? 0; renderClipList();
  $('qFastest').checked = !!q?.fastestFingers; $('qBonusMode').value = q?.bonusMode || 'sliding'; $('qBonusPlaces').value = q?.bonusPlaces ?? 1; $('qEvil').checked = !!q?.evil;
  $('qGoWide').checked = !!q?.goWide; $('qGoWidePoints').value = q?.goWidePoints ?? 0; $('qMode').value = q?.mode || 'progressive';
  [$('qLinePoints').value, $('qTwoLinePoints').value, $('qHousePoints').value] = q?.stagePoints || [1, 2, 3];
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
    speedBonus: speedTypes.includes(type) ? Number($('qSpeed').value) : 0, fastestFingers: speedTypes.includes(type) && $('qFastest').checked, answer: $('qAnswer').value.trim(), answerNote: $('qNote').value.trim(), aliases: lines('qAliases'), media: $('qMedia').value};
  if (markedTypes.includes(type)) Object.assign(q, {evil: $('qEvil').checked, bonusMode: $('qBonusMode').value, bonusPlaces: Number($('qBonusPlaces').value)});
  if (['choice', 'vote', 'multi'].includes(type)) q.options = lines('qOptions');
  if (type === 'multi') q.correct = lines('qCorrect');
  if (type === 'pinpoint') q.target = pinTarget;
  if (type === 'pinpoint' || type === 'wordsnake') Object.assign(q, {goWide: $('qGoWide').checked, goWidePoints: Number($('qGoWidePoints').value)});
  const stagePoints = $('qMode').value === 'progressive' ? {stagePoints: [Number($('qLinePoints').value), Number($('qTwoLinePoints').value), Number($('qHousePoints').value)]} : {};
  if (type === 'bingo') Object.assign(q, {mode: $('qMode').value, media: '', ...stagePoints});
  if (type === 'musicbingo') Object.assign(q, {...stagePoints, mode: $('qMode').value, revealNow: $('qRevealNow').checked, startAt: Number($('qStartAt').value), songSeconds: Number($('qSongSeconds').value), autoNext: $('qAutoNext').checked, media: '', songs: lines('qSongs').map(line => {
    // "Title | /media/file.mp3" plays an uploaded file; "Title | spotify:track:…" (or a Spotify song link) plays on
    // Spotify. "| start | seconds" after it gives that song its own start point and play time.
    const [title, rest = ''] = line.split(/\s*\|\s*(?=\/media\/|spotify:track:|https:\/\/open\.spotify\.com\/)/), [file = '', start = '', seconds = ''] = rest.split('|').map(s => s.trim());
    return {title: title.trim(), media: file.startsWith('/media/') ? file : null, ...(/^(spotify:|https:)/.test(file) ? {spotify: file} : {}), ...(start !== '' && {start: Number(start)}), ...(seconds !== '' && {seconds: Number(seconds)})};
  })});
  if (type === 'clips') Object.assign(q, {clips: clipItems.map(c => c.spotify ? {spotify: c.spotify, start: c.start ?? 0, ...(c.seconds !== undefined && {seconds: c.seconds}), label: c.label.trim()} : {media: c.media, label: c.label.trim()}), targetClip, clipSeconds: Number($('qClipSeconds').value), media: ''});
  if (type === 'sequence') q.items = lines('qItems');
  if (type === 'sheet') Object.assign(q, {items: rows.map(row => row.querySelectorAll('input')[0].value.trim()), itemAnswers: rows.map(row => row.querySelectorAll('input')[1].value.trim()), answerNote: '', media: ''});
  if (type === 'nearest') q.places = Number($('qPlaces').value);
  if (type === 'buzzer') Object.assign(q, {variation: $('qVariation').value, penalty: Number($('qPenalty').value), passPenalty: Number($('qPassPenalty').value), agreePoints: Number($('qAgreePoints').value), agreeSeconds: Number($('qAgreeSeconds').value)});
  return q;
}
$('questionForm').oninput = editorChanged;
$('qType').onchange = $('qVariation').onchange = $('qBonusMode').onchange = $('qFastest').onchange = $('qMode').onchange = $('qSongs').onchange = () => {formTypes(); editorChanged();};
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
// Quiz files can carry their pictures and sounds inside them as data: URLs, so a quiz moves between laptops in one
// file. Importing uploads each one (once, even if used twice) and swaps in its new /media/ path.
const mediaTypes = {'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'audio/mpeg': '.mp3', 'audio/ogg': '.ogg', 'audio/wav': '.wav', 'audio/x-wav': '.wav', 'audio/wave': '.wav'};
async function unpackMedia(quiz) {
  const done = new Map();
  const unpack = async value => {
    const match = typeof value === 'string' && /^data:([^;,]+);base64,(.*)$/s.exec(value);
    if (!match) return value;
    if (!done.has(value)) {
      if (!mediaTypes[match[1]]) throw Error(`Embedded ${match[1]} files are not supported`);
      const bytes = Uint8Array.from(atob(match[2]), c => c.charCodeAt(0));
      done.set(value, await uploadMedia(new File([bytes], `embedded${mediaTypes[match[1]]}`, {type: match[1]})));
    }
    return done.get(value);
  };
  for (const round of quiz?.rounds || []) for (const q of round.questions || []) {
    q.media = await unpack(q.media);
    for (const item of [...(q.clips || []), ...(q.songs || [])]) item.media = await unpack(item.media);
  }
  return quiz;
}
async function readQuizFile(file) {
  if (file.size > 50 * 1024 * 1024) throw Error('Quiz files must be under 50 MB');
  let quiz; try {quiz = JSON.parse(await file.text());} catch {throw Error('That file is not a quiz JSON file');}
  return unpackMedia(quiz);
}
async function packMedia(quiz) {
  const copy = structuredClone(quiz), done = new Map();
  const pack = async path => {
    if (typeof path !== 'string' || !path.startsWith('/media/')) return path;
    if (!done.has(path)) {
      const blob = await (await fetch(path)).blob();
      done.set(path, await new Promise(resolve => {const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsDataURL(blob);}));
    }
    return done.get(path);
  };
  delete copy.revision;
  for (const round of copy.rounds) for (const q of round.questions) {
    q.media = await pack(q.media);
    for (const item of [...(q.clips || []), ...(q.songs || [])]) item.media = await pack(item.media);
  }
  return copy;
}
// Loading a quiz file starts a fresh quiz: the current one's results are saved (and downloaded if anything was
// played), then teams and scores are cleared, as with End quiz & start next.
$('importQuiz').onchange = () => {const file = $('importQuiz').files[0]; $('importQuiz').value = ''; if (file) action(async () => {
  const played = state.history.length || state.teams.length;
  if (played && !confirm('Start a fresh quiz with this file? The current quiz ends: its results are saved and downloaded, and all teams and scores are cleared.')) return;
  const result = await request('new-event', {questions: 'load', quiz: await readQuizFile(file)});
  if (played) download(`pubquiz-results-${result.saved.replace(/^results\//, '')}`, result.results);
  await loadLibrary(); reviewId = '';
  return `New quiz loaded: ${library.title}${played ? ` — last quiz's results saved in ${result.saved}` : ''}`;
});};
$('exportQuiz').onclick = () => download('pubquiz-questions.json', library);
$('exportQuizMedia').onclick = () => action(async () => download(`${library.title.replace(/[^a-zA-Z0-9]+/g, '-') || 'quiz'}-with-media.json`, await packMedia(library)), 'Quiz downloaded with its pictures and sounds');
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
    if (/\.sq[bqntwp]$/i.test(file.name)) {
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
  if (clipRun?.spotify) request('spotify/pause').catch(() => {});
  if (clipRun) request('clip', {question: clipRun.question, clip: -1}).catch(() => {});
  clipRun = null; if (state) renderClipsPanel(state.question);
}
function playClip(i) {
  const q = state.question;
  if (!q?.live || q.type !== 'clips' || i >= q.clips.length) return stopClips();
  // A Spotify clip plays on the laptop's Spotify app for the question's clip length; the server logs its start.
  if (q.clips[i].spotify) {
    const run = clipRun = {question: q.id, index: i, spotify: true};
    request('spotify/play', {question: q.id, clip: i}).then(() => setTimeout(async () => {
      if (clipRun !== run) return;
      await request('spotify/pause').catch(() => {}); await request('clip', {question: q.id, clip: -1}).catch(() => {});
      setTimeout(() => {if (clipRun === run) playClip(i + 1);}, 1500);
    }, (q.clips[i].seconds ?? q.clipSeconds) * 1000)).catch(e => {message(e.message, true); if (clipRun === run) stopClips();});
    return renderClipsPanel(q);
  }
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
// Music bingo song timer: each song stops after the question's play time, and with auto-next the next one follows
// after a short gap, unless someone has called bingo or the game is paused or over. songRun cancels stale timers.
let songTimer = null, songRun = 0;
function stopSongTimer() {clearTimeout(songTimer); songTimer = null; songRun++;}
function timeSong(q, song) {
  const run = songRun, claims = state.question?.bingo?.claims ?? 0, seconds = song.seconds ?? q.songSeconds;
  if (!seconds) return;
  songTimer = setTimeout(async () => {
    if (run !== songRun) return;
    $('songAudio').pause(); if (song.spotify) await request('spotify/pause').catch(() => {});
    const live = state.question;
    // A claim during the song pauses the auto-play so the quizmaster can check it.
    if (!q.autoNext || run !== songRun || live?.id !== q.id || !live.live || live.paused || live.bingo.over || live.bingo.claims > claims || live.bingo.pending > 0 || live.bingo.played >= q.songs.length) return;
    songTimer = setTimeout(() => {if (run === songRun && !$('callNumber').disabled) $('callNumber').click();}, 2000);
  }, seconds * 1000);
}
// --- Sounds & bingo calls ---------------------------------------------------------------------------------------
// Sound files are matched to moments by SpeedQuizzing's file names (soundnames.js; first match wins).
const soundSlotInfo = Object.entries({startRound: 'Round starts', questionStart: 'Question opens', timerMusic: 'Music while answering (loops)', countdown: 'Final countdown (hits zero at time up)', timeUp: "Time's up",
  endRound: 'Round ends (leaderboard)', correct: 'Correct buzzer answer', wrong: 'Wrong buzzer answer', reveal: 'Answer reveal', bingoCall: 'Bingo number called',
  bingo: 'Someone calls BINGO', applause: 'Winner'}).map(([slot, label]) => [slot, label, slotFiles[slot]]);
const audioFile = file => /\.(mp3|ogg|wav)$/i.test(file.name);
const fileKey = file => (file.webkitRelativePath || file.name).toLowerCase().replace(/\.(mp3|ogg|wav)$/, '');
let soundsSignature = '';
function renderSounds(s) {
  const signature = JSON.stringify([s.sounds, s.bingoCalls?.length, s.soundThemes, s.settings.soundTheme, s.soundThemesByType, s.soundThemeNow]); if (signature === soundsSignature) return; soundsSignature = signature;
  // Themes come from the sound pack (SpeedQuizzing's Themes folder); a theme only replaces the moments it has sounds for.
  // A fixed theme, a random one for each question, or one per question type.
  const themeName = name => name || 'Standard sounds';
  selectOptions($('soundTheme'), [['', 'Standard sounds'], ...s.soundThemes.map(name => [name, name]), ...(s.soundThemes.length ? [['@random', 'Random theme for each question'], ['@type', 'Theme by question type']] : [])], s.settings.soundTheme);
  $('soundTheme').disabled = !s.soundThemes.length;
  const mode = s.settings.soundTheme, perQuestion = mode === '@random' || mode === '@type';
  $('themeHint').textContent = !s.soundThemes.length ? 'No themes found. Themes come from a sound pack (soundpack/Themes/<name>/, as in SpeedQuizzing).'
    : `A theme replaces the moments it has a sound for; the rest use the standard sounds. Changing theme resets the moments below to it (added buzzer sounds stay).${perQuestion ? ` Current question: ${themeName(s.soundThemeNow)}.` : ''}`;
  $('themeByType').hidden = mode !== '@type';
  if (mode === '@type') $('themeByType').replaceChildren(...[...$('qType').options].map(option => {
    const label = element('label', option.textContent), select = element('select');
    selectOptions(select, [['', 'Standard sounds'], ...s.soundThemes.map(name => [name, name])], s.soundThemesByType[option.value] ?? '');
    select.onchange = () => {const theme = select.value; action(() => request('settings', {soundThemeByType: {[option.value]: theme}}), `${option.textContent}: ${themeName(theme)}`);};
    label.append(select); return label;
  }));
  $('soundSlots').replaceChildren(...soundSlotInfo.map(([slot, label]) => {
    const row = element('div', undefined, 'sound-slot'), media = s.sounds.slots[slot], pick = element('input'), play = element('button', '▶', 'subtle'), remove = element('button', 'Remove', 'subtle');
    pick.type = 'file'; pick.accept = 'audio/mpeg,audio/ogg,audio/wav'; pick.setAttribute('aria-label', `File for ${label}`);
    pick.onchange = () => {const file = pick.files[0]; if (file) action(async () => {await request('sounds', {slots: {[slot]: await uploadMedia(file)}});}, `${label}: sound saved`);};
    play.type = remove.type = 'button'; play.disabled = remove.disabled = !media; play.title = 'Play here';
    play.onclick = () => {new Audio(media).play().catch(() => {});};
    remove.onclick = () => action(() => request('sounds', {slots: {[slot]: null}}), `${label}: sound removed`);
    row.append(element('strong', label), element('span', !media ? 'none (built-in beep or silent)' : media.startsWith('/sounds/') ? 'PubQuiz default' : media.startsWith('/pack/') ? 'from your sound pack' : 'your file', 'muted'), pick, play, remove); return row;
  }));
  $('buzzerStatus').textContent = s.sounds.buzzers.length ? `${s.sounds.buzzers.length} buzzer sounds added: ${s.sounds.buzzers.slice(0, 8).map(b => b.name).join(', ')}${s.sounds.buzzers.length > 8 ? '…' : ''}` : 'Only the 8 built-in buzzer sounds';
  $('clearBuzzers').disabled = !s.sounds.buzzers.length;
  $('callsStatus').textContent = s.bingoCalls ? `Your own bingo calls are in use (e.g. 4: “${s.bingoCalls[3] || bingoCall(4)}”)` : 'Built-in bingo calls';
  $('defaultCalls').disabled = !s.bingoCalls;
}
// The TV and phones' look: one look, a random one for each question, or one per question type.
const lookName = id => looks.find(([value]) => value === id)?.[1] || id;
let looksSignature = '';
function renderLooks(s) {
  const signature = JSON.stringify([s.settings.look, s.looksByType, s.look]); if (signature === looksSignature) return; looksSignature = signature;
  if (document.activeElement !== $('look')) selectOptions($('look'), [...looks, ['@random', 'Random look for each question'], ['@type', 'Look by question type']], s.settings.look);
  $('lookNow').textContent = s.settings.look.startsWith('@') ? `(now: ${lookName(s.look)})` : '';
  $('lookByType').hidden = s.settings.look !== '@type';
  if (s.settings.look === '@type' && !$('lookByType').contains(document.activeElement)) $('lookByType').replaceChildren(...[...$('qType').options].map(option => {
    const label = element('label', option.textContent), select = element('select');
    selectOptions(select, looks, s.looksByType[option.value] ?? 'stage');
    select.onchange = () => {const look = select.value; action(() => request('settings', {lookByType: {[option.value]: look}}), `${option.textContent}: ${lookName(look)}`);};
    label.append(select); return label;
  }));
}
$('look').onchange = () => {const look = $('look').value; action(() => request('settings', {look}), look === '@random' ? 'Each question now gets a random look' : look === '@type' ? 'Each question type now has its own look — change them below' : `Look: ${lookName(look)}`);};
$('soundTheme').onchange = () => {const soundTheme = $('soundTheme').value; action(() => request('settings', {soundTheme}), soundTheme ? `Sound theme: ${soundTheme}` : 'Standard sounds');};
$('soundFolder').onchange = () => {const files = [...$('soundFolder').files].filter(audioFile); action(async () => {
  const slots = {};
  for (const [slot, , names] of soundSlotInfo) {
    const file = names.map(name => files.find(f => fileKey(f).endsWith(name) && (fileKey(f) === name || fileKey(f).endsWith('/' + name)))).find(Boolean);
    if (file) slots[slot] = await uploadMedia(file);
  }
  $('soundFolder').value = '';
  if (!Object.keys(slots).length) throw Error('No sound files with recognised names in that folder — pick a file for each moment instead');
  await request('sounds', {slots});
  return `${Object.keys(slots).length} sound effects set: ${soundSlotInfo.filter(([slot]) => slots[slot]).map(([, label]) => label).join(', ')}`;
});};
async function addBuzzers(files) {
  const current = state.sounds.buzzers, names = new Set(current.map(b => b.name.toLowerCase())), added = [];
  for (const file of files.filter(audioFile)) {
    const name = file.name.replace(/\.(mp3|ogg|wav)$/i, '').replace(/[_]+/g, ' ').trim().slice(0, 60);
    if (!name || names.has(name.toLowerCase()) || current.length + added.length >= 200) continue;
    names.add(name.toLowerCase()); added.push({name, media: await uploadMedia(file)});
  }
  await request('sounds', {buzzers: [...current, ...added]});
  return `${added.length} buzzer sounds added — teams can pick them in their phone menu`;
}
$('buzzerFolder').onchange = () => {const files = [...$('buzzerFolder').files]; $('buzzerFolder').value = ''; action(() => addBuzzers(files));};
$('buzzerFiles').onchange = () => {const files = [...$('buzzerFiles').files]; $('buzzerFiles').value = ''; action(() => addBuzzers(files));};
$('clearBuzzers').onclick = () => action(async () => {if (confirm('Remove all added buzzer sounds? Teams using one go back to a built-in sound.')) await request('sounds', {buzzers: []});}, 'Buzzer sounds updated');
// SpeedQuizzing's file is JSON ({"1": "…", …, "90": "…"}); a plain list of 90 lines (optionally "4: …") works too.
function parseCalls(text) {
  let calls = Array(90).fill('');
  try {
    const data = JSON.parse(text);
    for (let n = 1; n <= 90; n++) calls[n - 1] = String((Array.isArray(data) ? data[n - 1] : data[n]) ?? '').slice(0, 150);
  } catch {
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    lines.forEach((line, i) => {const m = /^(\d{1,2})\s*[:.)\-–]\s*(.*)$/.exec(line), n = m ? Number(m[1]) : i + 1; if (n >= 1 && n <= 90) calls[n - 1] = (m ? m[2] : line).slice(0, 150);});
  }
  if (calls.filter(Boolean).length < 10) throw Error('That file does not look like a list of bingo calls');
  return calls;
}
$('callsFile').onchange = () => {const file = $('callsFile').files[0]; $('callsFile').value = ''; if (file) action(async () => {
  const calls = parseCalls(await file.text()); await request('bingo-calls', {calls});
  const missing = calls.map((c, i) => c ? null : i + 1).filter(Boolean);
  return `${90 - missing.length} bingo calls imported${missing.length ? ` — ${missing.length < 12 ? missing.join(', ') : missing.length + ' numbers'} use the built-in calls` : ''}`;
});};
$('defaultCalls').onclick = () => action(() => request('bingo-calls', {calls: null}), 'Back to the built-in bingo calls');
$('callNumber').onclick = () => action(async () => {
  stopSongTimer();
  const q = state.question, {number, warning} = await request('bingo', {question: q.id});
  if (q.type !== 'musicbingo') return `Called ${number}`;
  const song = q.songs[number - 1], audio = $('songAudio');
  audio.hidden = !song.media;
  if (song.spotify) {audio.pause(); if (!warning) timeSong(q, song); return `Song ${q.bingo.played + 1}: ${song.title}${warning ? ` — ⚠ ${warning}` : ' — playing on Spotify'}`;}
  // A media fragment (#t=) starts an uploaded song at the chosen point.
  const startAt = song.start ?? q.startAt;
  if (song.media) {audio.src = song.media + (startAt ? `#t=${startAt}` : ''); audio.play().then(() => timeSong(q, song)).catch(() => message('Press play on the song player', true));}
  return `Song ${q.bingo.played + 1}: ${song.title}${song.media ? '' : ' — play it from your own music player'}`;
});
$('spinWheel').onclick = () => action(async () => {
  const items = $('wheelItems').value.split('\n').map(s => s.trim()).filter(Boolean);
  const auto = state.settings.displayMode === 'auto';
  if (!auto && state.settings.displayMode !== 'wheel') await request('settings', {displayMode: 'wheel'});
  const wheel = await request('wheel', items.length ? {items} : {});
  $('wheelLast').textContent = `Last spin: ${wheel.items[wheel.result]}`;
  return auto ? 'Wheel spinning on the projector — Auto carries on once the result has shown' : 'Wheel spinning on the projector — set Projector view back to Auto when you are done';
});
// Single-key shortcuts, also usable from a Stream Deck or presenter remote that sends key presses.
const shortcuts = {n: 'next', c: 'close', r: 'reveal', 1: 'buzzCorrect', 2: 'buzzWrong', 3: 'buzzPass', a: 'startAgree', b: 'callNumber', w: 'spinWheel', t: 'timerPause', s: 'showScores'};
document.addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || $('panel').hidden || e.target.closest('input,textarea,select,dialog')) return;
  const key = e.key.toLowerCase(), shout = state?.question?.bingo?.pending && {1: 'shoutCorrect', 2: 'shoutWrong'}[key];
  const id = shout || (key === 'p' ? (state?.question?.paused ? 'resume' : 'pause') : shortcuts[key]);
  const button = id && $(id);
  if (!button || button.disabled || button.closest('[hidden]')) return;
  e.preventDefault(); if (tab !== 'live') chooseTab('live'); button.click();
});
// Revealing waits for the reveal sound (e.g. a drum roll, up to 10 s): the TV plays it, then the answer appears.
const soundLengths = new Map();
function soundLength(src) {
  if (!src) return Promise.resolve(0);
  if (!soundLengths.has(src)) soundLengths.set(src, new Promise(resolve => {
    const audio = new Audio(); audio.preload = 'metadata';
    audio.onloadedmetadata = () => resolve(Number.isFinite(audio.duration) ? audio.duration : 0); audio.onerror = () => resolve(0);
    setTimeout(() => resolve(0), 3000); audio.src = src;
  }));
  return soundLengths.get(src);
}
$('reveal').onclick = () => {const q = state.question, hide = q.revealed || q.revealing; action(async () => {
  const delay = hide ? 0 : Math.min(10000, Math.round(await soundLength(state.sounds.slots.reveal) * 1000));
  await request('reveal', {question: q.id, revealed: !hide, delay});
  return hide ? 'Answer hidden' : delay ? `Drum roll… the answer appears in ${Math.ceil(delay / 1000)}s` : 'Answer revealed';
});};
// Queued actions run later, after a refresh may have reset the form, so each handler reads its values straight away.
$('joinDetails').onsubmit = e => {e.preventDefault(); const body = {joinSsid: $('joinSsidInput').value, joinUrl: $('joinUrlInput').value}; action(() => request('settings', body), 'Join details saved — shown on the projector join screen');};
$('titleForm').onsubmit = e => {e.preventDefault(); const title = $('eventName').value; action(() => request('settings', {title}));};
$('registration').onclick = () => action(() => request('settings', {registrationOpen: !state.settings.registrationOpen}));
$('visibility').onclick = () => action(() => request('settings', {leaderboardVisible: !state.settings.leaderboardVisible}));
$('scramble').onclick = () => action(() => request('settings', {scrambleKeypads: !state.settings.scrambleKeypads}), 'Keypad scrambling updated — applies from the next question');
$('phrases').onclick = () => action(() => request('settings', {bingoPhrases: !state.settings.bingoPhrases}));
$('caller').onclick = () => action(() => request('settings', {bingoVoice: !state.settings.bingoVoice}));
$('board').onclick = () => action(() => request('settings', {bingoBoard: !state.settings.bingoBoard}));
$('online').onclick = () => action(() => request('settings', {onlineAfterJoin: !state.settings.onlineAfterJoin}));
$('waitingRoom').onclick = () => action(() => request('settings', {waitingRoom: !state.settings.waitingRoom}), 'Waiting room updated — applies to teams joining from now on');
$('admitAll').onclick = () => action(() => request('admit'), 'Everyone waiting has been let in');
$('showScores').onclick = () => action(() => request('settings', {showScores: !state.settings.showScores}), 'Leaderboard updated');
$('maxTeamsForm').onsubmit = e => {e.preventDefault(); const maxTeams = Number($('maxTeams').value); action(() => request('settings', {maxTeams}), 'Team limit saved');};
$('timerForm').onsubmit = e => {e.preventDefault(); const body = {action: 'start', seconds: Number($('timerMinutes').value) * 60 + Number($('timerSeconds').value), label: $('timerLabel').value}; action(() => request('timer', body), 'Countdown started on the TV');};
$('timerPause').onclick = () => action(() => request('timer', {action: state.timer?.endsAt === null ? 'resume' : 'pause'}), 'Countdown updated');
$('timerStop').onclick = () => action(() => request('timer', {action: 'stop'}), 'Countdown removed from the TV');
function renderTimer() {
  const timer = state?.timer; if (!timer) {$('timerNow').textContent = ''; $('timerPause').disabled = $('timerStop').disabled = true; return;}
  const left = timer.endsAt === null ? timer.remaining : Math.max(0, timer.endsAt - Date.now() - offset), secs = Math.ceil(left / 1000);
  $('timerNow').textContent = left <= 0 ? `⏰ ${timer.label || 'Countdown'}: time’s up` : `⏱ ${timer.label || 'Countdown'}: ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}${timer.endsAt === null ? ' (paused)' : ''}`;
  $('timerPause').textContent = timer.endsAt === null ? 'Resume' : 'Pause'; $('timerPause').disabled = busy || left <= 0; $('timerStop').disabled = busy;
}
$('photos').onclick = () => action(() => request('settings', {teamPhotos: !state.settings.teamPhotos}));
$('blockedForm').onsubmit = e => {e.preventDefault(); const blockedWords = $('blockedWords').value; action(() => request('settings', {blockedWords}), 'Blocked words saved');};
$('tvLanguage').onchange = () => {const language = $('tvLanguage').value; action(() => request('settings', {language}), 'TV language updated (phones use their own language)');};
$('displayMode').onchange = () => {const displayMode = $('displayMode').value; action(() => request('settings', {displayMode}));};
$('finish').onclick = () => action(async () => {
  if (!state.settings.ended && !confirm('Finish this quiz and close answers and registration? You can resume it later.')) return;
  // Finishing goes straight to the winner celebration on the projector.
  await request('settings', state.settings.ended ? {ended: false} : {ended: true, ...(state.settings.displayMode === 'auto' ? {} : {displayMode: 'winner'})});
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
// End quiz & start next: download the results, then clear the event (the server also keeps a copy).
$('newEvent').onclick = () => {$('newEventTitle').value = ''; $('newEventFile').value = ''; $('newEventDialog').showModal();};
$('newEventFile').onchange = () => {document.querySelector('[name=nextQuestions][value=load]').checked = true;};
$('newEventDialog').onclose = () => {
  if ($('newEventDialog').returnValue !== 'go') return;
  const questions = document.querySelector('[name=nextQuestions]:checked').value, file = $('newEventFile').files[0], title = $('newEventTitle').value.trim();
  action(async () => {
    const body = {questions, ...(title ? {title} : {})};
    if (questions === 'load') {
      if (!file) throw Error('Choose the quiz file to load, then try again');
      body.quiz = await readQuizFile(file);
    }
    const result = await request('new-event', body);
    download(`pubquiz-results-${result.saved.replace(/^results\//, '')}`, result.results);
    await loadLibrary(); reviewId = ''; return `New quiz ready. Last quiz's results downloaded and saved in ${result.saved}`;
  });
};
$('exportResults').onclick = () => action(async () => download('pubquiz-results.json', await request('export')), 'Results downloaded');
$('printSheets').onclick = () => {
  const paper = $('paper'), line = () => element('p', 'Answer: __________________________________________________');
  paper.replaceChildren(element('h1', library.title), element('p', 'Team name: __________________________________'));
  for (const r of library.rounds) {paper.append(element('h2', r.title)); for (const [i, q] of r.questions.entries()) {
    if (q.type === 'sheet') {paper.append(element('h3', q.text)); q.items.forEach((item, n) => paper.append(element('p', `${n + 1}. ${item}`), line()));}
    else if (['buzzer', 'bingo', 'musicbingo', 'pinpoint', 'clips', 'wordsnake', 'tiles'].includes(q.type)) continue;
    else {
      paper.append(element('p', `${i + 1}. ${q.text}`));
      if (['choice', 'vote', 'multi'].includes(q.type)) paper.append(element('p', q.options.map((o, n) => `${letters[n]}. ${o}`).join('    ')));
      if (q.type === 'sequence') paper.append(element('p', 'Put in order: ' + [...q.items].sort(() => Math.random() - 0.5).join(' · ')));
      paper.append(line());
    }
  }} window.print();
};
function teamControls(team) {
  const box = element('article', undefined, 'card'); box.append(element('h3', team.name), element('p', `${team.score} pts · ${!team.enabled ? 'Disabled' : team.waiting ? '🚪 In the waiting room' : team.connected ? 'Connected' : 'Disconnected'}`));
  const photoActions = team.photo ? (team.photo_status === 'pending' ? [['Approve photo', 'approvePhoto'], ['Reject photo', 'rejectPhoto']] : [['Remove photo', 'rejectPhoto']]) : [];
  if (team.photo) box.append(avatar(team.photo), element('p', team.photo_status === 'pending' ? 'Photo waiting for approval' : 'Photo approved', 'muted'));
  const {answered, scored, fastest} = team.stats;
  box.append(element('p', `${answered} answered · ${scored} scored${fastest !== null ? ` · fastest scoring answer ${(fastest / 1000).toFixed(1)}s` : ''}`, 'muted'));
  const note = element('textarea'); note.rows = 2; note.maxLength = 500; note.placeholder = 'Private notes (only on this desk)'; note.value = team.note || '';
  note.setAttribute('aria-label', `Notes for ${team.name}`);
  note.onchange = () => action(() => request('team', {id: team.id, action: 'note', note: note.value}), 'Note saved');
  box.append(note);
  const admit = team.enabled && team.waiting ? [['Let in', 'admit']] : [];
  for (const [label, actionName] of [...admit, ...photoActions, ['Rename', 'rename'], ['Move to a new phone', 'transfer'], ['Issue recovery code', 'recover'], [team.enabled ? team.waiting ? 'Turn away' : 'Disable' : 'Restore', team.enabled ? 'disable' : 'restore']]) {
    const button = element('button', label, 'subtle'); button.onclick = () => action(async () => {
      const body = {id: team.id, action: actionName};
      if (actionName === 'rename') {body.name = prompt('Team name', team.name); if (!body.name) return;}
      if (actionName === 'recover' && !confirm(`Revoke the old recovery code for ${team.name}?`)) return;
      const result = await request('team', body);
      if (result.secret || result.code) {
        $('recoveryTitle').textContent = result.code ? 'Move to a new phone' : 'New team recovery code';
        $('recoveryHelp').textContent = result.code ? 'On the new phone, open the quiz, choose “Already registered?” and enter this code. It works once, for five minutes. The old phone keeps working too.' : 'Give this privately to the team. Their answers and score stay intact.';
        $('recoveryName').textContent = team.name; $('recoveryCode').textContent = result.secret || result.code; $('recoveryDialog').showModal();
      }
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
// Teams whose phone left the quiz page (switched app or locked) while this question was open.
const awayText = list => list?.length ? '👀 Left the quiz page: ' + list.map(a => `${a.name} ${a.awayNow ? '(away now, ' : '('}${Math.round(a.ms / 1000)}s${a.count > 1 ? `, ${a.count} times` : ''})`).join(' · ') : '';
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
// Calls of "bingo!" wait here for the quizmaster's verdict (keys 1 and 2 answer the first). The desk shows whether
// the ticket checks out against the numbers called before the shout, but the quizmaster decides.
let shoutsSignature = '';
function renderShouts(g) {
  const waiting = g.shouts.filter(x => x.status === 'pending'), signature = JSON.stringify(waiting);
  if (signature === shoutsSignature) return; shoutsSignature = signature;
  $('bingoShouts').replaceChildren(...waiting.map((x, i) => {
    const li = element('li'), yes = element('button', 'Correct — bingo!'), no = element('button', 'Not a bingo', 'danger');
    yes.type = no.type = 'button'; if (i === 0) {yes.id = 'shoutCorrect'; no.id = 'shoutWrong';}
    yes.onclick = () => action(() => request('bingo-verdict', {shout: x.id, correct: true}), `${x.name}: correct — ${stageNames[x.stage]}`);
    no.onclick = () => action(() => request('bingo-verdict', {shout: x.id, correct: false}), `${x.name}: not a bingo`);
    li.append(element('strong', `🔔 ${x.name} called BINGO`), element('span', x.checks ? `✓ ticket checks out for ${stageNames[x.stage]}` : `✗ ticket does not check out for ${stageNames[x.stage]}`, x.checks ? 'good' : 'bad'), yes, no);
    return li;
  }));
}
function renderBingoPanel(q) {
  const g = q?.bingo; $('bingoPanel').hidden = !g || !q.live;
  if (!g) return;
  renderShouts(g);
  $('callNumber').textContent = g.music ? 'Play next song' : 'Call next number';
  if (!q.live) {$('songAudio').pause(); stopSongTimer();}
  if (g.music) {
    $('bingoInfo').textContent = g.winners.length ? bingoWins(g) : g.current ? `Song ${g.played}: ${g.current.title}` : 'No songs played yet';
    $('bingoCalls').textContent = `${g.played} of ${q.songs.length} songs played${q.songSeconds ? ` · each plays ${q.songSeconds}s${q.startAt ? ` from ${q.startAt}s` : ''}${q.autoNext ? ', then the next starts by itself' : ''}` : q.startAt ? ` · songs start ${q.startAt}s in` : ''}`;
    $('callNumber').disabled = busy || g.over || !!q.paused || g.pending > 0 || g.played >= q.songs.length;
    return;
  }
  $('bingoInfo').textContent = g.winners.length ? bingoWins(g) : g.last ? `Last call: ${g.last}${state.settings.bingoPhrases ? ` — ${(g.phrase ?? bingoCall(g.last))}` : ''} · ${g.called.length} called` : 'No numbers called yet';
  $('bingoCalls').textContent = g.called.join(' · ');
  $('callNumber').disabled = busy || g.over || !!q.paused || g.pending > 0 || g.called.length >= 90;
}
function shownValue(q, value) {
  if (q.type === 'wordsnake') {try {const {path, wide} = JSON.parse(value); return path.map(i => q.grid.letters[i]).join('') + (wide ? ' (went wide)' : '');} catch {return value;}}
  if (q.type === 'tiles') {try {return JSON.parse(value).map(i => q.pieces[i]).join('');} catch {return value;}}
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
  renderBuzzPanel(q); renderBingoPanel(q); showDeskPlayer(); renderSounds(s); useSounds(s.sounds); renderLooks(s);
  if (clipRun && (q?.id !== clipRun.question || !q.live)) stopClips(); else renderClipsPanel(q);
  $('liveCount').textContent = q ? `${s.answers.length} answers received · ${s.teams.filter(t => t.enabled && !t.waiting).length} active teams` : 'Add rounds in Build quiz, then start your first question.';
  renderMedia($('liveMedia'), q); renderSolution($('liveSolution'), q);
  $('next').disabled = !!q?.live || s.settings.ended; $('close').textContent = ['buzzer', 'bingo', 'musicbingo', 'clips'].includes(q?.type) ? 'End game' : 'Close answers'; $('close').disabled = !pending; $('pause').disabled = !q?.open; $('resume').disabled = !q?.paused; $('reveal').disabled = !q || !!pending;
  $('reveal').textContent = q?.revealing ? 'Revealing…' : q?.revealed ? 'Hide answer reveal' : 'Reveal answer';
  $('registration').textContent = s.settings.registrationOpen ? 'Close registration' : 'Open registration'; $('registration').disabled = s.settings.ended;
  $('visibility').textContent = s.settings.leaderboardVisible ? 'Hide leaderboard' : 'Show leaderboard';
  $('photos').textContent = `Team photos: ${s.settings.teamPhotos ? 'on' : 'off'}`;
  $('online').textContent = `Keep phones on quiz Wi-Fi: ${s.settings.onlineAfterJoin ? 'on' : 'off'}`;
  $('online').title = 'After a team joins, tell its phone the Wi-Fi is online so it stays on the quiz Wi-Fi instead of mobile data.';
  $('liveAway').textContent = awayText(s.away);
  const waiting = s.teams.filter(t => t.enabled && t.waiting);
  $('waitingRoom').textContent = `Waiting room: ${s.settings.waitingRoom ? 'on' : 'off'}`;
  $('waitingRoom').title = 'New teams wait on their phone until you let them in (here or in Teams & results).';
  $('admitAll').hidden = !waiting.length; $('admitAll').textContent = `Let everyone in (${waiting.length})`;
  $('showScores').textContent = `Board shows: ${s.settings.showScores ? 'scores' : 'positions only'}`;
  if (!$('maxTeamsForm').contains(document.activeElement)) $('maxTeams').value = s.settings.maxTeams;
  renderTimer();
  $('scramble').textContent = `Scramble keypads: ${s.settings.scrambleKeypads ? 'on' : 'off'}`; $('phrases').textContent = `Bingo phrases: ${s.settings.bingoPhrases ? 'on' : 'off'}`; $('caller').textContent = `Bingo caller voice: ${s.settings.bingoVoice ? 'on' : 'off'}`; $('board').textContent = `TV shows called numbers: ${s.settings.bingoBoard ? 'on' : 'off'}`;
  if (!$('blockedForm').contains(document.activeElement)) $('blockedWords').value = s.blockedWords.join('\n'); $('displayMode').value = s.settings.displayMode; $('autoView').textContent = s.settings.displayMode === 'auto' ? `(now: ${{join: 'join screen', leaderboard: 'leaderboard', question: 'question', winner: 'winner'}[s.view] || s.view})` : ''; $('tvLanguage').value = s.settings.language; $('finish').textContent = s.settings.ended ? 'Resume quiz' : 'Finish quiz';
  const offline = s.teams.filter(t => t.enabled && !t.waiting && !t.connected), photos = s.teams.filter(t => t.photo_status === 'pending').length;
  $('alerts').textContent = [waiting.length ? `🚪 Waiting room: ${waiting.map(t => t.name).join(', ')}` : '', offline.length ? `⚠ Disconnected: ${offline.map(t => t.name).join(', ')}` : '', photos ? `📷 ${photos} team ${photos === 1 ? 'photo' : 'photos'} waiting for approval in Teams & results` : ''].filter(Boolean).join(' · ');
  const played = new Set(s.history.map(q => q.sourceId)); const all = library?.rounds.flatMap(r => r.questions) || [];
  $('progress').textContent = `${all.filter(q => played.has(q.id)).length} of ${all.length} saved questions played`;
  if (library && library.revision !== s.libraryRevision) $('libraryStatus').textContent = 'Saved quiz changed in another window. Reload before editing.';
  selectOptions($('reviewSelect'), s.history.map(q => [String(q.id), `${q.id}. ${q.round ? q.round + ' · ' : ''}${q.text}`]), reviewId || String(q?.id || ''));
  const teamSignature = JSON.stringify(s.teams.map(({seen, ...t}) => t));
  if (teamSignature !== teamsSignature && !$('teamCards').contains(document.activeElement)) {teamsSignature = teamSignature; $('teamCards').replaceChildren(...s.teams.map(teamControls));}
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
  renderMedia($('reviewMedia'), q); $('reviewAway').textContent = awayText(r.away);
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
    const s = await request('state'); if (busy) return; if (!library) {await loadLibrary(); loadSpotify();}
    $('login').hidden = true; $('panel').hidden = false; $('connection').textContent = '● Server connected'; renderState(s);
    if (tab === 'mark') await loadReview();
  } catch (e) {
    if (e.status === 403) {key = ''; writeStorage('pubquiz-host', '', true); $('panel').hidden = true; $('login').hidden = false; message('Log in to unlock the desk again.', true);}
    $('connection').textContent = '● Server unavailable — reconnecting';
    for (const id of ['next', 'close', 'pause', 'resume', 'reveal']) $(id).disabled = true;
  }
}
window.addEventListener('beforeunload', e => {if (dirty) {e.preventDefault(); e.returnValue = '';}});
setInterval(() => {if (state) {$('liveTimer').textContent = timeText(state.question, offset); renderTimer();}}, 200);
const updates = live(refresh, () => key);
