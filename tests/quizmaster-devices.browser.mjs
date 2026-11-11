// Quizmaster devices through the account, in a real browser: a TV opens BeerMat Online's /tv, shows a QR code, a
// phone signed in approves it (/connect#tv=…), and the TV opens the quiz laptop's TV page signed in; a phone runs the
// quiz from its browser by picking the laptop on /connect. Against a local BeerMat Online and a quiz laptop signed in.
// npm run test:features
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {generateKeyPairSync} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {createService} from '../online/service.js';
import {createQuiz} from '../server/server.js';
const {chromium} = await import(process.env.BEERMAT_PLAYWRIGHT || 'playwright');
const log = text => console.log('PASS:', text);

const {privateKey, publicKey} = generateKeyPairSync('ed25519');
const dir = mkdtempSync(path.join(os.tmpdir(), 'beermat-devices-'));
const service = createService({database: path.join(dir, 'online.sqlite'), licenceKey: privateKey.export({type: 'pkcs8', format: 'der'}).toString('base64')});
await new Promise(r => service.server.listen(0, '127.0.0.1', r));
const online = `http://127.0.0.1:${service.server.address().port}`;
const hostKey = 'a-secure-devices-test-key';
const laptop = {wifi: async () => ({running: null}), link: () => ({url: 'https://bar.trycloudflare.com', ready: true, error: ''}), linkUp() {}, linkDown() {}};
const quiz = createQuiz({plan: 'pro', hostKey, database: path.join(dir, 'quiz.sqlite'), mediaDir: dir, packDir: dir, soundsDir: dir, laptop,
  licenceKey: publicKey.export({type: 'spki', format: 'der'}).toString('base64')});
// On every network, as the desk's quiz server is: the TV page finds it at its address on this computer's network.
await new Promise(r => quiz.server.listen(0, '0.0.0.0', r));
const base = `http://127.0.0.1:${quiz.server.address().port}`;
const post = async (url, body, key) => (await fetch(url, {method: 'POST', headers: {'Content-Type': 'application/json', ...(key && {Authorization: 'Bearer ' + key})}, body: JSON.stringify(body)})).json();
const desk = (await post(base + '/api/login', {key: hostKey})).key;
await post(base + '/api/host/settings', {onlineService: online, title: 'Tuesday quiz'}, desk);
await post(online + '/v1/accounts', {email: 'host@example.com', password: 'correct horse battery', displayName: 'Dan'});
await post(base + '/api/host/online/signin', {email: 'host@example.com', password: 'correct horse battery'}, desk);
assert.equal((await post(base + '/api/host/link', {}, desk)).signedIn, true);

const browser = await chromium.launch();
const errors = [];
try {
  const tv = await browser.newPage({viewport: {width: 1280, height: 720}});
  tv.on('pageerror', e => errors.push(e.message));
  const paired = tv.waitForResponse(r => r.url().endsWith('/v1/tv-pairings') && r.request().method() === 'POST');
  await tv.goto(online + '/tv');
  const {code} = await (await paired).json();
  await tv.locator('#qr svg').waitFor();
  assert.ok(await tv.locator('#pair').isVisible());
  log('a TV shows a QR code to sign in');

  const phone = await browser.newPage({viewport: {width: 390, height: 800}, isMobile: true});
  phone.on('pageerror', e => errors.push(e.message));
  await phone.goto(`${online}/connect#tv=${code}`);
  assert.equal(new URL(phone.url()).hash, '', 'the code leaves the address once read');
  await phone.fill('#email', 'host@example.com'); await phone.fill('#password', 'correct horse battery');
  await phone.click('#signIn button');
  await phone.click('#approve');
  await phone.locator('#status', {hasText: 'Done'}).waitFor();
  assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'fits a phone');
  log('a phone signed in approves the TV');

  await tv.waitForURL(url => url.pathname === '/tv' && url.port === String(quiz.server.address().port), {timeout: 15000});
  await tv.locator('#title', {hasText: 'Tuesday quiz'}).waitFor();
  assert.equal(new URL(tv.url()).hash, '', 'the ticket leaves the address');
  assert.ok(await tv.evaluate(() => sessionStorage.getItem('beermat-tv')), 'the TV signed in on the laptop');
  log('the TV opens the laptop’s TV page, found through the account and signed in');

  await phone.goto(online + '/connect');
  await phone.locator('#laptops button', {hasText: 'Tuesday quiz'}).click();
  await phone.waitForURL(url => url.pathname === '/deck', {timeout: 15000});
  await phone.locator('#deck').waitFor();
  assert.equal(await phone.locator('#signIn').isVisible(), false, 'signed in with the account, no code');
  const state = await post(base + '/api/host/state', {}, desk);
  assert.deepEqual(state.decks.map(d => d.how), ['venue'], 'the desk lists the phone');
  log('a phone runs the quiz from its browser, picked on /connect');
  assert.deepEqual(errors, []);
  log('no JavaScript errors');
} finally {
  await browser.close(); await quiz.close(); await service.close(); rmSync(dir, {recursive: true, force: true});
}
