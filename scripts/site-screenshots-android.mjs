#!/usr/bin/env node
// The website's phone screenshots (site/public/shots/phone-*.webp), taken from the native Android app on an emulator:
// a quiz server on this computer with the rehearsal quiz (load-test-quiz.mjs), made-up teams joining over the quiz
// API, and the app joining as one more team by typing the server's address, as a player would. Run it again whenever
// the app changes:
//
//     node scripts/site-screenshots-android.mjs
//
// Needs a running emulator or phone with the app installed (cd native/android && ./gradlew installDebug; ANDROID_HOME
// or ~/Android/Sdk for adb) and ffmpeg. The emulator reaches this computer at 10.0.2.2 (APP_SERVER_HOST for a real
// phone on the same network). The app's data is cleared first; the status bar is put in demo mode while it runs.
import {mkdtempSync, rmSync, mkdirSync, writeFileSync} from 'node:fs';
import {execFile, execFileSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createQuiz} from '../server/server.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..'), out = path.join(root, 'site', 'public', 'shots');
const adbPath = path.join(process.env.ANDROID_HOME || path.join(os.homedir(), 'Android', 'Sdk'), 'platform-tools', 'adb');
const app = process.env.APP_ID || 'uk.beermat.app.next', hostName = process.env.APP_SERVER_HOST || '10.0.2.2';
const adb = (...args) => execFileSync(adbPath, args, {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024});
const sleep = ms => new Promise(r => setTimeout(r, ms));

// What's on the phone's screen: each node's text and centre, from Android's accessibility dump.
function screen() {
  adb('shell', 'uiautomator', 'dump', '/sdcard/beermat-ui.xml');
  const xml = adb('shell', 'cat', '/sdcard/beermat-ui.xml');
  return [...xml.matchAll(/<node [^>]*?text="([^"]*)"[^>]*?class="([^"]*)"[^>]*?bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/g)]
    .map(([, text, kind, x1, y1, x2, y2]) => ({text: text.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'"), kind, x: (+x1 + +x2) >> 1, y: (+y1 + +y2) >> 1}));
}
async function tap(match, seconds = 15) {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    const node = screen().find(n => typeof match === 'function' ? match(n) : n.text === match);
    if (node) {adb('shell', 'input', 'tap', String(node.x), String(node.y)); return node;}
    await sleep(500);
  }
  throw Error(`Nothing on the phone's screen matches ${match}`);
}
const type = text => adb('shell', 'input', 'text', text.replace(/ /g, '%s'));

const dir = mkdtempSync(path.join(os.tmpdir(), 'beermat-android-shots-')), raw = path.join(dir, 'raw');
mkdirSync(raw); mkdirSync(out, {recursive: true});
const quiz = createQuiz({hostKey: 'screenshot-quiz-key-0123', database: path.join(dir, 'quiz.sqlite'), mediaDir: path.join(dir, 'media'), plan: 'pro'});
await new Promise(r => quiz.server.listen(0, '127.0.0.1', r));
const port = quiz.server.address().port, base = `http://127.0.0.1:${port}`;
await new Promise((resolve, reject) => execFile('node', [path.join(root, 'scripts', 'load-test-quiz.mjs'), base], {env: {...process.env, HOST_KEY: 'screenshot-quiz-key-0123'}}, e => e ? reject(e) : resolve()));
const post = async (route, body, key = '') => {
  const res = await fetch(`${base}/api/${route}`, {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + key}, body: JSON.stringify(body)});
  const json = await res.json(); if (!res.ok) throw Error(`${route}: ${json.error}`); return json;
};
const {key} = await post('login', {key: 'screenshot-quiz-key-0123'});
const host = (route, body = {}) => post('host/' + route, body, key);
await host('settings', {title: 'Tuesday Quiz Night', waitingRoom: false, teamPhotos: false});
const teams = [];
for (const name of ['Quiz Team Aguilera', 'Les Quizerables', 'Agatha Quiztie', 'Universally Challenged', 'Tequila Mockingbird']) teams.push(await post('join', {name}));

// The phone's capture, without the gesture bar, at the site's phone size (780×1688, as the browser shots were).
function shot(name) {
  const png = path.join(raw, `${name}.png`);
  writeFileSync(png, execFileSync(adbPath, ['exec-out', 'screencap', '-p'], {maxBuffer: 64 * 1024 * 1024}));
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', png, '-vf', 'crop=iw:iw*1688/780:0:0,scale=780:1688:flags=lanczos', '-c:v', 'libwebp', '-lossless', '1', '-compression_level', '6', path.join(out, `${name}.webp`)]);
  console.log('Saved', name);
}

const demo = (command, extras = []) => adb('shell', 'am', 'broadcast', '-a', 'com.android.systemui.demo', '-e', 'command', command, ...extras);
try {
  // A tidy status bar: 9:41, full battery and signal, no notifications.
  adb('shell', 'settings', 'put', 'global', 'sysui_demo_allowed', '1');
  demo('enter'); demo('clock', ['-e', 'hhmm', '0941']); demo('battery', ['-e', 'level', '100', '-e', 'plugged', 'false']);
  demo('network', ['-e', 'wifi', 'show', '-e', 'level', '4']); demo('network', ['-e', 'mobile', 'show', '-e', 'level', '4', '-e', 'datatype', 'none']); demo('notifications', ['-e', 'visible', 'false']);

  // A fresh app joins as a team, typing the TV's address.
  adb('shell', 'pm', 'clear', app);
  adb('shell', 'monkey', '-p', app, '-c', 'android.intent.category.LAUNCHER', '1');
  await tap(n => n.kind === 'android.widget.EditText');
  type(`${hostName}:${port}`);
  await tap('Connect');
  await tap('Pick a team name');   // the join screen is up
  await tap('Team name');
  type('The Quizzly Bears');
  await sleep(500);
  await tap('Join the quiz');
  for (let i = 0; !(await host('state')).teams.some(t => t.name === 'The Quizzly Bears'); i++) {
    if (i > 30) throw Error('The app didn’t join the quiz');
    await sleep(500);
  }
  await sleep(2500);

  let current = null;
  const open = async id => {
    if (current) await host('close', {expectedQuestion: current}).catch(() => {});
    await host('start', {id, expectedQuestion: current}); current = (await host('state')).question.id; await sleep(3000);
  };
  // A question with four answers, then the round formats.
  await open('test-q1'); shot('phone-choice');
  for (const [id, name] of [['test-q12', 'phone-wordsnake'], ['test-q11', 'phone-pinpoint'], ['test-q13', 'phone-tiles'], ['test-q5', 'phone-sequence'], ['test-q16', 'phone-buzzer'], ['test-q19', 'phone-bingo']]) {
    await open(id); shot(name);
  }
  // Ways to play: a picture under tiles part-way through, and music bingo's reaction table.
  const saved = (await host('library')).rounds.flatMap(r => r.questions), picture = saved.find(q => q.type === 'picture');
  await host('close', {expectedQuestion: current}).catch(() => {});
  await host('open', {text: 'What shape is under the tiles?', type: 'picture', media: picture.media, answer: picture.answer, round: 'Pictures', seconds: 30, points: 1, reveal: 'tiles'});
  current = (await host('state')).question.id; await sleep(13000); shot('phone-reveal');
  await host('close', {expectedQuestion: current});
  await host('open', {text: 'Music bingo: dab each song as soon as you know it', type: 'musicbingo', mode: 'line', round: 'Music bingo', seconds: 1800, points: 3,
    songs: saved.find(q => q.type === 'musicbingo').songs, reactions: true, reactionPoints: 1});
  current = (await host('state')).question.id;
  // Songs until one is on several teams' tickets, the app's team's among them, so the table has a few teams on it.
  let title = '';
  for (let i = 0; i < 25; i++) {
    await host('bingo', {question: current}); title = (await host('state')).question.bingo.current.title;
    await sleep(1200);
    const others = (await Promise.all(teams.map(t => post('state', {}, t.secret)))).filter(s => s.question.bingo.card.flat().includes(title)).length;
    if (others >= 2 && screen().some(n => n.text === title)) break;
  }
  // The other teams that have the song dab it, a moment apart; then the app's team, if its ticket has it.
  for (const team of teams) {
    const card = (await post('state', {}, team.secret)).question.bingo.card.flat();
    if (card.includes(title)) {await sleep(700); await post('react', {question: current, title}, team.secret);}
  }
  await sleep(2500);
  if (screen().some(n => n.text === title)) await tap(title);
  await sleep(2500); shot('phone-reactions');
  console.log(`Screenshots saved in ${path.relative(root, out)}`);
} finally {
  try {demo('exit');} catch {}
  await quiz.close(); rmSync(dir, {recursive: true, force: true});
}
