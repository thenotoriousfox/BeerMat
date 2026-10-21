// Optional real-browser suite. npm run test:browser after installing Playwright Chromium.
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, readFileSync} from 'node:fs';
import zlib from 'node:zlib';
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
async function waitFor(page, fn, timeout = 12000) {await page.waitForFunction(fn, null, {timeout});}
async function visible(page, selector) {await page.locator(selector).waitFor({state: 'visible', timeout: 12000});}
const hostContext = await context({viewport: {width: 1360, height: 900}});
const playerContext = await context({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true});
const projectorContext = await context({viewport: {width: 1280, height: 720}});
const rivalContext = await context({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true});
const host = await hostContext.newPage(), player = await playerContext.newPage(), projector = await projectorContext.newPage(), rival = await rivalContext.newPage();
const prompts = [];
host.on('dialog', async dialog => {await dialog.accept(dialog.type() === 'prompt' ? prompts.shift() || 'Test round' : undefined);});
player.on('dialog', dialog => dialog.accept());
rival.on('dialog', dialog => dialog.accept());
const log = text => console.log('PASS:', text);
// A silent mono 8 kHz WAV of the given length.
function makeWav(seconds) {
  const data = 8000 * 2 * seconds, wav = Buffer.alloc(44 + data);
  wav.write('RIFF'); wav.writeUInt32LE(36 + data, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(data, 40);
  return wav;
}
// A plain w×h PNG, large enough to click on.
function makePng(w, h) {
  const chunk = (type, data) => {const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(body)); return Buffer.concat([len, body, crc]);};
  const header = Buffer.alloc(13); header.writeUInt32BE(w, 0); header.writeUInt32BE(h, 4); header[8] = 8; header[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h, 200); for (let y = 0; y < h; y++) raw[y * (w * 3 + 1)] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
async function saveQuestion(type, text, fields = {}) {
  await host.locator('#newQuestion').click(); await host.locator('#qText').fill(text); await host.locator('#qType').selectOption(type); await host.locator('#qSeconds').fill('120');
  if (fields.answer !== undefined) await host.locator('#qAnswer').fill(fields.answer);
  if (fields.aliases) await host.locator('#qAliases').fill(fields.aliases);
  if (fields.options) await host.locator('#qOptions').fill(fields.options);
  if (fields.sequence) await host.locator('#qItems').fill(fields.sequence);
  if (fields.places) await host.locator('#qPlaces').fill(fields.places);
  if (fields.variation) await host.locator('#qVariation').selectOption(fields.variation);
  if (fields.agreePoints) await host.locator('#qAgreePoints').fill(fields.agreePoints);
  if (fields.correct) await host.locator('#qCorrect').fill(fields.correct);
  if (fields.mode) await host.locator('#qMode').selectOption(fields.mode);
  if (fields.items) {for (let i = 0; i < fields.items.length; i++) {if (i) await host.locator('#addSheetItem').click(); const row = host.locator('#sheetItems .sheet-row').nth(i); await row.locator('input').nth(0).fill(fields.items[i][0]); await row.locator('input').nth(1).fill(fields.items[i][1]);}}
  if (fields.file) {await host.locator('#mediaUpload').setInputFiles(fields.file); await waitFor(host, () => document.getElementById('qMedia').value.startsWith('/media/'));}
  if (fields.pinAt) {await waitFor(host, () => document.querySelector('#pinTarget img')?.naturalWidth > 0); await host.locator('#pinTarget img').click({position: fields.pinAt}); await host.locator('#pinTarget .target').waitFor();}
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
  // The TV starts in Auto: before the first question it shows how to join.
  await projector.goto(base + '/display'); await visible(projector, '#joinSection');
  await host.locator('[data-tab=live]').click(); assert.equal(await host.locator('#displayMode').inputValue(), 'auto');
  // Later updates with no question open must keep the TV connected (a drawing error shows as a lost connection).
  await host.locator('#visibility').click(); await waitFor(host, () => document.getElementById('visibility').textContent === 'Show leaderboard');
  await host.locator('#visibility').click(); await waitFor(host, () => document.getElementById('visibility').textContent === 'Hide leaderboard');
  await waitFor(projector, () => document.getElementById('connection').textContent.includes('Connected')); await waitFor(host, () => document.getElementById('autoView').textContent === '(now: join screen)');
  await waitFor(projector, () => document.querySelector('#wifiQr svg')?.getAttribute('aria-label') === 'QR code: WIFI:T:nopass;S:PubQuiz;;');
  assert.equal(await projector.locator('.qr').count(), 1, 'one code to scan'); assert.match(await projector.locator('#joinStepWifi').textContent(), /“PubQuiz”/);
  assert.match(await projector.locator('#joinFallback').textContent(), /10\.42\.0\.1/); await waitFor(projector, () => /1 team has joined/.test(document.getElementById('joinStatus').textContent));
  await host.locator('#joinSsidInput').fill('Fox Quiz'); await host.locator('#joinDetails button').click(); await waitFor(projector, () => document.getElementById('joinStepWifi').textContent.includes('Fox Quiz'));
  await projector.mouse.move(5, 5); await projector.mouse.move(20, 20); await projector.locator('#fullscreen').click(); await waitFor(projector, () => !!document.fullscreenElement && document.getElementById('fullscreen').textContent.includes('Exit'));
  await projector.keyboard.press('f'); await waitFor(projector, () => !document.fullscreenElement);
  await host.locator('#displayMode').selectOption('leaderboard'); await waitFor(projector, () => document.getElementById('joinHint').textContent.includes('Fox Quiz')); await projector.getByText('1. Fox team').waitFor();
  log('projector join screen with Wi-Fi and address QR codes, editable join details, full-screen toggle');
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
  await host.locator('#next').click(); await player.getByRole('heading', {name: 'Select orange', exact: true}).waitFor(); await player.getByRole('button', {name: 'A. orange'}).click(); await player.locator('#submit').click(); await waitFor(player, () => document.getElementById('answerState').textContent.includes('Final answer saved')); await host.locator('#close').click();
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
  const play = async (text) => {await host.locator('[data-tab=build]').click(); await host.locator('#questionSelect').selectOption(await host.locator('#questionSelect option', {hasText: text}).first().getAttribute('value')); await host.locator('#playSelected').click(); await host.locator('[data-tab=live]').click(); await player.getByRole('heading', {name: text, exact: true}).waitFor();};
  const submitted = async page => {await page.locator('#submit').click(); await waitFor(page, () => document.getElementById('answerState').textContent.includes('Final answer saved'));};
  const scoreOf = async name => Number((await host.locator('#teamCards article', {hasText: name}).locator('p').first().textContent()).split(' ')[0]);
  await rival.goto(base + '/'); await rival.locator('#name').fill('F u c k team'); await rival.locator('#joinButton').click(); await waitFor(rival, () => document.getElementById('message').textContent.includes('different team name'));
  await rival.locator('#name').fill('Owl team'); await rival.locator('#joinButton').click(); await visible(rival, '#game');
  await host.locator('[data-tab=build]').click(); await host.locator('#roundSelect').selectOption({index: 0});
  await saveQuestion('letter', 'Sonic is a what', {answer: 'h'});
  await saveQuestion('sequence', 'Order one two three', {sequence: 'One\nTwo\nThree'});
  await saveQuestion('nearest', 'Guess fifty', {answer: '50', places: '2'});
  await saveQuestion('buzzer', 'Classic buzz', {answer: 'Yes'});
  await saveQuestion('buzzer', 'Advanced buzz', {answer: 'Giraffe', variation: 'advanced', agreePoints: '2'});
  await host.locator('[data-tab=teams]').click(); const before = await scoreOf('Fox team');
  await host.locator('[data-tab=live]').click(); await host.locator('#scramble').click(); await waitFor(host, () => document.getElementById('scramble').textContent.endsWith('on'));
  await play('Sonic is a what'); await rival.getByRole('heading', {name: 'Sonic is a what', exact: true}).waitFor();
  const layout = page => page.locator('#inputs .keypad button').allTextContents();
  assert.notDeepEqual(await layout(player), await layout(rival), 'scrambled keypads differ per team'); assert.deepEqual([...await layout(player)].sort(), [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ']);
  await player.getByRole('button', {name: 'H', exact: true}).click(); await submitted(player);
  await rival.evaluate(() => {Object.defineProperty(document, 'hidden', {value: true, configurable: true}); document.dispatchEvent(new Event('visibilitychange'));});
  await waitFor(host, () => /Left the quiz page: Owl team \(away now/.test(document.getElementById('liveAway').textContent));
  await rival.evaluate(() => {Object.defineProperty(document, 'hidden', {value: false, configurable: true}); document.dispatchEvent(new Event('visibilitychange'));});
  await waitFor(host, () => /Owl team \(\d+s\)/.test(document.getElementById('liveAway').textContent));
  await rival.getByRole('button', {name: 'G', exact: true}).click(); await submitted(rival); await host.locator('#close').click();
  await play('Order one two three');
  for (const item of ['One', 'Two', 'Three']) await player.locator('#inputs .keypad button', {hasText: item}).click();
  assert.equal(await player.locator('#picked').textContent(), 'OneTwoThree'); await submitted(player); await host.locator('#close').click();
  await play('Guess fifty'); await player.locator('#inputs input[type=text]').fill('48'); await submitted(player);
  await rival.locator('#inputs input[type=text]').fill('70'); await submitted(rival); await host.locator('#close').click();
  await host.locator('[data-tab=teams]').click(); await waitFor(host, () => document.getElementById('teamCards').textContent.includes('Owl team'));
  assert.equal(await scoreOf('Fox team'), before + 3); assert.equal(await scoreOf('Owl team'), 1);
  log('leaving the quiz page during a question is shown on the desk');
  log('letter keypad, tap-to-order sequence and nearest-wins sliding scale (2 places: 1 point each after rounding)');
  await host.locator('[data-tab=live]').click(); await host.locator('#displayMode').selectOption('question'); await projector.mouse.move(5, 5); await projector.mouse.move(20, 20); await projector.locator('#enableSound').click();
  await play('Classic buzz'); await visible(rival, '#buzz'); await rival.locator('#buzz').click(); await player.locator('#buzz').click();
  await waitFor(player, () => document.getElementById('buzzStatus').textContent.includes('#2'));
  await waitFor(projector, () => document.getElementById('buzzLeader').textContent.includes('Owl team'));
  await waitFor(host, () => document.getElementById('buzzActive').textContent.includes('Owl team')); await host.locator('#buzzWrong').click();
  await waitFor(player, () => document.getElementById('buzzStatus').textContent.includes('give your answer'));
  await host.locator('#buzzCorrect').click(); await waitFor(host, () => !document.getElementById('next').disabled);
  log('classic buzzer: first-buzz queue, projector call-out, wrong answer passes to the next team');
  await play('Advanced buzz'); assert.equal(await rival.locator('#buzz').isDisabled(), true, 'wrong classic buzzer sits out the next buzzer question');
  await player.locator('#buzz').click(); await waitFor(host, () => document.getElementById('buzzActive').textContent.includes('Fox team'));
  await host.locator('#announced').fill('Giraffe'); await host.locator('#startAgree').click();
  await visible(rival, '#agreeBox'); await rival.locator('#agree').click(); await waitFor(rival, () => document.getElementById('agree').textContent.includes('You agreed'));
  await host.locator('#buzzCorrect').click(); await waitFor(host, () => !document.getElementById('next').disabled);
  await host.locator('[data-tab=teams]').click();
  await waitFor(host, () => /Owl team\s*3 pts/.test(document.getElementById('teamCards').textContent));
  log('advanced buzzer: locked-out team, announced answer and agree vote scoring');
  await host.locator('[data-tab=build]').click();
  const sqq = '\ufeffd><?xml version="1.0" encoding="utf-8"?><round><game>Quizsentials</game><title>Pub keypad</title><points_per_question>2</points_per_question><questions><question><user_view>multi</user_view><q>Pick B</q><short_answer>B</short_answer><long_answer></long_answer><options><option>Ay</option><option>Bee</option></options></question><question><user_view>letters</user_view><q>First letter of Paris</q><short_answer>P</short_answer><long_answer>Paris</long_answer></question></questions></round>';
  await host.locator('#importSq').setInputFiles([{name: 'Pub keypad.sqq', mimeType: 'application/octet-stream', buffer: Buffer.from(sqq)}, {name: 'QQ_Is this imported^^_Yes.txt', mimeType: 'text/plain', buffer: Buffer.alloc(0)}]);
  await waitFor(host, () => document.getElementById('message').textContent.startsWith('Imported 3 questions into 2 rounds'));
  assert.ok((await host.locator('#roundSelect').textContent()).includes('Pub keypad'));
  log('SpeedQuizzing .sqq round and Quick Question file import');
  await host.locator('#roundSelect').selectOption({index: 0});
  await saveQuestion('multi', 'Tick the primes', {options: '2\n3\n4', correct: '2\n3'});
  await saveQuestion('pinpoint', 'Tap the middle', {file: {name: 'board.png', mimeType: 'image/png', buffer: makePng(200, 100)}, pinAt: {x: 100, y: 50}});
  await saveQuestion('bingo', 'Bingo night', {mode: 'line'});
  await host.locator('[data-tab=teams]').click(); const fox = await scoreOf('Fox team'), owl = await scoreOf('Owl team');
  await play('Tick the primes'); await player.getByRole('button', {name: 'A. 2'}).click(); await player.getByRole('button', {name: 'B. 3'}).click(); await submitted(player);
  await rival.getByRole('button', {name: 'C. 4'}).click(); await submitted(rival); await host.locator('#close').click();
  await play('Tap the middle'); await waitFor(player, () => document.querySelector('#pinArea img')?.naturalWidth > 0);
  const box = await player.locator('#pinArea img').boundingBox(); await player.locator('#pinArea img').click({position: {x: box.width / 2 + 2, y: box.height / 2}}); await player.locator('#pinArea .tap').waitFor(); await submitted(player);
  await rival.locator('#pinArea img').click({position: {x: 3, y: 3}}); await submitted(rival); await host.keyboard.press('c');
  await host.locator('[data-tab=teams]').click(); await waitFor(host, () => !document.getElementById('teamCards').textContent.includes('Loading'));
  assert.equal(await scoreOf('Fox team'), fox + 2); assert.equal(await scoreOf('Owl team'), owl);
  log('multi-tap ticks and pinpoint taps scored; C shortcut closes');
  await player.locator('#menuButton').click(); await visible(player, '#teamMenu'); await player.locator('#sound').selectOption('3'); await waitFor(player, () => document.getElementById('message').textContent === 'Buzzer sound saved'); await player.locator('#teamMenu form button').click();
  await play('Bingo night'); await visible(player, '#ticket');
  const row = (await player.locator('#ticket .ticket-row').first().locator('button').allTextContents()).map(Number);
  assert.equal((await player.locator('#ticket button').count()), 15);
  for (let calls = 1; ; calls++) {
    await host.keyboard.press('b'); await host.waitForFunction(n => document.getElementById('bingoCalls').textContent.split(' · ').filter(Boolean).length === n, calls, {timeout: 12000});
    const called = (await host.locator('#bingoCalls').textContent()).split(' · ').map(Number);
    if (row.every(n => called.includes(n))) break;
  }
  await waitFor(projector, () => document.getElementById('bingoBoard').querySelectorAll('.called').length > 0 && document.getElementById('bingoCallText').textContent.length > 1);
  for (const n of row) await player.locator('#ticket button', {hasText: new RegExp(`^${n}$`)}).click();
  await player.locator('#claimBingo').click(); await waitFor(player, () => document.getElementById('bingoStatus').textContent.includes('counted'));
  await waitFor(projector, () => document.getElementById('bingoWinners').textContent.includes('Fox team'));
  assert.equal(await host.locator('#callNumber').isDisabled(), true); await host.keyboard.press('c');
  // Every desk action briefly disables the buttons; wait for the close to finish before the next shortcut.
  await waitFor(host, () => !document.getElementById('next').disabled && !document.getElementById('spinWheel').disabled);
  log('bingo: ticket dabbing, B shortcut calls numbers, call phrases, verified claim shown on projector');
  // The wheel clicks as each segment edge passes the pointer: on the audio clock, slowing down, all within the spin.
  // A frame-by-frame record of the wheel's angle checks that each click lands on an edge.
  await projector.evaluate(() => {
    window.wheelLog = {clicks: [], angles: []};
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (when, ...rest) {
      const context = this.context; window.wheelLog.clicks.push(when);
      if (!window.wheelLog.watching) {
        window.wheelLog.watching = true;
        const frame = () => {
          const spin = document.getElementById('wheelSpin'), m = spin && new DOMMatrix(getComputedStyle(spin).transform);
          if (m) window.wheelLog.angles.push([context.currentTime, Math.atan2(m.b, m.a) * 180 / Math.PI]);
          if (window.wheelLog.angles.length < 600) requestAnimationFrame(frame);
        };
        frame();
      }
      return start.call(this, when, ...rest);
    };
  });
  await host.locator('#wheelItems').fill('Red\nBlue\nGreen'); await host.locator('#wheelItems').evaluate(e => e.blur()); await host.keyboard.press('w');
  await visible(projector, '#wheelSection'); await waitFor(projector, () => document.getElementById('wheelResult').textContent.startsWith('🎉'));
  assert.match(await projector.locator('#wheelResult').textContent(), /Red|Blue|Green/);
  const {clicks, angles} = await projector.evaluate(() => window.wheelLog);
  // Three segments: 120° apart, and at least six full turns, so at least 18 clicks.
  assert.ok(clicks.length >= 18, `${clicks.length} wheel clicks`);
  const gaps = clicks.slice(1).map((c, i) => c - clicks[i]);
  assert.ok(gaps.at(-1) > gaps[1] * 3 && clicks.at(-1) - clicks[0] < 6, 'clicks slow down and end with the spin');
  // How far each click is from the moment a segment edge passes the pointer, from the frames either side of it.
  const misses = clicks.map(c => {
    const i = angles.findIndex(([t]) => t >= c); if (i < 1) return 0;
    const [[t0, a0], [t1, a1]] = [angles[i - 1], angles[i]], turn = ((a1 - a0) % 360 + 540) % 360 - 180;
    const angle = a0 + turn * (c - t0) / (t1 - t0), off = ((angle % 120) + 120) % 120;
    return Math.min(off, 120 - off) / Math.max(1, Math.abs(turn) / (t1 - t0)) * 1000;
  });
  assert.ok(Math.max(...misses) < 40, `clicks land on segment edges (worst ${Math.max(...misses).toFixed(1)} ms out)`);
  log('spin the wheel on the projector; team buzzer sound choice saved');
  await player.locator('#menuButton').click(); await player.locator('#photoInput').setInputFiles({name: 'selfie.png', mimeType: 'image/png', buffer: makePng(640, 480)});
  await waitFor(player, () => document.getElementById('photoStatus').textContent.includes('Waiting'));
  await host.locator('[data-tab=teams]').click(); await host.locator('#teamCards article', {hasText: 'Fox team'}).getByRole('button', {name: 'Approve photo'}).click();
  await waitFor(player, () => document.getElementById('photoStatus').textContent.includes('Approved')); await player.locator('#teamMenu form button').click();
  await host.locator('[data-tab=live]').click(); await host.locator('#displayMode').selectOption('leaderboard');
  await waitFor(projector, () => document.querySelector('#leaderboard .avatar')?.naturalWidth === 360);
  log('team photo: shrunk to a 360px JPEG on the phone, approved by the host, shown on the TV leaderboard');
  await host.locator('[data-tab=build]').click(); await host.locator('#roundSelect').selectOption({index: 0});
  await host.locator('#newQuestion').click(); await host.locator('#qText').fill('Tap on the second clip'); await host.locator('#qType').selectOption('clips');
  await host.locator('#clipUpload').setInputFiles([{name: 'Intro.wav', mimeType: 'audio/wav', buffer: makeWav(3)}, {name: 'Chorus.wav', mimeType: 'audio/wav', buffer: makeWav(3)}]);
  await waitFor(host, () => document.querySelectorAll('#clipList li').length === 2); await host.locator('#clipList input[type=radio]').nth(1).check();
  await host.locator('#saveQuestion').click(); await waitFor(host, () => document.getElementById('editorStatus').textContent === 'Saved question loaded');
  await host.locator('[data-tab=teams]').click(); const foxBefore = await scoreOf('Fox team');
  await play('Tap on the second clip'); await host.locator('#playClips').click();
  await waitFor(rival, () => document.getElementById('clipStatus').textContent.includes('Clip 1 of 2')); await rival.locator('#tap').click();
  await waitFor(player, () => document.getElementById('clipStatus').textContent.includes('Clip 2 of 2')); await player.locator('#tap').click();
  await waitFor(player, () => document.getElementById('clipStatus').textContent === 'You tapped: Clip 2');
  await waitFor(projector, () => document.getElementById('clipTaps').textContent.startsWith('2 teams'));
  await host.keyboard.press('c'); await host.locator('[data-tab=teams]').click();
  await waitFor(host, () => document.getElementById('teamCards').textContent.length > 0); assert.equal(await scoreOf('Fox team'), foxBefore + 1);
  log('sound clips: desk plays the playlist, taps scored by which clip was playing');
  await host.locator('[data-tab=build]').click(); await host.locator('#roundSelect').selectOption({index: 0});
  await host.locator('#newQuestion').click(); await host.locator('#qText').fill('Name that tune bingo'); await host.locator('#qType').selectOption('musicbingo');
  await host.locator('#qSongs').fill(Array.from({length: 14}, (_, i) => `Track ${i + 1}`).join('\n'));
  await host.locator('#songUpload').setInputFiles({name: 'Final_Track.wav', mimeType: 'audio/wav', buffer: makeWav(2)});
  await waitFor(host, () => /Final Track \| \/media\//.test(document.getElementById('qSongs').value));
  await host.locator('#saveQuestion').click(); await waitFor(host, () => document.getElementById('editorStatus').textContent === 'Saved question loaded');
  await play('Name that tune bingo'); await visible(player, '#ticket');
  assert.equal(await player.locator('#ticket button').count(), 15);
  for (let i = 0; i < 15; i++) {
    await host.locator('#callNumber').click(); await host.waitForFunction(n => document.getElementById('bingoCalls').textContent.startsWith(`${n} of`), i + 1, {timeout: 12000});
    if (/Final Track/.test(await host.locator('#bingoInfo').textContent())) await waitFor(host, () => !document.getElementById('songAudio').hidden && document.getElementById('songAudio').currentSrc.includes('/media/'));
  }
  await waitFor(projector, () => document.getElementById('bingoBig').textContent.includes('Song 15') && document.querySelectorAll('#bingoBoard span').length === 14);
  await player.locator('#claimBingo').click(); await waitFor(player, () => document.getElementById('bingoStatus').textContent.includes('counted'));
  await host.keyboard.press('c');
  log('music bingo: song titles and uploaded audio, desk plays songs, TV hides the current title, claim verified');
  const hostApi = async (route, body = {}) => {const key = (await (await fetch(base + '/api/login', {method: 'POST', body: JSON.stringify({key: 'browser-test-private-key'})})).json()).key; return (await fetch(base + '/api/host/' + route, {method: 'POST', headers: {Authorization: 'Bearer ' + key}, body: JSON.stringify(body)})).json();};
  await host.locator('[data-tab=build]').click(); await saveQuestion('wordsnake', 'Tallest animal', {answer: 'Giraffe'});
  await host.locator('[data-tab=build]').click(); await host.locator('#questionSelect').selectOption(await host.locator('#questionSelect option', {hasText: 'Tallest animal'}).first().getAttribute('value'));
  await host.locator('#qGoWide').check(); await host.locator('#qGoWidePoints').fill('1'); await host.locator('#saveQuestion').click(); await waitFor(host, () => document.getElementById('editorStatus').textContent === 'Saved question loaded');
  await saveQuestion('tiles', 'Disney film', {answer: 'The Lion King'});
  await play('Tallest animal'); await visible(player, '#snakeArea .snake');
  const snake = (await hostApi('state')).question;
  const size = snake.grid.size, first = snake.snakePath[0];
  const far = snake.grid.letters.findIndex((_, i) => Math.abs(Math.floor(i / size) - Math.floor(first / size)) > 1 || Math.abs(i % size - first % size) > 1);
  await player.locator('#snakeArea button').nth(far).click(); await player.locator("#snakeArea button").nth(first).click();
  assert.equal(await player.locator('#snakeWord').textContent(), 'G', 'a non-touching tap starts again');
  for (const i of snake.snakePath.slice(1)) await player.locator('#snakeArea button').nth(i).click();
  assert.equal(await player.locator('#snakeWord').textContent(), 'GIRAFFE'); await submitted(player);
  await rival.locator('#goWide').click(); await waitFor(rival, () => document.querySelectorAll('#snakeArea .gone').length === 9);
  for (const i of snake.snakePath) await rival.locator('#snakeArea button').nth(i).click(); await submitted(rival);
  await host.keyboard.press('c');
  await play('Disney film'); await visible(player, '#tileWord'); await waitFor(projector, () => document.getElementById('projectItems').textContent.includes('___ ____ ____'));
  const tiles = (await hostApi('state')).question, usedTiles = new Set();
  for (const t of tiles.tiles) {const i = tiles.pieces.findIndex((p, j) => p === t && !usedTiles.has(j)); usedTiles.add(i); await player.locator(`#inputs .tiles button[data-index="${i}"]`).click();}
  assert.equal(await player.locator('#tileWord').textContent(), 'THE LION KING'); await submitted(player); await host.keyboard.press('c');
  await host.locator('#reveal').click(); await waitFor(projector, () => document.getElementById('solution').textContent.includes('The Lion King'));
  log('word snake trace with restart and go wide; Seven Squares-style tiles; TV shows the word pattern');
  await host.locator('[data-tab=teams]').click(); const owlCard = host.locator('#teamCards article', {hasText: 'Owl team'});
  await owlCard.locator('textarea').fill('Table 7'); await owlCard.locator('textarea').blur(); await waitFor(host, () => document.getElementById('message').textContent === 'Note saved');
  await owlCard.getByRole('button', {name: 'Move to a new phone'}).click(); await visible(host, '#recoveryDialog'); const moveCode = await host.locator('#recoveryCode').textContent(); await host.locator('#recoveryDialog button').click();
  const newPhone = await rivalContext.browser().newContext({viewport: {width: 390, height: 844}, isMobile: true}).then(c => c.newPage()); newPhone.on('pageerror', e => errors.push(e.message));
  await newPhone.goto(base + '/'); await newPhone.locator('#join details').evaluate(d => d.open = true); await newPhone.locator('#recovery').fill(moveCode); await newPhone.locator('#recoverForm button').click();
  await visible(newPhone, '#game'); assert.equal(await newPhone.locator('#team').textContent(), 'Owl team');
  assert.match(await owlCard.textContent(), /answered · \d+ scored/); assert.equal(await owlCard.locator('textarea').inputValue(), 'Table 7');
  log('team notes and stats on the desk; 4-digit code moves a team to a new phone');
  const french = await browser.newContext({viewport: {width: 390, height: 844}, isMobile: true, locale: 'fr-FR'}).then(c => c.newPage()); french.on('pageerror', e => errors.push(e.message));
  await french.goto(base + '/'); await waitFor(french, () => document.getElementById('joinButton').textContent === 'Rejoindre le quiz');
  await french.locator('#name').fill('Les Renards'); await french.locator('#joinButton').click(); await visible(french, '#game');
  await waitFor(french, () => document.getElementById('connection').textContent === '● Connecté' && document.getElementById('message').textContent.startsWith('C’est parti'));
  await french.locator('#menuButton').click(); await french.locator('#teamMenu .language').selectOption('es'); await waitFor(french, () => document.getElementById('connection').textContent === '● Conectado');
  await host.locator('[data-tab=live]').click(); await host.locator('#displayMode').selectOption('leaderboard'); await Promise.all([projector.waitForEvent('load'), host.locator('#tvLanguage').selectOption('es')]);
  await waitFor(projector, () => document.querySelector('#boardSection h2')?.textContent === 'Clasificación');
  await Promise.all([projector.waitForEvent('load'), host.locator('#tvLanguage').selectOption('en')]); await waitFor(projector, () => document.querySelector('#boardSection h2')?.textContent === 'Leaderboard');
  await host.locator('[data-tab=teams]').click(); await host.locator('#teamCards article', {hasText: 'Les Renards'}).getByRole('button', {name: 'Disable'}).click();
  log('French phone by browser locale, switched to Spanish; TV language follows the desk setting');
  await host.locator('[data-tab=live]').click(); await host.locator('#waitingRoom').click(); await waitFor(host, () => document.getElementById('waitingRoom').textContent === 'Waiting room: on');
  const door = await browser.newContext({viewport: {width: 390, height: 844}, isMobile: true}).then(c => c.newPage()); door.on('pageerror', e => errors.push(e.message));
  await door.goto(base + '/'); await door.locator('#name').fill('Door team'); await door.locator('#joinButton').click();
  await waitFor(door, () => document.getElementById('question').textContent.includes('waiting room'));
  await waitFor(host, () => document.getElementById('admitAll').textContent === 'Let everyone in (1)' && document.getElementById('alerts').textContent.includes('Waiting room: Door team'));
  assert.equal(await projector.locator('#leaderboard', {hasText: 'Door team'}).count(), 0);
  await host.locator('#admitAll').click(); await waitFor(door, () => !document.getElementById('question').textContent.includes('waiting room'));
  await projector.locator('#leaderboard', {hasText: 'Door team'}).waitFor(); await host.locator('#waitingRoom').click();
  log('waiting room: a new team waits on its phone until the desk lets it in');
  await host.locator('#timerMinutes').fill('0'); await host.locator('#timerSeconds').fill('2'); await host.locator('#timerLabel').fill('Pens down'); await host.locator('#timerForm button[type=submit], #timerForm > button:not([type])').first().click();
  await visible(projector, '#countdown'); assert.equal(await projector.locator('#countdownLabel').textContent(), 'Pens down');
  await waitFor(projector, () => document.getElementById('countdownTime').textContent === 'Time’s up!'); await waitFor(host, () => document.getElementById('timerNow').textContent.includes('time’s up'));
  await host.locator('#timerStop').click(); await waitFor(projector, () => document.getElementById('countdown').hidden);
  await host.locator('#showScores').click(); await waitFor(projector, () => [...document.querySelectorAll('#leaderboard strong')].every(s => s.textContent === ''));
  await waitFor(player, () => /^#\d+$/.test(document.getElementById('myScore').textContent)); await host.locator('#showScores').click();
  await waitFor(projector, () => document.querySelector('#leaderboard strong').textContent.endsWith('pts'));
  log('TV countdown over the leaderboard; board switches between scores and positions only');
  await host.locator('[data-tab=build]').click(); await waitFor(host, () => document.getElementById('spotifyStatus').textContent === 'Not connected' && /^http:\/\/127\.0\.0\.1:\d+\/spotify\/callback$/.test(document.getElementById('spotifyRedirect').textContent));
  assert.equal(await host.locator('#spotifySongs').isDisabled(), true);
  await host.locator('#questionSelect').selectOption(''); await host.locator('#qType').selectOption('vote');
  assert.equal(await host.locator('#evilLabel').isHidden(), true); await host.locator('#qType').selectOption('text'); assert.equal(await host.locator('#evilLabel').isVisible(), true);
  assert.equal(await host.locator('#speedLabel').isHidden(), true); await host.locator('#qFastest').check(); assert.equal(await host.locator('#speedLabel').isVisible(), true);
  assert.equal(await host.locator('#bonusPlacesLabel').isHidden(), true); await host.locator('#qBonusMode').selectOption('fixed'); assert.equal(await host.locator('#bonusPlacesLabel').isVisible(), true);
  await host.locator('#qText').fill('Evil capital'); await host.locator('#qAnswer').fill('Cardiff'); await host.locator('#qEvil').check(); await host.locator('#qSpeed').fill('3'); await host.locator('#qBonusPlaces').fill('2');
  await host.locator('#saveQuestion').click(); await waitFor(host, () => document.getElementById('editorStatus').textContent === 'Saved question loaded');
  const saved = (await hostApi('library')).rounds.flatMap(r => r.questions).find(q => q.text === 'Evil capital');
  assert.deepEqual([saved.evil, saved.fastestFingers, saved.bonusMode, saved.bonusPlaces, saved.speedBonus], [true, true, 'fixed', 2, 3]);
  log('builder: Evil Mode and fixed speed bonus fields save with the question');
  await host.locator('[data-tab=live]').click(); await host.locator('#displayMode').selectOption('leaderboard'); await host.locator('#finish').click(); await waitFor(projector, () => document.getElementById('boardStatus').textContent === 'Final standings');
  await visible(projector, '#winnerSection'); await waitFor(projector, () => document.getElementById('winnerName').textContent === 'Fox team' && document.querySelectorAll('#confetti span').length === 80);
  assert.match(await projector.locator('#podium').textContent(), /🥈 Owl team/); await waitFor(player, () => document.getElementById('answerState').textContent === 'Quiz finished');
  assert.equal(await player.locator('#submit').isDisabled(), true);
  log('host-assisted recovery retains team identity; paper scoring; finish shows the winner celebration');
  await quiz.close(); await start(port);
  await host.reload(); await visible(host, '#panel'); // host session persists across a server restart
  // The restarted server is a new build, so the phone reloads itself, onto the quiz's own page.
  await player.waitForURL(url => url.pathname === '/', {timeout: 30000, waitUntil: 'domcontentloaded'});
  await waitFor(player, () => document.getElementById('connection').textContent.includes('Connected'));
  assert.equal(await player.locator('#team').textContent(), 'Fox team');
  await host.locator('[data-tab=build]').click(); await host.evaluate(() => window.print = () => {document.body.dataset.printed = 'yes';}); await host.locator('#printSheets').click();
  assert.equal(await host.locator('body').getAttribute('data-printed'), 'yes'); assert.match(await host.locator('#paper').textContent(), /One-item sheet/);
  await player.screenshot({path: '/tmp/pubquiz-player-review.png', fullPage: true});
  await host.screenshot({path: '/tmp/pubquiz-host-review.png', fullPage: true});
  log('server restart preserves the event, host session and player identity; blank sheets are printable');
  // The test quiz file carries its pictures and sounds; importing uploads them, and exporting packs them back in.
  // Loading a quiz file starts a fresh quiz: the night so far is saved and downloaded, and phones are asked to rejoin.
  await host.locator('[data-tab=build]').click();
  const [nightOne] = await Promise.all([host.waitForEvent('download', {timeout: 60000}), host.locator('#importQuiz').setInputFiles('examples/test-quiz.json')]);
  assert.match(nightOne.suggestedFilename(), /^pubquiz-results-/);
  await waitFor(host, () => document.getElementById('message').textContent.startsWith('New quiz loaded: Test quiz'), 60000);
  await waitFor(player, () => !document.getElementById('join').hidden && document.getElementById('message').textContent === 'A new quiz has started — pick your team name again.');
  assert.deepEqual((await hostApi('state')).teams, []);
  const imported = await hostApi('library'), importedMedia = imported.rounds.flatMap(r => r.questions.flatMap(q => [q.media, ...(q.clips || []).map(c => c.media), ...(q.songs || []).map(x => x.media)])).filter(Boolean);
  assert.deepEqual([imported.title, imported.rounds.length, importedMedia.length > 30, importedMedia.every(m => /^\/media\/[a-f0-9]+\.(png|wav)$/.test(m))], ['Test quiz', 6, true, true]);
  const [packed] = await Promise.all([host.waitForEvent('download'), host.locator('#exportQuizMedia').click()]);
  const bundle = JSON.parse(readFileSync(await packed.path(), 'utf8'));
  assert.match(bundle.rounds[1].questions[1].media, /^data:image\/png;base64,/); assert.equal(bundle.revision, undefined);
  log('loading a quiz file starts a fresh quiz; quiz files carry their media in and out');
  await host.locator('[data-tab=live]').click(); await host.locator('#newEvent').click(); await visible(host, '#newEventDialog');
  await host.locator('#newEventTitle').fill('Second night');
  const [results] = await Promise.all([host.waitForEvent('download'), host.locator('#newEventConfirm').click()]);
  assert.match(results.suggestedFilename(), /^pubquiz-results-.*\.json$/);
  await waitFor(host, () => document.getElementById('message').textContent.startsWith('New quiz ready'));
  await waitFor(player, () => !document.getElementById('join').hidden && document.getElementById('message').textContent === 'A new quiz has started — pick your team name again.');
  await visible(projector, '#joinSection'); await waitFor(projector, () => document.getElementById('title').textContent === 'Second night');
  log('end quiz & start next: results downloaded, phones asked to join again, TV back on the join screen');
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  log('no browser JavaScript errors and no external network requests');
} catch (error) {
  console.error('Host status:', await host.locator('#message').textContent());
  console.error('Marking state:', await host.locator('#markCards').textContent());
  console.error('Browser errors:', errors);
  throw error;
} finally {await browser.close(); await quiz.close(); rmSync(dir, {recursive: true, force: true});}
