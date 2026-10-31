import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtempSync, rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createQuiz} from '../server/server.js';

const hostKey = 'a-secure-tv-screen-test-key';
test('a TV screen names itself on its stream; the desk sees it and sends its playback there', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'quiz-screen-'));
  const quiz = createQuiz({plan: 'pro', hostKey, database: path.join(dir, 'quiz.sqlite'), mediaDir: path.join(dir, 'media')});
  await new Promise(r => quiz.server.listen(0, '127.0.0.1', r));
  const port = quiz.server.address().port, base = `http://127.0.0.1:${port}`;
  const key = (await (await fetch(`${base}/api/login`, {method: 'POST', body: JSON.stringify({key: hostKey})})).json()).key;
  const host = async (route, body = {}) => {const r = await fetch(`${base}/api/host/${route}`, {method: 'POST', headers: {Authorization: 'Bearer ' + key}, body: JSON.stringify(body)}); return {status: r.status, ...await r.json()};};
  const wait = async (check, what) => {for (let i = 0; i < 50; i++) {if (await check()) return; await new Promise(r => setTimeout(r, 40));} assert.fail(what);};
  let stream;
  try {
    assert.deepEqual((await host('state')).tvScreens, []);
    // The TV computer's stream, as BeerMat's TV screen mode opens it (no team key: the room's view only).
    stream = http.get(`${base}/api/events?screen=${encodeURIComponent('Bar TV <b>')}`);
    await wait(async () => (await host('state')).tvScreens.length === 1, 'the screen to show');
    assert.deepEqual((await host('state')).tvScreens, ['Bar TV b'], 'named, without markup');
    // The desk's own playback goes out in the TV's state.
    assert.equal((await host('playback', {action: 'play', media: '/media/abc.mp3', position: 1500})).screens, 1);
    let tv = await (await fetch(`${base}/api/leaderboard`)).json();
    assert.deepEqual({...tv.playback, at: 0}, {seq: 1, action: 'play', media: '/media/abc.mp3', position: 1500, at: 0});
    await host('playback', {action: 'pause', media: '/media/abc.mp3'});
    tv = await (await fetch(`${base}/api/leaderboard`)).json();
    assert.equal(tv.playback.seq, 2); assert.equal(tv.playback.action, 'pause');
    assert.equal((await host('playback', {action: 'play', media: '/etc/passwd'})).status, 400, 'only the quiz’s own files');
    assert.equal((await host('playback', {action: 'shout', media: '/media/abc.mp3'})).status, 400);
    assert.equal((await (await fetch(`${base}/api/state`, {method: 'POST', body: '{}'})).json()).playback, undefined, 'phones don’t get it');
    stream.destroy();
    await wait(async () => (await host('state')).tvScreens.length === 0, 'the screen to go when it disconnects');
  } finally {stream?.destroy(); await quiz.close(); rmSync(dir, {recursive: true, force: true});}
});
