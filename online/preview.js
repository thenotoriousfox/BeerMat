// A shared theme's browser preview: a phone's browser playing a quiz in the theme, as teams see it. The real quiz
// engine (server/server.js) runs in a temporary folder with the theme installed, a team joins, a sample question opens
// in the theme's look, and Playwright's Chromium photographs a phone-sized page. Used by service.js when this server
// has Chromium (npx playwright install chromium); browserPreview() fails otherwise and the service runs without it.
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createQuiz} from '../server/server.js';
import {checkTheme} from '../shared/theme-bundle.js';

export async function browserPreview() {
  const {chromium} = await import('playwright');
  const probe = await chromium.launch(); await probe.close();   // fails now, at start-up, if Chromium isn't there
  return async bundle => {
    const theme = checkTheme(bundle), dir = mkdtempSync(path.join(os.tmpdir(), 'beermat-preview-'));
    const hostKey = 'theme-preview-key-' + Math.random().toString(36).slice(2, 10);
    for (const [file, bytes] of theme.files) {mkdirSync(path.dirname(path.join(dir, 'my-themes', theme.id, file)), {recursive: true}); writeFileSync(path.join(dir, 'my-themes', theme.id, file), bytes);}
    const quiz = createQuiz({plan: 'pro', hostKey, database: path.join(dir, 'quiz.sqlite'), mediaDir: path.join(dir, 'media'), packDir: dir, soundsDir: dir, myThemesDir: path.join(dir, 'my-themes')});
    let browser;
    try {
      await new Promise(r => quiz.server.listen(0, '127.0.0.1', r));
      const base = `http://127.0.0.1:${quiz.server.address().port}`;
      const post = async (route, body, key = '') => (await fetch(base + route, {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + key}, body: JSON.stringify(body)})).json();
      const host = (await post('/api/login', {key: hostKey})).key;
      await post('/api/host/settings', {title: theme.name, look: theme.id, waitingRoom: false, teamPhotos: false}, host);
      const team = await post('/api/join', {name: 'The Quizzly Bears'});
      await post('/api/host/open', {type: 'choice', text: 'Which planet is known as the Red Planet?', options: ['Venus', 'Mars', 'Jupiter', 'Saturn'], answer: 'Mars', seconds: 60, points: 1}, host);
      browser = await chromium.launch();
      const page = await (await browser.newContext({viewport: {width: 390, height: 844}, deviceScaleFactor: 2, isMobile: true, hasTouch: true})).newPage();
      await page.addInitScript(secret => {try {localStorage.setItem('beermat-team', secret);} catch {}}, team.secret);
      await page.goto(base + '/'); await page.locator('#game').waitFor({timeout: 15000}); await page.waitForTimeout(1500);
      return await page.screenshot({type: 'jpeg', quality: 85});
    } finally {
      await browser?.close(); await quiz.close(); rmSync(dir, {recursive: true, force: true});
    }
  };
}
