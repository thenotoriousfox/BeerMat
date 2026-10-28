// Reporting a player's name or picture on a public leaderboard: only players who chose to appear can be reported, by a
// reference that doesn't give away their account, and admins see who it is.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {createService} from '../online/service.js';

test('a player on a leaderboard can be reported; admins see who', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'online-reports-'));
  const service = createService({database: path.join(dir, 'online.sqlite')});
  await new Promise(r => service.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${service.server.address().port}`;
  const api = async (method, route, body, token) => {
    const response = await fetch(base + route, {method, headers: {'Content-Type': 'application/json', ...(token && {Authorization: 'Bearer ' + token})}, ...(body && {body: JSON.stringify(body)})});
    return {status: response.status, ...await response.json()};
  };
  try {
    const shown = await api('POST', '/v1/accounts', {email: 'shown@example.com', password: 'correct horse battery', displayName: 'Rude Name'});
    await api('PATCH', '/v1/me', {privacy: {leaderboards: true}}, shown.token);
    const hidden = await api('POST', '/v1/accounts', {email: 'hidden@example.com', password: 'correct horse battery', displayName: 'Private'});
    const ref = accountId => createHash('sha256').update('profile:' + accountId).digest('hex').slice(0, 20);

    assert.equal((await api('POST', '/v1/reports', {kind: 'profile', target: ref(hidden.account.id), reason: 'Rude'})).status, 404, 'not on a leaderboard, so nothing to report');
    assert.equal((await api('POST', '/v1/reports', {kind: 'profile', target: shown.account.id, reason: 'Rude'})).status, 404, 'the account id itself isn’t the reference');
    assert.equal((await api('POST', '/v1/reports', {kind: 'profile', target: ref(shown.account.id), reason: ''})).status, 400);
    assert.equal((await api('POST', '/v1/reports', {kind: 'profile', target: ref(shown.account.id), reason: 'Offensive name'})).status, 201);

    const admin = (await api('POST', '/v1/accounts', {email: 'admin@example.com', password: 'correct horse battery', displayName: 'Admin'})).token;
    service.db.prepare("UPDATE accounts SET admin=1 WHERE email='admin@example.com'").run();
    const [report] = (await api('GET', '/v1/admin/reports', undefined, admin)).reports;
    assert.deepEqual([report.kind, report.targetName, report.email, report.reason], ['profile', 'Rude Name (shown@example.com)', 'shown@example.com', 'Offensive name']);
  } finally {await service.close(); rmSync(dir, {recursive: true, force: true});}
});
