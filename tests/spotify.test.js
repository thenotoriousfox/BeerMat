import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {mkdtempSync, rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createQuiz} from '../server/server.js';
import {trackId, playlistId, mprisApp} from '../server/spotify.js';

const hostKey = 'a-secure-quiz-test-key', clientId = '0123456789abcdef0123456789abcdef';
const id = n => `track${String(n).padStart(17, '0')}`;
// A stand-in for Spotify's accounts service and Web API that records what the quiz asked for.
function fakeSpotify() {
  const log = [], state = {challenge: null, device: true, idle: false, tokens: 0, laptop: 'CachyOS laptop'};
  const server = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const url = new URL(req.url, 'http://x'), json = (status, data) => {res.writeHead(status, {'Content-Type': 'application/json'}); res.end(data === undefined ? '' : JSON.stringify(data));};
    log.push({method: req.method, path: url.pathname + url.search, body, auth: req.headers.authorization});
    if (url.pathname === '/api/token') {
      const form = new URLSearchParams(body);
      if (form.get('grant_type') === 'authorization_code') {
        assert.equal(createHash('sha256').update(form.get('code_verifier')).digest('base64url'), state.challenge);
        assert.equal(form.get('code'), 'the-code');
      } else assert.equal(form.get('refresh_token'), state.tokens === 1 ? 'refresh-1' : 'refresh-2');
      state.tokens++;
      return json(200, {access_token: `access-${state.tokens}`, expires_in: 3600, refresh_token: `refresh-${state.tokens}`, scope: 'streaming user-modify-playback-state'});
    }
    if (url.pathname === '/v1/me') return json(200, {display_name: 'Quiz Host'});
    if (url.pathname === '/v1/me/player/devices') return json(200, {devices: [{id: 'tv', name: 'Living room TV', type: 'TV', is_active: false}, {id: 'laptop', name: state.laptop, type: 'Computer', is_active: !state.idle}]});
    // idle: the Spotify app open but not in use, so Spotify plays only when asked for a player by name.
    if (url.pathname.startsWith('/v1/me/player/') && state.idle && !url.searchParams.get('device_id')) return json(404, {error: {status: 404, message: 'Player command failed: No active device found', reason: 'NO_ACTIVE_DEVICE'}});
    // A player that has gone (its app closed): Spotify doesn't know its id any more.
    if (url.pathname.startsWith('/v1/me/player/') && url.searchParams.get('device_id') && !['tv', 'laptop'].includes(url.searchParams.get('device_id'))) return json(404, {error: {status: 404, message: 'Device not found'}});
    if (url.pathname.startsWith('/v1/me/player/')) return state.device ? json(204) : json(404, {error: {status: 404, message: 'Player command failed: No active device found', reason: 'NO_ACTIVE_DEVICE'}});
    if (url.pathname === `/v1/playlists/${'p'.repeat(22)}/items`) {
      const offset = Number(url.searchParams.get('offset') || 0);
      const track = n => ({item: {type: 'track', name: `Song ${n}`, uri: `spotify:track:${id(n)}`, artists: [{name: 'Band'}]}});
      return json(200, offset ? {items: [track(3), {item: {type: 'episode', name: 'Podcast', uri: 'spotify:episode:x'}}], next: null}
        : {items: [track(1), {item: {type: 'track', name: 'Local file', uri: 'spotify:local:a:b:c:1', is_local: true}}, track(2)], next: `https://api.spotify.com/v1/playlists/${'p'.repeat(22)}/items?offset=100&limit=100`});
    }
    if (url.pathname.startsWith('/v1/tracks/')) return json(200, {name: 'Single', artists: [{name: 'Singer'}]});
    json(404, {error: {status: 404, message: 'Not found'}});
  });
  return {server, log, state};
}
async function fixture(fn, options = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'quiz-spotify-')), fake = fakeSpotify(); let time = 1000000;
  await new Promise(r => fake.server.listen(0, '127.0.0.1', r));
  const spotifyBase = `http://127.0.0.1:${fake.server.address().port}`;
  const quiz = createQuiz({plan: 'pro', hostKey, database: path.join(dir, 'quiz.sqlite'), mediaDir: dir, now: () => time, spotifyAccountsUrl: spotifyBase, spotifyApiUrl: spotifyBase + '/v1', spotifyLocalApp: options.localApp});
  await new Promise(r => quiz.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${quiz.server.address().port}`;
  const call = async (route, body = {}, key = route.startsWith('host/') ? host : '') => {
    const response = await fetch(`${base}/api/${route}`, {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + key}, body: JSON.stringify(body)});
    return {status: response.status, ...await response.json()};
  };
  const host = (await call('login', {key: hostKey})).key; await call('host/settings', {waitingRoom: false});
  try {await fn({call, base, fake, tick: ms => time += ms});} finally {await quiz.close(); fake.server.close(); rmSync(dir, {recursive: true, force: true});}
}
async function connect({call, base, fake}) {
  const {url} = await call('host/spotify/connect', {clientId});
  const authorize = new URL(url);
  assert.equal(authorize.searchParams.get('redirect_uri'), `${base}/spotify/callback`);
  assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256');
  fake.state.challenge = authorize.searchParams.get('code_challenge');
  const page = await (await fetch(`${base}/spotify/callback?code=the-code&state=${authorize.searchParams.get('state')}`)).text();
  assert.match(page, /Spotify connected/);
}

test('Spotify links are recognised in every common form', () => {
  assert.equal(trackId('https://open.spotify.com/intl-en/track/4uLU6hMCjMI75M1A2tKUQC?si=abc'), '4uLU6hMCjMI75M1A2tKUQC');
  assert.equal(trackId('spotify:track:4uLU6hMCjMI75M1A2tKUQC'), '4uLU6hMCjMI75M1A2tKUQC');
  assert.equal(playlistId('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M'), '37i9dQZF1DXcBWIGoYBM5M');
  assert.equal(trackId('https://example.com/track/4uLU6hMCjMI75M1A2tKUQC'), null);
});

test('connect with PKCE, import a playlist, refresh tokens, disconnect', () => fixture(async ctx => {
  const {call, base, fake, tick} = ctx;
  assert.equal((await call('host/spotify/import', {links: ['spotify:playlist:' + 'p'.repeat(22)]})).status, 409);
  assert.equal((await call('host/spotify/connect', {clientId: 'nope'})).status, 400);
  // A stale or forged sign-in is refused.
  assert.match(await (await fetch(`${base}/spotify/callback?code=x&state=forged`)).text(), /expired/);
  await connect(ctx);
  let status = await call('host/spotify/status');
  assert.deepEqual([status.connected, status.user, status.devices.map(d => d.name), status.redirectUri, status.deskPlayer], [true, 'Quiz Host', ['Living room TV', 'CachyOS laptop'], `${base}/spotify/callback`, true]);
  // The desk player gets the current access token only.
  assert.deepEqual(Object.keys(await call('host/spotify/token')).sort(), ['accessToken', 'expiresAt', 'status']);
  assert.equal((await call('host/spotify/token')).accessToken, 'access-1');
  assert.equal((await call('host/spotify/token', {}, 'not-the-host')).status, 403);
  const {songs} = await call('host/spotify/import', {links: [`https://open.spotify.com/playlist/${'p'.repeat(22)}?si=x`]});
  assert.deepEqual(songs.map(s => s.title), ['Song 1 — Band', 'Song 2 — Band', 'Song 3 — Band']); // local files and podcasts skipped, all pages read
  assert.equal(songs[0].spotify, `spotify:track:${id(1)}`);
  tick(3600 * 1000); await call('host/spotify/import', {links: [`spotify:track:${id(9)}`]});
  assert.equal(fake.log.filter(l => l.path === '/api/token').length, 2, 'expired access token refreshed');
  assert.equal(fake.log.at(-1).auth, 'Bearer access-2');
  // Tokens never leave the server.
  assert.doesNotMatch(JSON.stringify(await call('host/state')) + JSON.stringify(await call('host/export')), /access-|refresh-/);
  await call('host/spotify/disconnect'); status = await call('host/spotify/status');
  assert.deepEqual([status.connected, status.clientId], [false, clientId]);
}));

test('music bingo plays Spotify songs from the start time; clips play and log; no player gives a clear message', () => fixture(async ctx => {
  const {call, fake} = ctx; await connect(ctx);
  // Every other song has its own start time (and is given as a song link); the rest start at the game's.
  const songs = Array.from({length: 15}, (_, i) => i % 2 ? {title: `Song ${i + 1}`, spotify: `spotify:track:${id(i + 1)}`} : {title: `Song ${i + 1}`, spotify: `https://open.spotify.com/track/${id(i + 1)}`, start: 10 * (i + 1)});
  const bingo = await call('host/open', {text: 'Music bingo', type: 'musicbingo', seconds: 600, points: 1, songs, mode: 'line', startAt: 45});
  const {number} = await call('host/bingo', {question: bingo.id});
  const played = fake.log.findLast(l => l.path === '/v1/me/player/play');
  assert.deepEqual(JSON.parse(played.body), {uris: [`spotify:track:${id(number)}`], position_ms: ((number - 1) % 2 ? 45 : 10 * number) * 1000});
  fake.state.device = false;
  const second = await call('host/bingo', {question: bingo.id});
  assert.match(second.warning, /Start Spotify player/); assert.ok(second.number, 'the call still counts');
  fake.state.device = true;
  await call('host/close');
  for (let i = 0; i < 50 && !fake.log.some(l => l.path === '/v1/me/player/pause'); i++) await new Promise(r => setTimeout(r, 10));
  assert.ok(fake.log.some(l => l.path === '/v1/me/player/pause'), 'ending the game pauses Spotify');
  const clips = await call('host/open', {text: 'Tap the right intro', type: 'clips', seconds: 600, points: 2, clipSeconds: 10, targetClip: 1,
    clips: [{spotify: `spotify:track:${id(1)}`, start: 30, label: 'One'}, {spotify: `spotify:track:${id(2)}`, label: 'Two'}]});
  const team = await call('join', {name: 'Fox'});
  await call('host/spotify/play', {question: clips.id, clip: 1});
  assert.deepEqual(JSON.parse(fake.log.findLast(l => l.path === '/v1/me/player/play').body), {uris: [`spotify:track:${id(2)}`], position_ms: 0});
  assert.equal((await call('tap', {question: clips.id}, team.secret)).clip, 2);
  await call('host/close');
  assert.equal((await call('host/open', {text: 'Bad', type: 'clips', seconds: 60, points: 1, targetClip: 0, clips: [{spotify: 'spotify:track:short'}, {spotify: `spotify:track:${id(1)}`}]})).status, 400);
  // An audio question's Spotify clip plays from its start; the desk is told how long to let it play. Phones don't see the track.
  const audio = await call('host/open', {text: 'Name the artist', type: 'audio', seconds: 30, points: 1, answer: 'Queen', clip: {spotify: `https://open.spotify.com/track/${id(3)}`, start: 42, seconds: 12}});
  assert.equal((await call('host/spotify/play', {question: audio.id})).seconds, 12);
  assert.deepEqual(JSON.parse(fake.log.findLast(l => l.path === '/v1/me/player/play').body), {uris: [`spotify:track:${id(3)}`], position_ms: 42000});
  const seen = (await call('state', {}, team.secret)).question; assert.deepEqual([seen.clip, seen.playsSong], [undefined, true]);
}));

test('with no player in use, BeerMat plays on the Spotify app on a computer rather than refuse', () => fixture(async ctx => {
  const {call, fake} = ctx; await connect(ctx);
  fake.state.idle = true;
  const audio = await call('host/open', {text: 'Name the artist', type: 'audio', seconds: 30, points: 1, answer: 'Queen', clip: {spotify: `spotify:track:${id(3)}`, start: 42, seconds: 12}});
  assert.equal((await call('host/spotify/play', {question: audio.id})).status, 200);
  const played = fake.log.filter(l => l.path.startsWith('/v1/me/player/play'));
  assert.deepEqual(played.map(l => l.path), ['/v1/me/player/play', '/v1/me/player/play?device_id=laptop'], 'asked for the active player, then the laptop by name (not the TV)');
  assert.deepEqual(JSON.parse(played.at(-1).body), {uris: [`spotify:track:${id(3)}`], position_ms: 42000});
}));

test('a chosen player that has gone (its app closed): BeerMat plays on this laptop’s instead', () => fixture(async ctx => {
  const {call, fake} = ctx; await connect(ctx);
  await call('host/spotify/device', {id: 'gone-phone'});
  fake.state.idle = true;
  assert.equal((await call('host/spotify/preview', {link: `spotify:track:${id(3)}`})).ok, true);
  assert.deepEqual(fake.log.filter(l => l.path.startsWith('/v1/me/player/play')).map(l => l.path), ['/v1/me/player/play?device_id=gone-phone', '/v1/me/player/play?device_id=laptop']);
  await call('host/spotify/pause');
  assert.deepEqual(fake.log.filter(l => l.path.startsWith('/v1/me/player/pause')).map(l => l.path), ['/v1/me/player/pause?device_id=gone-phone', '/v1/me/player/pause'], 'pauses whichever is playing');
  // A chosen player that's there but refuses isn't swapped for another.
  await call('host/spotify/device', {id: 'tv'});
  fake.state.device = false; fake.state.idle = false;
  assert.equal((await call('host/spotify/preview', {link: `spotify:track:${id(3)}`})).status, 409);
}));

test('the Spotify app on this laptop is told directly (its Connect link can stop answering); a chosen player isn’t', () => {
  const told = [], app = {works: true, full: [], play: async (uri, start, {full} = {}) => {if (!app.works) throw new Error('not open'); app.full.push(full); told.push(['play', uri, start]);}, pause: async () => {told.push(['pause']);}};
  return fixture(async ctx => {
    const {call, fake} = ctx; await connect(ctx);
    const webPlays = () => fake.log.filter(l => l.path.startsWith('/v1/me/player/play')).length;
    const audio = await call('host/open', {text: 'Name the artist', type: 'audio', seconds: 30, points: 1, answer: 'Queen', clip: {spotify: `spotify:track:${id(3)}`, start: 42, seconds: 12}});
    assert.equal((await call('host/spotify/play', {question: audio.id})).seconds, 12);
    await call('host/spotify/pause');
    assert.deepEqual(told, [['play', `spotify:track:${id(3)}`, 42], ['pause']]);
    assert.equal(webPlays(), 0, 'not through Spotify Connect');
    // Clips play at the app's full volume unless the quizmaster turns that off.
    assert.equal((await call('host/spotify/status')).fullVolume, true);
    await call('host/spotify/full-volume', {on: false});
    assert.equal((await call('host/spotify/status')).fullVolume, false);
    await call('host/spotify/play', {question: audio.id});
    assert.equal((await call('host/spotify/full-volume', {on: 'yes'})).status, 400);
    await call('host/spotify/full-volume', {on: true});
    assert.deepEqual(app.full, [true, false]);
    told.splice(2);
    app.works = false;
    assert.equal((await call('host/spotify/play', {question: audio.id})).status, 200);
    assert.equal(webPlays(), 1, 'the app not open: through Spotify Connect');
    app.works = true;
    await call('host/spotify/preview', {link: `spotify:track:${id(4)}`});
    assert.equal(app.full.at(-1), false, 'a preview while building the quiz: Spotify\'s own volume');
    told.splice(2);
    await call('host/spotify/device', {id: 'tv'});
    await call('host/spotify/preview', {link: `spotify:track:${id(4)}`});
    assert.deepEqual([told.length, fake.log.findLast(l => l.path.startsWith('/v1/me/player/play')).path], [2, '/v1/me/player/play?device_id=tv'], 'the TV chosen: on the TV');
  }, {localApp: app});
});

// The Electron desk started clips through Spotify Connect, at the start time in one step, and they started in the
// right place; the D-Bus jump after OpenUri sometimes didn't. So Connect first, checked over D-Bus, and D-Bus only
// when the app didn't play it.
test('the Spotify app on this laptop is told through Spotify Connect first, and over D-Bus when that does nothing', () => {
  const told = [], app = {connectWorks: true, connect: async (send, uri, start, {full}) => {await send(); told.push(['connect', uri, start, full]); return app.connectWorks;}, play: async (uri, start) => {told.push(['play', uri, start]);}, pause: async () => {told.push(['pause']);}};
  return fixture(async ctx => {
    const {call, fake} = ctx; await connect(ctx);
    fake.state.laptop = os.hostname();
    const audio = await call('host/open', {text: 'Name the artist', type: 'audio', seconds: 30, points: 1, answer: 'Queen', clip: {spotify: `spotify:track:${id(3)}`, start: 42, seconds: 12}});
    await call('host/spotify/play', {question: audio.id});
    const sent = fake.log.findLast(l => l.path.startsWith('/v1/me/player/play'));
    assert.deepEqual([sent.path, JSON.parse(sent.body)], ['/v1/me/player/play?device_id=laptop', {uris: [`spotify:track:${id(3)}`], position_ms: 42000}]);
    assert.deepEqual(told, [['connect', `spotify:track:${id(3)}`, 42, true]], 'played through Connect: no D-Bus jump');
    await call('host/spotify/pause');
    assert.deepEqual(told.at(-1), ['pause'], 'paused on the app');
    told.length = 0; app.connectWorks = false;
    await call('host/spotify/play', {question: audio.id});
    assert.deepEqual(told, [['connect', `spotify:track:${id(3)}`, 42, true], ['play', `spotify:track:${id(3)}`, 42]], 'Connect did nothing: over D-Bus');
    // No laptop among Spotify's players (its Connect link gone): straight over D-Bus.
    told.length = 0; fake.state.laptop = 'Another laptop';
    await call('host/spotify/play', {question: audio.id});
    assert.deepEqual(told, [['play', `spotify:track:${id(3)}`, 42]]);
  }, {localApp: app});
});

test('a clip through Spotify Connect is checked over D-Bus: the song, at its start time, silent until then', async () => {
  const run = async ({plays, at = 42e6, full = false}) => {
    const app = {volume: 0.6, track: '/com/spotify/track/' + id(1), at: 5e6, starts: null, heardBefore: false};
    const call = async (method, ...args) => {
      if (method.endsWith('Properties.Get')) {
        if (app.starts !== null && app.starts-- === 0) {app.track = '/com/spotify/track/' + id(2); app.at = at; if (app.volume > 0 && at < 41e6) app.heardBefore = true;}
        if (args[1] === 'Volume') return `(<${app.volume}>,)`;
        return args[1] === 'Metadata' ? `({'mpris:trackid': <'${app.track}'>},)` : `(<int64 ${app.at}>,)`;
      }
      if (method.endsWith('Properties.Set')) {app.volume = Number(/[\d.]+/.exec(args[2])[0]); return '()';}
      return '()';
    };
    const spotifyApp = mprisApp(call, async () => {});
    const there = await spotifyApp.connect(async () => {if (plays) app.starts = 3;}, `spotify:track:${id(2)}`, 42, {full});
    return {there, app, spotifyApp};
  };
  let r = await run({plays: true});
  assert.deepEqual([r.there, r.app.volume, r.app.heardBefore], [true, 0.6, false]);
  r = await run({plays: true, full: true});
  assert.deepEqual([r.there, r.app.volume], [true, 1]);
  await r.spotifyApp.pause();
  assert.equal(r.app.volume, 0.6, 'the quizmaster\'s volume back after a full one');
  r = await run({plays: false, full: true});
  assert.deepEqual([r.there, r.app.volume], [false, 0.6], 'Connect did nothing: not there, volume as it was');
  r = await run({plays: true, at: 0});
  assert.equal(r.there, false, 'the song from 0:00, not the start time: not there');
});

test('Build quiz previews a track from its start point on the chosen player, for the desk only', () => fixture(async ctx => {
  const {call, fake} = ctx; await connect(ctx);
  const plays = () => fake.log.filter(l => l.path === '/v1/me/player/play').length;
  assert.equal((await call('host/spotify/preview', {link: `https://open.spotify.com/track/${id(4)}?si=abc`, start: 30})).ok, true);
  assert.deepEqual(JSON.parse(fake.log.findLast(l => l.path === '/v1/me/player/play').body), {uris: [`spotify:track:${id(4)}`], position_ms: 30000});
  await call('host/spotify/preview', {link: `spotify:track:${id(5)}`});
  assert.deepEqual(JSON.parse(fake.log.findLast(l => l.path === '/v1/me/player/play').body), {uris: [`spotify:track:${id(5)}`], position_ms: 0});
  const before = plays();
  for (const body of [{link: 'https://example.com/song'}, {link: `spotify:track:${id(5)}`, start: -1}, {link: `spotify:track:${id(5)}`, start: 1.5}, {}]) assert.equal((await call('host/spotify/preview', body)).status, 400);
  assert.equal((await call('host/spotify/preview', {link: `spotify:track:${id(5)}`}, 'not-the-host')).status, 403);
  assert.equal(plays(), before, 'refused previews play nothing');
  // Previews leave nothing behind: no question, no clip log.
  assert.equal((await call('host/state')).history.length, 0);
}));

test('only the desk page may load Spotify\'s player; phones and the TV stay local-only', () => fixture(async ({base}) => {
  const policy = async route => (await fetch(base + route)).headers.get('content-security-policy');
  assert.match(await policy('/host'), /script-src 'self' https:\/\/sdk\.scdn\.co/); assert.match(await policy('/host'), /frame-src https:\/\/sdk\.scdn\.co/);
  for (const route of ['/', '/tv']) {const p = await policy(route); assert.doesNotMatch(p, /spotify|scdn/); assert.match(p, /connect-src 'self';/);}
}));

// The Spotify app over D-Bus: it takes a while to load a song (still saying the old one meanwhile), drops a seek sent
// before then, and Seek is relative; OpenUri starts the song at 0:00. The clip has to start at its start time however
// slow the app is, with none of the song's opening heard first, and the volume left as it was.
test('the Spotify app on this laptop starts a clip at its start time, however long the song takes to load', async () => {
  for (const loadPolls of [0, 1, 4, 12]) {
    const app = {track: '/com/spotify/track/' + id(1), at: 80e6, loading: null, polls: 0, volume: 0.8, heard: false};
    const wait = async ms => {if (app.stuck > 0) app.stuck--; else app.at += ms * 1000; if (app.volume > 0 && app.track.endsWith(id(2)) && app.at < 14e6) app.heard = true;};
    const call = async (method, ...args) => {
      if (method.endsWith('.OpenUri')) {app.loading = '/com/spotify/track/' + args[0].split(':').pop(); app.polls = 0; return '()';}
      if (method.endsWith('Properties.Get')) {
        if (app.loading && app.polls++ >= loadPolls) {app.track = app.loading; app.loading = null; app.at = 0; app.stuck = 2; if (app.volume > 0) app.heard = true;}
        if (args[1] === 'Volume') return `(<${app.volume}>,)`;
        return args[1] === 'Metadata' ? `({'mpris:trackid': <'${app.track}'>, 'xesam:title': <'Song'>},)` : `(<int64 ${app.at}>,)`;
      }
      if (method.endsWith('Properties.Set')) {app.volume = Number(/[\d.]+/.exec(args[2])[0]); return '()';}
      if (method.endsWith('.Seek')) {if (!app.loading) app.at += Number(args[0]); return '()';}
      if (method.endsWith('.SetPosition')) {if (args[0] === app.track && !app.loading && !app.stuck) app.at = Number(args[1]); return '()';}
      return '()';
    };
    await mprisApp(call, wait).play(`spotify:track:${id(2)}`, 15);
    assert.equal(app.track, '/com/spotify/track/' + id(2), `loads after ${loadPolls} looks`);
    assert.ok(app.at >= 15e6 && app.at < 16e6, `at ${app.at / 1e6} s after ${loadPolls} looks, not 15 s`);
    assert.equal(app.heard, false, `the song's opening heard after ${loadPolls} looks`);
    assert.equal(app.volume, 0.8, 'volume back as it was');
  }
  // No start time: just the song, nothing else asked.
  const asked = [];
  await mprisApp(async method => {asked.push(method); return '()';}, async () => {}).play(`spotify:track:${id(2)}`, 0);
  assert.deepEqual(asked, ['org.mpris.MediaPlayer2.Player.OpenUri']);
});

// Full volume: the clip plays with the app at full (still silent until it's at the start time) and the
// quizmaster's volume comes back when it's paused, even after several clips in a row, or when the next clip isn't full.
test('a clip can play at the Spotify app\'s full volume, and the quizmaster\'s volume comes back after', async () => {
  const app = {volume: 0.4, track: '', at: 0, heard: []};
  const call = async (method, ...args) => {
    if (method.endsWith('.OpenUri')) {app.track = '/com/spotify/track/' + args[0].split(':').pop(); app.at = 0; app.heard.push(app.volume); return '()';}
    if (method.endsWith('Properties.Get')) {
      if (args[1] === 'Volume') return `(<${app.volume}>,)`;
      return args[1] === 'Metadata' ? `({'mpris:trackid': <'${app.track}'>},)` : `(<int64 ${app.at}>,)`;
    }
    if (method.endsWith('Properties.Set')) {app.volume = Number(/[\d.]+/.exec(args[2])[0]); return '()';}
    if (method.endsWith('.SetPosition')) {app.at = Number(args[1]); return '()';}
    return '()';
  };
  const spotifyApp = mprisApp(call, async () => {});
  await spotifyApp.play(`spotify:track:${id(2)}`, 15, {full: true});
  assert.deepEqual([app.volume, app.heard], [1, [0]], 'full, and silent while it jumps');
  await spotifyApp.play(`spotify:track:${id(3)}`, 20, {full: true});
  assert.equal(app.volume, 1);
  await spotifyApp.pause();
  assert.equal(app.volume, 0.4, 'the quizmaster\'s volume back, not the full one');
  await spotifyApp.play(`spotify:track:${id(2)}`, 0, {full: true});
  assert.equal(app.volume, 1, 'no start time: full too');
  await spotifyApp.play(`spotify:track:${id(3)}`, 0);
  assert.equal(app.volume, 0.4, 'a clip not at full: the quizmaster\'s volume');
  await spotifyApp.play(`spotify:track:${id(2)}`, 15);
  assert.equal(app.volume, 0.4);
  await spotifyApp.pause();
  assert.equal(app.volume, 0.4);
});
