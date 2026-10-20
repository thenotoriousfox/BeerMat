import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtempSync, rmSync, readdirSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createQuiz} from '../server.js';

const hostKey = 'a-secure-quiz-test-key';
test('the rehearsal quiz script loads six valid rounds, keeps other rounds and replaces its own on a re-run', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'quiz-testquiz-'));
  const quiz = createQuiz({hostKey, database: path.join(dir, 'quiz.sqlite'), mediaDir: dir});
  await new Promise(r => quiz.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${quiz.server.address().port}`;
  const call = async (route, body = {}, key = '') => (await fetch(`${base}/api/${route}`, {method: 'POST', headers: {Authorization: 'Bearer ' + key}, body: JSON.stringify(body)})).json();
  try {
    const key = (await call('login', {key: hostKey})).key;
    await call('host/library/save', {revision: 0, quiz: {title: 'My quiz', rounds: [{id: 'mine', title: 'My round', questions: [{id: 'm1', type: 'text', text: 'Mine?', seconds: 30, points: 1}]}]}}, key);
    const run = () => promisify(execFile)(process.execPath, ['scripts/load-test-quiz.mjs', base], {env: {...process.env, HOST_KEY: hostKey}});
    await run(); await run();
    const library = await call('host/library', {}, key);
    assert.deepEqual(library.rounds.map(r => r.id), ['mine', ...Array.from({length: 6}, (_, i) => `test-round-${i + 1}`)]);
    assert.equal(library.title, 'My quiz');
    const types = new Set(library.rounds.flatMap(r => r.questions.map(q => q.type)));
    for (const type of ['choice', 'multi', 'letter', 'number', 'sequence', 'text', 'picture', 'audio', 'vote', 'nearest', 'pinpoint', 'wordsnake', 'tiles', 'buzzer', 'clips', 'bingo', 'musicbingo', 'sheet']) assert.ok(types.has(type), type);
    assert.ok(readdirSync(dir).some(f => f.endsWith('.png')) && readdirSync(dir).some(f => f.endsWith('.wav')));
  } finally {await quiz.close(); rmSync(dir, {recursive: true, force: true});}
});
