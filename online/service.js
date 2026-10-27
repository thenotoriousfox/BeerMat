// BeerMat Online: the optional internet service for player profiles, statistics and achievements across venues,
// venue pages and quiz event listings. A quiz never needs it: laptops run quizzes offline and players join as guests.
// It runs anywhere Node 22 runs (online/deploy.sh puts it on a server); docs/ONLINE.md covers the API, the data kept
// and the deployment.
//
//   node online/service.js         PORT (8080), ONLINE_DB (online.sqlite), ALLOWED_ORIGINS (comma-separated web origins),
//                                  BACKUP_DIR (where nightly backups land, shown to admins), TRUST_PROXY=1 (behind Caddy)
//
// Venues: only admins add venues, in the admin console (/admin). An admin links a venue to its operator's account; the
// operator then edits its profile, publishes its quiz nights and registers its quiz laptops. The venues are copied
// nightly to venues.json in the repository (GET /v1/venues.json), the app's fallback when the service is down.
//
// Trust: quiz results only come from claims signed by a quiz laptop (claims.js). A claim from a laptop key that a
// venue has registered counts towards statistics and achievements; one from a venue the service has verified also
// counts on public leaderboards. Players' own submissions are never trusted for scores.
import http from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes, scryptSync, timingSafeEqual, createHash} from 'node:crypto';
import {readFileSync, existsSync, statSync, readdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyClaim, keyId, validKey} from '../shared/claims.js';
import {summarize, achievements} from '../shared/achievements.js';
import {parseVenueList, checkQuizNights} from '../shared/venues.js';
import {signLicence, plans} from '../shared/licence.js';

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
// Venues' regular quiz nights are UK local times. london(t) is the date and time in London at t; londonTime() the
// moment a London date and time happens (summer time included).
const londonFormat = new Intl.DateTimeFormat('en-GB', {timeZone: 'Europe/London', year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'long', hour: 'numeric', minute: 'numeric', hourCycle: 'h23'});
const london = t => Object.fromEntries(londonFormat.formatToParts(t).map(p => [p.type, p.value]));
const londonTime = (y, m, d, h, mi) => {
  const guess = Date.UTC(y, m - 1, d, h, mi), at = london(guess);
  return guess - (Date.UTC(+at.year, at.month - 1, +at.day, +at.hour, +at.minute) - guess);
};

const venuesTable = name => `CREATE TABLE IF NOT EXISTS ${name}(id TEXT PRIMARY KEY, owner TEXT REFERENCES accounts(id) ON DELETE SET NULL, name TEXT NOT NULL,
  town TEXT NOT NULL, postcode TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '', website TEXT NOT NULL DEFAULT '', lat REAL, lon REAL,
  verified INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL, quiz_nights TEXT NOT NULL DEFAULT '[]', listed INTEGER NOT NULL DEFAULT 0, edited TEXT NOT NULL DEFAULT '[]',
  plan TEXT NOT NULL DEFAULT 'free', plan_until INTEGER);`;

export function createService({database = 'online.sqlite', now = Date.now, allowedOrigins = [], appDir = path.join(here, '..', 'mobile', 'www'), adminDir = path.join(here, 'admin'), backupDir = '', trustProxy = false, licenceKey = '', publicUrl = '', mail = null, pagesDir = path.join(here, 'pages')} = {}) {
  const startedAt = now();
  const db = new DatabaseSync(database);
  // Before the venue list, every venue had to have an owner: rebuild that table once (foreign keys off, so nothing
  // that points at a venue is lost).
  if (db.prepare("SELECT 1 FROM sqlite_master WHERE name='venues'").get() && db.prepare('PRAGMA table_info(venues)').all().find(c => c.name === 'owner')?.notnull) {
    db.exec(`PRAGMA foreign_keys=OFF; BEGIN; ${venuesTable('venues_new')}
      INSERT INTO venues_new(id,owner,name,town,postcode,address,website,lat,lon,verified,created) SELECT id,owner,name,town,postcode,address,website,lat,lon,verified,created FROM venues;
      DROP TABLE venues; ALTER TABLE venues_new RENAME TO venues; COMMIT;`);
  }
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY, email TEXT UNIQUE COLLATE NOCASE NOT NULL, password TEXT NOT NULL, created INTEGER NOT NULL,
      display_name TEXT NOT NULL, preferred_team TEXT NOT NULL DEFAULT '', avatar TEXT, privacy TEXT NOT NULL DEFAULT '{}', admin INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY, account TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
    ${venuesTable('venues')}
    CREATE TABLE IF NOT EXISTS venue_keys(key_id TEXT PRIMARY KEY, venue TEXT NOT NULL REFERENCES venues(id) ON DELETE CASCADE, public_key TEXT UNIQUE NOT NULL, added INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY, venue TEXT NOT NULL REFERENCES venues(id) ON DELETE CASCADE, title TEXT NOT NULL, starts INTEGER NOT NULL,
      format TEXT NOT NULL DEFAULT '', entry TEXT NOT NULL DEFAULT '', details TEXT NOT NULL DEFAULT '', cancelled INTEGER NOT NULL DEFAULT 0, updated INTEGER NOT NULL,
      regular INTEGER NOT NULL DEFAULT 0, occurs TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS favourites(account TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, venue TEXT NOT NULL REFERENCES venues(id) ON DELETE CASCADE, PRIMARY KEY(account, venue));
    CREATE TABLE IF NOT EXISTS results(account TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, event TEXT NOT NULL, team TEXT NOT NULL, venue_key TEXT NOT NULL,
      claim TEXT NOT NULL, date INTEGER NOT NULL, added INTEGER NOT NULL, PRIMARY KEY(account, event, team));
    CREATE TABLE IF NOT EXISTS venue_results(venue_key TEXT NOT NULL, event TEXT NOT NULL, summary TEXT NOT NULL, received INTEGER NOT NULL, PRIMARY KEY(venue_key, event));
    CREATE INDEX IF NOT EXISTS events_starts ON events(starts);
    CREATE TABLE IF NOT EXISTS email_tokens(hash TEXT PRIMARY KEY, account TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, purpose TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS reports(id TEXT PRIMARY KEY, kind TEXT NOT NULL, target TEXT NOT NULL, reason TEXT NOT NULL, reporter TEXT, created INTEGER NOT NULL, resolved INTEGER);
  `);
  // Email addresses are confirmed by a link. Accounts made before that existed count as confirmed.
  if (!db.prepare('PRAGMA table_info(accounts)').all().some(c => c.name === 'email_verified')) db.exec('ALTER TABLE accounts ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0; UPDATE accounts SET email_verified=1');
  // Quiz nights became a list of days and times (a short-lived quiz_night text column is left unused).
  // Quiz nights published from a venue's regular nights: regular=1, occurs = their London date.
  if (!db.prepare('PRAGMA table_info(events)').all().some(c => c.name === 'regular')) db.exec("ALTER TABLE events ADD COLUMN regular INTEGER NOT NULL DEFAULT 0; ALTER TABLE events ADD COLUMN occurs TEXT NOT NULL DEFAULT ''");
  if (!db.prepare('PRAGMA table_info(venues)').all().some(c => c.name === 'quiz_nights')) db.exec("ALTER TABLE venues ADD COLUMN quiz_nights TEXT NOT NULL DEFAULT '[]'");
  // A venue's plan: free, or pro until plan_until (no date: until an admin changes it).
  if (!db.prepare('PRAGMA table_info(venues)').all().some(c => c.name === 'plan')) db.exec("ALTER TABLE venues ADD COLUMN plan TEXT NOT NULL DEFAULT 'free'; ALTER TABLE venues ADD COLUMN plan_until INTEGER");
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
  const profile = a => ({id: a.id, admin: !!a.admin, email: a.email, emailVerified: !!a.email_verified, displayName: a.display_name, preferredTeam: a.preferred_team, avatar: a.avatar || null, privacy: privacy(a), created: a.created});
  const venueOut = v => ({id: v.id, name: v.name, town: v.town, postcode: v.postcode, address: v.address, website: v.website, lat: v.lat, lon: v.lon, quizNights: JSON.parse(v.quiz_nights || '[]'), verified: !!v.verified,
    directions: 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(v.postcode || v.lat === null ? [v.name, v.address, v.town, v.postcode].filter(Boolean).join(', ') : `${v.lat},${v.lon}`)});
  const londonDate = t => {const d = london(t); return `${d.year}-${d.month.padStart(2, '0')}-${d.day.padStart(2, '0')}`;};
  const eventOut = (e, v) => ({id: e.id, title: e.title, startsAt: e.starts, format: e.format, entry: e.entry, details: e.details, cancelled: !!e.cancelled, updated: e.updated, regular: !!e.regular, venue: venueOut(v)});
  // A venue's regular nights are published by themselves, four weeks ahead (topped up hourly and whenever its nights
  // or its own quiz nights change). A week its operator cancelled stays cancelled; a quiz it published itself on the
  // same day takes that day's place; nights it no longer holds are taken down.
  const AHEAD_DAYS = 28;
  function publishRegular(only) {
    for (const v of only ? rows('SELECT * FROM venues WHERE id=?', only) : rows('SELECT * FROM venues')) {
      const nights = JSON.parse(v.quiz_nights || '[]'), wanted = new Map();
      for (let i = 0; i <= AHEAD_DAYS; i++) {
        const day = london(now() + i * 86400000), night = nights.find(n => n.day === day.weekday.toLowerCase());
        if (!night) continue;
        const [h, mi] = night.time.split(':').map(Number), starts = londonTime(+day.year, +day.month, +day.day, h, mi);
        if (starts > now()) wanted.set(londonDate(starts), starts);
      }
      const own = new Set(rows('SELECT starts FROM events WHERE venue=? AND regular=0 AND cancelled=0 AND starts>?', v.id, now()).map(e => londonDate(e.starts)));
      const existing = new Map(rows('SELECT * FROM events WHERE venue=? AND regular=1 AND starts>?', v.id, now()).map(e => [e.occurs, e]));
      for (const [date, starts] of wanted) {
        const e = existing.get(date);
        if (own.has(date)) {if (e && !e.cancelled) run('DELETE FROM events WHERE id=?', e.id);}
        else if (!e) run('INSERT INTO events(id,venue,title,starts,updated,regular,occurs) VALUES(?,?,?,?,?,1,?)', id(), v.id, 'Quiz night', starts, now(), date);
        else if (!e.cancelled && e.starts !== starts) run('UPDATE events SET starts=?,updated=? WHERE id=?', starts, now(), e.id);
      }
      for (const [date, e] of existing) if (!wanted.has(date)) run('DELETE FROM events WHERE id=?', e.id);
    }
  }
  const regularTimer = setInterval(() => publishRegular(), 3600000);
  regularTimer.unref();
  publishRegular();
  // Emails: a link to confirm the address (a week) or to choose a new password (an hour). Each link works once.
  const link = (account, purpose) => {
    const t = token(); run('DELETE FROM email_tokens WHERE account=? AND purpose=?', account, purpose);
    run('INSERT INTO email_tokens VALUES(?,?,?,?)', sha(t), account, purpose, now() + (purpose === 'reset' ? 3600000 : 7 * 86400000));
    return `${publicUrl.replace(/\/$/, '')}/${purpose === 'reset' ? 'reset' : 'verify'}?token=${t}`;
  };
  const useLink = (t, purpose) => {
    const row = typeof t === 'string' ? one('SELECT * FROM email_tokens WHERE hash=? AND purpose=? AND expires>?', sha(t), purpose, now()) : null;
    check(row, purpose === 'reset' ? 'This reset link has expired or was already used. Ask for a new one.' : 'This link has expired or was already used.', 400);
    run('DELETE FROM email_tokens WHERE hash=?', row.hash);
    return row.account;
  };
  const sendVerify = a => mail && publicUrl ? mail({to: a.email, subject: 'Confirm your BeerMat email address',
    text: `Hi ${a.display_name},\n\nConfirm this is your email address for BeerMat:\n${link(a.id, 'verify')}\n\nThe link works for a week. If you didn't make a BeerMat account, ignore this email.\n`}).catch(e => console.error('Email not sent:', e.message)) : null;
  const planOf = v => v.plan === 'pro' && (v.plan_until === null || v.plan_until > now()) ? 'pro' : 'free';
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
    if (!partial || body.quizNights !== undefined) {const {nights, error} = checkQuizNights(body.quizNights); check(!error, error); out.quiz_nights = JSON.stringify(nights);}
    for (const [k, lo, hi] of [['lat', -90, 90], ['lon', -180, 180]]) if (body[k] !== undefined) {check(body[k] === null || (typeof body[k] === 'number' && body[k] >= lo && body[k] <= hi), 'Invalid location'); out[k] = body[k];}
    check(('lat' in out) === ('lon' in out) && (out.lat === null) === (out.lon === null), 'Give both latitude and longitude');
    return out;
  }
  const update = (table, idValue, fields) => {const keys = Object.keys(fields); if (keys.length) run(`UPDATE ${table} SET ${keys.map(k => `${k}=?`).join(',')} WHERE id=?`, ...keys.map(k => fields[k]), idValue);};

  // The venue list: new venues are added, listed ones updated (except what their operator has changed since), and
  // listed venues no longer on it removed. A list that can't be read changes nothing.
  function importVenues(json) {
    const {venues, errors} = parseVenueList(json);
    if (!json || !Array.isArray(json.venues)) return {imported: 0, removed: 0, errors};
    const ids = new Set(venues.map(v => v.id));
    let removed = 0;
    db.exec('BEGIN');
    try {
      for (const v of venues) {
        const fields = {name: v.name, town: v.town, postcode: v.postcode, address: v.address, website: v.website, lat: v.lat, lon: v.lon, quiz_nights: JSON.stringify(v.quizNights)};
        const existing = one('SELECT edited FROM venues WHERE id=?', v.id);
        if (!existing) run('INSERT INTO venues(id,name,town,postcode,address,website,lat,lon,quiz_nights,listed,created) VALUES(?,?,?,?,?,?,?,?,?,1,?)', v.id, v.name, v.town, v.postcode, v.address, v.website, v.lat, v.lon, JSON.stringify(v.quizNights), now());
        else {
          const edited = new Set(JSON.parse(existing.edited));
          update('venues', v.id, Object.fromEntries(Object.entries(fields).filter(([k]) => !edited.has(k === 'lon' ? 'lat' : k))));
          run('UPDATE venues SET listed=1 WHERE id=?', v.id);
        }
      }
      for (const r of rows('SELECT id FROM venues WHERE listed=1')) if (!ids.has(r.id)) {run('DELETE FROM venues WHERE id=?', r.id); removed++;}
      db.exec('COMMIT');
    } catch (e) {db.exec('ROLLBACK'); throw e;}
    publishRegular();
    return {imported: venues.length, removed, errors};
  }

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
  const staticTypes = {'.woff2': 'font/woff2', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json'};

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
        const shared = {'/app/shared/online-client.js': path.join(here, 'client.js'), '/app/shared/achievements.js': path.join(here, '..', 'shared', 'achievements.js')};
        const base = path.resolve(shared[p] ? path.dirname(shared[p]) : appDir), file = shared[p] || path.resolve(base, decodeURIComponent(p.slice(5)) || 'index.html');
        check(file.startsWith(base + path.sep) && existsSync(file) && statSync(file).isFile() && staticTypes[path.extname(file)], 'Not found', 404);
        res.writeHead(200, {'Content-Type': staticTypes[path.extname(file)], 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-cache',
          'Content-Security-Policy': "default-src 'self'; img-src 'self' data: https://tile.openstreetmap.org; connect-src *; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'"});
        return res.end(readFileSync(file));
      }
      // BeerMat's logos and font, for the web app and the admin console.
      if (method === 'GET' && p.startsWith('/brand/')) {
        const name = p.slice(7), file = path.join(here, '..', 'brand', name);
        check(/^(mark|logo|logo-stacked|wordmark|mark-print|logo-print)\.svg$|^fredoka\.woff2$/.test(name) && existsSync(file), 'Not found', 404);
        res.writeHead(200, {'Content-Type': staticTypes[path.extname(name)], 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'max-age=86400'});
        return res.end(readFileSync(file));
      }
      // The pages emailed links open: confirm an email address, choose a new password.
      if (method === 'GET' && (p === '/verify' || p === '/reset' || p === '/pages/pages.js' || p === '/pages/pages.css')) {
        const file = path.join(pagesDir, {'/verify': 'verify.html', '/reset': 'reset.html'}[p] || path.basename(p));
        res.writeHead(200, {'Content-Type': staticTypes[path.extname(file)], 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-cache',
          'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"});
        return res.end(readFileSync(file));
      }
      // The admin console: its own pages; everything it shows comes from the admin API below.
      if (method === 'GET' && (p === '/admin' || p.startsWith('/admin/'))) {
        if (p === '/admin') {res.writeHead(302, {Location: '/admin/'}); return res.end();}
        const base = path.resolve(adminDir), file = path.resolve(base, decodeURIComponent(p.slice(7)) || 'index.html');
        check(file.startsWith(base + path.sep) && existsSync(file) && statSync(file).isFile() && staticTypes[path.extname(file)], 'Not found', 404);
        res.writeHead(200, {'Content-Type': staticTypes[path.extname(file)], 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-cache',
          'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; connect-src 'self' https://api.postcodes.io; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"});
        return res.end(readFileSync(file));
      }
      // The venue list, in venues.json's format: copied nightly into the repository (.github/workflows/venues-backup.yml).
      if (method === 'GET' && p === '/v1/venues.json') {
        return send(200, {venues: rows('SELECT * FROM venues ORDER BY id').map(v => ({id: v.id, name: v.name, town: v.town, ...(v.postcode && {postcode: v.postcode}),
          ...(v.address && {address: v.address}), ...(v.website && {website: v.website}), ...(v.lat !== null && {lat: v.lat, lon: v.lon}), quizNights: JSON.parse(v.quiz_nights || '[]')}))});
      }
      check(p.startsWith('/v1/'), 'Not found', 404);
      // Behind Caddy every request comes from 127.0.0.1; the client's address is the last one Caddy adds.
      const ip = (trustProxy && req.headers['x-forwarded-for']?.split(',').pop().trim()) || req.socket.remoteAddress || '';
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
        sendVerify(one('SELECT * FROM accounts WHERE id=?', accountId));
        return send(201, {token: session(accountId), account: profile(one('SELECT * FROM accounts WHERE id=?', accountId))});
      }
      if (method === 'POST' && p === '/v1/sessions') {
        limit('signin:' + ip); limit('signin:' + String(input.email).toLowerCase());
        const found = typeof input.email === 'string' && typeof input.password === 'string' ? one('SELECT * FROM accounts WHERE email=?', input.email.trim().toLowerCase()) : null;
        check(found && passwordOk(input.password, found.password), 'Email or password not recognised', 401);
        return send(200, {token: session(found.id), account: profile(found)});
      }
      // Confirming the email address, and a new password by email (the same answer whether or not the address has an
      // account, so it can't be used to find out who has one).
      if (method === 'POST' && p === '/v1/me/verify') {
        const a = me(); check(!a.email_verified, 'Your email address is already confirmed');
        check(mail && publicUrl, 'Email isn’t set up on this service yet', 503);
        limit('verify:' + a.id); await sendVerify(a); return send(200, {sent: true});
      }
      if (method === 'POST' && p === '/v1/verify') {run('UPDATE accounts SET email_verified=1 WHERE id=?', useLink(input.token, 'verify')); return send(200, {verified: true});}
      if (method === 'POST' && p === '/v1/password-reset') {
        limit('reset:' + ip); limit('reset:' + String(input.email).toLowerCase());
        check(mail && publicUrl, 'Password reset isn’t set up on this service yet. Ask BeerMat for help.', 503);
        const a = typeof input.email === 'string' ? one('SELECT * FROM accounts WHERE email=?', input.email.trim().toLowerCase()) : null;
        if (a) await mail({to: a.email, subject: 'Reset your BeerMat password', text: `Hi ${a.display_name},\n\nChoose a new BeerMat password here:\n${link(a.id, 'reset')}\n\nThe link works for an hour. If you didn't ask for this, ignore this email: your password stays the same.\n`})
          .catch(e => {console.error('Email not sent:', e.message); throw new ApiError(502, 'The email couldn’t be sent. Try again later.');});
        return send(200, {sent: true});
      }
      if (method === 'POST' && p === '/v1/password-reset/confirm') {
        check(typeof input.password === 'string' && input.password.length >= 10 && input.password.length <= 200, 'Password must be at least 10 characters');
        const accountId = useLink(input.token, 'reset');
        // The link came by email, so the address is confirmed too; every signed-in device is signed out.
        run('UPDATE accounts SET password=?,email_verified=1 WHERE id=?', hashPassword(input.password), accountId);
        run('DELETE FROM sessions WHERE account=?', accountId);
        return send(200, {reset: true});
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
        // A venue it ran stays (it belongs to the venue list), without an operator.
        run('DELETE FROM accounts WHERE id=?', a.id);
        return send(200, {deleted: true});
      }

      // ---- Results (signed by a quiz laptop) ----
      if (method === 'POST' && p === '/v1/me/results') {
        const a = me(), claim = input.claim;
        check(claim && typeof claim === 'object' && claim.kind === 'beermat.result' && claim.v === 1, 'Not a BeerMat result');
        check(verifyClaim(claim), 'This result was not signed by a quiz laptop, or has been changed', 422);
        check(typeof claim.event === 'string' && claim.event.length <= 40 && typeof claim.team === 'string' && claim.team.length <= 40 && Number.isSafeInteger(claim.date), 'Not a BeerMat result');
        const r = claim.result;
        check(r && [r.rank, r.teams, r.answered, r.correct].every(Number.isSafeInteger) && typeof r.points === 'number' && r.correct <= r.answered && r.rank >= 1 && r.rank <= r.teams, 'Not a BeerMat result');
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

      // ---- Reports: anyone can flag a venue page that looks wrong or abusive; admins see them in the console ----
      if (method === 'POST' && p === '/v1/reports') {
        limit('report:' + ip);
        check(input.kind === 'venue' && typeof input.target === 'string' && one('SELECT 1 FROM venues WHERE id=?', input.target), 'Venue not found', 404);
        const reason = text(input.reason, 500, {required: true, name: 'What’s wrong'});
        run('INSERT INTO reports(id,kind,target,reason,reporter,created) VALUES(?,?,?,?,?,?)', id(), 'venue', input.target, reason, account?.id ?? null, now());
        return send(201, {reported: true});
      }

      // ---- Admin console ----
      const admin = () => {const a = me(); check(a.admin, 'Admins only', 403); return a;};
      if (method === 'GET' && p === '/v1/admin/overview') {
        admin();
        const n = (sql, ...a) => one(sql, ...a).n;
        let lastBackup = null;
        try {const times = readdirSync(backupDir).filter(f => f.endsWith('.sqlite')).map(f => statSync(path.join(backupDir, f)).mtimeMs); if (times.length) lastBackup = Math.max(...times);} catch {}
        return send(200, {venues: n('SELECT COUNT(*) n FROM venues'), verifiedVenues: n('SELECT COUNT(*) n FROM venues WHERE verified=1'), operatedVenues: n('SELECT COUNT(*) n FROM venues WHERE owner IS NOT NULL'),
          mappedVenues: n('SELECT COUNT(*) n FROM venues WHERE lat IS NOT NULL'), proVenues: n("SELECT COUNT(*) n FROM venues WHERE plan='pro' AND (plan_until IS NULL OR plan_until>?)", now()), accounts: n('SELECT COUNT(*) n FROM accounts'), admins: n('SELECT COUNT(*) n FROM accounts WHERE admin=1'),
          newAccounts: n('SELECT COUNT(*) n FROM accounts WHERE created>?', now() - 7 * 86400000), results: n('SELECT COUNT(*) n FROM results'), laptops: n('SELECT COUNT(*) n FROM venue_keys'),
          venueResults: n('SELECT COUNT(*) n FROM venue_results'), upcoming: n('SELECT COUNT(*) n FROM events WHERE cancelled=0 AND starts>? AND starts<?', now(), now() + 7 * 86400000),
          openReports: n('SELECT COUNT(*) n FROM reports WHERE resolved IS NULL'), databaseBytes: (() => {try {return statSync(database).size;} catch {return null;}})(), lastBackup, startedAt, now: now()});
      }
      if (method === 'GET' && p === '/v1/admin/venues') {
        admin();
        return send(200, {venues: rows('SELECT v.*, a.email operator_email, a.display_name operator_name FROM venues v LEFT JOIN accounts a ON a.id=v.owner ORDER BY v.name COLLATE NOCASE').map(v => ({
          ...venueOut(v), operator: v.owner ? {email: v.operator_email, name: v.operator_name} : null, plan: planOf(v), planSet: v.plan, planUntil: v.plan_until,
          laptops: rows('SELECT key_id id, added FROM venue_keys WHERE venue=? ORDER BY added', v.id),
          upcoming: rows('SELECT * FROM events WHERE venue=? AND cancelled=0 AND starts>? ORDER BY starts LIMIT 20', v.id, now()).map(e => ({id: e.id, title: e.title, startsAt: e.starts, regular: !!e.regular})),
          sharedResults: rows('SELECT r.summary, r.received FROM venue_results r JOIN venue_keys k ON k.public_key=r.venue_key WHERE k.venue=? ORDER BY r.received DESC LIMIT 10', v.id)
            .map(r => {const sum = JSON.parse(r.summary); return {title: sum.title, date: sum.date, teams: sum.teams.length, winner: sum.teams.find(t => t.rank === 1)?.name || '', received: r.received};}),
        }))});
      }
      if (method === 'GET' && p === '/v1/admin/reports') {
        admin();
        const list = rows(`SELECT r.*, v.name venue_name, a.email reporter_email FROM reports r LEFT JOIN venues v ON r.kind='venue' AND v.id=r.target LEFT JOIN accounts a ON a.id=r.reporter
          WHERE ?=1 OR r.resolved IS NULL ORDER BY r.created DESC LIMIT 200`, Number(url.searchParams.get('all') === '1'));
        return send(200, {reports: list.map(r => ({id: r.id, kind: r.kind, target: r.target, targetName: r.venue_name || '(removed)', reason: r.reason, reporter: r.reporter_email || null, created: r.created, resolved: r.resolved}))});
      }
      if (method === 'PATCH' && parts[0] === 'admin' && parts[1] === 'reports' && parts.length === 3) {
        admin(); check(one('SELECT 1 FROM reports WHERE id=?', parts[2]), 'Report not found', 404);
        run('UPDATE reports SET resolved=? WHERE id=?', input.resolved === false ? null : now(), parts[2]);
        return send(200, {ok: true});
      }
      if (method === 'GET' && p === '/v1/admin/accounts') {
        admin();
        const q = (url.searchParams.get('q') || '').trim().toLowerCase().slice(0, 100), like = `%${q.replace(/[%_]/g, '')}%`;
        const list = rows(`SELECT a.id, a.email, a.display_name, a.created, a.admin, a.email_verified, a.avatar IS NOT NULL photo, (SELECT COUNT(*) FROM results r WHERE r.account=a.id) results,
          (SELECT group_concat(v.name, ', ') FROM venues v WHERE v.owner=a.id) venues FROM accounts a WHERE ?='' OR lower(a.email) LIKE ? OR lower(a.display_name) LIKE ? ORDER BY a.created DESC LIMIT 200`, q, like, like);
        return send(200, {total: one('SELECT COUNT(*) n FROM accounts').n, accounts: list.map(r => ({id: r.id, email: r.email, emailVerified: !!r.email_verified, displayName: r.display_name, created: r.created, admin: !!r.admin, photo: !!r.photo, results: r.results, venues: r.venues || ''}))});
      }
      if (parts[0] === 'admin' && parts[1] === 'accounts' && parts.length === 3 && (method === 'PATCH' || method === 'DELETE')) {
        const a = admin(), target = one('SELECT * FROM accounts WHERE id=?', parts[2]); check(target, 'Account not found', 404);
        if (method === 'DELETE') {check(target.id !== a.id, 'You can’t delete your own account here'); run('DELETE FROM accounts WHERE id=?', target.id); return send(200, {deleted: true});}
        if (input.admin !== undefined) {check(typeof input.admin === 'boolean', 'Invalid setting'); check(input.admin || target.id !== a.id, 'You can’t remove your own admin rights'); run('UPDATE accounts SET admin=? WHERE id=?', Number(input.admin), target.id);}
        if (input.removePhoto === true) run('UPDATE accounts SET avatar=NULL WHERE id=?', target.id);
        return send(200, {ok: true});
      }

      // An admin sets a venue's plan by hand (free, or pro with or without an end date).
      if (method === 'PATCH' && parts[0] === 'admin' && parts[1] === 'venues' && parts.length === 3) {
        admin();
        const v = one('SELECT * FROM venues WHERE id=?', parts[2]); check(v, 'Venue not found', 404);
        check(plans.includes(input.plan), 'Plan must be free or pro');
        check(input.planUntil === undefined || input.planUntil === null || (Number.isSafeInteger(input.planUntil) && input.planUntil > 0), 'The end date must be a timestamp');
        run('UPDATE venues SET plan=?,plan_until=? WHERE id=?', input.plan, input.plan === 'pro' ? input.planUntil ?? null : null, v.id);
        return send(200, {ok: true});
      }

      // ---- Licences for quiz laptops ----
      // A laptop asks with a request signed by its venue key; the licence names its venue's plan. It lasts until the
      // plan ends (at most a month ahead, so it is renewed) plus two weeks, for laptops that are seldom online.
      if (method === 'POST' && p === '/v1/licence') {
        limit('licence:' + ip);
        check(licenceKey, 'Licences aren’t set up on this service yet', 503);
        check(input.kind === 'beermat.licence-request' && input.v === 1 && Number.isSafeInteger(input.at) && verifyClaim(input), 'Not a licence request from a quiz laptop');
        check(Math.abs(now() - input.at) < 10 * 60000, 'This laptop’s clock is wrong: set its date and time, then try again');
        const v = venueOfKey(input.venueKey);
        check(v, 'Register this laptop with your venue first (desk: Venue)', 403);
        const plan = planOf(v), month = 31 * 86400000, grace = 14 * 86400000;
        const expires = (plan === 'pro' ? Math.min(v.plan_until ?? Infinity, now() + month) : now() + month) + grace;
        return send(200, {licence: signLicence({plan, venue: v.id, venueName: v.name, venueKey: input.venueKey, issued: now(), expires, paidUntil: plan === 'pro' ? v.plan_until : null}, licenceKey)});
      }

      // ---- Venues and events (venue operators) ----
      const myVenue = venueId => {const v = one('SELECT * FROM venues WHERE id=?', venueId); check(v, 'Venue not found', 404); check(v.owner === me().id || me().admin, 'Only the venue’s operator can change it', 403); return v;};
      if (method === 'GET' && p === '/v1/me/venues') return send(200, {venues: rows('SELECT * FROM venues WHERE owner=? ORDER BY name', me().id).map(v => ({...venueOut(v), keys: rows('SELECT key_id FROM venue_keys WHERE venue=?', v.id).map(k => k.key_id)}))});
      // Every venue, for the map: public details and its next quiz night.
      if (method === 'GET' && p === '/v1/venues') {
        const next = v => {const e = one('SELECT * FROM events WHERE venue=? AND starts>? AND cancelled=0 ORDER BY starts LIMIT 1', v.id, now() - 6 * 3600000); return e ? {id: e.id, title: e.title, startsAt: e.starts} : null;};
        return send(200, {venues: rows('SELECT * FROM venues ORDER BY name COLLATE NOCASE').map(v => ({...venueOut(v), next: next(v)})), fetchedAt: now()});
      }
      // Venues don't add themselves: they come from the venue list, or an admin adds one here.
      if (method === 'POST' && p === '/v1/venues') {
        check(me().admin, 'Venues are added by BeerMat: ask to be added', 403);
        // A readable id from the name and town (it never changes, and names the venue in venues.json).
        const fields = validVenue(input), slug = `${fields.name}-${fields.town}`.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'venue';
        let venueId = slug;
        for (let i = 2; one('SELECT 1 FROM venues WHERE id=?', venueId); i++) venueId = `${slug}-${i}`;
        run('INSERT INTO venues(id,name,town,postcode,address,website,lat,lon,quiz_nights,created) VALUES(?,?,?,?,?,?,?,?,?,?)', venueId, fields.name, fields.town, fields.postcode, fields.address, fields.website, fields.lat ?? null, fields.lon ?? null, fields.quiz_nights, now());
        publishRegular(venueId);
        return send(201, venueOut(one('SELECT * FROM venues WHERE id=?', venueId)));
      }
      if (parts[0] === 'venues' && parts.length >= 2) {
        if (method === 'GET' && parts.length === 2) {
          const v = one('SELECT * FROM venues WHERE id=?', parts[1]); check(v, 'Venue not found', 404);
          return send(200, {...venueOut(v), events: rows('SELECT * FROM events WHERE venue=? AND starts>? AND cancelled=0 ORDER BY starts', v.id, now() - 6 * 3600000).map(e => eventOut(e, v))});
        }
        // The operator edits the venue's profile; what they change stays theirs when the list is imported again.
        if (method === 'PATCH' && parts.length === 2) {
          const v = myVenue(parts[1]), fields = validVenue(input, true);
          update('venues', v.id, fields);
          if (fields.quiz_nights !== undefined) publishRegular(v.id);
          run('UPDATE venues SET edited=? WHERE id=?', JSON.stringify([...new Set([...JSON.parse(v.edited), ...Object.keys(fields).filter(k => k !== 'lon')])]), v.id);
          return send(200, venueOut(one('SELECT * FROM venues WHERE id=?', v.id)));
        }
        if (method === 'DELETE' && parts.length === 2) {const v = myVenue(parts[1]); check(me().admin, 'Ask BeerMat to take a venue off', 403); run('DELETE FROM venues WHERE id=?', v.id); return send(200, {ok: true});}
        // An admin links the venue to its operator's account (or unlinks it with {email: null}).
        if (method === 'POST' && parts[2] === 'operator' && parts.length === 3) {
          check(me().admin, 'Admins only', 403);
          const v = one('SELECT * FROM venues WHERE id=?', parts[1]); check(v, 'Venue not found', 404);
          const account = input.email === null ? null : one('SELECT id FROM accounts WHERE email=?', String(input.email || '').trim().toLowerCase());
          check(input.email === null || account, 'No account uses that email', 404);
          run('UPDATE venues SET owner=? WHERE id=?', account?.id ?? null, v.id);
          return send(200, {ok: true});
        }
        // The quiz laptop's key (desk: Past quizzes → BeerMat Online), so its results count for this venue.
        if (method === 'POST' && parts[2] === 'keys') {
          const v = myVenue(parts[1]);
          check(typeof input.publicKey === 'string' && /^[A-Za-z0-9+/=]{40,120}$/.test(input.publicKey), 'Paste the laptop’s venue key from the quiz desk');
          check(validKey(input.publicKey), 'That is not a BeerMat venue key');
          const owner = one('SELECT venue FROM venue_keys WHERE public_key=?', input.publicKey);
          check(!owner || owner.venue === v.id, 'That laptop is registered to another venue', 409);
          run('INSERT OR IGNORE INTO venue_keys VALUES(?,?,?,?)', keyId(input.publicKey), v.id, input.publicKey, now());
          return send(201, {keyId: keyId(input.publicKey)});
        }
        if (method === 'DELETE' && parts[2] === 'keys' && parts.length === 4) {const v = myVenue(parts[1]); run('DELETE FROM venue_keys WHERE venue=? AND key_id=?', v.id, parts[3]); return send(200, {ok: true});}
        if (method === 'POST' && parts[2] === 'events' && parts.length === 3) {
          const v = myVenue(parts[1]), e = validEvent(input), eventId = id();
          run('INSERT INTO events(id,venue,title,starts,format,entry,details,updated) VALUES(?,?,?,?,?,?,?,?)', eventId, v.id, e.title, e.starts, e.format, e.entry, e.details, now());
          publishRegular(v.id);
          return send(201, eventOut(one('SELECT * FROM events WHERE id=?', eventId), v));
        }
        // Admins mark a venue verified (checked to be real); its results then count on public leaderboards.
        if (method === 'POST' && parts[2] === 'verify') {check(me().admin, 'Admins only', 403); run('UPDATE venues SET verified=? WHERE id=?', input.verified === false ? 0 : 1, parts[1]); return send(200, {ok: true});}
      }
      if (parts[0] === 'events' && parts.length === 2 && (method === 'PATCH' || method === 'DELETE')) {
        const e = one('SELECT * FROM events WHERE id=?', parts[1]); check(e, 'Event not found', 404);
        const v = myVenue(e.venue);
        if (method === 'DELETE') run('UPDATE events SET cancelled=1,updated=? WHERE id=?', now(), e.id);
        // Changing one of the regular nights makes it the venue's own, so it isn't reset to the usual time.
        else {update('events', e.id, validEvent(input, true)); run('UPDATE events SET updated=?,regular=0 WHERE id=?', now(), e.id);}
        publishRegular(v.id);
        return send(200, eventOut(one('SELECT * FROM events WHERE id=?', e.id), v));
      }
      // Upcoming quizzes: by town, postcode area or a point the player chose to share (never stored).
      if (method === 'GET' && p === '/v1/events') {
        const q = (url.searchParams.get('q') || '').trim().slice(0, 80), lat = Number(url.searchParams.get('lat')), lon = Number(url.searchParams.get('lon'));
        const near = url.searchParams.has('lat') && Number.isFinite(lat) && Number.isFinite(lon) ? {lat, lon} : null;
        const radius = Math.min(Number(url.searchParams.get('radiusKm')) || 25, 200);
        check(q || near || url.searchParams.get('venue'), 'Search by town, postcode or location');
        const venues = new Map(rows('SELECT * FROM venues').map(v => [v.id, v]));
        let list = rows('SELECT * FROM events WHERE cancelled=0 AND starts>? AND starts<? ORDER BY starts LIMIT 500', now() - 3 * 3600000, now() + 120 * 86400000)
          .map(e => ({out: eventOut(e, venues.get(e.venue)), venue: venues.get(e.venue)}));
        if (url.searchParams.get('venue')) list = list.filter(x => x.venue.id === url.searchParams.get('venue'));
        if (q) {
          const term = q.toLowerCase(), area = postcodeArea(q);
          list = list.filter(x => x.venue.town.toLowerCase().includes(term) || x.venue.name.toLowerCase().includes(term) || (x.venue.postcode && postcodeArea(x.venue.postcode) === area));
        }
        let out = list.map(x => ({...x.out, ...(near && x.venue.lat !== null ? {distanceKm: Math.round(distance(near, x.venue) * 10) / 10} : {})}));
        if (near) out = out.filter(e => e.distanceKm !== undefined && e.distanceKm <= radius).sort((a, b) => a.distanceKm - b.distanceKm || a.startsAt - b.startsAt);
        return send(200, {events: out.slice(0, 50), fetchedAt: now()});
      }

      // ---- Venue results from quiz laptops (desk: Share results) ----
      if (method === 'POST' && p === '/v1/venue-results') {
        check(input.kind === 'beermat.event' && input.v === 1 && Array.isArray(input.teams) && input.teams.length <= 300, 'Not a BeerMat event summary');
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
  return {server, db, importVenues, publishRegular, close: () => new Promise(resolve => {clearInterval(regularTimer); server.close(() => {db.close(); resolve();}); server.closeAllConnections();})};
}

// Email through Resend (resend.com: RESEND_API_KEY, and MAIL_FROM on a domain verified there).
export const resendMail = (key, from) => async ({to, subject, text}) => {
  const response = await fetch('https://api.resend.com/emails', {method: 'POST', headers: {Authorization: 'Bearer ' + key, 'Content-Type': 'application/json'},
    body: JSON.stringify({from, to: [to], subject, text}), signal: AbortSignal.timeout(10000)});
  if (!response.ok) throw Error(`Resend said ${response.status}`);
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const service = createService({database: process.env.ONLINE_DB || 'online.sqlite', allowedOrigins: (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean),
    backupDir: process.env.BACKUP_DIR || '', trustProxy: process.env.TRUST_PROXY === '1', licenceKey: process.env.LICENCE_KEY_FILE && existsSync(process.env.LICENCE_KEY_FILE) ? readFileSync(process.env.LICENCE_KEY_FILE, 'utf8').trim() : '',
    publicUrl: process.env.PUBLIC_URL || '', mail: process.env.RESEND_API_KEY ? resendMail(process.env.RESEND_API_KEY, process.env.MAIL_FROM || 'BeerMat <noreply@example.com>') : null});
  service.server.listen(Number(process.env.PORT || 8080), process.env.BIND || '127.0.0.1', () => console.log(`BeerMat Online on http://${process.env.BIND || '127.0.0.1'}:${process.env.PORT || 8080} (put HTTPS in front before going public)`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => service.close().then(() => process.exit(0)));
}
