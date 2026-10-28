// A quiz server for the native clients' integration tests (native/android, native/ios): the real engine with a fixed
// plan (as the Node tests use) and a small quiz, in a temporary folder. Prints one JSON line {port, hostKey} when ready
// and stops when its input closes.
//   node tests/fixtures/serve.mjs pro|free [full] [--bind 0.0.0.0] [--port n]
// `full` loads scripts/load-test-quiz.mjs instead: six rounds using every format.
import {mkdtempSync, rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createQuiz} from '../../server/server.js';

const plan = process.argv[2] === 'pro' ? 'pro' : 'free', hostKey = 'native-client-test-key-0123';
const dir = mkdtempSync(path.join(os.tmpdir(), 'beermat-native-'));
const quiz = createQuiz({plan, hostKey, database: path.join(dir, 'quiz.sqlite'), mediaDir: path.join(dir, 'media'), packDir: dir, soundsDir: dir});
const arg = name => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null;
await new Promise(r => quiz.server.listen(Number(arg('--port') || 0), arg('--bind') || '127.0.0.1', r));
const port = quiz.server.address().port, base = `http://127.0.0.1:${port}`;
const post = async (route, body, key) => (await fetch(base + route, {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + key}, body: JSON.stringify(body)})).json();
const host = (await post('/api/login', {key: hostKey})).key;
if (process.argv.includes('full')) {
  // Asynchronously: the loader talks to this same server.
  const {execFile} = await import('node:child_process');
  await new Promise((resolve, reject) => execFile('node', [path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'scripts', 'load-test-quiz.mjs'), base],
    {env: {...process.env, HOST_KEY: hostKey}}, e => e ? reject(e) : resolve()));
} else await post('/api/host/library/save', {revision: 0, quiz: {title: 'Native test quiz', rounds: [{id: 'r1', title: 'Round one', questions: [
  {id: 'q1', type: 'choice', text: 'Which planet is known as the Red Planet?', options: ['Venus', 'Mars', 'Jupiter', 'Saturn'], answer: 'Mars', seconds: 60, points: 1},
  {id: 'q2', type: 'sequence', text: 'Smallest first', items: ['One', 'Two', 'Three'], seconds: 60, points: 2},
  {id: 'q3', type: 'text', text: 'Capital of France?', answer: 'Paris', seconds: 60, points: 1},
]}]}}, host);
await post('/api/host/settings', {waitingRoom: false}, host);
console.log(JSON.stringify({port, hostKey: host}));
process.stdin.resume();
process.stdin.on('end', async () => {await quiz.close(); rmSync(dir, {recursive: true, force: true}); process.exit(0);});
