// Optional real-browser suite. npm run test:browser after installing Playwright Chromium.
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createQuiz} from '../server.js';
const {chromium} = await import(process.env.PUBQUIZ_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({headless: true, ...(process.env.PUBQUIZ_BROWSER ? {executablePath: process.env.PUBQUIZ_BROWSER, args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-zygote']} : {})});
const dir = mkdtempSync(path.join(os.tmpdir(), 'pubquiz-browser-'));
let quiz;
async function start(port = 0) {quiz = createQuiz({database: path.join(dir, 'quiz.sqlite'), mediaDir: dir, hostKey: 'browser-test-private-key'}); await new Promise(r => quiz.server.listen(port, '127.0.0.1', r));}
await start(); const port = quiz.server.address().port, base = `http://127.0.0.1:${port}`;
const errors = [], external = [];
async function context(options) {
  const c = await browser.newContext(options); c.on('page', page => {page.on('pageerror', e => errors.push(e.message)); page.on('request', r => {if (!r.url().startsWith(base) && !r.url().startsWith('blob:')) external.push(r.url());});}); return c;
}
async function waitFor(page, fn) {await page.waitForFunction(fn, null, {timeout: 12000});}
async function visible(page, selector) {await page.locator(selector).waitFor({state: 'visible', timeout: 12000});}
const hostContext = await context({viewport: {width: 1360, height: 900}});
const playerContext = await context({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true});
const projectorContext = await context({viewport: {width: 1280, height: 720}});
const host = await hostContext.newPage(), player = await playerContext.newPage(), projector = await projectorContext.newPage();
const prompts = [];
host.on('dialog', async dialog => {await dialog.accept(dialog.type() === 'prompt' ? prompts.shift() || 'Test round' : undefined);});
player.on('dialog', dialog => dialog.accept());
const log = text => console.log('PASS:', text);
async function saveQuestion(type, text, fields = {}) {
  await host.locator('#newQuestion').click(); await host.locator('#qText').fill(text); await host.locator('#qType').selectOption(type); await host.locator('#qSeconds').fill('120');
  if (fields.answer !== undefined) await host.locator('#qAnswer').fill(fields.answer);
  if (fields.aliases) await host.locator('#qAliases').fill(fields.aliases);
  if (fields.options) await host.locator('#qOptions').fill(fields.options);
  if (fields.items) {for (let i = 0; i < fields.items.length; i++) {if (i) await host.locator('#addSheetItem').click(); const row = host.locator('#sheetItems .sheet-row').nth(i); await row.locator('input').nth(0).fill(fields.items[i][0]); await row.locator('input').nth(1).fill(fields.items[i][1]);}}
  if (fields.file) {await host.locator('#mediaUpload').setInputFiles(fields.file); await waitFor(host, () => document.getElementById('qMedia').value.startsWith('/media/'));}
  await host.locator('#saveQuestion').click(); await waitFor(host, () => document.getElementById('editorStatus').textContent === 'Saved question loaded');
  assert.equal(await host.locator('#qText').inputValue(), text);
}
try {
  await host.goto(base + '/host'); await host.locator('#key').fill('browser-test-private-key'); await host.locator('#loginForm button').click(); await visible(host, '#panel');
  await host.locator('[data-tab=build]').click(); prompts.push('Round one'); await host.locator('#addRound').click(); await waitFor(host, () => document.getElementById('roundSelect').options.length === 1);
  await saveQuestion('text', 'Type hello', {answer: 'hello', aliases: 'hi'});
  await saveQuestion('choice', 'Select orange', {answer: 'orange', options: 'orange\nblue'});
  await saveQuestion('sheet', 'One-item sheet', {items: [['Type one', 'one']]});
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9sAAAAASUVORK5CYII=', 'base64');
  await saveQuestion('picture', 'Picture question', {answer: 'pixel', file: {name: 'pixel.png', mimeType: 'image/png', buffer: png}});
  const wav = Buffer.alloc(2044); wav.write('RIFF'); wav.writeUInt32LE(2036, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(2000, 40);
  await saveQuestion('audio', 'Audio question', {answer: 'silence', file: {name: 'silence.wav', mimeType: 'audio/wav', buffer: wav}});
  await host.reload(); await visible(host, '#panel'); await host.locator('[data-tab=build]').click(); await waitFor(host, () => document.getElementById('questionSelect').options.length === 6);
  log('form authoring: text, choice, one-item sheet, picture and audio upload; saved quiz survives reload');
  await player.goto(base + '/hotspot-detect.html'); await player.locator('#name').fill('Fox team'); await player.locator('#joinButton').click(); await visible(player, '#game'); const recovery = await player.locator('#code').textContent(); assert.equal(recovery.length, 48);
  await projector.goto(base + '/display'); await projector.getByText('1. Fox team').waitFor();
  await host.locator('[data-tab=live]').click(); await host.locator('#next').click(); await player.getByRole('heading', {name: 'Type hello', exact: true}).waitFor();
  await player.locator('#inputs input').fill('hi'); await waitFor(player, () => document.getElementById('draftStatus').textContent.includes('Draft saved'));
  await player.reload(); await visible(player, '#game'); assert.equal(await player.locator('#inputs input').inputValue(), 'hi');
  await host.locator('#pause').click(); await waitFor(player, () => document.getElementById('status').textContent.includes('Paused')); assert.equal(await player.locator('#submit').isDisabled(), true);
  await host.locator('#resume').click(); await waitFor(player, () => !document.getElementById('submit').disabled);
  await playerContext.setOffline(true); await waitFor(player, () => document.getElementById('connection').textContent.includes('Connection lost'));
  await playerContext.setOffline(false); await waitFor(player, () => !document.getElementById('submit').disabled); assert.equal(await player.locator('#inputs input').inputValue(), 'hi');
  await player.locator('#submit').click(); await waitFor(player, () => document.getElementById('answerState').textContent.includes('Final answer saved')); assert.equal(await player.locator('#submit').isDisabled(), true);
  await host.locator('#close').click(); await host.locator('#reveal').click(); await player.getByText('hello', {exact: true}).waitFor();
  log('captive fallback, registration, draft reload, offline reconnect, pause/resume, final submission and reveal');
  await host.locator('#next').click(); await player.getByRole('heading', {name: 'Select orange', exact: true}).waitFor(); await player.locator('#inputs select').selectOption('orange'); await player.locator('#submit').click(); await waitFor(player, () => document.getElementById('answerState').textContent.includes('Final answer saved')); await host.locator('#close').click();
  await host.locator('#next').click(); await player.getByRole('heading', {name: 'One-item sheet', exact: true}).waitFor(); await player.locator('#inputs input').fill('one'); await player.locator('#submit').click(); await waitFor(player, () => document.getElementById('answerState').textContent.includes('Final answer saved')); await host.locator('#close').click();
  await host.locator('[data-tab=mark]').click(); await host.locator('#reviewSelect').selectOption('3'); await host.locator('#markCards select').selectOption('0');
  await host.locator('#markCards select').evaluate(select => select.blur());
  for (let i = 0; i < 2; i++) await host.waitForResponse(response => response.url().endsWith('/api/host/review'));
  assert.equal(await host.locator('#markCards select').inputValue(), '0', 'Polling must preserve unsaved marks');
  await host.locator('#markCards button').click(); await waitFor(host, () => document.getElementById('markCards').textContent.includes('Saved score: 0'));
  await host.locator('#markCards select').selectOption('1'); await host.locator('#markCards button').click(); await waitFor(host, () => document.getElementById('markCards').textContent.includes('Saved score: 1'));
  log('choice submission, one-item sheet submission and partial-credit marking');
  await host.locator('[data-tab=live]').click(); await host.locator('#next').click(); await player.getByRole('heading', {name: 'Picture question', exact: true}).waitFor(); await waitFor(player, () => document.querySelector('#media img')?.complete && document.querySelector('#media img')?.naturalWidth === 1); await host.locator('#close').click();
  await host.locator('#next').click(); await player.getByRole('heading', {name: 'Audio question', exact: true}).waitFor(); await waitFor(player, () => document.querySelector('#media audio')?.readyState >= 1);
  await host.locator('#displayMode').selectOption('question'); await visible(projector, '#projectQuestion'); await projector.getByRole('heading', {name: 'Audio question', exact: true}).waitFor();
  await player.locator('#media audio').evaluate(a => a.play()); await host.locator('#close').click();
  log('picture decoding, local audio loading/playback and projector question view');
  await host.locator('[data-tab=teams]').click(); await host.getByRole('button', {name: 'Issue recovery code'}).click(); await visible(host, '#recoveryDialog'); const rotated = await host.locator('#recoveryCode').textContent(); assert.notEqual(rotated, recovery); await host.locator('#recoveryDialog button').click();
  await visible(player, '#join'); await player.locator('#join details').evaluate(d => d.open = true); await player.locator('#recovery').fill(rotated); await player.locator('#recoverForm button').click(); await visible(player, '#game');
  await host.locator('#adjustPoints').fill('3'); await host.locator('#adjustReason').fill('Paper round'); await host.locator('#adjustForm button').click(); await waitFor(host, () => document.getElementById('teamCards').textContent.includes('6 pts'));
  await host.locator('[data-tab=live]').click(); await host.locator('#displayMode').selectOption('leaderboard'); await host.locator('#finish').click(); await waitFor(projector, () => document.getElementById('boardStatus').textContent === 'Final standings'); await waitFor(player, () => document.getElementById('answerState').textContent === 'Quiz finished');
  assert.equal(await player.locator('#submit').isDisabled(), true);
  log('host-assisted recovery retains team identity; paper scoring and final leaderboard');
  await quiz.close(); await start(port);
  await visible(host, '#login'); await host.locator('#key').fill('browser-test-private-key'); await host.locator('#loginForm button').click(); await visible(host, '#panel');
  await waitFor(player, () => document.getElementById('connection').textContent.includes('Connected'));
  assert.equal(await player.locator('#team').textContent(), 'Fox team');
  await host.locator('[data-tab=build]').click(); await host.evaluate(() => window.print = () => {document.body.dataset.printed = 'yes';}); await host.locator('#printSheets').click();
  assert.equal(await host.locator('body').getAttribute('data-printed'), 'yes'); assert.match(await host.locator('#paper').textContent(), /One-item sheet/);
  await player.screenshot({path: '/tmp/pubquiz-player-review.png', fullPage: true});
  await host.screenshot({path: '/tmp/pubquiz-host-review.png', fullPage: true});
  log('server restart preserves the event and player identity; blank sheets are printable');
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  log('no browser JavaScript errors and no external network requests');
} catch (error) {
  console.error('Host status:', await host.locator('#message').textContent());
  console.error('Marking state:', await host.locator('#markCards').textContent());
  console.error('Browser errors:', errors);
  throw error;
} finally {await browser.close(); await quiz.close(); rmSync(dir, {recursive: true, force: true});}
