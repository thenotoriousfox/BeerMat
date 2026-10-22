// PubQuiz Online: the optional internet service for player profiles, statistics and achievements across venues,
// venue pages and quiz event listings. A quiz never needs it: laptops run quizzes offline and players join as guests.
// This is a complete reference implementation (Node + SQLite) that runs anywhere Node 22 runs; it is not deployed
// anywhere yet. docs/ONLINE.md covers the API, the data kept and what a production deployment needs.
//
//   node online/service.js         PORT (8080), ONLINE_DB (online.sqlite), ALLOWED_ORIGINS (comma-separated web origins)
//
// Trust: quiz results only come from claims signed by a quiz laptop (claims.js). A claim from a laptop key that a
// venue has registered counts towards statistics and achievements; one from a venue the service has verified also
// counts on public leaderboards. Players' own submissions are never trusted for scores.
import http from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes, scryptSync, timingSafeEqual, createHash} from 'node:crypto';
import {readFileSync, existsSync, statSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyClaim, keyId, validKey} from '../claims.js';
import {summarize, achievements} from '../achievements.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const token = () => randomBytes(32).toString('base64url');
const id = () => randomBytes(9).toString('base64url');
const sha = value => createHash('sha256').update(value).digest('hex');
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
class ApiError extends Error {constructor(status, message) {super(message); this.status = status;}}
const check = (ok, message, status = 400) => {if (!ok) throw new ApiError(status, message);};
const text = (value, max, {required = false, name = 'Text'} = {}) => {
  if (value === undefined || value === null || value === '') {check(!required, `${name} is required`); return '';}
  check(typeof value === 'string' && value.trim().length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value), `${name} must be up to ${max} characters`);
  return value.trim();
};
const hashPassword = (password, salt = randomBytes(16).toString('base64')) => `${salt}:${scryptSync(password, salt, 32, {N: 16384, r: 8, p: 1}).toString('base64')}`;
const passwordOk = (password, stored) => {
  const [salt, hash] = stored.split(':'), mine = Buffer.from(hashPassword(password, salt).split(':')[1], 'base64');
  return timingSafeEqual(mine, Buffer.from(hash, 'base64'));
};
const defaultPrivacy = {leaderboards: false, photo: false, history: false};
// Haversine distance in km.
const distance = (a, b) => {
  const rad = x => x * Math.PI / 180, dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  return 6371 * 2 * Math.asin(Math.sqrt(Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2));
};
const postcodeArea = p => p.toUpperCase().replace(/\s+/g, ' ').trim().split(' ')[0];

export function createService({database = 'online.sqlite', now = Date.now, allowedOrigins = [], appDir = path.join(here, '..', 'mobile', 'www')} = {}) {
  const db = new DatabaseSync(database);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY, email TEXT UNIQUE COLLATE NOCASE NOT NULL, password TEXT NOT NULL, created INTEGER NOT NULL,
      display_name TEXT NOT NULL, preferred_team TEXT NOT NULL DEFAULT '', avatar TEXT, privacy TEXT NOT NULL DEFAULT '{}', admin INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY, account TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS venues(id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, name TEXT NOT NULL, town TEXT NOT NULL,
      postcode TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '', website TEXT NOT NULL DEFAULT '', lat REAL, lon REAL, verified INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS venue_keys(key_id TEXT PRIMARY KEY, venue TEXT NOT NULL REFERENCES venues(id) ON DELETE CASCADE, public_key TEXT UNIQUE NOT NULL, added INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY, venue TEXT NOT NULL REFERENCES venues(id) ON DELETE CASCADE, title TEXT NOT NULL, starts INTEGER NOT NULL,
      format TEXT NOT NULL DEFAULT '', entry TEXT NOT NULL DEFAULT '', details TEXT NOT NULL DEFAULT '', cancelled INTEGER NOT NULL DEFAULT 0, updated INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS favourites(account TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, venue TEXT NOT NULL REFERENCES venues(id) ON DELETE CASCADE, PRIMARY KEY(account, venue));
    CREATE TABLE IF NOT EXISTS results(account TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, event TEXT NOT NULL, team TEXT NOT NULL, venue_key TEXT NOT NULL,
      claim TEXT NOT NULL, date INTEGER NOT NULL, added INTEGER NOT NULL, PRIMARY KEY(account, event, team));
    CREATE TABLE IF NOT EXISTS venue_results(venue_key TEXT NOT NULL, event TEXT NOT NULL, summary TEXT NOT NULL, received INTEGER NOT NULL, PRIMARY KEY(venue_key, event));
    CREATE INDEX IF NOT EXISTS events_starts ON events(starts);
  `);
  const one = (sql, ...a) => db.prepare(sql).get(...a), rows = (sql, ...a) => db.prepare(sql).all(...a), run = (sql, ...a) => db.prepare(sql).run(...a);
  const attempts = new Map();
  // Ten tries a minute per address (and per email for sign-in), then a pause.
  function limit(name) {
    const list = (attempts.get(name) || []).filter(t => now() - t < 60000);
    check(list.length < 10, 'Too many attempts. Wait a minute and try again.', 429);
    list.push(now()); attempts.set(name, list);
  }
  const session = account => {const t = token(); run('INSERT INTO sessions VALUES(?,?,?)', sha(t), account, now() + SESSION_MS); return t;};
  const privacy = a => ({...defaultPrivacy, ...JSON.parse(a.privacy || '{}')});
  const profile = a => ({id: a.id, email: a.email, displayName: a.display_name, preferredTeam: a.preferred_team, avatar: a.avatar || null, privacy: privacy(a), created: a.created});
  const venueOut = v => ({id: v.id, name: v.name, town: v.town, postcode: v.postcode, address: v.address, website: v.website, lat: v.lat, lon: v.lon, verified: !!v.verified,
    directions: v.lat !== null && v.lon !== null ? `https://www.openstreetmap.org/directions?to=${v.lat},${v.lon}` : `https://www.openstreetmap.org/search?query=${encodeURIComponent([v.name, v.address, v.town, v.postcode].filter(Boolean).join(', '))}`});
  const eventOut = (e, v) => ({id: e.id, title: e.title, startsAt: e.starts, format: e.format, entry: e.entry, details: e.details, cancelled: !!e.cancelled, updated: e.updated, venue: venueOut(v)});
  // A venue key counts once a venue has registered it.
  const venueOfKey = key => one('SELECT v.* FROM venue_keys k JOIN venues v ON v.id=k.venue WHERE k.public_key=?', key);
  function history(accountId) {
    return rows('SELECT * FROM results WHERE account=? ORDER BY date', accountId).map(r => {
      const c = JSON.parse(r.claim), v = venueOfKey(r.venue_key);
      return {event: r.event, team: r.team, date: r.date, title: c.title, venue: v?.id || 'key:' + keyId(r.venue_key), venueName: v?.name || '', registered: !!v, verifiedVenue: !!v?.verified, result: c.result};
    });
  }
  function validEvent(body, partial = false) {
    const out = {};
    if (!partial || body.title !== undefined) out.title = text(body.title, 120, {required: true, name: 'Title'});
    if (!partial || body.startsAt !== undefined) {check(Number.isSafeInteger(body.startsAt) && body.startsAt > 0, 'Start time must be a timestamp'); out.starts = body.startsAt;}
    for (const [k, max] of [['format', 200], ['entry', 200], ['details', 2000]]) if (!partial || body[k] !== undefined) out[k] = text(body[k], max, {name: k[0].toUpperCase() + k.slice(1)});
    return out;
  }
  function validVenue(body, partial = false) {
    const out = {};
    if (!partial || body.name !== undefined) out.name = text(body.name, 120, {required: true, name: 'Venue name'});
    if (!partial || body.town !== undefined) out.town = text(body.town, 80, {required: true, name: 'Town'});
    if (!partial || body.postcode !== undefined) out.postcode = text(body.postcode, 10, {name: 'Postcode'}).toUpperCase();
    if (!partial || body.address !== undefined) out.address = text(body.address, 200, {name: 'Address'});
    if (!partial || body.website !== undefined) {out.website = text(body.website, 200, {name: 'Website'}); check(!out.website || /^https:\/\//.test(out.website), 'Website must start with https://');}
    for (const [k, lo, hi] of [['lat', -90, 90], ['lon', -180, 180]]) if (body[k] !== undefined) {check(body[k] === null || (typeof body[k] === 'number' && body[k] >= lo && body[k] <= hi), 'Invalid location'); out[k] = body[k];}
    return out;
  }
  const update = (table, idValue, fields) => {const keys = Object.keys(fields); if (keys.length) run(`UPDATE ${table} SET ${keys.map(k => `${k}=?`).join(',')} WHERE id=?`, ...keys.map(k => fields[k]), idValue);};

  async function body(req) {
    const chunks = []; let size = 0;
    for await (const chunk of req) {size += chunk.length; check(size <= 400 * 1024, 'Request too large', 413); chunks.push(chunk);}
    if (!size) return {};
    try {const value = JSON.parse(Buffer.concat(chunks)); check(value && typeof value === 'object' && !Array.isArray(value), 'Send a JSON object'); return value;}
    catch (e) {throw e instanceof ApiError ? e : new ApiError(400, 'Send valid JSON');}
  }
  // The player app and the service's own pages may call the API from a browser; other sites may not.
  const appOrigins = ['capacitor://localhost', 'http://localhost', 'https://localhost', ...allowedOrigins];
  const headers = req => ({'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    ...(appOrigins.includes(req.headers.origin) ? {'Access-Control-Allow-Origin': req.headers.origin, 'Vary': 'Origin', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, Idempotency-Key', 'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE'} : {})});
  const staticTypes = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json'};

  async function handle(req, res) {
    const send = (status, data) => {res.writeHead(status, headers(req)); res.end(JSON.stringify(data));};
    try {
      const url = new URL(req.url, 'http://online.local'), p = url.pathname, method = req.method;
      if (method === 'OPTIONS') {res.writeHead(204, headers(req)); return res.end();}
      if (p === '/health') return send(200, {ok: true});
      // The player web app (the same pages as the phone app) for players without the app.
      if (method === 'GET' && (p === '/' || p.startsWith('/app/'))) {
        if (p === '/') {res.writeHead(302, {Location: '/app/'}); return res.end();}
        // The app's shared code comes straight from the source (the phone app gets copies at build time).
        const shared = {'/app/shared/online-client.js': path.join(here, 'client.js'), '/app/shared/achievements.js': path.join(here, '..', 'achievements.js')};
        const base = path.resolve(shared[p] ? path.dirname(shared[p]) : appDir), file = shared[p] || path.resolve(base, decodeURIComponent(p.slice(5)) || 'index.html');
        check(file.startsWith(base + path.sep) && existsSync(file) && statSync(file).isFile() && staticTypes[path.extname(file)], 'Not found', 404);
        res.writeHead(200, {'Content-Type': staticTypes[path.extname(file)], 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-cache',
          'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; connect-src *; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'"});
        return res.end(readFileSync(file));
      }
      check(p.startsWith('/v1/'), 'Not found', 404);
      const ip = req.socket.remoteAddress || '';
      const auth = req.headers.authorization?.replace(/^Bearer /, '') || '';
      const account = auth ? one('SELECT a.* FROM sessions s JOIN accounts a ON a.id=s.account WHERE s.hash=? AND s.expires>?', sha(auth), now()) : null;
      const me = () => {check(account, 'Sign in first', 401); return account;};
      const input = ['POST', 'PATCH', 'PUT'].includes(method) ? await body(req) : {};
      const parts = p.split('/').slice(2);

      // ---- Accounts ----
      if (method === 'POST' && p === '/v1/accounts') {
        limit('signup:' + ip);
        const email = text(input.email, 200, {required: true, name: 'Email'}).toLowerCase();
        check(/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email), 'Enter a valid email address');
        check(typeof input.password === 'string' && input.password.length >= 10 && input.password.length <= 200, 'Password must be at least 10 characters');
        const displayName = text(input.displayName, 40, {required: true, name: 'Display name'});
        check(!one('SELECT 1 FROM accounts WHERE email=?', email), 'An account already uses that email', 409);
        const accountId = id();
        run('INSERT INTO accounts(id,email,password,created,display_name,privacy) VALUES(?,?,?,?,?,?)', accountId, email, hashPassword(input.password), now(), displayName, JSON.stringify(defaultPrivacy));
        return send(201, {token: session(accountId), account: profile(one('SELECT * FROM accounts WHERE id=?', accountId))});
      }
      if (method === 'POST' && p === '/v1/sessions') {
        limit('signin:' + ip); limit('signin:' + String(input.email).toLowerCase());
        const found = typeof input.email === 'string' && typeof input.password === 'string' ? one('SELECT * FROM accounts WHERE email=?', input.email.trim().toLowerCase()) : null;
        check(found && passwordOk(input.password, found.password), 'Email or password not recognised', 401);
        return send(200, {token: session(found.id), account: profile(found)});
      }
      if (method === 'DELETE' && p === '/v1/sessions') {run('DELETE FROM sessions WHERE hash=?', sha(auth)); return send(200, {ok: true});}
      if (method === 'GET' && p === '/v1/me') return send(200, profile(me()));
      if (method === 'PATCH' && p === '/v1/me') {
        const a = me(), fields = {};
        if (input.displayName !== undefined) fields.display_name = text(input.displayName, 40, {required: true, name: 'Display name'});
        if (input.preferredTeam !== undefined) fields.preferred_team = text(input.preferredTeam, 40, {name: 'Team name'});
        if (input.avatar !== undefined) {
          check(input.avatar === null || (typeof input.avatar === 'string' && input.avatar.length <= 300000 && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(input.avatar)), 'Profile picture must be a JPEG, PNG or WebP under 200 KB');
          fields.avatar = input.avatar;
        }
        if (input.privacy !== undefined) {
          check(input.privacy && typeof input.privacy === 'object' && Object.entries(input.privacy).every(([k, v]) => Object.hasOwn(defaultPrivacy, k) && typeof v === 'boolean'), 'Unknown privacy setting');
          fields.privacy = JSON.stringify({...privacy(a), ...input.privacy});
        }
        update('accounts', a.id, fields);
        return send(200, profile(one('SELECT * FROM accounts WHERE id=?', a.id)));
      }
      // Everything held about the player, and erasing it (UK GDPR access and erasure).
      if (method === 'GET' && p === '/v1/me/export') {
        const a = me();
        return send(200, {profile: profile(a), results: rows('SELECT event,team,date,added,claim FROM results WHERE account=?', a.id).map(r => ({...r, claim: JSON.parse(r.claim)})),
          favourites: rows('SELECT venue FROM favourites WHERE account=?', a.id).map(f => f.venue), venues: rows('SELECT * FROM venues WHERE owner=?', a.id).map(venueOut)});
      }
      if (method === 'DELETE' && p === '/v1/me') {
        const a = me();
        // Venue results uploaded by this account's laptops go with its venues.
        for (const k of rows('SELECT k.public_key FROM venue_keys k JOIN venues v ON v.id=k.venue WHERE v.owner=?', a.id)) run('DELETE FROM venue_results WHERE venue_key=?', k.public_key);
        run('DELETE FROM accounts WHERE id=?', a.id);
        return send(200, {deleted: true});
      }

      // ---- Results (signed by a quiz laptop) ----
      if (method === 'POST' && p === '/v1/me/results') {
        const a = me(), claim = input.claim;
        check(claim && typeof claim === 'object' && claim.kind === 'pubquiz.result' && claim.v === 1, 'Not a PubQuiz result');
        check(verifyClaim(claim), 'This result was not signed by a quiz laptop, or has been changed', 422);
        check(typeof claim.event === 'string' && claim.event.length <= 40 && typeof claim.team === 'string' && claim.team.length <= 40 && Number.isSafeInteger(claim.date), 'Not a PubQuiz result');
        const r = claim.result;
        check(r && [r.rank, r.teams, r.answered, r.correct].every(Number.isSafeInteger) && typeof r.points === 'number' && r.correct <= r.answered && r.rank >= 1 && r.rank <= r.teams, 'Not a PubQuiz result');
        // The same result sent again (a retry, or a second phone of the same player) is the same record.
        const existing = one('SELECT 1 FROM results WHERE account=? AND event=? AND team=?', a.id, claim.event, claim.team);
        if (!existing) run('INSERT INTO results VALUES(?,?,?,?,?,?,?)', a.id, claim.event, claim.team, claim.venueKey, JSON.stringify(claim), claim.date, now());
        const v = venueOfKey(claim.venueKey);
        return send(existing ? 200 : 201, {saved: true, duplicate: !!existing, registeredVenue: !!v, venue: v ? venueOut(v) : null});
      }
      if (method === 'GET' && p === '/v1/me/results') return send(200, {results: history(me().id)});
      if (method === 'DELETE' && parts[0] === 'me' && parts[1] === 'results' && parts.length === 4) {
        run('DELETE FROM results WHERE account=? AND event=? AND team=?', me().id, parts[2], parts[3]); return send(200, {ok: true});
      }
      // Statistics from every signed result; achievements only from venues that registered their laptop.
      if (method === 'GET' && p === '/v1/me/stats') {
        const all = history(me().id), counted = all.filter(h => h.registered);
        return send(200, {stats: summarize(counted), achievements: achievements(counted), waiting: all.length - counted.length});
      }

      // ---- Favourites ----
      if (method === 'GET' && p === '/v1/me/favourites') return send(200, {venues: rows('SELECT v.* FROM favourites f JOIN venues v ON v.id=f.venue WHERE f.account=? ORDER BY v.name', me().id).map(venueOut)});
      if ((method === 'PUT' || method === 'DELETE') && parts[0] === 'me' && parts[1] === 'favourites' && parts.length === 3) {
        const a = me();
        if (method === 'PUT') {check(one('SELECT 1 FROM venues WHERE id=?', parts[2]), 'Venue not found', 404); run('INSERT OR IGNORE INTO favourites VALUES(?,?)', a.id, parts[2]);}
        else run('DELETE FROM favourites WHERE account=? AND venue=?', a.id, parts[2]);
        return send(200, {ok: true});
      }

      // ---- Venues and events (venue operators) ----
      const myVenue = venueId => {const v = one('SELECT * FROM venues WHERE id=?', venueId); check(v, 'Venue not found', 404); check(v.owner === me().id || me().admin, 'Only the venue’s operator can change it', 403); return v;};
      if (method === 'GET' && p === '/v1/me/venues') return send(200, {venues: rows('SELECT * FROM venues WHERE owner=? ORDER BY name', me().id).map(v => ({...venueOut(v), keys: rows('SELECT key_id FROM venue_keys WHERE venue=?', v.id).map(k => k.key_id)}))});
      if (method === 'POST' && p === '/v1/venues') {
        const a = me(), fields = validVenue(input), venueId = id();
        run('INSERT INTO venues(id,owner,name,town,postcode,address,website,lat,lon,created) VALUES(?,?,?,?,?,?,?,?,?,?)', venueId, a.id, fields.name, fields.town, fields.postcode, fields.address, fields.website, fields.lat ?? null, fields.lon ?? null, now());
        return send(201, venueOut(one('SELECT * FROM venues WHERE id=?', venueId)));
      }
      if (parts[0] === 'venues' && parts.length >= 2) {
        if (method === 'GET' && parts.length === 2) {
          const v = one('SELECT * FROM venues WHERE id=?', parts[1]); check(v, 'Venue not found', 404);
          return send(200, {...venueOut(v), events: rows('SELECT * FROM events WHERE venue=? AND starts>? AND cancelled=0 ORDER BY starts', v.id, now() - 6 * 3600000).map(e => eventOut(e, v))});
        }
        if (method === 'PATCH' && parts.length === 2) {const v = myVenue(parts[1]); update('venues', v.id, validVenue(input, true)); return send(200, venueOut(one('SELECT * FROM venues WHERE id=?', v.id)));}
        if (method === 'DELETE' && parts.length === 2) {const v = myVenue(parts[1]); run('DELETE FROM venues WHERE id=?', v.id); return send(200, {ok: true});}
        // The quiz laptop's key (desk: Past quizzes → PubQuiz Online), so its results count for this venue.
        if (method === 'POST' && parts[2] === 'keys') {
          const v = myVenue(parts[1]);
          check(typeof input.publicKey === 'string' && /^[A-Za-z0-9+/=]{40,120}$/.test(input.publicKey), 'Paste the laptop’s venue key from the quiz desk');
          check(validKey(input.publicKey), 'That is not a PubQuiz venue key');
          const owner = one('SELECT venue FROM venue_keys WHERE public_key=?', input.publicKey);
          check(!owner || owner.venue === v.id, 'That laptop is registered to another venue', 409);
          run('INSERT OR IGNORE INTO venue_keys VALUES(?,?,?,?)', keyId(input.publicKey), v.id, input.publicKey, now());
          return send(201, {keyId: keyId(input.publicKey)});
        }
        if (method === 'DELETE' && parts[2] === 'keys' && parts.length === 4) {const v = myVenue(parts[1]); run('DELETE FROM venue_keys WHERE venue=? AND key_id=?', v.id, parts[3]); return send(200, {ok: true});}
        if (method === 'POST' && parts[2] === 'events' && parts.length === 3) {
          const v = myVenue(parts[1]), e = validEvent(input), eventId = id();
          run('INSERT INTO events(id,venue,title,starts,format,entry,details,updated) VALUES(?,?,?,?,?,?,?,?)', eventId, v.id, e.title, e.starts, e.format, e.entry, e.details, now());
          return send(201, eventOut(one('SELECT * FROM events WHERE id=?', eventId), v));
        }
        // Admins mark a venue verified (checked to be real); its results then count on public leaderboards.
        if (method === 'POST' && parts[2] === 'verify') {check(me().admin, 'Admins only', 403); run('UPDATE venues SET verified=? WHERE id=?', input.verified === false ? 0 : 1, parts[1]); return send(200, {ok: true});}
      }
      if (parts[0] === 'events' && parts.length === 2 && (method === 'PATCH' || method === 'DELETE')) {
        const e = one('SELECT * FROM events WHERE id=?', parts[1]); check(e, 'Event not found', 404);
        const v = myVenue(e.venue);
        if (method === 'DELETE') run('UPDATE events SET cancelled=1,updated=? WHERE id=?', now(), e.id);
        else {update('events', e.id, validEvent(input, true)); run('UPDATE events SET updated=? WHERE id=?', now(), e.id);}
        return send(200, eventOut(one('SELECT * FROM events WHERE id=?', e.id), v));
      }
      // Upcoming quizzes: by town, postcode area or a point the player chose to share (never stored).
      if (method === 'GET' && p === '/v1/events') {
        const q = (url.searchParams.get('q') || '').trim().slice(0, 80), lat = Number(url.searchParams.get('lat')), lon = Number(url.searchParams.get('lon'));
        const near = url.searchParams.has('lat') && Number.isFinite(lat) && Number.isFinite(lon) ? {lat, lon} : null;
        const radius = Math.min(Number(url.searchParams.get('radiusKm')) || 25, 200);
        check(q || near || url.searchParams.get('venue'), 'Search by town, postcode or location');
        let list = rows(`SELECT e.*, v.id vid, v.name vname, v.town, v.postcode, v.address, v.website, v.lat, v.lon, v.verified FROM events e JOIN venues v ON v.id=e.venue
          WHERE e.cancelled=0 AND e.starts>? AND e.starts<? ORDER BY e.starts LIMIT 500`, now() - 3 * 3600000, now() + 120 * 86400000)
          .map(r => ({event: r, venue: {id: r.vid, name: r.vname, town: r.town, postcode: r.postcode, address: r.address, website: r.website, lat: r.lat, lon: r.lon, verified: r.verified}}));
        if (url.searchParams.get('venue')) list = list.filter(x => x.venue.id === url.searchParams.get('venue'));
        if (q) {
          const term = q.toLowerCase(), area = postcodeArea(q);
          list = list.filter(x => x.venue.town.toLowerCase().includes(term) || x.venue.name.toLowerCase().includes(term) || (x.venue.postcode && postcodeArea(x.venue.postcode) === area));
        }
        let out = list.map(x => ({...eventOut(x.event, x.venue), ...(near && x.venue.lat !== null ? {distanceKm: Math.round(distance(near, x.venue) * 10) / 10} : {})}));
        if (near) out = out.filter(e => e.distanceKm !== undefined && e.distanceKm <= radius).sort((a, b) => a.distanceKm - b.distanceKm || a.startsAt - b.startsAt);
        return send(200, {events: out.slice(0, 50), fetchedAt: now()});
      }

      // ---- Venue results from quiz laptops (desk: Share results) ----
      if (method === 'POST' && p === '/v1/venue-results') {
        check(input.kind === 'pubquiz.event' && input.v === 1 && Array.isArray(input.teams) && input.teams.length <= 300, 'Not a PubQuiz event summary');
        check(verifyClaim(input), 'This summary was not signed by a quiz laptop, or has been changed', 422);
        check(venueOfKey(input.venueKey), 'This laptop is not registered to a venue yet', 403);
        const before = one('SELECT summary FROM venue_results WHERE venue_key=? AND event=?', input.venueKey, input.event);
        run('INSERT INTO venue_results VALUES(?,?,?,?) ON CONFLICT(venue_key,event) DO UPDATE SET summary=excluded.summary,received=excluded.received', input.venueKey, input.event, JSON.stringify(input), now());
        return send(before ? 200 : 201, {saved: true});
      }
      // Players who chose to appear: wins and points from verified venues (one venue, or all of them).
      if (method === 'GET' && p === '/v1/leaderboards') {
        const venue = url.searchParams.get('venue');
        const board = new Map();
        for (const a of rows('SELECT * FROM accounts')) {
          const p2 = privacy(a); if (!p2.leaderboards) continue;
          const mine = history(a.id).filter(h => h.verifiedVenue && (!venue || h.venue === venue));
          if (!mine.length) continue;
          const s = summarize(mine);
          board.set(a.id, {name: a.display_name, avatar: p2.photo ? a.avatar : null, quizzes: s.quizzes, wins: s.wins, points: s.points, accuracy: s.accuracy});
        }
        return send(200, {players: [...board.values()].sort((x, y) => y.wins - x.wins || y.points - x.points).slice(0, 100)});
      }
      throw new ApiError(404, 'Not found');
    } catch (e) {
      if (!(e instanceof ApiError)) console.error(e);
      if (res.headersSent) return res.destroy();
      send(e.status || 500, {error: e instanceof ApiError ? e.message : 'Server error'});
    }
  }
  const server = http.createServer(handle);
  server.requestTimeout = 15000;
  return {server, db, close: () => new Promise(resolve => {server.close(() => {db.close(); resolve();}); server.closeAllConnections();})};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const service = createService({database: process.env.ONLINE_DB || 'online.sqlite', allowedOrigins: (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)});
  service.server.listen(Number(process.env.PORT || 8080), process.env.BIND || '127.0.0.1', () => console.log(`PubQuiz Online on http://${process.env.BIND || '127.0.0.1'}:${process.env.PORT || 8080} (put HTTPS in front before going public)`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => service.close().then(() => process.exit(0)));
}
