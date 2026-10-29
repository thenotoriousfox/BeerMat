// A native app hands its team to the browser player for a round it doesn't draw itself: /#team=<recovery code> opens
// the player page signed in as that team, and the code leaves the address bar at once. npm run test:handover
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createQuiz} from '../server/server.js';
const {chromium} = await import(process.env.BEERMAT_PLAYWRIGHT || 'playwright');

const dir = mkdtempSync(path.join(os.tmpdir(), 'beermat-handover-'));
const quiz = createQuiz({plan: 'pro', database: path.join(dir, 'quiz.sqlite'), mediaDir: path.join(dir, 'media'), packDir: dir, soundsDir: dir, hostKey: 'handover-browser-key'});
await new Promise(r => quiz.server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${quiz.server.address().port}`;
const browser = await chromium.launch(), errors = [];
try {
  const joined = await (await fetch(base + '/api/join', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({name: 'App Handover'})})).json();
  const page = await (await browser.newContext()).newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${base}/#team=${joined.secret}`);
  await page.locator('#team', {hasText: 'App Handover'}).waitFor();
  assert.equal(new URL(page.url()).hash, '', 'the recovery code is removed from the address');
  assert.equal(await page.evaluate(() => localStorage.getItem('beermat-team')), joined.secret);
  console.log('PASS: #team=<code> opens the player page as that team and clears the address');
  const other = await (await browser.newContext()).newPage();
  await other.goto(`${base}/#team=not-a-code`);
  await other.locator('#join').waitFor();
  assert.equal(await other.evaluate(() => localStorage.getItem('beermat-team')), null);
  console.log('PASS: anything else in the fragment is ignored');
  assert.deepEqual(errors, []);
} finally {
  await browser.close(); await quiz.close(); rmSync(dir, {recursive: true, force: true});
}
