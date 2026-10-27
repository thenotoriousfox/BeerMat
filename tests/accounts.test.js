// BeerMat Online: confirming an email address, resetting a password by email, and reporting a venue page, against a
// real service on a temporary database with a mailbox in place of the email service.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createService} from '../online/service.js';

async function start(options = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'online-accounts-')), sent = [];
  const service = createService({database: path.join(dir, 'online.sqlite'), publicUrl: 'https://beermat.test', mail: async m => {sent.push(m);}, ...options});
  await new Promise(r => service.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${service.server.address().port}`;
  const api = async (method, route, body, token) => {
    const response = await fetch(base + route, {method, headers: {'Content-Type': 'application/json', ...(token && {Authorization: 'Bearer ' + token})}, ...(body && {body: JSON.stringify(body)})});
    return {status: response.status, ...await response.json().catch(() => ({}))};
  };
  const tokenIn = m => /token=([\w-]+)/.exec(m.text)[1];
  return {service, base, api, sent, tokenIn, done: async () => {await service.close(); rmSync(dir, {recursive: true, force: true});}};
}

test('a new account confirms its email address from the link it is sent', async () => {
  const {base, api, sent, tokenIn, done} = await start();
  try {
    const {token, account} = await api('POST', '/v1/accounts', {email: 'Sam@Example.com', password: 'correct horse battery', displayName: 'Sam'});
    assert.equal(account.emailVerified, false);
    assert.equal(sent.length, 1); assert.equal(sent[0].to, 'sam@example.com'); assert.match(sent[0].text, /https:\/\/beermat\.test\/verify\?token=/);
    assert.equal((await api('POST', '/v1/verify', {token: 'nonsense'})).status, 400);
    assert.equal((await api('POST', '/v1/verify', {token: tokenIn(sent[0])})).verified, true);
    assert.equal((await api('GET', '/v1/me', undefined, token)).emailVerified, true);
    assert.equal((await api('POST', '/v1/verify', {token: tokenIn(sent[0])})).status, 400, 'a link works once');
    assert.equal((await api('POST', '/v1/me/verify', {}, token)).status, 400, 'already confirmed');
    const page = await fetch(base + '/verify?token=x');
    assert.equal(page.status, 200); assert.match(page.headers.get('content-security-policy'), /default-src 'self'/); assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
    for (const p of ['/reset', '/pages/pages.js', '/pages/pages.css']) assert.equal((await fetch(base + p)).status, 200, p);
    assert.equal((await fetch(base + '/pages/../service.js')).status, 404);
  } finally {await done();}
});

test('password reset: a link by email, an hour to use it once, and every device signed out', async () => {
  let time = Date.now();
  const {api, sent, tokenIn, done} = await start({now: () => time});
  try {
    const old = (await api('POST', '/v1/accounts', {email: 'lou@example.com', password: 'correct horse battery', displayName: 'Lou'})).token;
    sent.length = 0;
    assert.deepEqual(await api('POST', '/v1/password-reset', {email: 'nobody@example.com'}), {status: 200, sent: true}, 'the same answer for an unknown address');
    assert.equal(sent.length, 0);
    await api('POST', '/v1/password-reset', {email: ' LOU@example.com '});
    assert.equal(sent.length, 1); assert.match(sent[0].text, /\/reset\?token=/);
    const link = tokenIn(sent[0]);
    assert.equal((await api('POST', '/v1/password-reset/confirm', {token: link, password: 'short'})).status, 400);
    assert.equal((await api('POST', '/v1/password-reset/confirm', {token: link, password: 'a brand new password'})).reset, true);
    assert.equal((await api('GET', '/v1/me', undefined, old)).status, 401, 'old sessions end');
    assert.equal((await api('POST', '/v1/sessions', {email: 'lou@example.com', password: 'correct horse battery'})).status, 401);
    const fresh = await api('POST', '/v1/sessions', {email: 'lou@example.com', password: 'a brand new password'});
    assert.equal(fresh.status, 200); assert.equal(fresh.account.emailVerified, true, 'the email link proves the address');
    assert.equal((await api('POST', '/v1/password-reset/confirm', {token: link, password: 'another new password'})).status, 400, 'once only');
    await api('POST', '/v1/password-reset', {email: 'lou@example.com'});
    time += 61 * 60000;
    assert.equal((await api('POST', '/v1/password-reset/confirm', {token: tokenIn(sent.at(-1)), password: 'another new password'})).status, 400, 'an hour only');
  } finally {await done();}
});

test('without an email service, reset says so and sign-up still works', async () => {
  const {api, done} = await start({mail: null});
  try {
    const account = await api('POST', '/v1/accounts', {email: 'a@example.com', password: 'correct horse battery', displayName: 'A'});
    assert.equal(account.status, 201);
    assert.equal((await api('POST', '/v1/password-reset', {email: 'a@example.com'})).status, 503);
    assert.equal((await api('POST', '/v1/me/verify', {}, account.token)).status, 503);
  } finally {await done();}
});

test('reports: anyone can flag a venue page; admins see and resolve them', async () => {
  const {service, api, done} = await start();
  try {
    service.importVenues({venues: [{id: 'red-lion-bristol', name: 'The Red Lion', town: 'Bristol'}]});
    assert.equal((await api('POST', '/v1/reports', {kind: 'venue', target: 'nowhere', reason: 'x'})).status, 404);
    assert.equal((await api('POST', '/v1/reports', {kind: 'venue', target: 'red-lion-bristol', reason: ''})).status, 400);
    assert.equal((await api('POST', '/v1/reports', {kind: 'venue', target: 'red-lion-bristol', reason: 'The quiz moved to Thursdays'})).status, 201);
    const admin = (await api('POST', '/v1/accounts', {email: 'admin@example.com', password: 'correct horse battery', displayName: 'Admin'})).token;
    assert.equal((await api('GET', '/v1/admin/reports', undefined, admin)).status, 403);
    service.db.prepare('UPDATE accounts SET admin=1').run();
    const [report] = (await api('GET', '/v1/admin/reports', undefined, admin)).reports;
    assert.deepEqual([report.targetName, report.reason, report.reporter, report.resolved], ['The Red Lion', 'The quiz moved to Thursdays', null, null]);
    assert.equal((await api('GET', '/v1/admin/overview', undefined, admin)).openReports, 1);
    await api('PATCH', `/v1/admin/reports/${report.id}`, {resolved: true}, admin);
    assert.equal((await api('GET', '/v1/admin/reports', undefined, admin)).reports.length, 0);
    assert.equal((await api('GET', '/v1/admin/reports?all=1', undefined, admin)).reports.length, 1);
  } finally {await done();}
});
