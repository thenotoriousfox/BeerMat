// PubQuiz Player and phone browsers in the same quiz, in real Chromium (Playwright), with phone-sized screens:
//   node tests/mobile.browser.mjs
// One team plays as the app does (the app's user agent, its own screens served at http://localhost as the Android
// app serves them), one in a normal phone browser. Both play the same question; after the quiz each keeps the result
// in a PubQuiz Online profile: the app through its own screens, the browser through the web app.
// This emulates the app's web view; it is not a test on a phone (see docs/MOBILE.md for what still needs one).
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, readFileSync, existsSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {chromium} from 'playwright';
import {createQuiz} from '../server.js';
import {createService} from '../online/service.js';

const root = path.join(import.meta.dirname, '..');
const dir = mkdtempSync(path.join(os.tmpdir(), 'pubquiz-mobile-'));
const quiz = createQuiz({hostKey: 'mobile-test-private-key', database: path.join(dir, 'quiz.sqlite'), mediaDir: dir, packDir: dir, soundsDir: dir});
const service = createService({database: path.join(dir, 'online.sqlite')});
await new Promise(r => quiz.server.listen(0, '127.0.0.1', r));
await new Promise(r => service.server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${quiz.server.address().port}`, online = `http://127.0.0.1:${service.server.address().port}`;
// The app's screens are served by Playwright here, which Chromium's local network checks treat as a public site.
const browser = await chromium.launch({headless: true, args: ['--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights']});
const errors = [], pass = name => console.log('PASS:', name);
const post = async (url, body = {}, key = '') => {
  const res = await fetch(url, {method: 'POST', headers: {'Content-Type': 'application/json', ...(key ? {Authorization: 'Bearer ' + key} : {})}, body: JSON.stringify(body)});
  const json = await res.json(); if (!res.ok) throw Error(`${url}: ${json.error}`); return json;
};
const phone = {viewport: {width: 390, height: 844}, deviceScaleFactor: 2, isMobile: true, hasTouch: true};
const watch = page => {page.on('pageerror', e => errors.push(`${page.url()}: ${e.message}`)); return page;};

// The app's own screens at http://localhost, as the Android app serves mobile/www (shared code from the source).
const www = path.join(root, 'mobile', 'www'), shared = {'/shared/online-client.js': path.join(root, 'online', 'client.js'), '/shared/achievements.js': path.join(root, 'achievements.js')};
async function appContext() {
  const context = await browser.newContext({...phone, userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36 PubQuizPlayer/0.4.0 (android)'});
  await context.route('http://localhost/**', route => {
    const p = new URL(route.request().url()).pathname, file = shared[p] || path.join(www, p === '/' ? 'index.html' : p);
    if (!existsSync(file)) return route.fulfill({status: 404, body: ''});
    route.fulfill({status: 200, body: readFileSync(file), contentType: {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css'}[path.extname(file)]});
  });
  // This copy of the app points at the test's PubQuiz Online; the quiz page records vibrations.
  await context.addInitScript(url => {
    if (location.host === 'localhost') localStorage.setItem('pq-online:baseUrl', JSON.stringify(url));
    window.vibrations = []; navigator.vibrate = pattern => {window.vibrations.push(pattern); return true;};
  }, online);
  return context;
}

try {
  const host = (await post(base + '/api/login', {key: 'mobile-test-private-key'})).key;
  await post(base + '/api/host/library/save', {revision: 0, quiz: {title: 'Interop', rounds: [{id: 'r1', title: 'Capitals', questions: [{id: 'q1', text: 'Capital of Wales?', type: 'text', seconds: 60, points: 2, answer: 'Cardiff'}]}]}}, host);
  await post(base + '/api/host/settings', {onlineService: online, title: 'Lion Tuesday'}, host);

  const appCtx = await appContext(), app = watch(await appCtx.newPage());
  const webCtx = await browser.newContext({...phone, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'});
  const web = watch(await webCtx.newPage());

  // The app's Play screen: a typed address opens the quiz's player page.
  await app.goto('http://localhost/');
  await app.fill('#address', base.replace('http://', ''));
  await app.click('#addressForm button');
  await app.waitForURL(base + '/').catch(async e => {throw Error(`${e.message}\nstatus: ${await app.locator('#status').textContent()}\nerrors: ${errors.join('; ')}`);});
  assert.equal(await app.locator('#appHome').isVisible(), true);
  assert.equal(await app.locator('#appHome').getAttribute('href'), 'http://localhost/');
  await web.goto(base + '/');
  assert.equal(await web.locator('#appHome').isVisible(), false);
  pass('the app opens a typed quiz address in the same player page browsers use, with a way back to its screens');

  for (const [page, name] of [[app, 'App Foxes'], [web, 'Browser Owls']]) {await page.fill('#name', name); await page.click('#joinButton'); await page.locator('#game').waitFor({state: 'visible'});}
  assert.equal(await app.evaluate(() => window.vibrations.length), 0);
  await post(base + '/api/host/next', {expectedQuestion: null}, host);
  for (const [page, answer] of [[app, 'Cardiff'], [web, 'Swansea']]) {
    await page.locator('#inputs input').first().waitFor({state: 'visible'});
    await page.fill('#inputs input', answer); await page.click('#submit');
    await page.waitForFunction(() => /Final answer saved/.test(document.querySelector('#answerState').textContent));
  }
  assert.deepEqual(await app.evaluate(() => window.vibrations[0]), [120, 60, 120], 'the app vibrates for a new question');
  assert.equal(await web.evaluate(() => window.vibrations?.length ?? 0), 0, 'browsers stay quiet unless switched on');
  await post(base + '/api/host/close', {}, host);
  await post(base + '/api/host/settings', {ended: true}, host);
  const board = await (await fetch(base + '/api/leaderboard')).json();
  assert.deepEqual(board.teams.map(t => [t.name, t.score]), [['App Foxes', 2], ['Browser Owls', 0]]);
  pass('an app team and a browser team play the same question; both are marked by the quiz laptop');

  // The venue registers its quiz laptop with PubQuiz Online so results count.
  const operator = await post(online + '/v1/accounts', {email: 'landlord@example.com', password: 'correct horse battery', displayName: 'Landlord'});
  const venue = await post(online + '/v1/venues', {name: 'The Lion', town: 'Bristol'}, operator.token);
  await post(online + `/v1/venues/${venue.id}/keys`, {publicKey: (await post(base + '/api/host/results', {}, host)).venueKey}, operator.token);

  await app.locator('#keepResult').waitFor({state: 'visible'});
  await app.click('#keepResultButton');
  await app.waitForURL(/^http:\/\/localhost\/$/);
  await app.locator('#profile').waitFor({state: 'visible'});
  await app.waitForFunction(() => /Sign in or create an account/.test(document.querySelector('#status').textContent));
  assert.match(await app.locator('#pending').textContent(), /1 result waiting/);
  await app.fill('#signUpName', 'Sam'); await app.fill('#signUpEmail', 'sam@example.com'); await app.fill('#signUpPassword', 'correct horse battery');
  await app.check('#signUpConsent'); await app.click('#signUpForm button');
  await app.waitForFunction(() => document.querySelector('#stats strong')?.textContent === '1');
  assert.match(await app.locator('#badges').textContent(), /🏅 First Quiz/);
  assert.match(await app.locator('#badges').textContent(), /🏅 First Win/);
  assert.equal(await app.locator('#pending').isVisible(), false);
  pass('the app keeps its team\'s laptop-signed result, then saves it to a new profile: stats and badges appear');

  const opened = webCtx.waitForEvent('page');
  await web.click('#keepResultButton');
  const webApp = watch(await opened);
  await webApp.waitForURL(new RegExp(`^${online}/app/`));
  await webApp.locator('#signUpForm').waitFor({state: 'visible'});
  await webApp.fill('#signUpName', 'Alex'); await webApp.fill('#signUpEmail', 'alex@example.com'); await webApp.fill('#signUpPassword', 'correct horse battery');
  await webApp.check('#signUpConsent'); await webApp.click('#signUpForm button');
  await webApp.waitForFunction(() => document.querySelector('#stats strong')?.textContent === '1');
  assert.doesNotMatch(await webApp.locator('#badges').textContent(), /🏅 First Win/);
  pass('a browser team keeps its result through the PubQuiz Online web app, no install needed');

  // Find a quiz in the app, then offline: the last listing, marked as possibly out of date.
  await post(online + `/v1/venues/${venue.id}/events`, {title: 'Tuesday Quiz', startsAt: Date.now() + 86400000, entry: '£2'}, operator.token);
  await app.click('#tab-find');
  await app.fill('#search', 'Bristol'); await app.click('#searchForm button');
  await app.locator('#events li').first().waitFor();
  assert.match(await app.locator('#events').textContent(), /Tuesday Quiz.*The Lion, Bristol/s);
  await appCtx.setOffline(true);
  await app.click('#searchForm button');
  await app.locator('#findStale').waitFor({state: 'visible'});
  assert.match(await app.locator('#findStale').textContent(), /may have changed/);
  assert.match(await app.locator('#events').textContent(), /Tuesday Quiz/);
  await appCtx.setOffline(false);
  pass('finding quizzes works, and offline it shows the last listing marked as possibly out of date');

  assert.deepEqual(errors, []);
  pass('no JavaScript errors in the app screens, the quiz pages or the web app');
} finally {
  await browser.close(); await quiz.close(); await service.close(); rmSync(dir, {recursive: true, force: true});
}
