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

  // revealSeconds: revealed over its first 3 seconds of 30, the picture is whole after them, answers still open.
  await host('open', {text: 'Quick one', type: 'picture', media: '/media/red.png', answer: 'Mars', reveal: 'tiles', revealSeconds: 3, seconds: 30, points: 1});
  const quick = String((await host('state')).question.id);
  await phone.waitForFunction(id => document.querySelector('#media .reveal-tiles')?.dataset.question === id, quick);
  assert.ok(await phone.locator('#media .reveal-tiles span:not(.gone)').count() >= 9, 'it starts under its tiles');
  await phone.waitForFunction(() => document.querySelectorAll('#media .reveal-tiles span:not(.gone)').length === 0, null, {timeout: 6000});
  assert.equal((await host('state')).question.open, true, 'still open');
  await host('close');
  log('a picture revealed over its first seconds is whole after them');

  // The on-screen keyboard (Galaxy Fold feedback, 2 Nov): a browser that slides the page to keep the typing box in view
  // carried the top bar, Send answer and all, off the top. Asked to shrink the page instead; failing that, the bar
  // follows the visible part. visualViewport stands in for the keyboard here.
  const typistContext = await browser.newContext({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true});
  const typist = await typistContext.newPage(); typist.on('pageerror', e => errors.push(e.message));
  await typist.addInitScript(() => {
    const fake = new EventTarget(); fake.offsetTop = 0; fake.height = innerHeight;
    Object.defineProperty(window, 'visualViewport', {value: fake, configurable: true});
  });
  await typist.goto(base + '/');
  assert.match(await typist.locator('meta[name=viewport]').getAttribute('content'), /interactive-widget=resizes-content/);
  await typist.fill('#name', 'Typists'); await typist.fill('#table', '3'); await typist.click('#joinButton');
  await typist.locator('#game').waitFor({state: 'visible'});
  const barTop = () => typist.evaluate(() => Math.round(document.querySelector('.topbar').getBoundingClientRect().top));
  const top = await barTop();
  await typist.evaluate(() => {visualViewport.offsetTop = 320; visualViewport.height = 300; visualViewport.dispatchEvent(new Event('resize'));});
  assert.equal(await barTop(), top + 320, 'the bar moves down with the visible part');
  await typist.evaluate(() => {visualViewport.offsetTop = 0; visualViewport.height = innerHeight; visualViewport.dispatchEvent(new Event('resize'));});
  assert.equal(await barTop(), top, 'and back when the keyboard closes');
  await typistContext.close();
  log('with the keyboard open, Send answer stays at the top of what the phone shows');
  // Blur sharpens on the TV's curve (TvStage.qml): three-quarters of the way it's nearly sharp on the phone too
  // (a straight-line blur still had 7 px of 28 there, far blurrier than the TV).
  await host('open', {text: 'Blurry one', type: 'picture', media: '/media/red.png', answer: 'Mars', reveal: 'blur', revealSeconds: 4, seconds: 30, points: 1});
  const blurry = String((await host('state')).question.id);
  await phone.waitForFunction(id => document.querySelector('#media')?.dataset.media && document.querySelector('#media img')?.style.filter.startsWith('blur'), blurry);
  const blurAt = async () => Number((await phone.locator('#media img').evaluate(img => img.style.filter)).match(/blur\(([\d.]+)px\)/)?.[1] ?? 0);
  assert.ok(await blurAt() > 15, 'it starts very blurred');
  await phone.waitForTimeout(3000);
  assert.ok(await blurAt() < 3, `nearly sharp three-quarters of the way (${await blurAt()} px)`);
  await host('close');
  log('a blurred picture sharpens on the phone as on the TV');

  // Pinpoint with several places to find: a tap for each, the points for each place found.
  const placesQ = await host('open', {text: 'Tap both corners', type: 'pinpoint', media: '/media/red.png', seconds: 60, points: 2,
    targets: [{x: 0.1, y: 0.1, r: 0.08}, {x: 0.9, y: 0.9, r: 0.08}]});
  await phone.waitForFunction(() => document.querySelector('#pinArea img'));
  assert.match(await phone.locator('#inputs').textContent(), /2 to find/);
  const box = await phone.locator('#pinArea img').boundingBox();
  await phone.mouse.click(box.x + box.width * 0.1, box.y + box.height * 0.1); await phone.mouse.click(box.x + box.width * 0.9, box.y + box.height * 0.9);
  await phone.waitForFunction(() => document.querySelectorAll('#pinArea .tap').length === 2);
  await phone.click('#submit'); await phone.waitForFunction(() => /final answer/i.test(document.getElementById('draftStatus').textContent + document.getElementById('message').textContent));
  await host('close');
  await phone.waitForFunction(() => document.getElementById('resultPoints').textContent === '+4 points'); void placesQ;
  log('pinpoint with several places: a tap for each, points for each place found');

  // A wager: the phone stakes before sending; a right answer wins the stake.
  await host('open', {text: 'Capital of Spain?', type: 'text', answer: 'Madrid', seconds: 60, wager: 5});
  await phone.waitForFunction(() => document.querySelector('.keypad.stake') && document.getElementById('status').textContent.includes('Wager: up to 5 points'));
  await phone.locator('#inputs input[name=answer-0]').fill('Madrid');
  await phone.click('#submit'); await phone.waitForFunction(() => document.getElementById('message').textContent === 'Choose your stake first');
  await phone.click('.keypad.stake button:text-is("3")'); await phone.click('#submit');
  await phone.waitForFunction(() => /final answer/i.test(document.getElementById('draftStatus').textContent + document.getElementById('message').textContent));
  await host('close');
  await phone.waitForFunction(() => document.getElementById('resultPoints').textContent === '+3 points · Staked 3');
  log('wager: the phone stakes before sending; a right answer wins the stake');

  // Progressive clues: the phone and the TV show the clues so far; a new one appears as time passes.
  await host('open', {text: 'Who am I?', type: 'clues', seconds: 30, points: 3, clueSeconds: 5, answer: 'Newton', clues: ['Born 1642.', 'Royal Mint.', 'Principia.']});
  await phone.waitForFunction(() => document.querySelectorAll('#clueList li').length === 1 && document.getElementById('status').textContent.includes('Clue 1 of 3: 3 points now'));
  await phone.waitForFunction(() => document.querySelectorAll('#clueList li').length === 2, null, {timeout: 9000});
  await host('close');
  log('progressive clues: the phone shows the clues so far, a new one every few seconds');

  // List answers: a box each; each right one scores once.
  await host('open', {text: 'Name the countries of the UK.', type: 'list', seconds: 60, points: 1, slots: 3, accepted: ['England', 'Scotland', 'Wales | Cymru', 'Northern Ireland']});
  await phone.waitForFunction(() => document.querySelectorAll('#inputs .list-box input').length === 3);
  const boxes = phone.locator('#inputs .list-box input');
  await boxes.nth(0).fill('cymru'); await boxes.nth(1).fill('Wales'); await boxes.nth(2).fill('England');
  await phone.click('#submit'); await phone.waitForFunction(() => /final answer/i.test(document.getElementById('draftStatus').textContent + document.getElementById('message').textContent));
  await host('close');
  await phone.waitForFunction(() => document.getElementById('resultPoints').textContent === '+2 points');
  log('list answers: a box each, a point for each right one (Wales and Cymru count once)');

  // An older phone (before iOS 16 / Chrome 103): no AbortSignal.timeout (every request used it), Array at,
  // structuredClone or <dialog>. compat.js fills them in: it joins, answers, keeps a draft and opens the team menu.
  const oldContext = await browser.newContext({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true});
  const oldPhone = await oldContext.newPage(); oldPhone.on('pageerror', e => errors.push('older phone: ' + e.message)); oldPhone.on('dialog', d => d.accept());
  await oldPhone.addInitScript(() => {delete AbortSignal.timeout; delete Array.prototype.at; delete window.structuredClone; delete window.HTMLDialogElement;});
  await oldPhone.goto(base + '/');
  assert.equal(await oldPhone.evaluate(() => typeof structuredClone === 'function' && typeof AbortSignal.timeout === 'function' && [1, 2].at(-1) === 2), true, 'filled in');
  await oldPhone.fill('#name', 'Old Phones'); await oldPhone.fill('#table', '9'); await oldPhone.click('#joinButton');
  await oldPhone.locator('#game').waitFor({state: 'visible'});
  const sendWas = (await host('state')).settings.sendQuestion; await host('settings', {sendQuestion: false});
  await host('open', {text: 'Capital of Wales?', type: 'text', answer: 'Cardiff', seconds: 60, points: 1});
  await oldPhone.waitForFunction(() => document.getElementById('question').textContent === 'Capital of Wales?' && document.querySelectorAll('#inputs input:not([type=hidden])').length === 1);
  await oldPhone.locator('#inputs input').fill('Cardiff');
  await oldPhone.waitForFunction(() => /draft/i.test(document.getElementById('draftStatus').textContent));
  await oldPhone.click('#submit');
  await oldPhone.waitForFunction(() => /final answer/i.test(document.getElementById('draftStatus').textContent + document.getElementById('message').textContent));
  assert.ok((await host('state')).answers.some(a => a.value === 'Cardiff'), 'its answer reached the desk');
  await oldPhone.click('#menuButton'); await oldPhone.locator('#teamMenu').waitFor({state: 'visible'});
  await oldPhone.click('#teamMenu form[method=dialog] button'); await oldPhone.locator('#teamMenu').waitFor({state: 'hidden'});
  await host('close'); await host('settings', {sendQuestion: sendWas}); await oldContext.close();
  log('an older phone (no AbortSignal.timeout, at, structuredClone or dialog) joins, answers and opens its team menu');

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
  // While it's read out, the TV asks the room to listen; Send puts it on the TV and phones together.
  await tv.waitForFunction(() => document.querySelector('#question').textContent.includes('Listen to the quizmaster'));
  await desk.keyboard.press('s');
  await desk.locator('#send').waitFor({state: 'hidden'});
  await tv.waitForFunction(() => document.querySelector('#question').textContent === 'Capital of Peru?');
  assert.equal((await host('state')).question.open, true, 'S sent it');
  await host('close'); await host('settings', {sendQuestion: false});
  log('desk: Send Question switch, the Send button and the S key; the TV shows the question only once it is sent');

  // VAR Check: after the reveal the team appeals from its phone; the desk overturns it; the TV shows the decision.
  const varQ = await host('open', {text: 'Capital of Spain?', type: 'text', answer: 'Madrid', seconds: 60, points: 2, round: 'VAR round'});
  await phone.waitForFunction(() => document.getElementById('question').textContent === 'Capital of Spain?' && document.querySelector('#inputs input'));
  await phone.locator('#inputs input').fill('Madird'); await phone.click('#submit');
  await phone.waitForFunction(() => /final answer/i.test(document.getElementById('draftStatus').textContent + document.getElementById('message').textContent));
  await host('close'); await host('reveal', {question: varQ.id});
  await phone.locator('#varButton').waitFor({state: 'visible', timeout: 20000});
  assert.match(await phone.locator('#varStatus').textContent(), /Ask for a VAR Check\. 1 left this round/);
  await phone.click('#varButton');
  await phone.waitForFunction(() => document.getElementById('varStatus').textContent.includes('reviewing'));
  await desk.locator('#varChecks .var-check').waitFor({state: 'visible'});
  assert.match(await desk.locator('#varChecks').textContent(), /Owls answered “Madird”/);
  await shot(desk, 'desk-var-check');
  await desk.click('#varChecks button:text("Overturn (+2)")');
  await tv.waitForFunction(() => document.getElementById('firstKind').textContent.includes('VAR CHECK'));
  await tv.waitForFunction(() => document.getElementById('firstKind').textContent === 'OVERTURNED', null, {timeout: 8000});
  assert.equal(await tv.locator('#firstDetail').textContent(), '+2 points');
  await shot(tv, 'tv-var-check');
  await phone.waitForFunction(() => document.getElementById('varStatus').textContent.includes('overturned! +2'));
  assert.equal(await phone.locator('#varButton').isVisible(), false, 'one a round: used');
  await desk.click('[data-tab=settings]'); await desk.selectOption('#varCheck', 'night');
  await desk.waitForFunction(async () => true); await new Promise(r => setTimeout(r, 500));
  assert.equal((await host('state')).settings.varCheck, 'night', 'the desk sets the limit');
  await host('settings', {varCheck: 'round'}); await desk.click('[data-tab=live]');
  log('VAR Check: a team appeals from its phone after the reveal, the desk overturns it, the TV shows the decision');

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

  // Run the night in a phone's browser: the desk's code signs it in; it opens, closes and reveals a question.
  await host('settings', {sendQuestion: false, displayMode: 'auto'});
  await host('close');
  // A one-question quiz for Next to open.
  await host('library/save', {revision: (await host('library')).revision, quiz: {title: 'Deck quiz', rounds: [{id: 'd1', title: 'Round one', questions: [
    // An answer sheet (a music round's question): Run the night shows its lines to read out.
    {id: 'dq1', type: 'sheet', text: 'Name the artist and song in clip 1.', items: ['Artist', 'Title'], itemAnswers: ['Tracy Chapman', 'Fast Car'], partScoring: 'split', seconds: 60, points: 4}]}]}});
  const deckPhone = await context.newPage();
  deckPhone.on('pageerror', e => errors.push(e.message)); deckPhone.on('dialog', d => d.accept());
  await deckPhone.goto(base + '/deck');
  await deckPhone.locator('#codeForm').waitFor({state: 'visible'});
  const {code} = await host('deck-code');
  await deckPhone.fill('#code', code); await deckPhone.click('#codeForm button');
  await deckPhone.locator('#deck').waitFor({state: 'visible'});
  assert.equal((await host('state')).decks.at(-1).how, 'code');
  await deckPhone.waitForFunction(() => !document.getElementById('next').disabled);
  await deckPhone.click('#next');
  await deckPhone.waitForFunction(() => !document.getElementById('questionCard').hidden && document.getElementById('state').textContent.startsWith('Open'));
  assert.equal(await deckPhone.locator('#answer').textContent(), 'Answer: Artist: Tracy Chapman · Title: Fast Car');
  await deckPhone.click('#controls button:text("Close answers")');
  await deckPhone.waitForFunction(() => document.getElementById('state').textContent === 'Closed');
  await deckPhone.click('#controls button:text("Reveal answer")');
  await deckPhone.waitForFunction(() => document.getElementById('state').textContent === 'Answer: Artist: Tracy Chapman · Title: Fast Car', null, {timeout: 15000});
  assert.equal((await host('state')).question.revealed, true);
  await shot(deckPhone, 'deck');
  await deckPhone.click('#leave');
  await deckPhone.locator('#codeForm').waitFor({state: 'visible'});
  log('Run the night in a phone’s browser: the desk’s code, then a question opened, closed and revealed');

  assert.deepEqual(errors, []);
  log('no JavaScript errors on the phone, desk or TV');
} finally {
  await browser.close(); await quiz.close(); rmSync(dir, {recursive: true, force: true});
}
