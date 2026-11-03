// Ordering audio clips: a put in order question with a clip per item; the desk plays them in the order phones show
// the items, and phones and the TV see which item's clip is playing (the clips themselves stay hidden).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createQuiz} from '../server/server.js';
import {validateQuestion} from '../server/model.js';

const dir = mkdtempSync(path.join(os.tmpdir(), 'quiz-ordering-'));
for (const n of ['a', 'b', 'c']) writeFileSync(path.join(dir, `${n}.mp3`), 'ID3');
const base = {text: 'Put these songs in order of release, earliest first.', type: 'sequence', seconds: 90, points: 2,
  items: ['Hey Jude', 'Wonderwall', 'Bad Guy'], clips: [{media: '/media/a.mp3'}, {media: '/media/b.mp3'}, {spotify: 'spotify:track:2M9ro2krNb7nr7HSprkEgo', start: 30}]};

test('a clip for each item, in the same order', () => {
  const q = validateQuestion(base, dir);
  assert.deepEqual([q.clips.length, q.clipSeconds, q.clips[2].start], [3, 15, 30]);
  assert.throws(() => validateQuestion({...base, clips: base.clips.slice(0, 2)}, dir), /a clip for each item/);
  assert.equal(validateQuestion({...base, clips: []}, dir).clips, undefined, 'clips are optional');
});

test('played: the desk logs each clip; phones see which item is playing, not the clips', async () => {
  const quiz = createQuiz({plan: 'pro', hostKey: 'ordering-clips-test-key', database: path.join(dir, 'q.sqlite'), mediaDir: dir, packDir: path.join(dir, 'x'), soundsDir: path.join(dir, 'x')});
  await new Promise(r => quiz.server.listen(0, '127.0.0.1', r));
  const call = async (route, body = {}, key = route.startsWith('host/') ? host : '') => {
    const r = await fetch(`http://127.0.0.1:${quiz.server.address().port}/api/${route}`, {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + key}, body: JSON.stringify(body)});
    return {status: r.status, ...await r.json()};
  };
  const host = (await call('login', {key: 'ordering-clips-test-key'})).key;
  try {
    await call('host/settings', {waitingRoom: false});
    const team = await call('join', {name: 'Owls'});
    const {id} = await call('host/open', base);
    let seen = (await call('state', {}, team.secret)).question;
    assert.deepEqual([seen.hasClips, seen.clips, seen.nowPlaying], [true, undefined, undefined]);
    assert.equal((await call('host/state')).question.clips.length, 3, 'the desk has them');
    assert.equal((await call('host/clip', {question: id, clip: 1})).status, 200);
    seen = (await call('state', {}, team.secret)).question;
    assert.equal(seen.nowPlaying, 'Wonderwall');
    await call('host/clip', {question: id, clip: -1});
    assert.equal((await call('state', {}, team.secret)).question.nowPlaying, undefined, 'between clips');
  } finally {await quiz.close(); rmSync(dir, {recursive: true, force: true});}
});
