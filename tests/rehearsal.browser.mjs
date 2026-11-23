// A rehearsal in real browser pages, on a Free laptop: the desk sets it up, simulated teams play a question, the TV
// says it's a rehearsal, and a real phone joins through the normal join page, sees "Connection successful", shows on
// the desk as a test phone, and gets no question. npm run test:rehearsal (BEERMAT_SHOTS=<dir> saves screenshots).
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {execFile} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createQuiz} from '../server/server.js';
const {chromium} = await import(process.env.BEERMAT_PLAYWRIGHT || 'playwright');

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..'), shots = process.env.BEERMAT_SHOTS;
const dir = mkdtempSync(path.join(os.tmpdir(), 'beermat-rehearsal-'));
const quiz = createQuiz({plan: 'free', database: path.join(dir, 'quiz.sqlite'), mediaDir: path.join(dir, 'media'), packDir: dir, soundsDir: dir, hostKey: 'rehearsal-browser-key'});
await new Promise(r => quiz.server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${quiz.server.address().port}`;
await new Promise((resolve, reject) => execFile('node', [path.join(root, 'scripts', 'load-test-quiz.mjs'), base], {env: {...process.env, HOST_KEY: 'rehearsal-browser-key'}}, e => e ? reject(e) : resolve()));
const browser = await chromium.launch(), errors = [];
const page = async options => {const p = await (await browser.newContext(options)).newPage(); p.on('pageerror', e => errors.push(e.message)); p.on('dialog', d => d.accept()); return p;};
const pass = text => console.log('PASS:', text);
const shot = (p, name) => shots ? p.screenshot({path: path.join(shots, `rehearsal-${name}.png`), fullPage: name.startsWith('desk')}) : null;
try {
  const desk = await page({viewport: {width: 1600, height: 1000}});
  await desk.goto(base + '/host'); await desk.fill('#key', 'rehearsal-browser-key'); await desk.click('#loginForm button'); await desk.locator('#panel').waitFor();
  await desk.locator('#modePill', {hasText: 'REHEARSAL'}).waitFor();
  assert.match(await desk.locator('#goLive').textContent(), /Pro/); assert.equal(await desk.locator('#goLive').isDisabled(), true);
  pass('a Free desk is not live, and says hosting live is Pro');

  await desk.click('#rehearseOpen'); await desk.locator('#rehearseDialog').waitFor();
  await desk.fill('#rTeams', '6'); await desk.selectOption('#rAuto', 'manual'); await desk.selectOption('#rSpeed', 'fast');
  await shot(desk, 'setup');
  await desk.click('#rehearseStart');
  await desk.locator('#simTeams li', {hasText: 'connected'}).nth(5).waitFor();
  pass('the rehearsal starts with six simulated teams, connected');

  const tv = await page({viewport: {width: 1280, height: 720}});
  await tv.goto(base + '/tv?app=1'); await tv.locator('#rehearsalBadge').waitFor({state: 'visible'});
  pass('the TV shows it is a rehearsal');

  const phone = await page({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true});
  await phone.goto(base + '/'); await phone.fill('#name', 'My test phone'); await phone.click('#joinButton');
  await phone.locator('#rehearsalCard', {hasText: 'Connection successful'}).waitFor();
  assert.equal(await phone.locator('#rehearsalName').textContent(), 'My test phone');
  await desk.locator('#testPhones li', {hasText: 'My test phone'}).waitFor();
  pass('a real phone joins through the join page, sees Connection successful, and shows on the desk as a test phone');

  await desk.click('#next'); await desk.locator('#liveText', {hasText: 'Red Planet'}).waitFor();
  await desk.evaluate(() => {document.querySelector('#rehearsalPanel details').open = true;});
  for (const action of ['right', 'wrong']) {await desk.locator(`[data-sim=${action}]`).click(); await desk.waitForTimeout(300); await desk.selectOption('#simPick', {index: 1});}
  await desk.locator('#roomCount', {hasText: '2 answered'}).waitFor();
  await tv.locator('#question', {hasText: 'Red Planet'}).waitFor();
  await phone.waitForTimeout(1000);
  assert.equal(await phone.locator('#question').isVisible(), false, 'the question never shows on the test phone');
  assert.equal(await phone.locator('#rehearsalCard').isVisible(), true);
  pass('simulated teams answer from the desk; the TV shows the question; the test phone still only shows its connection');
  await shot(desk, 'desk'); await shot(tv, 'tv'); await shot(phone, 'phone');

  await desk.click('#preflightRun'); await desk.locator('#preflightList li strong').nth(5).waitFor();
  const labels = await desk.locator('#preflightList li strong').allTextContents();
  assert.ok(labels.some(l => l.startsWith('The quiz')) && labels.some(l => l.startsWith('TV and sound · Not checked')));
  await shot(desk, 'preflight');
  await desk.click('#preflightClose');
  pass('preflight checks the quiz and says what it could not check');

  await desk.click('#rehearseStop'); await desk.locator('#simTeams li', {hasText: 'Start a rehearsal'}).waitFor();
  pass('ending the rehearsal clears it');
  assert.deepEqual(errors, []); pass('no JavaScript errors');
} finally {await browser.close(); await quiz.close(); rmSync(dir, {recursive: true, force: true});}
