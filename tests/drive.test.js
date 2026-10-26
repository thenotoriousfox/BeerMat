import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {driveFileId, fetchDriveQuiz} from '../drive.js';
import {createQuiz} from '../server.js';

const id = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345';
const quiz = {title: 'From Drive', rounds: [{id: 'r1', title: 'Final', secret: true, questions: [{id: 'q1', type: 'text', text: 'Capital of Wales?', seconds: 30, points: 1, answer: 'Cardiff'}]}]};
const reply = (body, {status = 200, type = 'application/json'} = {}) => new Response(typeof body === 'string' ? body : JSON.stringify(body), {status, headers: {'content-type': type}});

test('Drive links of every usual shape give the file id; anything else is refused', () => {
  for (const link of [`https://drive.google.com/file/d/${id}/view?usp=sharing`, `https://drive.google.com/file/d/${id}`, `https://drive.google.com/open?id=${id}`,
    `https://drive.google.com/uc?id=${id}&export=download`, `https://drive.usercontent.google.com/download?id=${id}&export=download`, ` https://drive.google.com/file/d/${id}/view `]) assert.equal(driveFileId(link), id, link);
  for (const link of ['', 'not a link', `http://drive.google.com/file/d/${id}/view`, `https://evil.example/file/d/${id}/view`, `https://drive.google.com.evil.example/file/d/${id}`,
    'https://drive.google.com/file/d/../../etc/view', 'https://drive.google.com/drive/folders/']) assert.equal(driveFileId(link), null, link);
});

test('a Drive quiz file downloads from Google only; private files, missing files and non-quiz files say why', async () => {
  const asked = [];
  const drive = answer => async (url, options) => {asked.push(url); assert.ok(options.signal); return answer();};
  assert.deepEqual(await fetchDriveQuiz(`https://drive.google.com/file/d/${id}/view`, drive(() => reply(quiz))), quiz);
  assert.equal(asked[0], `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`);
  const fails = async (answer, pattern, status) => {
    await assert.rejects(fetchDriveQuiz(`https://drive.google.com/file/d/${id}/view`, drive(answer)), e => pattern.test(e.message) && e.status === status);
  };
  await fails(() => reply('<html>Sign in</html>', {type: 'text/html; charset=utf-8'}), /Anyone with the link/, 403);
  await fails(() => reply('<html>No access</html>', {status: 403, type: 'text/html'}), /Anyone with the link/, 403);
  await fails(() => reply('gone', {status: 404, type: 'text/plain'}), /no file/, 404);
  await fails(() => reply('{"broken', {type: 'application/octet-stream'}), /not a quiz JSON/, 400);
  await fails(() => {throw TypeError('fetch failed');}, /online/, 502);
  await fails(() => new Response(new Uint8Array(51 * 1024 * 1024), {headers: {'content-type': 'application/json'}}), /50 MB/, 413);
  await assert.rejects(fetchDriveQuiz('https://example.com/quiz.json', drive(() => reply(quiz))), /not a Google Drive file link/);
  assert.equal(asked.length, 7);
});

test('the desk route fetches a Drive quiz for the quizmaster only', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'quiz-drive-')), hostKey = 'a-secure-quiz-test-key';
  const quizServer = createQuiz({hostKey, database: path.join(dir, 'quiz.sqlite'), mediaDir: dir, packDir: path.join(dir, 'none'), soundsDir: path.join(dir, 'none'), fetchImpl: async () => reply(quiz)});
  await new Promise(r => quizServer.server.listen(0, '127.0.0.1', r));
  const call = async (route, body, key = '') => {
    const response = await fetch(`http://127.0.0.1:${quizServer.server.address().port}/api/${route}`, {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + key}, body: JSON.stringify(body)});
    return {status: response.status, ...await response.json()};
  };
  try {
    assert.equal((await call('host/drive', {url: `https://drive.google.com/file/d/${id}/view`})).status, 403);
    const host = (await call('login', {key: hostKey})).key;
    const got = await call('host/drive', {url: `https://drive.google.com/file/d/${id}/view`}, host);
    assert.equal(got.status, 200); assert.deepEqual(got.quiz, quiz);
    assert.equal((await call('host/drive', {url: 'https://example.com/x'}, host)).status, 400);
    // The secret round survives loading.
    assert.equal((await call('host/new-event', {questions: 'load', quiz: got.quiz}, host)).status, 200);
    assert.equal((await call('host/library', {}, host)).rounds[0].secret, true);
  } finally {await quizServer.close(); rmSync(dir, {recursive: true, force: true});}
});
