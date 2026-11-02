// The phone page with this round of features, in a real browser: the table number at join, a question waiting for the
// quizmaster's Send, six fixed A–F buttons, a picture under tiles and music bingo's reaction table.
// npm run test:features (after installing Playwright Chromium). BEERMAT_SHOTS=<dir> saves screenshots.
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createQuiz} from '../server/server.js';
const {chromium} = await import(process.env.BEERMAT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({headless: true});
const dir = mkdtempSync(path.join(os.tmpdir(), 'beermat-features-'));
const quiz = createQuiz({plan: 'pro', database: path.join(dir, 'quiz.sqlite'), mediaDir: dir, hostKey: 'features-test-private-key'});
await new Promise(r => quiz.server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${quiz.server.address().port}`;
const {key} = await (await fetch(base + '/api/login', {method: 'POST', body: JSON.stringify({key: 'features-test-private-key'})})).json();
const host = async (route, body = {}) => (await fetch(`${base}/api/host/${route}`, {method: 'POST', headers: {Authorization: 'Bearer ' + key}, body: JSON.stringify(body)})).json();
const errors = [], log = text => console.log('PASS:', text);
const shot = async (page, name) => process.env.BEERMAT_SHOTS && page.screenshot({path: path.join(process.env.BEERMAT_SHOTS, `phone-${name}.png`)});
// A 400×300 picture: a solid red PNG.
const png = await (async () => {
  const zlib = (await import('node:zlib')).default;
  const crc = buf => {let c = ~0; for (const b of buf) {c ^= b; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;} return ~c >>> 0;};
  const chunk = (type, data) => {const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type), data]); const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body)); return Buffer.concat([len, body, sum]);};
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(400, 0); ihdr.writeUInt32BE(300, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(400 * 3, Buffer.from([220, 40, 40]))]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(Array(300).fill(row)))), chunk('IEND', Buffer.alloc(0))]);
})();
writeFileSync(path.join(dir, 'red.png'), png);

try {
  await host('settings', {waitingRoom: false, askTable: true, sendQuestion: true, fixedSix: true});
  const context = await browser.newContext({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true});
  const phone = await context.newPage();
  phone.on('pageerror', e => errors.push(e.message)); phone.on('dialog', d => d.accept());
  await phone.goto(base + '/');
  await phone.locator('#tableLabel').waitFor({state: 'visible'});
  await phone.fill('#name', 'Owls'); await phone.fill('#table', '7'); await phone.click('#joinButton');
  await phone.locator('#game').waitFor({state: 'visible'});
  assert.equal((await host('state')).teams.find(t => t.name === 'Owls').table_no, 7);
  log('the table number is asked for at join and reaches the desk');

  await host('open', {text: 'Which colour is the sky?', type: 'choice', options: ['Green', 'Blue', 'Red'], answer: 'Blue', seconds: 30, points: 1});
  await phone.waitForFunction(() => document.querySelector('#question').textContent.includes('Listen to the quizmaster'));
  assert.equal(await phone.locator('#inputs button').count(), 0, 'no buttons before Send');
  await shot(phone, 'held');
  await host('send');
  await phone.waitForFunction(() => document.querySelector('#question').textContent === 'Which colour is the sky?');
  assert.deepEqual(await phone.locator('#inputs button').allTextContents(), ['A', 'B', 'C', 'D', 'E', 'F']);
  await shot(phone, 'six');
  await phone.click('#inputs button:text-is("E")'); await phone.click('#submit');
  await phone.waitForFunction(() => document.querySelector('#answerState').textContent.includes('✓'));
  await host('close');
  assert.equal((await host('state')).teams.find(t => t.name === 'Owls').score, 0, 'E is past the last option: wrong');
  log('a question waits for Send; then six A–F buttons, a phantom letter marked wrong');

  // The leaderboard reveal: the phone shows a place only once the TV has, its own included.
  await host('settings', {sendQuestion: false, fixedSix: false});
  const others = [];
  for (const name of ['Bears', 'Cats']) others.push((await (await fetch(base + '/api/join', {method: 'POST', body: JSON.stringify({name})})).json()).secret);
  await host('open', {text: 'Say yes', type: 'text', answer: 'yes', seconds: 30, points: 2});
  const sayYes = (await host('state')).question.id;
  for (const secret of others) await fetch(base + '/api/answer', {method: 'POST', headers: {Authorization: 'Bearer ' + secret}, body: JSON.stringify({question: sayYes, value: 'yes'})});
  await host('close'); await host('board', {action: 'show'});
  const placesShown = () => phone.evaluate(() => [...document.querySelectorAll('#leaderboard li.shown')].map(li => li.textContent.includes('Owls') ? 'Owls' : 'other'));
  await phone.waitForFunction(() => document.querySelector('#leaderboard').classList.contains('revealing'));
  assert.deepEqual(await placesShown(), [], 'nothing before the TV shows it');
  assert.equal(await phone.locator('#myScore').textContent(), '', 'not even the team’s own place');
  await host('board', {action: 'next'});
  await phone.waitForFunction(() => document.querySelector('#myScore').textContent.startsWith('#3'));
  assert.deepEqual(await placesShown(), ['Owls'], 'last place, as on the TV');
  await host('board', {action: 'next'});     // Bears and Cats tie for first: the board is complete
  await phone.waitForFunction(() => !document.querySelector('#leaderboard').classList.contains('revealing'));
  assert.equal((await placesShown()).length, 3);
  log('the phone follows the TV’s leaderboard reveal, its own place included');

  await host('settings', {sendQuestion: false});
  await host('open', {text: 'Whose flag?', type: 'picture', media: '/media/red.png', answer: 'Mars', reveal: 'tiles', seconds: 60, points: 1});
  await phone.locator('#media .reveal-tiles').waitFor();
  const covered = await phone.locator('#media .reveal-tiles span:not(.gone)').count();
  assert.ok(covered >= 11, `most tiles still on at the start (${covered})`);
  await shot(phone, 'tiles');
  await host('close');
  await phone.waitForFunction(() => document.querySelectorAll('#media .reveal-tiles span:not(.gone)').length === 0);
  log('a picture starts under twelve tiles, all gone once answers close');

  const songs = Array.from({length: 15}, (_, i) => ({title: `Song ${i + 1}`}));
  await host('open', {text: 'Music bingo', type: 'musicbingo', mode: 'line', songs, reactions: true, reactionPoints: 1, seconds: 600, points: 3});
  const q = (await host('state')).question, {number} = await host('bingo', {question: q.id});
  await phone.locator('#notMine').waitFor({state: 'visible'});
  await phone.click(`#ticket button:text-is("Song ${number}")`);
  await phone.waitForFunction(() => document.querySelector('#notMine').disabled);
  const table = (await host('state')).question.reactionTable;
  assert.equal(table.now[0].name, 'Owls');
  await shot(phone, 'reactions');
  log('music bingo: dabbing the song playing puts the team on the reaction table');

  // The desk page (the Electron desk's) and the browser TV with the same features.
  await host('close');
  const deskContext = await browser.newContext({viewport: {width: 1360, height: 900}});
  const desk = await deskContext.newPage(), tv = await deskContext.newPage();
  for (const page of [desk, tv]) {page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => d.accept());}
  await desk.goto(base + '/host'); await desk.fill('#key', 'features-test-private-key'); await desk.click('#loginForm button');
  await desk.locator('#panel').waitFor({state: 'visible'});
  await tv.goto(base + '/tv?app=1');
  // The room switches are in Settings → General → Quiz room.
  await desk.click('[data-tab=settings]'); await desk.click('#sendQuestion');
  await desk.waitForFunction(() => document.querySelector('#sendQuestion').textContent.endsWith('on'));
  await desk.click('[data-tab=live]');
  await host('open', {text: 'Capital of Peru?', type: 'text', answer: 'Lima', seconds: 30, points: 1});
  await desk.locator('#send').waitFor({state: 'visible'});
  await shot(desk, 'desk-held');
  await desk.keyboard.press('s');
  await desk.locator('#send').waitFor({state: 'hidden'});
  assert.equal((await host('state')).question.open, true, 'S sent it');
  await host('close'); await host('settings', {sendQuestion: false});
  log('desk: Send Question switch, the Send button and the S key');

  await desk.locator('details.tools summary').click();
  await desk.selectOption('#flyType', 'letter'); await desk.click('#flyForm button');
  await desk.waitForFunction(() => document.querySelector('#liveText').textContent === 'Question on the fly');
  await host('close');
  await desk.locator('#flyAnswerForm').waitFor({state: 'visible'});
  await desk.fill('#flyAnswer', 'q'); await desk.click('#flyAnswerForm button');
  await desk.locator('#flyAnswerForm').waitFor({state: 'hidden'});
  assert.equal((await host('state')).question.answer, 'Q');
  log('desk: a question on the fly, its answer set after it closes');

  await desk.selectOption('#fastTeam', {label: 'Owls'}); await desk.click('#fastFirst');
  await tv.waitForFunction(() => document.querySelector('#firstKind').textContent.includes('FAST TRACK'));
  await shot(tv, 'tv-fasttrack');
  await desk.fill('#rolloverName', 'Jackpot'); await desk.click('#saveRollover');
  await desk.locator('#savedWheels li').waitFor();
  await desk.click('#savedWheels li button:text-is("Spin")');
  await tv.waitForFunction(() => document.querySelector('#wheelTitle').textContent === 'Jackpot');
  await tv.waitForFunction(() => /Jackpot won|rolls over/.test(document.querySelector('#wheelNote').textContent), null, {timeout: 12000});
  log('desk and TV: Fast Track spotlight, a saved rollover jackpot spun with its note');

  // Wording that gives the answer away (hideText): the TV asks the room to listen, until the reveal shows it.
  await host('settings', {displayMode: 'auto'});
  await host('open', {text: 'Which word is spelt S-E-C-R-E-T?', type: 'text', answer: 'secret', hideText: true, seconds: 30, points: 1});
  await tv.waitForFunction(() => document.querySelector('#question').textContent.includes('Listen to the quizmaster'));
  await desk.waitForFunction(() => document.querySelector('#liveKey').textContent.includes('Read it out: the TV and phones'));
  assert.ok(await tv.evaluate(() => document.querySelector('#question').classList.contains('listen')));
  await host('close'); await host('reveal', {question: (await host('state')).question.id, revealed: true, delay: 0});
  await tv.waitForFunction(() => document.querySelector('#question').textContent === 'Which word is spelt S-E-C-R-E-T?');
  log('hidden wording: the TV asks the room to listen and the desk says to read it out, until the reveal');

  await host('settings', {groupBoard: true, displayMode: 'leaderboard'});
  await host('team', {id: (await host('state')).teams[0].id, action: 'group', group: 'Sales'});
  await tv.waitForFunction(() => !document.querySelector('#groupBoard').hidden && document.querySelector('#groupBoard').textContent.includes('Sales'));
  await shot(tv, 'tv-groups');
  await desk.click('[data-tab=settings]'); await desk.click('.settings-nav button[data-group=results]');
  await desk.click('#reportNow');
  await desk.locator('#reportDialog[open] .report-list li').first().waitFor();
  await shot(desk, 'desk-report');
  log('TV group board; the desk’s question report');

  assert.deepEqual(errors, []);
  log('no JavaScript errors on the phone, desk or TV');
} finally {
  await browser.close(); await quiz.close(); rmSync(dir, {recursive: true, force: true});
}
