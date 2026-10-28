#!/usr/bin/env node
// The website's product screenshots (site/public/shots), taken from the real app: a quiz server with the rehearsal
// quiz (load-test-quiz.mjs), teams joining on phone-sized pages, the desk and the TV. Run it again whenever the desk,
// TV or phone pages change:   node scripts/site-screenshots.mjs
// Needs Playwright's Chromium (as the browser tests) and ffmpeg (WebP). Team names are made up for the demo quiz.
import {chromium} from 'playwright';
import {mkdtempSync, rmSync, mkdirSync} from 'node:fs';
import {execFile, execFileSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createQuiz} from '../server/server.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..'), out = path.join(root, 'site', 'public', 'shots');
const dir = mkdtempSync(path.join(os.tmpdir(), 'beermat-shots-')), raw = path.join(dir, 'raw');
mkdirSync(raw); mkdirSync(out, {recursive: true});
const quiz = createQuiz({hostKey: 'screenshot-quiz-key-0123', database: path.join(dir, 'quiz.sqlite'), mediaDir: path.join(dir, 'media'), plan: 'pro'});
await new Promise(r => quiz.server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${quiz.server.address().port}`;
await new Promise((resolve, reject) => execFile('node', [path.join(root, 'scripts', 'load-test-quiz.mjs'), base], {env: {...process.env, HOST_KEY: 'screenshot-quiz-key-0123'}}, e => e ? reject(e) : resolve()));
const post = async (route, body, key = '') => {
  const res = await fetch(`${base}/api/${route}`, {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + key}, body: JSON.stringify(body)});
  const json = await res.json(); if (!res.ok) throw Error(`${route}: ${json.error}`); return json;
};
const {key} = await post('login', {key: 'screenshot-quiz-key-0123'});
const host = (route, body = {}) => post('host/' + route, body, key);
await host('settings', {title: 'Tuesday Quiz Night', waitingRoom: false, teamPhotos: false});
const state = () => host('state');
const sleep = ms => new Promise(r => setTimeout(r, ms));
// Converts a capture to WebP (quality 90: the shots are mostly text). TV and desk captures are taken at twice their
// layout size, for sharp text on high-density screens and in the full-screen viewer: they're saved as <name>@2x.webp
// at full size and <name>.webp at half (the page's srcset picks). Phone captures are already 2× and kept as they are.
const encode = (png, file, scale) => execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', png, ...(scale ? ['-vf', `scale=iw/${scale}:-1:flags=lanczos`] : []), '-c:v', 'libwebp', '-quality', '90', path.join(out, file)]);
const webp = (png, name, retina = false) => {encode(png, `${name}.webp`, retina ? 2 : 0); if (retina) encode(png, `${name}@2x.webp`, 0);};
const shot = async (page, name, options = {}) => {const file = path.join(raw, `${name}.png`); await page.screenshot({path: file, ...options}); webp(file, name, page.retina);};

const browser = await chromium.launch();
try {
  // Six teams join through the real join page, each on its own phone-sized page.
  const phone = {viewport: {width: 390, height: 844}, deviceScaleFactor: 2, isMobile: true, hasTouch: true};
  const phones = [];
  for (const name of ['Quiz Team Aguilera', 'Les Quizerables', 'The Quizzly Bears', 'Agatha Quiztie', 'Universally Challenged', 'Tequila Mockingbird']) {
    const page = await (await browser.newContext(phone)).newPage();
    await page.goto(base + '/'); await page.fill('#name', name); await page.click('#joinButton'); await page.locator('#game').waitFor();
    phones.push(page);
  }
  // A team taps an answer and sends it, as players do.
  const answer = async (page, value) => {
    await page.locator(`button.opt[data-value="${value}"]`).click({timeout: 5000});
    const send = page.getByRole('button', {name: 'Send answer'});
    if (await send.isVisible()) await send.click({timeout: 5000});
  };

  const tv = await (await browser.newContext({viewport: {width: 1600, height: 900}, deviceScaleFactor: 2})).newPage(); tv.retina = true;
  await tv.goto(base + '/display'); await sleep(1500);
  await shot(tv, 'tv-join');

  const desk = await (await browser.newContext({viewport: {width: 1600, height: 1000}, deviceScaleFactor: 2})).newPage(); desk.retina = true;
  await desk.goto(base + '/host'); await desk.fill('#key', 'screenshot-quiz-key-0123'); await desk.click('#loginForm button'); await desk.locator('#panel').waitFor();

  // Opens one saved question by id, closing the one before.
  let current = null;
  const open = async id => {
    if (current) await host('close', {expectedQuestion: current}).catch(() => {});
    await host('start', {id, expectedQuestion: current}); current = (await state()).question.id; await sleep(1500);
  };

  // The first question, mid-flow: some teams in, the desk and TV as the room sees them.
  await open('test-q1');
  for (const [i, value] of [[0, 'Mars'], [1, 'Mars'], [3, 'Venus']]) await answer(phones[i], value);
  await sleep(1500);
  await shot(tv, 'tv-question'); await shot(phones[5], 'phone-choice');
  // The picture shown when a link to the site is shared (Open Graph): the TV at 1200×630, kept as PNG for every app.
  const og = await (await browser.newContext({viewport: {width: 1200, height: 630}})).newPage();
  await og.goto(base + '/display'); await sleep(1500); await og.screenshot({path: path.join(out, 'og.png')});
  // Without the "Quiz desk unlocked" note from signing in.
  await desk.waitForFunction(() => !document.getElementById('message').textContent, null, {timeout: 15000}).catch(() => {});
  await shot(desk, 'desk');

  // The answer revealed on the TV, after the drum roll.
  await host('close', {expectedQuestion: current});
  await host('reveal', {question: current, revealed: true, delay: 0}); await sleep(2500);
  await shot(tv, 'tv-reveal');

  // Round formats, on a phone.
  for (const [id, name] of [['test-q12', 'phone-wordsnake'], ['test-q11', 'phone-pinpoint'], ['test-q13', 'phone-tiles'], ['test-q5', 'phone-sequence'], ['test-q16', 'phone-buzzer'], ['test-q19', 'phone-bingo']]) {
    await open(id); await shot(phones[2], name);
  }
  // The leaderboard on the TV.
  await host('close', {expectedQuestion: current}).catch(() => {});
  await host('settings', {displayMode: 'leaderboard'}); await sleep(2500);
  await shot(tv, 'tv-leaderboard');
  console.log(`Screenshots saved in ${path.relative(root, out)}`);
} finally {
  await browser.close(); await quiz.close(); rmSync(dir, {recursive: true, force: true});
}
