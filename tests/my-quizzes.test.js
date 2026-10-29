// My quizzes: the laptop keeps a copy of every quiz it has had (my-quizzes/ in its data folder, named after the quiz's
// title) whenever the quiz is saved and before another takes its place, so a new, cleared or loaded quiz never loses
// one; the Quizzes page lists them with the quiz library's downloads, and deletes one.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createQuiz} from '../server/server.js';

const question = text => ({id: 'q' + Math.random().toString(36).slice(2, 8), text, type: 'choice', seconds: 30, points: 1, options: ['A', 'B'], answer: 'A'});
const quiz = (title, ...texts) => ({title, rounds: [{id: 'r1', title: 'Round 1', questions: texts.map(question)}]});

test('my quizzes: kept on save and before another quiz replaces it; listed and deleted', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'my-quizzes-'));
  const server = createQuiz({hostKey: 'a-secure-quiz-test-key', database: path.join(dir, 'quiz.sqlite'), mediaDir: path.join(dir, 'media'), packDir: dir, soundsDir: dir, plan: 'pro'});
  await new Promise(r => server.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.server.address().port}`;
  const host = (await (await fetch(base + '/api/login', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({key: 'a-secure-quiz-test-key'})})).json()).key;
  const call = async (route, body = {}) => {
    const response = await fetch(`${base}/api/host/${route}`, {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + host}, body: JSON.stringify(body)});
    return {status: response.status, ...await response.json()};
  };
  const mine = async () => (await call('my-quizzes')).mine.map(q => [q.file, q.title, q.questions]);
  try {
    assert.deepEqual(await mine(), [], 'an empty quiz isn’t kept');
    // Saving keeps it, named after its title; saving again updates the same file.
    await call('library/save', {revision: 0, quiz: quiz('Pub Classics', 'One?')});
    assert.deepEqual(await mine(), [['pub-classics.json', 'Pub Classics', 1]]);
    await call('library/save', {revision: 1, quiz: quiz('Pub Classics', 'One?', 'Two?')});
    assert.deepEqual(await mine(), [['pub-classics.json', 'Pub Classics', 2]]);
    const kept = JSON.parse(readFileSync(path.join(dir, 'my-quizzes', 'pub-classics.json'), 'utf8'));
    assert.equal(kept.revision, undefined);
    assert.equal(kept.rounds[0].questions[1].text, 'Two?');

    // Loading another quiz keeps the one it replaces (as it was, unsaved edits aside), and the new one is kept when saved.
    assert.equal((await call('new-event', {questions: 'load', quiz: quiz('Halloween Night', 'Boo?')})).status, 200);
    assert.deepEqual((await mine()).map(q => q[0]).sort(), ['pub-classics.json']);
    // Clearing (a new, empty quiz) keeps the one it replaces too.
    assert.equal((await call('new-event', {questions: 'empty'})).status, 200);
    assert.deepEqual((await mine()).map(q => q[0]).sort(), ['halloween-night.json', 'pub-classics.json']);
    assert.equal((await call('library')).rounds.length, 0);
    assert.equal((await call('new-event', {questions: 'empty'})).status, 200, 'clearing an empty quiz');
    assert.deepEqual((await mine()).length, 2, 'keeps nothing new');

    // A kept quiz loads again as it was.
    const [halloween] = (await call('my-quizzes')).mine.filter(q => q.file === 'halloween-night.json');
    assert.equal(halloween.path, path.join(dir, 'my-quizzes', 'halloween-night.json'));
    assert.equal((await call('new-event', {questions: 'load', quiz: JSON.parse(readFileSync(halloween.path, 'utf8'))})).status, 200);
    assert.equal((await call('library')).title, 'Halloween Night');

    // Downloads from the quiz library are listed apart; any of them can be deleted; nothing outside the folders.
    mkdirSync(path.join(dir, 'quiz-library'));
    writeFileSync(path.join(dir, 'quiz-library', 'q-0123456789.json'), JSON.stringify(quiz('From the library', 'X?', 'Y?')));
    writeFileSync(path.join(dir, 'quiz-library', 'q-broken0000.json'), '{not json');
    const listed = await call('my-quizzes');
    assert.deepEqual(listed.downloaded.map(q => [q.file, q.title, q.questions]), [['q-0123456789.json', 'From the library', 2]], 'a broken file is left out');
    assert.equal(listed.folder, path.join(dir, 'my-quizzes'));
    assert.equal((await call('my-quizzes/delete', {kind: 'downloaded', file: 'q-0123456789.json'})).status, 200);
    assert.equal((await call('my-quizzes/delete', {file: 'pub-classics.json'})).status, 200);
    assert.ok(!existsSync(path.join(dir, 'my-quizzes', 'pub-classics.json')));
    for (const file of ['../quiz.sqlite', 'missing.json', 'Pub Classics.json', null]) assert.equal((await call('my-quizzes/delete', {file})).status, 400, String(file));
    assert.ok(existsSync(path.join(dir, 'quiz.sqlite')));
  } finally {await server.close(); rmSync(dir, {recursive: true, force: true});}
});
