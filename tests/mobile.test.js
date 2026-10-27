// BeerMat Player's own logic (mobile/www/join.js): what scanning or typing gives, handing results over, reminders.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {parseScan, normaliseAddress, readClaim, remember, calendarFile, hotspotCandidates} from '../mobile/www/join.js';
import {wifiCode} from '../web/qr.js';

test('typed addresses: an IP with a port, a full link or an app link; nothing but http(s) and no passwords', () => {
  assert.equal(normaliseAddress('192.168.1.20:3000'), 'http://192.168.1.20:3000');
  assert.equal(normaliseAddress(' http://10.42.0.1/ '), 'http://10.42.0.1');
  assert.equal(normaliseAddress('https://smart-quiz-name.trycloudflare.com/display'), 'https://smart-quiz-name.trycloudflare.com');
  assert.equal(normaliseAddress('beermat://join?url=' + encodeURIComponent('http://192.168.0.5:3002')), 'http://192.168.0.5:3002');
  for (const bad of ['', 'javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,hi', 'http://user:pass@10.0.0.1', 'ftp://x.example']) assert.throws(() => normaliseAddress(bad), /./, bad);
});

test('scanned codes: the TV\'s quiz link, the open quiz Wi-Fi, and a Windows hotspot with its password (escapes included)', () => {
  assert.deepEqual(parseScan('http://192.168.1.20:3000'), {type: 'quiz', url: 'http://192.168.1.20:3000'});
  assert.deepEqual(parseScan(wifiCode('BeerMat')), {type: 'wifi', ssid: 'BeerMat', password: '', open: true, candidates: hotspotCandidates});
  const locked = parseScan(wifiCode('Fox; "Quiz"', 'pa;ss:word'));
  assert.deepEqual([locked.ssid, locked.password, locked.open], ['Fox; "Quiz"', 'pa;ss:word', false]);
  assert.equal(parseScan('WIFI:T:WPA;;').type, 'invalid');
  assert.equal(parseScan('some random text').type, 'invalid');
  assert.deepEqual(hotspotCandidates, ['http://10.42.0.1', 'http://192.168.137.1:3000']);
});

test('results handed over by the quiz page are read back exactly; anything else is ignored', () => {
  const claim = {v: 1, kind: 'beermat.result', event: 'e1', team: 't', result: {name: 'Foxés 🦊', rank: 1}, sig: 'abc'};
  // The same packing as the quiz page (client.js).
  const packed = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(claim)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  assert.deepEqual(readClaim('#claim=' + packed), claim);
  assert.equal(readClaim(''), null);
  assert.equal(readClaim('#claim=!!!'), null);
  assert.equal(readClaim('#claim=' + btoa(JSON.stringify({kind: 'other', sig: 'x'}))), null);
});

test('recent quizzes and calendar reminders', () => {
  let list = [];
  for (let i = 0; i < 10; i++) list = remember(list, `http://10.0.0.${i}`, '', i);
  assert.equal(list.length, 8);
  list = remember(list, 'http://10.0.0.3', 'Lion', 99);
  assert.deepEqual([list[0].url, list[0].title, list.filter(r => r.url === 'http://10.0.0.3').length], ['http://10.0.0.3', 'Lion', 1]);
  const ics = calendarFile({id: 'ev1', title: 'Quiz, night', startsAt: Date.UTC(2026, 10, 3, 19, 30), format: 'General', entry: '£2', venue: {name: 'The Lion', address: '1 High St', town: 'Bristol', postcode: 'BS1'}});
  assert.match(ics, /DTSTART:20261103T193000Z/);
  assert.match(ics, /SUMMARY:Quiz\\, night — The Lion/);
  assert.match(ics, /TRIGGER:-PT2H/);
});

test('app configuration: the player page knows the app by its user agent, and quiz pages may be opened inside the app', () => {
  const config = JSON.parse(readFileSync(path.join(import.meta.dirname, '..', 'mobile', 'capacitor.config.json'), 'utf8'));
  const client = readFileSync(path.join(import.meta.dirname, '..', 'web', 'client.js'), 'utf8');
  for (const platform of ['android', 'ios']) {
    const agent = config[platform].appendUserAgent;
    assert.match(agent, new RegExp(`^BeerMatApp/[\\d.]+ \\(${platform}\\)$`));
    assert.match(client, /BeerMatApp\\\/\[\\d\.\]\+ \\\(\(ios\|android\)\\\)/);
  }
  assert.equal(config.server.androidScheme, 'http', 'the app page must be able to reach http quiz addresses (no mixed content)');
  assert.deepEqual(config.server.allowNavigation, ['*']);
  const manifest = readFileSync(path.join(import.meta.dirname, '..', 'mobile', 'android', 'app', 'src', 'main', 'AndroidManifest.xml'), 'utf8');
  assert.match(manifest, /usesCleartextTraffic="true"/);
  assert.doesNotMatch(manifest, /ACCESS_BACKGROUND_LOCATION|ACCESS_FINE_LOCATION/, 'no background or precise location');
  const plist = readFileSync(path.join(import.meta.dirname, '..', 'mobile', 'ios', 'App', 'App', 'Info.plist'), 'utf8');
  for (const key of ['NSCameraUsageDescription', 'NSLocationWhenInUseUsageDescription', 'NSLocalNetworkUsageDescription', 'NSAllowsLocalNetworking']) assert.match(plist, new RegExp(key));
  assert.doesNotMatch(plist, /NSLocationAlwaysAndWhenInUseUsageDescription/);
});
