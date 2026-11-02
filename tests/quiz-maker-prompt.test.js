// docs/QUIZ-MAKER-PROMPT.md is what people hand to a writer (or an AI) to make quiz files. It must keep up with what
// the quiz loader accepts: every question field server/model.js reads is described there, and its example loads.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, mkdtempSync, rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {validateLibrary} from '../server/model.js';

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
