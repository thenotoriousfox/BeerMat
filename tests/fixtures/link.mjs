// For the Qt desk's quizmaster-device tests (native/tests/test_link.py): a BeerMat Online that signs tickets, an
// account on it, and another quiz laptop ("the bar") signed in to that account, running a quiz, reachable on this
// computer's network. Prints one JSON line when ready: {online, email, password, bar: {base, host, title}}; stops when
// its input closes. Lines on its input: "away?" answers {away} (the bar's desk elsewhere, by name or null); "restart"
// restarts the bar's quiz server on a new address and answers {base, host}.
import {mkdtempSync, rmSync} from 'node:fs';
import {generateKeyPairSync} from 'node:crypto';
import {createInterface} from 'node:readline';
import path from 'node:path';
import os from 'node:os';
import {createService} from '../../online/service.js';
import {createQuiz} from '../../server/server.js';

const dir = mkdtempSync(path.join(os.tmpdir(), 'beermat-link-'));
const {privateKey, publicKey} = generateKeyPairSync('ed25519');
const service = createService({database: path.join(dir, 'online.sqlite'), licenceKey: privateKey.export({type: 'pkcs8', format: 'der'}).toString('base64')});
await new Promise(r => service.server.listen(0, '127.0.0.1', r));
const online = `http://127.0.0.1:${service.server.address().port}`;
const hostKey = 'a-secure-link-fixture-key', email = 'host@example.com', password = 'correct horse battery';
// Its quizmaster link isn't a real tunnel: devices here reach it at its address on this computer's network.
const laptop = {wifi: async () => ({running: null}), status: async () => ({wifi: {available: false}, jobs: {}, online: null, cloudflared: true, setup: {}}),
  link: () => ({url: 'https://bar-link.invalid', ready: true, error: ''}), linkUp() {}, linkDown() {}};
const make = () => createQuiz({plan: 'pro', hostKey, database: path.join(dir, 'bar.sqlite'), mediaDir: dir, packDir: dir, soundsDir: dir, laptop,
  licenceKey: publicKey.export({type: 'spki', format: 'der'}).toString('base64')});
let quiz = make();
await new Promise(r => quiz.server.listen(0, '0.0.0.0', r));
let base = `http://127.0.0.1:${quiz.server.address().port}`;
const post = async (url, body, key) => (await fetch(url, {method: 'POST', headers: {'Content-Type': 'application/json', ...(key && {Authorization: 'Bearer ' + key})}, body: JSON.stringify(body)})).json();
let host = (await post(base + '/api/login', {key: hostKey})).key;
await post(base + '/api/host/settings', {onlineService: online, title: 'Tuesday at the bar', waitingRoom: false}, host);
await post(online + '/v1/accounts', {email, password, displayName: 'Dan'});
await post(base + '/api/host/online/signin', {email, password}, host);
await post(base + '/api/host/link', {}, host);
console.log(JSON.stringify({online, email, password, bar: {base, host, title: 'Tuesday at the bar'}}));
createInterface({input: process.stdin}).on('line', async line => {
  // The bar's laptop restarts: the same quiz and sign-in, on a new address (its quizmaster link would change too).
  if (line.trim() === 'restart') {
    await quiz.close(); quiz = make();
    await new Promise(r => quiz.server.listen(0, '0.0.0.0', r));
    base = `http://127.0.0.1:${quiz.server.address().port}`;
    host = (await post(base + '/api/login', {key: hostKey})).key;
    await post(base + '/api/host/link', {}, host);
    console.log(JSON.stringify({base, host}));
  }
  if (line.trim() === 'away?') console.log(JSON.stringify({away: (await post(base + '/api/host/state', {}, host)).deskAway?.name || null}));
}).on('close', async () => {await quiz.close(); await service.close(); rmSync(dir, {recursive: true, force: true}); process.exit(0);});
