// docs/QUIZ-MAKER-PROMPT.md is what people hand to a writer (or an AI) to make quiz files. It must keep up with what
// the quiz loader accepts: every question field server/model.js reads is described there, and its example loads.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, mkdtempSync, rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {validateLibrary, types, speedTypes, autoMarked} from '../server/model.js';

const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const doc = read('docs/QUIZ-MAKER-PROMPT.md');
// Fields the server makes or keeps for itself, never written in a quiz file.
const internal = new Set(['round', 'onTheFly', 'fixedSix', 'tiles', 'snake', 'pieces']);

test('every question field the loader reads is in the quiz maker prompt', () => {
  const fields = new Set([...read('server/model.js').matchAll(/\bq\.([a-zA-Z]+)/g)].map(m => m[1]));
  // Named as code: `field`, `field: true` or "field" (in an example).
  const missing = [...fields].filter(f => !internal.has(f) && !new RegExp(`[\`"]${f}[\`":]`).test(doc));
  assert.deepEqual(missing, []);
});

test('the prompt’s example quiz loads', () => {
  const json = doc.match(/## Example\s+```json\n([\s\S]*?)\n```/)[1];
  const dir = mkdtempSync(path.join(os.tmpdir(), 'quiz-prompt-'));
  try {
    const quiz = validateLibrary(JSON.parse(json), dir);
    assert.ok(quiz.rounds.flatMap(r => r.questions).length >= 10);
  } finally {rmSync(dir, {recursive: true, force: true});}
});

// Which formats an option works on: the prompt's lists are the loader's.
const listed = sentence => sentence.replace(/,? and /g, ', ').split(/,\s*/).map(x => x.trim()).filter(Boolean).sort();
test('the prompt lists the formats speed bonuses and Risk It work on, as the loader does', () => {
  assert.deepEqual(listed(doc.match(/`speedBonus` is allowed on: ([^.]+)\./)[1]), [...speedTypes].sort());
  const [always, withAnswer] = [...doc.matchAll(/only work on questions BeerMat can mark by itself\. Those are:\n- ([^;]+);\n- ([^,]+(?:, [^,]+)*), but only when they have an `answer`/g)][0].slice(1);
  assert.deepEqual(listed(always), types.filter(t => autoMarked({type: t})).sort());
  assert.deepEqual(listed(withAnswer), types.filter(t => !autoMarked({type: t}) && autoMarked({type: t, answer: 'x'})).sort());
});
