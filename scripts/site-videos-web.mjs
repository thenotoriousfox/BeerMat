#!/usr/bin/env node
// The website's clip of a team joining in a phone's browser (site/public/clips/phone-join): what a team sees after
// scanning the TV's code, with no app: the join page, a team name, then the first question and the answer. Recorded
// from Chromium at phone size with its own screen feed (smooth frames, with their times), against a quiz server on
// this computer running the rehearsal quiz (load-test-quiz.mjs) on Pro. Run it again whenever the phone page changes:
//
//     node scripts/site-videos-web.mjs
//
// Needs Playwright's Chromium and ffmpeg with libsvtav1 and libx264.
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {execFile, execFileSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createQuiz} from '../server/server.js';

const {chromium} = await import(process.env.BEERMAT_PLAYWRIGHT || 'playwright');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..'), out = path.join(root, 'site', 'public', 'clips');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const dir = mkdtempSync(path.join(os.tmpdir(), 'beermat-web-videos-')), hostKey = 'web-video-quiz-key-0123';
const quiz = createQuiz({hostKey, database: path.join(dir, 'quiz.sqlite'), mediaDir: path.join(dir, 'media'), plan: 'pro'});
await new Promise(r => quiz.server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${quiz.server.address().port}`;
await new Promise((resolve, reject) => execFile('node', [path.join(root, 'scripts', 'load-test-quiz.mjs'), base], {env: {...process.env, HOST_KEY: hostKey}}, e => e ? reject(e) : resolve()));
const post = async (route, body, key = '') => {
  const res = await fetch(`${base}/api/${route}`, {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + key}, body: JSON.stringify(body)});
  const json = await res.json(); if (!res.ok) throw Error(`${route}: ${json.error}`); return json;
};
const {key} = await post('login', {key: hostKey});
const host = (route, body = {}) => post('host/' + route, body, key);
await host('settings', {title: 'Tuesday Quiz Night', waitingRoom: false, teamPhotos: false});
const teams = [];
for (const name of ['Agatha Quiztie', 'Les Quizerables', 'Quiz Team Aguilera', 'Tequila Mockingbird']) teams.push(await post('join', {name}));

const browser = await chromium.launch();
try {
  const context = await browser.newContext({viewport: {width: 390, height: 844}, deviceScaleFactor: 2, isMobile: true, hasTouch: true});
  const page = await context.newPage();
  // Chromium's screen feed: each frame with the moment it was drawn.
  const cdp = await context.newCDPSession(page), frames = [];
  cdp.on('Page.screencastFrame', ({data, metadata, sessionId}) => {frames.push({at: metadata.timestamp, data}); cdp.send('Page.screencastFrameAck', {sessionId}).catch(() => {});});
  await page.goto(base + '/');
  await page.locator('#name').waitFor();
  await sleep(500);
  await cdp.send('Page.startScreencast', {format: 'png', maxWidth: 780, maxHeight: 1688, everyNthFrame: 1});
  await sleep(1200);
  await page.locator('#name').tap();
  await page.locator('#name').pressSequentially('The Quizzly Bears', {delay: 90});
  await sleep(500);
  await page.locator('#joinButton').tap();
  await page.locator('#game').waitFor({state: 'visible'});
  await sleep(1800);
  await host('start', {id: 'test-q1', expectedQuestion: null});
  const q = (await host('state')).question;
  await page.locator('#inputs button', {hasText: 'Mars'}).waitFor();
  await sleep(1600);
  await page.locator('#inputs button', {hasText: 'Mars'}).tap();
  await sleep(600);
  await page.locator('#submit').tap();
  for (const [i, value] of ['Mars', 'Venus', 'Mars', 'Mars'].entries()) {await sleep(300); await post('answer', {question: q.id, value}, teams[i].secret);}
  await sleep(900);
  await host('close', {expectedQuestion: q.id});
  await host('reveal', {question: q.id, revealed: true, delay: 0});
  await sleep(3000);
  await cdp.send('Page.stopScreencast');
  // Each frame lasts until the next; a steady 30 fps clip in AV1 (10-bit) and H.264, and a poster.
  const list = [];
  frames.forEach((f, i) => {
    const file = path.join(dir, `${String(i).padStart(5, '0')}.png`);
    writeFileSync(file, Buffer.from(f.data, 'base64'));
    list.push(`file '${file}'`, `duration ${((frames[i + 1]?.at ?? f.at + 0.5) - f.at).toFixed(4)}`);
  });
  list.push(`file '${path.join(dir, `${String(frames.length - 1).padStart(5, '0')}.png`)}'`);
  writeFileSync(path.join(dir, 'frames.txt'), list.join('\n') + '\n');
  const input = ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', path.join(dir, 'frames.txt'), '-an', '-vf', 'scale=720:-2:flags=lanczos,fps=30'];
  execFileSync('ffmpeg', [...input, '-c:v', 'libsvtav1', '-pix_fmt', 'yuv420p10le', '-crf', '32', '-preset', '6', '-svtav1-params', 'tune=0:film-grain=4', path.join(out, 'phone-join.webm')]);
  execFileSync('ffmpeg', [...input, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '22', '-preset', 'slow', '-tune', 'grain', '-movflags', '+faststart', path.join(out, 'phone-join.mp4')]);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', '7.5', '-i', path.join(out, 'phone-join.mp4'), '-frames:v', '1', '-c:v', 'libwebp', '-lossless', '1', '-compression_level', '6', path.join(out, 'phone-join.webp')]);
  console.log(`phone-join: ${frames.length} frames in ${(frames.at(-1).at - frames[0].at).toFixed(1)}s`);
} finally {
  await browser.close(); await quiz.close(); rmSync(dir, {recursive: true, force: true});
}
