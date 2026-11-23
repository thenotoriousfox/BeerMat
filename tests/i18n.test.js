import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

globalThis.document = {documentElement: {}};
const {t, setLanguage} = await import('../web/i18n.js');
const source = readFileSync(new URL('../web/i18n.js', import.meta.url), 'utf8');
const dictionary = Function(`return ${/const T = (\{[\s\S]*?\n\});/.exec(source)[1]}`)();
const vars = text => [...text.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join();

test('every phrase has French and Spanish with the same placeholders', () => {
  for (const [english, [fr, es]] of Object.entries(dictionary)) {
    assert.ok(fr && es, english); assert.equal(vars(fr), vars(english), english); assert.equal(vars(es), vars(english), english);
  }
});

test('every translated string used by the phone and TV pages is in the dictionary', () => {
  for (const file of ['client.js', 'app.js']) {
    const code = readFileSync(new URL(`../web/${file}`, import.meta.url), 'utf8');
    for (const [, text] of code.matchAll(/\bt\('((?:[^'\\]|\\.)*)'/g)) assert.ok(text.replace(/\\'/g, "'") in dictionary, `${file}: ${text}`);
  }
  for (const page of ['player.html', 'display.html']) {
    const html = readFileSync(new URL(`../web/${page}`, import.meta.url), 'utf8').replace(/<(script|title)[\s\S]*?<\/\1>/g, '');
    for (const [, text] of html.matchAll(/>([^<]*[A-Za-z][^<]*)</g)) {
      const trimmed = text.trim();
      if (trimmed && !/^(BeerMat|http:\/\/\S+)$/.test(trimmed)) assert.ok(trimmed in dictionary, `${page}: ${trimmed}`);
    }
  }
});

test('t substitutes values and falls back to English', () => {
  setLanguage('fr'); assert.equal(t('Song {n}', {n: 7}), 'Chanson 7'); assert.equal(t('Not in the dictionary'), 'Not in the dictionary');
  setLanguage('es'); assert.equal(t('{n}s remaining', {n: 12}), 'quedan 12 s');
  setLanguage('xx'); assert.equal(t('Leaderboard'), 'Leaderboard');
});
