// The client protocol (docs/CLIENT-PROTOCOL.md): what the browser player, the native desk and the native phone apps
// rely on. Discovery says what a server is; every state carries the protocol version; a phone joining a Free laptop's
// rehearsal is told so at join and in its state, and every gameplay route refuses it with 403.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createQuiz} from '../server/server.js';

async function quizServer(plan) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'quiz-protocol-'));
  const quiz = createQuiz({plan, hostKey: 'protocol-test-key-0123', database: path.join(dir, 'quiz.sqlite'), mediaDir: path.join(dir, 'media'), packDir: dir, soundsDir: dir});
  await new Promise(r => quiz.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${quiz.server.address().port}`;
  const post = async (route, body = {}, key = '') => {
    const res = await fetch(base + route, {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + key}, body: JSON.stringify(body)});
    return {status: res.status, ...await res.json().catch(() => ({}))};
  };
  const host = (await post('/api/login', {key: 'protocol-test-key-0123'})).key;
  return {base, post, host, close: async () => {await quiz.close(); rmSync(dir, {recursive: true, force: true});}};
}

test('discovery and protocol version on every state', async () => {
  const {base, post, host, close} = await quizServer('pro');
  try {
    const hello = await (await fetch(base + '/api/hello')).json();
    assert.deepEqual({app: hello.app, protocol: hello.protocol, rehearsal: hello.rehearsal, open: hello.registrationOpen}, {app: 'BeerMat', protocol: 1, rehearsal: false, open: true});
    assert.equal(typeof hello.build, 'string');
    const team = await post('/api/join', {name: 'Protocol Pals'});
    assert.equal(team.status, 200); assert.equal(team.rehearsal, undefined);
    assert.equal((await post('/api/state', {}, team.secret)).protocol, 1);
    assert.equal((await post('/api/host/state', {}, host)).protocol, 1);
  } finally {await close();}
});

test('a phone joining a rehearsal is a test device, refused every gameplay route', async () => {
  const {base, post, close} = await quizServer('free');
  try {
    assert.equal((await (await fetch(base + '/api/hello')).json()).rehearsal, true);
    const phone = await post('/api/join', {name: 'Test Phone'});
    assert.equal(phone.rehearsal, true);
    const state = await post('/api/state', {}, phone.secret);
    assert.equal(state.protocol, 1); assert.equal(state.rehearsal.device, true); assert.equal(state.question, null);
    for (const route of ['/api/answer', '/api/buzz', '/api/agree', '/api/draft', '/api/bingo', '/api/tap', '/api/gowide', '/api/fifty', '/api/team/result'])
      assert.equal((await post(route, {}, phone.secret)).status, 403, route);
  } finally {await close();}
});
