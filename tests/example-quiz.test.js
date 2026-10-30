import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createQuiz} from '../server/server.js';
import {types} from '../server/model.js';
const root = path.join(path.dirname(new URL(import.meta.url).pathname), '..');

const hostKey = 'a-secure-quiz-test-key';
test('the example quiz that ships with BeerMat loads as the desk loads it, and every question opens', async () => {
  const example = JSON.parse(readFileSync(path.join(root, 'examples', 'example-quiz.json'), 'utf8'));
  const questions = example.rounds.flatMap(r => r.questions);
  assert.deepEqual([...new Set(questions.map(q => q.type))].sort(), [...types].sort(), 'one question in every format');
  assert.equal(questions.length, types.length);

  const dir = mkdtempSync(path.join(os.tmpdir(), 'quiz-example-'));
  const quiz = createQuiz({plan: 'pro', hostKey, database: path.join(dir, 'quiz.sqlite'), mediaDir: path.join(dir, 'media')});
  await new Promise(r => quiz.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${quiz.server.address().port}`;
  try {
    const key = (await (await fetch(`${base}/api/login`, {method: 'POST', body: JSON.stringify({key: hostKey})})).json()).key;
    const host = async (route, body = {}) => {const r = await fetch(`${base}/api/host/${route}`, {method: 'POST', headers: {Authorization: 'Bearer ' + key}, body: JSON.stringify(body)}); return {status: r.status, ...await r.json()};};
    // The desk's Quizzes page offers it; the browser desk fetches it from the quiz server.
    const listed = (await host('my-quizzes')).example;
    assert.deepEqual([listed.title, listed.rounds, listed.questions], [example.title, example.rounds.length, questions.length]);
    assert.equal(listed.path, path.join(root, 'examples', 'example-quiz.json'));
    assert.equal((await host('example-quiz')).quiz.title, example.title);
    // The pictures and sounds inside the file are uploaded first (as desk.py's loadQuizConfirmed and host.js's unpackMedia do).
    const extensions = {'image/png': '.png', 'audio/mpeg': '.mp3'};
    for (const holder of questions.flatMap(q => [q, ...(q.clips || []), ...(q.songs || [])])) {
      const match = /^data:([^;]+);base64,(.*)$/s.exec(holder.media || '');
      if (!match) continue;
      assert.ok(extensions[match[1]], match[1]);
      const r = await fetch(`${base}/api/host/media?name=x${extensions[match[1]]}`, {method: 'POST', headers: {Authorization: 'Bearer ' + key}, body: Buffer.from(match[2], 'base64')});
      assert.equal(r.status, 200);
      holder.media = (await r.json()).media;
    }
    assert.equal((await host('new-event', {questions: 'load', quiz: example})).status, 200);
    await host('settings', {waitingRoom: false});
    const saved = (await host('library')).rounds;
    assert.deepEqual(saved.map(r => r.questions.length), example.rounds.map(r => r.questions.length));
    let current = null;
    for (const item of saved.flatMap(r => r.questions)) {
      const opened = await host('next', {expectedQuestion: current});
      assert.ok(opened.id, `${item.type}: ${opened.error}`);
      current = opened.id;
      assert.equal((await host('close', {expectedQuestion: current})).status, 200, item.type);
    }
  } finally {await quiz.close(); rmSync(dir, {recursive: true, force: true});}
});
