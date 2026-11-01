#!/usr/bin/env node
// The website's phone videos (site/public/clips/phone-*), recorded from the native Android app on an emulator with
// Android's screenrecord: a team answering a question and seeing the answer, and the quizmaster running the night from
// the app (Run the night). A quiz server on this computer runs the rehearsal quiz (load-test-quiz.mjs) on Pro, with
// made-up teams answering over the quiz API. Run it again whenever the app changes:
//
//     node scripts/site-videos-android.mjs
//
// Needs a running emulator or phone with the app installed (cd native/android && ./gradlew installDebug) and ffmpeg
// with libsvtav1 and libx264. The app's data is cleared first; the status bar is put in demo mode while it runs.
import {mkdtempSync, rmSync, mkdirSync} from 'node:fs';
import {execFile, execFileSync, spawn} from 'node:child_process';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createQuiz} from '../server/server.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..'), out = path.join(root, 'site', 'public', 'clips');
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
async function find(match, seconds = 15) {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    const node = screen().find(n => typeof match === 'function' ? match(n) : n.text === match);
    if (node) return node;
    await sleep(400);
  }
  throw Error(`Nothing on the phone's screen matches ${match}`);
}
const press = node => adb('shell', 'input', 'tap', String(node.x), String(node.y));
const tap = async (match, seconds) => press(await find(match, seconds));
const type = text => adb('shell', 'input', 'text', text.replace(/ /g, '%s'));

// Android's own screen recording, while `scene` runs; then the clip at the site's phone shape, without the gesture bar.
async function record(name, scene, posterAt) {
  const file = `/sdcard/beermat-${name}.mp4`;
  const recorder = spawn(adbPath, ['shell', 'screenrecord', '--bit-rate', '16000000', '--time-limit', '60', file]);
  await sleep(1200);
  const started = Date.now();
  await scene();
  const seconds = (Date.now() - started) / 1000;
  adb('shell', 'pkill', '-INT', 'screenrecord');
  await new Promise(r => recorder.on('exit', r));
  await sleep(1500);
  const raw = path.join(dir, `${name}.mp4`);
  execFileSync(adbPath, ['pull', file, raw]);
  // From when the scene started; cropped to the phone screenshots' shape (780×1688) and scaled to 720 wide.
  const input = ['-v', 'error', '-y', '-ss', '1.0', '-i', raw, '-t', String(seconds.toFixed(2)), '-an', '-vf', 'crop=iw:iw*1688/780:0:0,scale=720:1558:flags=lanczos,fps=30'];
  execFileSync('ffmpeg', [...input, '-c:v', 'libsvtav1', '-pix_fmt', 'yuv420p10le', '-crf', '32', '-preset', '6', '-svtav1-params', 'tune=0:film-grain=4', path.join(out, `${name}.webm`)]);
  execFileSync('ffmpeg', [...input, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '22', '-preset', 'slow', '-tune', 'grain', '-movflags', '+faststart', path.join(out, `${name}.mp4`)]);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(posterAt), '-i', path.join(out, `${name}.mp4`), '-frames:v', '1', '-c:v', 'libwebp', '-lossless', '1', '-compression_level', '6', path.join(out, `${name}.webp`)]);
  console.log(`${name}: ${seconds.toFixed(1)}s`);
}

const dir = mkdtempSync(path.join(os.tmpdir(), 'beermat-android-videos-'));
mkdirSync(out, {recursive: true});
const hostKey = 'video-quiz-key-0123456';
const quiz = createQuiz({hostKey, database: path.join(dir, 'quiz.sqlite'), mediaDir: path.join(dir, 'media'), plan: 'pro'});
await new Promise(r => quiz.server.listen(0, '127.0.0.1', r));
const port = quiz.server.address().port, base = `http://127.0.0.1:${port}`;
await new Promise((resolve, reject) => execFile('node', [path.join(root, 'scripts', 'load-test-quiz.mjs'), base], {env: {...process.env, HOST_KEY: hostKey}}, e => e ? reject(e) : resolve()));
const post = async (route, body, key = '') => {
  const res = await fetch(`${base}/api/${route}`, {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + key}, body: JSON.stringify(body)});
  const json = await res.json(); if (!res.ok) throw Error(`${route}: ${json.error}`); return json;
};
const {key} = await post('login', {key: hostKey});
const host = (route, body = {}) => post('host/' + route, body, key);
await host('settings', {title: 'Tuesday Quiz Night', waitingRoom: false, teamPhotos: false});
const teams = [];
for (const name of ['Quiz Team Aguilera', 'Les Quizerables', 'Agatha Quiztie', 'Universally Challenged', 'Tequila Mockingbird']) teams.push(await post('join', {name}));
const current = async () => (await host('state')).question;
const answerAll = async (picks, gap = 700) => {
  const q = await current();
  for (const [i, value] of picks.entries()) {await sleep(gap); await post('answer', {question: q.id, value}, teams[i].secret).catch(() => {});}
};
// The desk is open on the laptop (its stream marked as the desk's), as on a real night: the phone deck doesn't warn.
const deskStream = http.get(`${base}/api/events?key=${key}&desk=1`);

const demo = (command, extras = []) => adb('shell', 'am', 'broadcast', '-a', 'com.android.systemui.demo', '-e', 'command', command, ...extras);
try {
  adb('shell', 'settings', 'put', 'global', 'sysui_demo_allowed', '1');
  demo('enter'); demo('clock', ['-e', 'hhmm', '2041']); demo('battery', ['-e', 'level', '100', '-e', 'plugged', 'false']);
  demo('network', ['-e', 'wifi', 'show', '-e', 'level', '4']); demo('network', ['-e', 'mobile', 'show', '-e', 'level', '4', '-e', 'datatype', 'none']); demo('notifications', ['-e', 'visible', 'false']);

  // 1. A team on a phone: the question arrives, they tap an answer, the answer is revealed.
  adb('shell', 'pm', 'clear', app);
  adb('shell', 'monkey', '-p', app, '-c', 'android.intent.category.LAUNCHER', '1');
  await tap(n => n.kind === 'android.widget.EditText');
  type(`${hostName}:${port}`);
  await tap('Connect');
  await tap('Team name');
  type('The Quizzly Bears');
  await sleep(500);
  await tap('Join the quiz');
  await find(n => /quiz|ready|waiting/i.test(n.text), 20);
  await sleep(2500);
  await record('phone-play', async () => {
    await sleep(800);
    await host('start', {id: 'test-q1', expectedQuestion: null});
    const mars = await find(n => n.text.endsWith('Mars'));
    await sleep(1800);
    press(mars);
    await sleep(600);
    await tap('Lock in answer');
    await answerAll(['Mars', 'Venus', 'Mars', 'Mars', 'Jupiter'], 500);
    await sleep(1200);
    const q = await current();
    await host('close', {expectedQuestion: q.id});
    await sleep(1000);
    await host('reveal', {question: q.id, revealed: true, delay: 1500});
    await sleep(4500);
  }, 10.5);

  // 2. Run the night: the quizmaster's own phone, signed in with the desk's code.
  // Past two more questions, so the phone opens a numbers question.
  for (let i = 0; i < 2; i++) {
    await host('next', {expectedQuestion: (await current()).id});
    await host('close', {expectedQuestion: (await current()).id});
    await host('reveal', {question: (await current()).id, revealed: true, delay: 0});
  }
  adb('shell', 'pm', 'clear', app);
  adb('shell', 'monkey', '-p', app, '-c', 'android.intent.category.LAUNCHER', '1');
  await tap('Profile');
  await tap('Quizmaster? Run the night from this phone');
  await tap(n => n.kind === 'android.widget.EditText');
  type(`${hostName}:${port}`);
  await tap('Connect');
  await find('Host this quiz', 20);
  await tap(n => n.kind === 'android.widget.EditText');
  type((await host('deck-code')).code);
  await sleep(500);
  await tap('Host this quiz');
  await find('Start next question', 20);
  await sleep(2000);
  await record('phone-deck', async () => {
    await sleep(800);
    await tap('Start next question');
    await find('Close answers');
    await answerAll(['6', '6', '8', '6', '5'], 400);
    await sleep(800);
    await tap('Close answers');
    await sleep(800);
    await tap('Reveal answer');
    // The drum roll on the TV, then the answer on the phone too.
    for (let i = 0; i < 80 && !(await current()).revealed; i++) await sleep(250);
    await sleep(2500);
  }, 9);
  console.log(`Clips saved in ${path.relative(root, out)}`);
} finally {
  try {demo('exit');} catch {}
  deskStream.destroy();
  await quiz.close(); rmSync(dir, {recursive: true, force: true});
}
