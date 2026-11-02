// Run the night in a phone's browser (/deck): the quizmaster's phone hosting the quiz on this laptop, as the BeerMat
// app's Run the night does (native/android deck/), with no app to install. It signs in with the code the desk shows
// (no internet needed) and works on the quiz Wi-Fi or the venue's, where the laptop also is. Clips, songs and audio
// play from the laptop: the phone asks the desk (deck-command).
import './compat.js';
import {$, element, readStorage, writeStorage} from './app.js';
import {t, setLanguage, translatePage} from './i18n.js';

let key = readStorage('beermat-deck'), state = null, busy = false, messageTimer, revealLength = new Map(), stream = null, deadlineTimer = null;
const STEPS = {reveal: 'Reveal next position', revealFirst: 'Reveal the leader', revealSecond: 'Reveal second place', show: 'Show leaderboard', recap: 'Reveal the secret round',
  recapAnswer: 'Reveal the next secret answer', recapResults: 'Show the round’s results', finish: 'Finish quiz & reveal leaderboard', round: 'Start next round', question: 'Start next question'};

function say(text, error = false) {
  $('message').textContent = text; $('message').classList.toggle('error', error);
  clearTimeout(messageTimer); messageTimer = setTimeout(() => {$('message').textContent = '';}, error ? 7000 : 4000);
}
async function call(route, body = {}) {
  const response = await fetch('/api/' + route, {method: 'POST', headers: {'Content-Type': 'application/json', ...(key && {Authorization: 'Bearer ' + key})}, body: JSON.stringify(body), signal: AbortSignal.timeout(10000)});
  const data = await response.json().catch(() => ({}));
  if ((response.status === 401 || response.status === 403) && route.startsWith('host/')) {signedOut(t('The desk has taken this phone off. Sign in again to host.')); throw Error('');}
  if (!response.ok) throw Error(t(data.error || 'Something went wrong'));
  return data;
}
// One thing at a time, as on the desk: a double tap can't skip a question.
async function act(fn, done) {
  if (busy) return; busy = true; render();
  try {await fn(); if (done) say(done); await refresh();} catch (e) {if (e.message) say(e.message, true);} finally {busy = false; render();}
}
const host = (route, body) => call('host/' + route, body);

// ---- signing in ----
async function start() {
  try {
    const hello = await (await fetch('/api/deck/hello')).json();
    $('title').textContent = hello.title || 'BeerMat';
    $('found').textContent = t('Found {title}.', {title: hello.title || 'BeerMat'});
  } catch {}
  if (key && await refresh(true)) return run();
  $('signIn').hidden = false; $('deck').hidden = true;
}
$('codeForm').onsubmit = async e => {
  e.preventDefault();
  try {
    // The desk lists it by the kind of phone (it has no account name to go by).
    key = (await call('deck/login', {code: $('code').value, name: /iPhone|iPad/.test(navigator.userAgent) ? 'iPhone (browser)' : /Android/.test(navigator.userAgent) ? 'Android (browser)' : 'Phone (browser)'})).key;
    writeStorage('beermat-deck', key);
    $('code').value = '';
    if (await refresh(true)) run();
  } catch (e) {if (e.message) say(e.message, true);}
};
function run() {
  $('signIn').hidden = true; $('deck').hidden = false;
  stream?.close();
  // The server nudges on every change; each nudge means "fetch the state again".
  stream = new EventSource(`/api/events?key=${encodeURIComponent(key)}`);
  stream.onmessage = () => refresh();
  render();
}
function signedOut(why) {
  stream?.close(); stream = null; key = ''; writeStorage('beermat-deck', '');
  $('deck').hidden = true; $('signIn').hidden = false; state = null;
  say(why, true);
}
$('leave').onclick = () => act(async () => {await host('logout').catch(() => {}); signedOut(t('This phone no longer hosts the quiz'));});

async function refresh(first = false) {
  try {
    state = await host('state');
    if (state.settings?.language) {setLanguage(state.settings.language); translatePage();}
    $('title').textContent = state.settings?.title || 'BeerMat';
    render();
    // The answer appears when the TV's drum roll ends, which nothing announces: look again until it has.
    clearTimeout(deadlineTimer);
    if (state.question?.revealing) deadlineTimer = setTimeout(refresh, 1000);
    return true;
  } catch (e) {if (first) return false; return false;}
}

// ---- what can be done now (as the Qt desk: desk.py canSend, canClose…) ----
const q = () => state?.question || null;
// The answer to read: an answer sheet's lines (a music round's artist and title) when it has no single answer.
const answerText = question => question.answer || (question.items || []).map((item, i) => question.itemAnswers?.[i] ? `${item}: ${question.itemAnswers[i]}` : '').filter(Boolean).join(' · ');
const can = {
  next: () => !!state?.nextStep && !q()?.live,
  send: () => !!q()?.held && !!q()?.live,
  close: () => !!q() && (q().open || q().live) && !q().revealed,
  reveal: () => !!q() && !q().open && !q().live && !q().revealed && !q().revealing,
  pause: () => !!q()?.open && !q().paused,
  resume: () => !!q()?.paused && !q().held,
};

function render() {
  if (!state) return;
  const question = q();
  $('questionCard').hidden = !question;
  if (question) {
    $('round').textContent = question.round || '';
    $('question').textContent = question.text || '';
    $('readItOut').hidden = !(question.hideText && !question.revealed);
    const left = question.paused ? question.remaining : Math.max(0, question.deadline - Date.now());
    $('state').textContent = question.held ? t('Waiting to be sent to the phones') : question.paused ? t('Paused') : question.open ? t('Open: {s}s left', {s: Math.ceil(left / 1000)})
      : question.revealing ? t('Drum roll…') : question.revealed ? t('Answer: {answer}', {answer: answerText(question)}) : t('Closed');
    $('state').classList.toggle('open', !!question.open);
    const teams = state.teams.filter(team => team.enabled !== false && !team.waiting);
    $('answered').textContent = t('{n} of {total} teams answered', {n: state.answers.length, total: teams.length});
    $('answer').textContent = !question.revealed && answerText(question) ? t('Answer: {answer}', {answer: answerText(question)}) : '';
    const button = (label, onclick, cls = 'subtle') => {const b = element('button', label, cls); b.type = 'button'; b.disabled = busy; b.onclick = onclick; return b;};
    $('controls').replaceChildren(...[
      can.send() && button(t('Send question'), () => act(() => host('send'), t('Question sent to the phones')), ''),
      can.pause() && button(t('Pause timer'), () => act(() => host('pause', {expectedQuestion: question.id}), t('Timer paused'))),
      can.resume() && button(t('Resume timer'), () => act(() => host('resume', {expectedQuestion: question.id}), t('Timer resumed'))),
      can.close() && button(t('Close answers'), () => act(() => host('close', {expectedQuestion: question.id}), t('Answers closed')), ''),
      can.reveal() && button(t('Reveal answer'), reveal, ''),
    ].filter(Boolean));
    // The round's own controls; what plays, plays from the laptop.
    const desk = action => () => act(() => host('deck-command', typeof action === 'string' ? {action} : action), t('Asked the desk'));
    const clips = question.type === 'clips' && question.live ? (question.clips || []) : [];
    $('roundControls').replaceChildren(...[
      ...(clips.length ? [button(t('Play all clips'), desk('playClips')), ...clips.map((_, i) => button(t('Clip {n}', {n: i + 1}), desk({action: 'playClip', value: i}))), button(t('Stop'), desk('stopClips'))] : []),
      ...(question.type === 'bingo' || question.type === 'musicbingo' ? [button(question.type === 'bingo' ? t('Call next number') : t('Next song'), desk('callNumber'))] : []),
      ...(question.type === 'musicbingo' && question.bingo?.current ? [button(t('Play this song again'), desk('replaySong'))] : []),
      ...(question.type === 'buzzer' && question.buzz?.active ? [element('p', t('{team} buzzed', {team: question.buzz.active.name}), 'status-line'),
        ...[['correct', 'Correct', 'Marked correct'], ['wrong', 'Wrong', 'Marked wrong'], ['pass', 'Pass', 'Passed to the next buzzer']].map(([action, label, done]) =>
          button(t(label), () => act(() => host('buzz', {question: question.id, action, announced: ''}), t(done))))] : []),
      ...(/\.(mp3|ogg|wav)$/i.test(question.media || '') || question.clip?.spotify ? [button(t('Play the sound again'), desk('playAudio')), button(t('Pause or carry on'), desk('pauseAudio'))] : []),
    ]);
    $('roundControls').querySelectorAll('button').forEach(b => {b.disabled = busy || !state.deskConnected;});
  }
  $('next').textContent = t(STEPS[state.nextStep] || 'Quiz finished');
  $('next').disabled = busy || !can.next();
  $('back').hidden = !state.back; $('back').textContent = state.back ? t('Back: {step}', {step: state.back.label.charAt(0).toLowerCase() + state.back.label.slice(1)}) : '';
  $('back').disabled = busy;
  $('deskClosed').hidden = !!state.deskConnected;
  const board = [...state.teams].filter(team => team.enabled !== false && !team.waiting).sort((a, b) => (a.rank || 999) - (b.rank || 999) || a.name.localeCompare(b.name));
  $('board').replaceChildren(...(board.length ? board.map(team => {
    const li = element('li'); li.append(element('span', `${team.rank || '–'}  ${team.name}`), element('strong', String(team.score ?? ''))); li.classList.toggle('away', !team.connected); return li;
  }) : [element('li', t('No teams yet'), 'hint')]));
}
// The countdown ticks between the server's updates.
setInterval(() => {if (q()?.open && !q().paused) render();}, 1000);

// ---- Next, Back, Reveal (as desk.py) ----
$('next').onclick = () => {
  const step = state?.nextStep;
  if (!step || !can.next()) return;
  if (step === 'finish') {
    if (!confirm(t('Finish this quiz and close answers and registration? You can resume it later.'))) return;
    return act(async () => {await host('settings', {ended: true, leaderboardVisible: true}); if (q()) await host('board', {action: 'show'});}, t('Quiz finished: the final standings are on the TV'));
  }
  if (step === 'show') return act(() => host('board', {action: 'show'}), t('Leaderboard on the TV'));
  if (step === 'recap') return act(() => host('recap', {action: 'start'}), t('The secret round’s first answer is on the TV'));
  if (step === 'recapAnswer' || step === 'recapResults') return act(() => host('recap', {action: 'next'}), step === 'recapResults' ? t('The round’s results are on the TV') : t('Next secret answer revealed'));
  if (step.startsWith('reveal')) return act(() => host('board', {action: 'next'}), step === 'revealFirst' ? t('The leader revealed') : step === 'revealSecond' ? t('Second place revealed: the full board') : t('Next position revealed'));
  return act(() => host('next', {expectedQuestion: q()?.id ?? null}), t('Next question opened'));
};
$('back').onclick = () => {
  const step = state?.back; if (!step) return;
  if (step.answers && !confirm(t('{n} team(s) have answered; those answers are thrown away.', {n: step.answers}))) return;
  act(() => host('back', {kind: step.kind, ...(step.answers ? {discard: true} : {})}), t('Back: {step}', {step: step.label.charAt(0).toLowerCase() + step.label.slice(1)}));
};
// The TV plays the drum roll and the answer appears as it ends (up to 10 s), as on the desk.
async function soundLength(src) {
  if (!src) return 0;
  if (!revealLength.has(src)) revealLength.set(src, await new Promise(resolve => {
    const audio = new Audio(); audio.preload = 'metadata';
    audio.onloadedmetadata = () => resolve(Number.isFinite(audio.duration) ? audio.duration : 0); audio.onerror = () => resolve(0);
    setTimeout(() => resolve(0), 3000); audio.src = src;
  }));
  return revealLength.get(src);
}
function reveal() {
  const question = q(); if (!question || !can.reveal()) return;
  act(async () => {
    const fast = state.rehearsal?.options?.speed === 'fast';
    const delay = fast ? 0 : Math.min(10000, Math.round(await soundLength(state.sounds?.slots?.reveal) * 1000));
    await host('reveal', {question: question.id, revealed: true, delay});
    say(delay ? t('Drum roll… the answer appears in {n}s', {n: Math.ceil(delay / 1000)}) : t('Answer revealed on the TV'));
  });
}

translatePage();
start();
