// The website's account page (site/src/pages/account.astro) in a real browser, against a local BeerMat Online with a
// stand-in Stripe: a venue's own account signs in, sees its plan, opens the subscription page, saves its details and
// regular nights, adds and cancels a one-off quiz night, removes a laptop and signs out. Phone width too.
// npm run test:features (needs the site built: it builds it first).
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtempSync, rmSync, readFileSync, existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {createService} from '../online/service.js';
const {chromium} = await import(process.env.BEERMAT_PLAYWRIGHT || 'playwright');
const root = path.join(path.dirname(new URL(import.meta.url).pathname), '..'), dist = path.join(root, 'site', 'dist');
execFileSync('npm', ['run', 'build'], {cwd: path.join(root, 'site'), stdio: 'ignore'});
const log = text => console.log('PASS:', text);

// Stripe's customer portal, as far as BeerMat Online is concerned.
const stripeCalls = [];
const fakeStripe = http.createServer(async (req, res) => {
  for await (const _ of req); stripeCalls.push(req.url);
  res.writeHead(200, {'Content-Type': 'application/json'}); res.end(JSON.stringify({url: 'https://billing.stripe.test/session'}));
});
await new Promise(r => fakeStripe.listen(0, '127.0.0.1', r));
// The website, served as Cloudflare would, pointing at the local BeerMat Online.
let onlineUrl = '';
const types = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.webp': 'image/webp', '.png': 'image/png'};
const site = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html'; else if (!path.extname(p)) p += '/index.html';
  const file = path.join(dist, p);
  if (!file.startsWith(dist) || !existsSync(file)) {res.writeHead(404); return res.end();}
  let body = readFileSync(file); if (/\.(html|js)$/.test(p)) body = Buffer.from(body.toString().replaceAll('https://online.beermatquiz.co.uk', onlineUrl));
  res.writeHead(200, {'Content-Type': types[path.extname(p)] || 'application/octet-stream'}); res.end(body);
});
await new Promise(r => site.listen(0, '127.0.0.1', r));
const siteUrl = `http://127.0.0.1:${site.address().port}`;

const dir = mkdtempSync(path.join(os.tmpdir(), 'beermat-account-'));
const service = createService({database: path.join(dir, 'online.sqlite'), allowedOrigins: [siteUrl],
  stripe: {secretKey: 'sk_test_x', webhookSecret: 'whsec_test', prices: {monthly: 'price_m', yearly: 'price_y'}, siteUrl, apiBase: `http://127.0.0.1:${fakeStripe.address().port}`}});
await new Promise(r => service.server.listen(0, '127.0.0.1', r));
onlineUrl = `http://127.0.0.1:${service.server.address().port}`;
const api = async (method, route, body, token) => (await fetch(onlineUrl + route, {method, headers: {'Content-Type': 'application/json', ...(token && {Authorization: 'Bearer ' + token})}, ...(body && {body: JSON.stringify(body)})})).json();
await api('POST', '/v1/accounts', {email: 'landlord@example.com', password: 'correct horse battery', displayName: 'Landlord'});
service.importVenues({venues: [{id: 'red-lion-bristol', name: 'The Red Lion', town: 'Bristol'}]});
const owner = service.db.prepare("SELECT id FROM accounts WHERE email='landlord@example.com'").get().id;
service.db.prepare("UPDATE venues SET owner=?, plan='pro', plan_until=?, stripe_customer='cus_test', founding=1").run(owner, Date.now() + 20 * 86400000);
service.db.prepare('INSERT INTO venue_keys VALUES(?,?,?,?)').run('abcdef1234567890', 'red-lion-bristol', 'MCowBQYDK2VwAyEA' + 'A'.repeat(44), Date.now() - 86400000);

const browser = await chromium.launch();
const errors = [];
try {
  const context = await browser.newContext({viewport: {width: 1280, height: 900}});
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => d.accept());
  await page.goto(siteUrl + '/');
  assert.equal(await page.locator('header a[href="/account"]').first().textContent(), 'Sign in');
  await page.goto(siteUrl + '/account');
  await page.locator('#signIn').waitFor();
  await page.fill('#signIn input[name=email]', 'landlord@example.com'); await page.fill('#signIn input[name=password]', 'wrong password!');
  await page.click('#signIn button'); await page.waitForFunction(() => document.getElementById('status').textContent.length > 0 && !document.getElementById('status').textContent.includes('Signing'));
  assert.ok(await page.locator('#signIn').isVisible(), 'a wrong password stays on the sign-in');
  await page.fill('#signIn input[name=password]', 'correct horse battery'); await page.click('#signIn button');
  await page.locator('[data-name]').waitFor();
  assert.equal(await page.locator('[data-name]').textContent(), 'The Red Lion');
  assert.equal(await page.locator('[data-plan]').textContent(), 'BeerMat Pro');
  assert.match(await page.locator('[data-plan-text]').textContent(), /founding price.*paid until/);
  assert.ok(await page.locator('[data-billing]').isVisible()); assert.ok(!(await page.locator('[data-get-pro]').isVisible()));
  if (process.env.BEERMAT_SHOTS) await page.screenshot({path: path.join(process.env.BEERMAT_SHOTS, 'site-account.png'), fullPage: true});
  log('the venue’s own account signs in and sees its plan, founding price and renewal');

  await page.route('https://billing.stripe.test/**', route => route.fulfill({status: 200, body: 'Stripe'}));
  await Promise.all([page.waitForURL('https://billing.stripe.test/session'), page.click('[data-billing]')]);
  assert.ok(stripeCalls.some(c => c.startsWith('/v1/billing_portal/sessions')));
  log('Manage subscription opens Stripe’s page for the venue');

  await page.goto(siteUrl + '/account'); await page.locator('[data-name]').waitFor();
  await page.fill('[data-details] input[name=town]', 'Clifton');
  await page.check('[data-details] input[name=on-tuesday]'); await page.fill('[data-details] input[name=time-tuesday]', '19:30');
  await page.click('[data-details] button');
  await page.waitForFunction(() => /^Saved|[A-Z].*(must|Give|Invalid|went wrong)/.test(document.getElementById('status').textContent) && !document.getElementById('status').textContent.startsWith('Saving'));
  assert.match(await page.locator('#status').textContent(), /^Saved/);
  const venue = service.db.prepare("SELECT town, quiz_nights FROM venues WHERE id='red-lion-bristol'").get();
  assert.deepEqual([venue.town, JSON.parse(venue.quiz_nights)], ['Clifton', [{day: 'tuesday', time: '19:30'}]]);
  log('details and regular nights save to BeerMat Online');

  await page.click('summary:text("Add a one-off quiz night")');
  const day = new Date(Date.now() + 9 * 86400000).toISOString().slice(0, 10);
  await page.fill('[data-event] input[name=title]', 'Halloween special'); await page.fill('[data-event] input[name=date]', day);
  await page.click('[data-event] button');
  await page.locator('[data-events] li', {hasText: 'Halloween special'}).waitFor();
  await page.locator('[data-events] li', {hasText: 'Halloween special'}).locator('button').click();
  await page.waitForFunction(() => document.getElementById('status').textContent === 'Cancelled.');
  assert.equal(service.db.prepare("SELECT cancelled FROM events WHERE title='Halloween special'").get().cancelled, 1);
  log('a one-off quiz night is added, listed and cancelled');

  assert.match(await page.locator('[data-laptops]').textContent(), /Laptop abcdef12/);
  await page.locator('[data-laptops] button').click();
  await page.waitForFunction(() => document.getElementById('status').textContent === 'Removed.');
  assert.equal(service.db.prepare('SELECT COUNT(*) n FROM venue_keys').get().n, 0);
  log('a registered laptop is listed and can be removed');

  const phone = await context.newPage(); await phone.setViewportSize({width: 390, height: 844});
  phone.on('pageerror', e => errors.push(e.message));
  await phone.goto(siteUrl + '/account'); await phone.locator('[data-name]').waitFor();
  assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no sideways scroll on a phone');
  if (process.env.BEERMAT_SHOTS) await phone.screenshot({path: path.join(process.env.BEERMAT_SHOTS, 'site-account-phone.png'), fullPage: true});
  log('signed in on this browser, and it fits a phone');

  await page.click('#signOut'); await page.locator('#signIn').waitFor();
  await page.reload(); await page.locator('#signIn').waitFor();
  assert.ok(!(await page.locator('#signedIn').isVisible()));
  log('Sign out forgets the sign-in');
  assert.deepEqual(errors, []);
  log('no JavaScript errors');
} finally {
  await browser.close(); await service.close(); site.close(); fakeStripe.close(); rmSync(dir, {recursive: true, force: true});
}
