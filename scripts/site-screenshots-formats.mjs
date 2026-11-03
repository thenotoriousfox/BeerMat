#!/usr/bin/env node
// The Round formats page's phone screenshots (site/public/shots/phone-format-*.webp): every format of the example quiz
// (examples/example-quiz.json) on the native Android app, joined as a team as scripts/site-screenshots-android.mjs
// does (that script makes the homepage's phone shots; formats it already has aren't taken again). Run it again
// whenever a format's phone screen changes:
//
//     node scripts/site-screenshots-formats.mjs
//
// The formats the app hands over to the phone's browser (BrowserRound) are taken there instead, on a phone-sized page
// at the same size, with a few answers filled in.
//
// Needs a running emulator or phone with the app installed, and ffmpeg (as site-screenshots-android.mjs).
import {mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
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
const post = async (route, body, key = '') => {
  const res = await fetch(`${base}/api/${route}`, {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + key}, body: JSON.stringify(body)});
  const json = await res.json(); if (!res.ok) throw Error(`${route}: ${json.error}`); return json;
};
const {key} = await post('login', {key: 'screenshot-quiz-key-0123'});
const host = (route, body = {}) => post('host/' + route, body, key);
const example = JSON.parse(readFileSync(path.join(root, 'examples', 'example-quiz.json'), 'utf8'));
// The pictures and sounds inside the file are uploaded first (as the desk does when it loads a quiz).
const extensions = {'image/png': '.png', 'audio/mpeg': '.mp3', 'video/mp4': '.mp4'};
for (const holder of example.rounds.flatMap(r => r.questions).flatMap(q => [q, ...(q.clips || []), ...(q.songs || [])])) {
  const match = /^data:([^;]+);base64,(.*)$/s.exec(holder.media || '');
  if (!match) continue;
  const res = await fetch(`${base}/api/host/media?name=x${extensions[match[1]]}`, {method: 'POST', headers: {Authorization: 'Bearer ' + key}, body: Buffer.from(match[2], 'base64')});
  holder.media = (await res.json()).media;
}
await host('new-event', {questions: 'load', quiz: example});
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

  // A second team on a phone's browser, for the formats the app opens in the browser.
  const browser = await chromium.launch();
  const page = await (await browser.newContext({viewport: {width: 390, height: 844}, deviceScaleFactor: 2, isMobile: true, hasTouch: true})).newPage();
  await page.goto(base + '/'); await page.fill('#name', 'Pub Quizzard'); await page.click('#joinButton'); await page.locator('#game').waitFor();
  const inBrowser = new Set(['video', 'clues', 'list', 'pairs', 'sort', 'links', 'survey']);
  const browserShot = async name => {
    await page.evaluate(() => window.scrollTo(0, 0)); await sleep(300);
    const png = path.join(raw, `${name}.png`); await page.screenshot({path: png});
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', png, '-c:v', 'libwebp', '-lossless', '1', '-compression_level', '6', path.join(out, `${name}.webp`)]);
    console.log('Saved', name, '(browser)');
  };
  // Some answers on their way: the first few groups chosen, a box or two typed in.
  const fill = async q => {
    const selects = page.locator('#inputs select');
    for (let i = 0, n = await selects.count(); i < Math.ceil(n * 2 / 3); i++) {
      const options = await selects.nth(i).locator('option').count();
      await selects.nth(i).selectOption({index: 1 + [1, 0, 2, 1, 0, 2, 3, 1][i % 8] % (options - 1)});
    }
    const typed = {list: ['England', 'Wales'], links: ['Planets'], survey: ['Kettle']}[q.type] || [];
    const boxes = page.locator('#inputs input[type=text]');
    for (let i = 0; i < typed.length && i < await boxes.count(); i++) await boxes.nth(i).fill(typed[i]);
    if (q.type === 'clues') await sleep((q.clueSeconds || 10) * 1000 + 500);
  };
  let current = null;
  const open = async id => {
    if (current) await host('close', {expectedQuestion: current}).catch(() => {});
    await host('start', {id, expectedQuestion: current}); current = (await host('state')).question.id; await sleep(3500);
  };
  // The formats the homepage's shots don't show already (choice, word trail, pinpoint, tiles, order, buzzer, bingo,
  // the picture reveal and music bingo come from site-screenshots-android.mjs).
  const taken = new Set(['choice', 'wordsnake', 'pinpoint', 'tiles', 'sequence', 'buzzer', 'bingo', 'picture', 'musicbingo']);
  for (const q of process.env.ONLY_EXTRAS ? [] : (await host('library')).rounds.flatMap(r => r.questions)) {
    const name = q.type;
    if (taken.has(name) || q.pair) continue;   // true or false is multiple choice
    await open(q.id);
    if (inBrowser.has(q.type)) {await page.locator('#question', {hasText: q.text.slice(0, 20)}).waitFor(); await fill(q); await browserShot(`phone-format-${name}`);} else shot(`phone-format-${name}`);
  }
  // Ways to play that change a team's phone: a wager, Risk It, six fixed buttons and Wipeout.
  const choice = {type: 'choice', round: 'General knowledge', seconds: 30, points: 3, options: ['Jupiter', 'Saturn', 'Uranus', 'Neptune'], answer: 'Saturn', text: 'Which planet has the most known moons?'};
  for (const [name, question, settings] of [
    ['wager', {...choice, wager: 5}],
    ['sixbuttons', {...choice, options: ['Jupiter', 'Saturn', 'Uranus']}, {fixedSix: true}],
  ]) {
    if (settings) await host('settings', settings);
    if (current) await host('close', {expectedQuestion: current}).catch(() => {});
    await host('open', question); current = (await host('state')).question.id; await sleep(3500);
    shot(`phone-extra-${name}`);
    if (settings) await host('settings', {fixedSix: false});
  }
  // Risk It and Wipeout show in what a wrong answer scores: the browser team answers, and its phone after the reveal.
  for (const [name, question, ticks] of [
    ['riskit', {...choice, evil: true}, ['A']],
    ['wipeout', {type: 'multi', round: 'General knowledge', seconds: 30, points: 3, text: 'Which of these are gas giants? Tick all that apply.', options: ['Jupiter', 'Mars', 'Saturn', 'Venus', 'Mercury', 'Earth'], correct: ['Jupiter', 'Saturn'], wipeout: true}, ['A', 'B', 'C']],
  ]) {
    if (current) await host('close', {expectedQuestion: current}).catch(() => {});
    await host('open', question); current = (await host('state')).question.id;
    await page.locator('#question', {hasText: question.text.slice(0, 20)}).waitFor();
    for (const letter of ticks) await page.click(`#inputs button:has-text("${letter}.")`);
    await page.click('#submit'); await sleep(800);
    await host('close', {expectedQuestion: current}); await host('reveal', {question: current, revealed: true, delay: 0});
    await page.waitForFunction(() => document.getElementById('resultPoints')?.textContent); await sleep(1500);
    await browserShot(`phone-extra-${name}`);
  }
  await browser.close();
  console.log(`Screenshots saved in ${path.relative(root, out)}`);
} finally {
  try {demo('exit');} catch {}
  await quiz.close(); rmSync(dir, {recursive: true, force: true});
}
