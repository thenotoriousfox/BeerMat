// Video questions: an MP4 or WebM plays on the TV (phones say to watch it); the desk replays or stops it on every TV.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createQuiz} from '../server/server.js';
import {validateQuestion} from '../server/model.js';

const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(16)]);

test('uploads, checks, and the TVs follow Play again and Stop', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'quiz-video-'));
  writeFileSync(path.join(dir, 'clip.mp4'), mp4); writeFileSync(path.join(dir, 'song.mp3'), 'ID3');
  assert.equal(validateQuestion({text: 'Q', type: 'video', seconds: 30, points: 1, media: '/media/clip.mp4', answer: 'Green'}, dir).media, '/media/clip.mp4');
  assert.throws(() => validateQuestion({text: 'Q', type: 'video', seconds: 30, points: 1, media: '/media/song.mp3', answer: 'x'}, dir), /does not match/);
  assert.throws(() => validateQuestion({text: 'Q', type: 'text', seconds: 30, points: 1, media: '/media/clip.mp4', answer: 'x'}, dir), /does not match/, 'a video only on a video question');
  const quiz = createQuiz({plan: 'pro', hostKey: 'video-test-key', database: path.join(dir, 'q.sqlite'), mediaDir: dir, packDir: path.join(dir, 'x'), soundsDir: path.join(dir, 'x')});
  await new Promise(r => quiz.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${quiz.server.address().port}`;
  const call = async (route, body = {}, key = route.startsWith('host/') ? host : '') => {
    const r = await fetch(`${base}/api/${route}`, {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + key}, body: JSON.stringify(body)});
    return {status: r.status, ...await r.json()};
  };
  const host = (await call('login', {key: 'video-test-key'})).key;
  try {
    const upload = (name, body) => fetch(`${base}/api/host/media?name=${name}`, {method: 'POST', headers: {Authorization: 'Bearer ' + host}, body}).then(async r => ({status: r.status, ...await r.json()}));
    const {media} = await upload('clip.mp4', mp4);
    assert.match(media, /^\/media\/[a-f0-9]+\.mp4$/);
    assert.equal((await upload('fake.mp4', Buffer.from('not a video at all'))).status, 400, 'checked by its content');
    const served = await fetch(base + media, {headers: {Range: 'bytes=0-7'}});
    assert.deepEqual([served.status, served.headers.get('content-type')], [206, 'video/mp4'], 'served in parts, as video players ask');
    await call('host/settings', {waitingRoom: false});
    const team = await call('join', {name: 'Owls'});
    const {id} = await call('host/open', {text: 'Which colour came second?', type: 'video', seconds: 30, points: 1, media, answer: 'Green'});
    assert.deepEqual((await call('state', {}, team.secret)).question.videoCue, {seq: 0, action: 'play'}, 'plays as it opens');
    await call('host/video', {question: id, action: 'play'});
    assert.deepEqual((await call('state', {}, team.secret)).question.videoCue, {seq: 1, action: 'play'});
    await call('host/video', {question: id, action: 'stop'});
    assert.deepEqual((await call('state', {}, team.secret)).question.videoCue, {seq: 2, action: 'stop'});
    assert.equal((await call('host/video', {question: id, action: 'rewind'})).status, 400);
    await call('answer', {question: id, value: 'green'}, team.secret); await call('host/close', {expectedQuestion: id});
    assert.equal((await call('state', {}, team.secret)).answer.points, 1);
  } finally {await quiz.close(); rmSync(dir, {recursive: true, force: true});}
});
