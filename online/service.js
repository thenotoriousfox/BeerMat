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
import {spawn} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes, scryptSync, timingSafeEqual, createHash, createHmac} from 'node:crypto';
import {readFileSync, existsSync, statSync, readdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyClaim, keyId, validKey} from '../shared/claims.js';
import {summarize, achievements} from '../shared/achievements.js';
import {parseVenueList, checkQuizNights} from '../shared/venues.js';
import {signLicence, signDeckTicket, plans} from '../shared/licence.js';
import {checkTheme, renameTheme, bundleOf} from '../shared/theme-bundle.js';
import {checkQuizFile, quizOutline, QUIZ_LIMITS} from '../shared/quiz-file.js';

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
// A quiz laptop as the account's other devices see it (the quizmaster link).
const deskRow = d => ({keyId: d.key_id, venueKey: d.public_key, name: d.name, title: d.title, role: d.role, addresses: JSON.parse(d.addresses), link: d.link, seen: d.seen});
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

export function createService({database = 'online.sqlite', now = Date.now, allowedOrigins = [], appDir = path.join(here, '..', 'mobile', 'www'), adminDir = path.join(here, 'admin'), backupDir = '', trustProxy = false, licenceKey = '', publicUrl = '', mail = null, pagesDir = path.join(here, 'pages'), stripe = null, adminEmail = '', fetchImpl = globalThis.fetch, ffmpeg = 'ffmpeg', renderPreview = null, drawPreviews = null} = {}) {
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
    CREATE TABLE IF NOT EXISTS quiz_runs(run TEXT PRIMARY KEY, received INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS venue_results(venue_key TEXT NOT NULL, event TEXT NOT NULL, summary TEXT NOT NULL, received INTEGER NOT NULL, PRIMARY KEY(venue_key, event));
    CREATE INDEX IF NOT EXISTS events_starts ON events(starts);
    CREATE TABLE IF NOT EXISTS email_tokens(hash TEXT PRIMARY KEY, account TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, purpose TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS stripe_events(id TEXT PRIMARY KEY, received INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS desks(key_id TEXT PRIMARY KEY, public_key TEXT NOT NULL, account TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, name TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '', role TEXT NOT NULL, addresses TEXT NOT NULL DEFAULT '[]', link TEXT, seen INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS tv_devices(hash TEXT PRIMARY KEY, account TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, name TEXT NOT NULL, created INTEGER NOT NULL, seen INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS tv_pairings(hash TEXT PRIMARY KEY, name TEXT NOT NULL, device TEXT, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS reports(id TEXT PRIMARY KEY, kind TEXT NOT NULL, target TEXT NOT NULL, reason TEXT NOT NULL, reporter TEXT, created INTEGER NOT NULL, resolved INTEGER);
    CREATE TABLE IF NOT EXISTS shared_buzzers(id TEXT PRIMARY KEY, name TEXT NOT NULL, venue TEXT REFERENCES venues(id) ON DELETE SET NULL, venue_key TEXT NOT NULL, audio BLOB,
      seconds REAL NOT NULL, created INTEGER NOT NULL, hidden INTEGER NOT NULL DEFAULT 0, removed INTEGER);
    CREATE TABLE IF NOT EXISTS shared_themes(id TEXT PRIMARY KEY, name TEXT NOT NULL, venue TEXT REFERENCES venues(id) ON DELETE SET NULL, venue_key TEXT NOT NULL,
      bundle TEXT, bytes INTEGER NOT NULL, look INTEGER NOT NULL, tv INTEGER NOT NULL, sounds INTEGER NOT NULL, created INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', reviewed INTEGER, note TEXT NOT NULL DEFAULT '', hidden INTEGER NOT NULL DEFAULT 0, removed INTEGER);
    CREATE TABLE IF NOT EXISTS shared_quizzes(id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', venue TEXT REFERENCES venues(id) ON DELETE SET NULL,
      venue_key TEXT NOT NULL, quiz TEXT, bytes INTEGER NOT NULL, rounds INTEGER NOT NULL, questions INTEGER NOT NULL, formats TEXT NOT NULL, outline TEXT NOT NULL,
      created INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', reviewed INTEGER, note TEXT NOT NULL DEFAULT '', hidden INTEGER NOT NULL DEFAULT 0, removed INTEGER);
    CREATE TABLE IF NOT EXISTS shared_theme_previews(theme TEXT NOT NULL REFERENCES shared_themes(id) ON DELETE CASCADE, kind TEXT NOT NULL, type TEXT NOT NULL, image BLOB NOT NULL,
      PRIMARY KEY(theme, kind));
  `);
  // Email addresses are confirmed by a link. Accounts made before that existed count as confirmed.
  if (!db.prepare('PRAGMA table_info(accounts)').all().some(c => c.name === 'email_verified')) db.exec('ALTER TABLE accounts ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0; UPDATE accounts SET email_verified=1');
  // Quiz nights became a list of days and times (a short-lived quiz_night text column is left unused).
  // Quiz nights published from a venue's regular nights: regular=1, occurs = their London date.
  if (!db.prepare('PRAGMA table_info(events)').all().some(c => c.name === 'regular')) db.exec("ALTER TABLE events ADD COLUMN regular INTEGER NOT NULL DEFAULT 0; ALTER TABLE events ADD COLUMN occurs TEXT NOT NULL DEFAULT ''");
  if (!db.prepare('PRAGMA table_info(venues)').all().some(c => c.name === 'quiz_nights')) db.exec("ALTER TABLE venues ADD COLUMN quiz_nights TEXT NOT NULL DEFAULT '[]'");
  // A venue's plan: free, or pro until plan_until (no date: until an admin changes it).
  if (!db.prepare('PRAGMA table_info(venues)').all().some(c => c.name === 'plan')) db.exec("ALTER TABLE venues ADD COLUMN plan TEXT NOT NULL DEFAULT 'free'; ALTER TABLE venues ADD COLUMN plan_until INTEGER");
  // Venues bought on the website: their Stripe customer and subscription, and whether an admin has approved them for
  // the map yet (venues added any other way are approved).
  if (!db.prepare('PRAGMA table_info(venues)').all().some(c => c.name === 'approved')) db.exec("ALTER TABLE venues ADD COLUMN approved INTEGER NOT NULL DEFAULT 1; ALTER TABLE venues ADD COLUMN stripe_customer TEXT; ALTER TABLE venues ADD COLUMN stripe_subscription TEXT");
  // A venue an admin has stopped from sharing buzzers (it shared clips it had no right to).
  // Offers: a venue that bought at the founding price (founding_offer), and holds one of the founding places once it
  // has paid (founding); the end of a free trial (trial_until), for the desk.
  if (!db.prepare('PRAGMA table_info(venues)').all().some(c => c.name === 'founding')) db.exec('ALTER TABLE venues ADD COLUMN founding_offer INTEGER NOT NULL DEFAULT 0; ALTER TABLE venues ADD COLUMN founding INTEGER NOT NULL DEFAULT 0; ALTER TABLE venues ADD COLUMN trial_until INTEGER');
  if (!db.prepare('PRAGMA table_info(venues)').all().some(c => c.name === 'library_banned')) db.exec('ALTER TABLE venues ADD COLUMN library_banned INTEGER NOT NULL DEFAULT 0');
  const one = (sql, ...a) => db.prepare(sql).get(...a), rows = (sql, ...a) => db.prepare(sql).all(...a), run = (sql, ...a) => db.prepare(sql).run(...a);
  const transaction = fn => {db.exec('BEGIN'); try {const result = fn(); db.exec('COMMIT'); return result;} catch (e) {db.exec('ROLLBACK'); throw e;}};
  // Phone deck relay: in-memory state pushed by laptops, read by phone decks through this service.
  const relays = new Map(); // keyId → {state, version, commands:[], streams:Set, updatedAt}
  const relaySecret = randomBytes(32);
  const relayCleanup = setInterval(() => {for (const [kid, r] of relays) if (now() - r.updatedAt > 90000) {for (const s of r.streams) try {s.end();} catch {} relays.delete(kid);}}, 30000);
  relayCleanup.unref?.();
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
    // A new venue's first password (setup) uses the reset page, with a week to do it.
    return `${publicUrl.replace(/\/$/, '')}/${purpose === 'verify' ? 'verify' : 'reset'}?token=${t}`;
  };
  const useLink = (t, ...purposes) => {
    const row = typeof t === 'string' ? one(`SELECT * FROM email_tokens WHERE hash=? AND purpose IN (${purposes.map(() => '?').join(',')}) AND expires>?`, sha(t), ...purposes, now()) : null;
    const purpose = purposes[0];
    check(row, purpose === 'reset' ? 'This reset link has expired or was already used. Ask for a new one.' : 'This link has expired or was already used.', 400);
    run('DELETE FROM email_tokens WHERE hash=?', row.hash);
    return row.account;
  };
  // An email in plain text and in BeerMat's look: the logo on a night band, a line or two, one big button.
  const email = ({to, subject, name, intro, button, url, outro}) => mail({to, subject,
    text: `Hi ${name},\n\n${intro}\n${url}\n\n${outro}\n\nBeerMat · ${publicUrl.replace(/^https:\/\/(online\.)?/, '')}\n`,
    html: emailHtml({base: publicUrl.replace(/\/$/, ''), title: subject, name, intro, button, url, outro})});
  const sendVerify = a => mail && publicUrl ? email({to: a.email, subject: 'Confirm your BeerMat email address', name: a.display_name,
    intro: 'Tap the button to confirm this is your email address for BeerMat.', button: 'Confirm my email', url: link(a.id, 'verify'),
    outro: 'The link works for a week. If you didn’t make a BeerMat account, you can ignore this email.'}).catch(e => console.error('Email not sent:', e.message)) : null;
  // A readable venue id from the name and town (it never changes, and names the venue in venues.json).
  function newVenueId(name, town) {
    const slug = `${name}-${town}`.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'venue';
    let venueId = slug;
    for (let i = 2; one('SELECT 1 FROM venues WHERE id=?', venueId); i++) venueId = `${slug}-${i}`;
    return venueId;
  }
  // ---- BeerMat Pro by subscription (Stripe) ----
  // A venue buys on the website: Stripe Checkout takes the payment, then its webhook tells us, and the venue, its
  // operator's account and its Pro plan are made here. Renewals, plan changes and cancellations arrive the same way.
  async function stripeApi(method, route, params = {}) {
    check(stripe?.secretKey, 'Payments aren’t set up on this service yet', 503);
    const body = new URLSearchParams();
    const add = (prefix, value) => {
      if (Array.isArray(value)) value.forEach((v, i) => add(`${prefix}[${i}]`, v));
      else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) add(`${prefix}[${k}]`, v);
      else if (value !== undefined && value !== null) body.append(prefix, String(value));
    };
    for (const [k, v] of Object.entries(params)) add(k, v);
    let response;
    try {
      response = await fetchImpl(`${stripe.apiBase || 'https://api.stripe.com'}/v1/${route}${method === 'GET' && body.size ? '?' + body : ''}`,
        {method, headers: {Authorization: 'Bearer ' + stripe.secretKey}, ...(method === 'GET' ? {} : {body}), signal: AbortSignal.timeout(15000)});
    } catch {throw new ApiError(502, 'The payment service can’t be reached. Try again in a minute.');}
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {console.error('Stripe', method, route, data.error?.message || response.status); throw new ApiError(502, 'The payment service said no. Try again, or email us.');}
    return data;
  }
  // Stripe signs each webhook: HMAC-SHA256 of "<time>.<body>" with the endpoint's secret, in the Stripe-Signature header.
  function stripeSigned(raw, header) {
    const parts = Object.fromEntries((header || '').split(',').map(x => x.split('=')).filter(x => x.length === 2).map(([k, v]) => [k, v]));
    const signatures = (header || '').split(',').filter(x => x.startsWith('v1=')).map(x => Buffer.from(x.slice(3), 'hex'));
    const time = Number(parts.t), expected = createHmac('sha256', stripe?.webhookSecret || '').update(`${parts.t}.${raw}`).digest();
    return !!stripe?.webhookSecret && Number.isFinite(time) && Math.abs(now() / 1000 - time) < 300 && signatures.some(sig => sig.length === expected.length && timingSafeEqual(sig, expected));
  }
  // Paid until the end of the current period, with two days for the renewal to arrive.
  const paidUntil = sub => ((sub.items?.data?.[0]?.current_period_end ?? sub.current_period_end) + 2 * 86400) * 1000;
  function applySubscription(sub) {
    const v = one('SELECT * FROM venues WHERE stripe_subscription=?', sub.id);
    if (!v) return;
    if (['active', 'trialing', 'past_due'].includes(sub.status)) run("UPDATE venues SET plan='pro',plan_until=?,trial_until=? WHERE id=?", paidUntil(sub), sub.status === 'trialing' && sub.trial_end ? sub.trial_end * 1000 : null, v.id);
    // A founding place is taken once the venue has paid (not while it's trying Pro).
    if (sub.status === 'active' && v.founding_offer && !v.founding) run('UPDATE venues SET founding=1 WHERE id=?', v.id);
    else if (['canceled', 'unpaid', 'incomplete_expired'].includes(sub.status)) run('UPDATE venues SET plan_until=? WHERE id=?', Math.min(v.plan_until ?? now(), now()), v.id);
  }
  async function checkoutCompleted(session) {
    if (session.mode !== 'subscription' || !session.subscription || one('SELECT 1 FROM venues WHERE stripe_subscription=?', session.subscription)) return;
    const m = session.metadata || {}, address = String(session.customer_details?.email || session.customer_email || m.email || '').trim().toLowerCase();
    const sub = await stripeApi('GET', `subscriptions/${session.subscription}`);
    // The operator's account: theirs if the email already has one, otherwise a new one they set a password for.
    let account = one('SELECT * FROM accounts WHERE email=?', address), made = false;
    if (!account) {
      const accountId = id(); made = true;
      run('INSERT INTO accounts(id,email,password,created,display_name,privacy) VALUES(?,?,?,?,?,?)', accountId, address, hashPassword(token()), now(), (m.contact || m.venue || 'BeerMat venue').slice(0, 40), JSON.stringify(defaultPrivacy));
      account = one('SELECT * FROM accounts WHERE id=?', accountId);
    }
    const venueId = newVenueId(m.venue, m.town);
    run(`INSERT INTO venues(id,owner,name,town,postcode,address,lat,lon,created,plan,plan_until,approved,stripe_customer,stripe_subscription,founding_offer,founding,trial_until) VALUES(?,?,?,?,?,?,?,?,?,'pro',?,0,?,?,?,?,?)`,
      venueId, account.id, m.venue, m.town, m.postcode || '', m.address || '', m.lat ? Number(m.lat) : null, m.lon ? Number(m.lon) : null, now(), paidUntil(sub), session.customer, session.subscription,
      m.founding === '1' ? 1 : 0, m.founding === '1' && sub.status === 'active' ? 1 : 0, sub.status === 'trialing' && sub.trial_end ? sub.trial_end * 1000 : null);
    if (mail && publicUrl) {
      const site = stripe.siteUrl || 'https://beermatquiz.co.uk';
      await email({to: address, subject: `Welcome to BeerMat Pro, ${m.venue}`, name: account.display_name,
        intro: made ? `Thanks for choosing BeerMat Pro for ${m.venue}. First, choose a password for your BeerMat account. Then download BeerMat for the quiz laptop, sign in on its Venue tab, and add your quiz nights.`
          : `Thanks for choosing BeerMat Pro for ${m.venue}. It’s linked to your BeerMat account, so sign in on the quiz desk’s Venue tab with your usual password and add your quiz nights.`,
        button: made ? 'Choose my password' : 'Download BeerMat', url: made ? link(account.id, 'setup') : `${site}/download`,
        outro: `Your pub goes on the BeerMat map once we’ve checked it, usually within a day. Download BeerMat: ${site}/download. Questions? Just reply to this email.`}).catch(e => console.error('Email not sent:', e.message));
      if (adminEmail) await mail({to: adminEmail, subject: `New BeerMat Pro venue to approve: ${m.venue}, ${m.town}`,
        text: `${m.venue}, ${[m.address, m.town, m.postcode].filter(Boolean).join(', ')}\nOperator: ${account.display_name} <${address}>\n\nApprove it for the map: ${publicUrl.replace(/\/$/, '')}/admin/#venues\n`}).catch(e => console.error('Email not sent:', e.message));
    }
  }
  // The offers on the website and at checkout: a free trial of Pro, and the founding price for the first venues to pay.
  const foundingLeft = () => stripe?.founding?.monthly && stripe?.founding?.yearly ? Math.max(0, (stripe.foundingPlaces ?? 20) - one('SELECT COUNT(*) n FROM venues WHERE founding=1').n) : 0;
  const trialDays = () => stripe?.trialDays ?? 14;
  const planOf = v => v.plan === 'pro' && (v.plan_until === null || v.plan_until > now()) ? 'pro' : 'free';
  // Only BeerMat Pro venues are on the map, in quiz listings and on public venue pages: they're the pubs running
  // BeerMat quizzes. A venue's operator and admins still see it, to get it ready before it goes Pro.
  const PRO_SQL = "plan='pro' AND (plan_until IS NULL OR plan_until>?) AND approved=1";
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

  // ---- The shared buzzer library ----
  // Quiz laptops of BeerMat Pro venues share short sound clips with each other. Anyone can see what's there (names
  // and lengths, never who shared them); playing, adding, sharing and reporting take a request signed by a Pro
  // venue's laptop. Clips go up straight away and come down when reported: three venues reporting one hides it until
  // an admin looks. Whoever shares a clip confirms they have the right to.
  function proLaptop(request, kind, {pro = true, what = 'The shared buzzer library'} = {}) {
    check(request && request.kind === kind && request.v === 1 && Number.isSafeInteger(request.at) && verifyClaim(request), 'Not a request from a quiz laptop');
    check(Math.abs(now() - request.at) < 10 * 60000, 'This laptop’s clock is wrong: set its date and time, then try again');
    const v = venueOfKey(request.venueKey);
    check(v, 'Register this laptop with your venue first (desk: Venue)', 403);
    check(!pro || planOf(v) === 'pro', `${what} is part of BeerMat Pro`, 403);
    return v;
  }
  // Any audio in; out comes MP3, mono, silence trimmed from both ends, at an even loudness, ten seconds at most.
  function transcode(audio) {
    return new Promise((resolve, reject) => {
      const trim = 'silenceremove=start_periods=1:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse';
      const child = spawn(ffmpeg, ['-v', 'error', '-i', 'pipe:0', '-t', '10', '-af', `${trim},loudnorm=I=-14:TP=-1`, '-ac', '1', '-ar', '44100', '-b:a', '128k', '-f', 'mp3', 'pipe:1'], {stdio: ['pipe', 'pipe', 'ignore']});
      const out = [], timer = setTimeout(() => child.kill('SIGKILL'), 20000);
      child.stdout.on('data', c => out.push(c));
      child.on('error', () => {clearTimeout(timer); reject(new ApiError(503, 'Sharing buzzers isn’t set up on this service yet'));});
      child.on('close', code => {clearTimeout(timer); const mp3 = Buffer.concat(out); code === 0 && mp3.length > 2000 ? resolve(mp3) : reject(new ApiError(400, 'That file isn’t a sound we can use. Try an MP3, Ogg or WAV.'));});
      child.stdin.on('error', () => {});
      child.stdin.end(audio);
    });
  }
  // A player on a public leaderboard is reported by a reference that doesn't reveal their account.
  const profileRef = accountId => sha('profile:' + accountId).slice(0, 20);
  const buzzerOut = b => ({id: b.id, name: b.name, seconds: Math.round(b.seconds * 10) / 10, added: b.created});
  // The theme library: as the buzzer library, but every theme waits for an admin before anyone sees it (its look.css
  // runs on other venues' TVs and phones), and it's checked twice (shared/theme-bundle.js) as well: here, under the
  // library id it gets, and on the laptop that installs it.
  const themeOut = t => ({id: t.id, name: t.name, look: !!t.look, tv: !!t.tv, sounds: !!t.sounds, bytes: t.bytes, added: t.created,
    previews: rows('SELECT kind FROM shared_theme_previews WHERE theme=? ORDER BY kind', t.id).map(r => r.kind)});
  // Previews: pictures of the theme on BeerMat Desk's TV and on a phone in the app, and in a phone's browser. JPEG, PNG
  // or WebP, 1 MB each. The desk that shares a theme sends the TV and app ones, and an admin may add them; this service
  // draws whichever a theme is missing, with drawPreviews (online/qt-preview.js: the desk's own Qt TV and app mock),
  // and the browser one with renderPreview (online/preview.js, a headless browser), when it has them. One theme at a
  // time, after the upload has been answered: a small server draws one picture at once.
  const PREVIEW_KINDS = ['tv', 'app', 'browser'];
  const pictureType = b => b[0] === 0xff && b[1] === 0xd8 ? 'image/jpeg' : b.subarray(0, 4).toString('latin1') === '\x89PNG' ? 'image/png'
    : b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' ? 'image/webp' : null;
  let drawing = Promise.resolve();
  function drawPictures(themeId) {
    drawing = drawing.then(async () => {
      const t = one('SELECT bundle FROM shared_themes WHERE id=? AND removed IS NULL', themeId); if (!t?.bundle) return;
      const has = new Set(rows('SELECT kind FROM shared_theme_previews WHERE theme=?', themeId).map(r => r.kind)), bundle = JSON.parse(t.bundle), drawn = {};
      if (drawPreviews && (!has.has('tv') || !has.has('app'))) Object.assign(drawn, await drawPreviews(bundle).catch(e => {console.error('Theme pictures failed:', e.message); return {};}));
      if (renderPreview && !has.has('browser')) drawn.browser = await renderPreview(bundle).catch(e => {console.error('Browser preview failed:', e.message); return null;});
      for (const [kind, image] of Object.entries(drawn)) {
        if (has.has(kind) || !image || !pictureType(image) || !one('SELECT 1 FROM shared_themes WHERE id=? AND removed IS NULL', themeId)) continue;
        run('INSERT OR REPLACE INTO shared_theme_previews VALUES(?,?,?,?)', themeId, kind, pictureType(image), image);
      }
    }).catch(e => console.error('Theme pictures failed:', e.message));
    return drawing;
  }
  function savePreviews(themeId, previews) {
    for (const [kind, data] of Object.entries(previews || {})) {
      check(['tv', 'app'].includes(kind) && typeof data === 'string' && data.length <= 1.4 * 1024 * 1024, 'Previews are a TV and an app picture, 1 MB each');
      const image = Buffer.from(data, 'base64'), type = pictureType(image);
      check(type, `The ${kind} preview isn’t a picture`);
      run('INSERT OR REPLACE INTO shared_theme_previews VALUES(?,?,?,?)', themeId, kind, type, image);
    }
  }
  // A theme that fails the checks is the sender's mistake (400, saying what's wrong), not a server error.
  const checkedTheme = (bundle, themeId) => {try {return renameTheme(checkTheme(bundle), themeId);} catch (e) {check(false, e.message);}};
  const sharedTheme = themeId => {const t = one('SELECT * FROM shared_themes WHERE id=? AND removed IS NULL', themeId); check(t, 'That theme isn’t in the library any more', 404); return t;};
  const themeLibrary = {what: 'The theme library'};
  // The quiz library: quiz files venues and BeerMat share, each with its pictures and sounds inside. As themes, every
  // quiz a venue shares waits for an admin before anyone sees it; BeerMat's own go straight in. Anyone sees what's in
  // it (title, description, rounds, formats, never the questions); downloading and sharing is BeerMat Pro. Checked
  // (shared/quiz-file.js) here and again on the laptop that downloads it.
  const quizOut = q => ({id: q.id, title: q.title, description: q.description, rounds: q.rounds, questions: q.questions, formats: JSON.parse(q.formats),
    outline: JSON.parse(q.outline), bytes: q.bytes, added: q.created, by: q.venue_key === 'beermat' ? 'BeerMat' : q.venue_name || ''});
  const quizLibrary = {what: 'The quiz library'};
  const checkedQuiz = (quiz, description) => {
    let checked; try {checked = checkQuizFile(quiz);} catch (e) {check(false, e.message);}
    return {...checked, description: text(description || '', QUIZ_LIMITS.description, {name: 'Description'})};
  };
  const storeQuiz = (quizId, checked, {venue = null, venueKey, status = 'pending'}) => run(
    'INSERT INTO shared_quizzes(id,title,description,venue,venue_key,quiz,bytes,rounds,questions,formats,outline,created,status,reviewed) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    quizId, checked.title, checked.description, venue, venueKey, JSON.stringify(checked.quiz), checked.bytes, checked.rounds, checked.questions,
    JSON.stringify(checked.formats), JSON.stringify(quizOutline(checked.quiz)), now(), status, status === 'approved' ? now() : null);
  const quizRow = quizId => one('SELECT q.*, v.name venue_name FROM shared_quizzes q LEFT JOIN venues v ON v.id=q.venue WHERE q.id=?', quizId);
  const sharedQuiz = quizId => {const q = quizRow(quizId); check(q && !q.removed, 'That quiz isn’t in the library any more', 404); return q;};
  const sharedBuzzer = buzzerId => {const b = one('SELECT * FROM shared_buzzers WHERE id=? AND removed IS NULL', buzzerId); check(b, 'That buzzer isn’t in the library any more', 404); return b;};

  async function body(req, max = 400 * 1024) {
    const chunks = []; let size = 0;
    for await (const chunk of req) {size += chunk.length; check(size <= max, 'Request too large', 413); chunks.push(chunk);}
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
        check(/^(mark|logo|logo-stacked|wordmark|mark-print|logo-print)\.svg$|^fredoka\.woff2$|^logo-email\.png$/.test(name) && existsSync(file), 'Not found', 404);
        res.writeHead(200, {'Content-Type': staticTypes[path.extname(name)], 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'max-age=86400'});
        return res.end(readFileSync(file));
      }
      // The pages emailed links open: confirm an email address, choose a new password.
      // And the quizmaster's devices: a TV signing in (/tv) and a phone approving it or running the quiz (/connect).
      // Both may try a laptop's own address on the device's network (connect-src http:) before its quizmaster link.
      const pageFiles = {'/verify': 'verify.html', '/reset': 'reset.html', '/tv': 'tv.html', '/connect': 'connect.html', '/pages/pages.js': 'pages.js', '/pages/pages.css': 'pages.css',
        '/pages/link.js': 'link.js', '/pages/tv.js': 'tv.js', '/pages/connect.js': 'connect.js', '/pages/qr.js': path.join('..', '..', 'web', 'qr.js')};
      if (method === 'GET' && pageFiles[p]) {
        const file = path.join(pagesDir, pageFiles[p]);
        res.writeHead(200, {'Content-Type': staticTypes[path.extname(file)], 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-cache',
          'Content-Security-Policy': `default-src 'self'; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'${p === '/tv' || p === '/connect' ? '; connect-src \'self\' http:' : ''}`});
        return res.end(readFileSync(file));
      }
      // The admin console: its own pages; everything it shows comes from the admin API below.
      if (method === 'GET' && (p === '/admin' || p.startsWith('/admin/'))) {
        if (p === '/admin') {res.writeHead(302, {Location: '/admin/'}); return res.end();}
        const base = path.resolve(adminDir), file = path.resolve(base, decodeURIComponent(p.slice(7)) || 'index.html');
        check(file.startsWith(base + path.sep) && existsSync(file) && statSync(file).isFile() && staticTypes[path.extname(file)], 'Not found', 404);
        res.writeHead(200, {'Content-Type': staticTypes[path.extname(file)], 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-cache',
          'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; media-src blob:; connect-src 'self' https://api.postcodes.io; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"});
        return res.end(readFileSync(file));
      }
      // The venue list, in venues.json's format: copied nightly into the repository (.github/workflows/venues-backup.yml).
      if (method === 'GET' && p === '/v1/venues.json') {
        return send(200, {venues: rows('SELECT * FROM venues ORDER BY id').map(v => ({id: v.id, ...(planOf(v) === 'pro' && {onMap: true}), name: v.name, town: v.town, ...(v.postcode && {postcode: v.postcode}),
          ...(v.address && {address: v.address}), ...(v.website && {website: v.website}), ...(v.lat !== null && {lat: v.lat, lon: v.lon}), quizNights: JSON.parse(v.quiz_nights || '[]')}))});
      }
      check(p.startsWith('/v1/'), 'Not found', 404);
      // Behind Caddy every request comes from 127.0.0.1; the client's address is the last one Caddy adds.
      const ip = (trustProxy && req.headers['x-forwarded-for']?.split(',').pop().trim()) || req.socket.remoteAddress || '';
      const auth = req.headers.authorization?.replace(/^Bearer /, '') || '';
      const account = auth ? one('SELECT a.* FROM sessions s JOIN accounts a ON a.id=s.account WHERE s.hash=? AND s.expires>?', sha(auth), now()) : null;
      const me = () => {check(account, 'Sign in first', 401); return account;};
      // Stripe's webhook: the body is checked byte for byte against its signature, so it's read raw. An event that
      // fails here (Stripe unreachable, say) isn't recorded, so Stripe sends it again.
      if (method === 'POST' && p === '/v1/stripe/webhook') {
        const chunks = []; let size = 0;
        for await (const chunk of req) {size += chunk.length; check(size <= 1024 * 1024, 'Request too large', 413); chunks.push(chunk);}
        const raw = Buffer.concat(chunks).toString('utf8');
        check(stripeSigned(raw, req.headers['stripe-signature']), 'Bad signature', 400);
        const event = JSON.parse(raw), object = event.data?.object || {};
        if (one('SELECT 1 FROM stripe_events WHERE id=?', event.id)) return send(200, {received: true});
        if (event.type === 'checkout.session.completed') await checkoutCompleted(object);
        else if (String(event.type).startsWith('customer.subscription.')) applySubscription(object);
        run('INSERT OR IGNORE INTO stripe_events VALUES(?,?)', event.id, now());
        return send(200, {received: true});
      }
      // A shared buzzer arrives as base64 audio: up to 2 MB of it.
      const input = ['POST', 'PATCH', 'PUT'].includes(method) ? await body(req, method === 'POST' && (p === '/v1/buzzers' || p === '/v1/admin/buzzers') ? 3 * 1024 * 1024 : method === 'POST' && (p === '/v1/themes' || p === '/v1/admin/themes' || p === '/v1/quizzes' || p === '/v1/admin/quizzes') ? 36 * 1024 * 1024 : method === 'PUT' && /^\/v1\/admin\/themes\/[^/]+\/previews$/.test(p) ? 3 * 1024 * 1024 : undefined) : {};
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
        if (a) await email({to: a.email, subject: 'Reset your BeerMat password', name: a.display_name, intro: 'Someone, hopefully you, asked to reset your BeerMat password. Tap the button to choose a new one.',
          button: 'Choose a new password', url: link(a.id, 'reset'), outro: 'The link works for an hour. If you didn’t ask for this, ignore this email: your password stays the same.'})
          .catch(e => {console.error('Email not sent:', e.message); throw new ApiError(502, 'The email couldn’t be sent. Try again later.');});
        return send(200, {sent: true});
      }
      if (method === 'POST' && p === '/v1/password-reset/confirm') {
        check(typeof input.password === 'string' && input.password.length >= 10 && input.password.length <= 200, 'Password must be at least 10 characters');
        const accountId = useLink(input.token, 'reset', 'setup');
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
          favourites: rows('SELECT venue FROM favourites WHERE account=?', a.id).map(f => f.venue), venues: rows('SELECT * FROM venues WHERE owner=?', a.id).map(venueOut),
          laptops: rows('SELECT * FROM desks WHERE account=?', a.id).map(deskRow), tvs: rows('SELECT name, created, seen FROM tv_devices WHERE account=?', a.id)});
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
      if (method === 'GET' && p === '/v1/me/favourites') return send(200, {venues: rows(`SELECT v.* FROM favourites f JOIN venues v ON v.id=f.venue WHERE f.account=? AND ${PRO_SQL.replaceAll('plan', 'v.plan')} ORDER BY v.name`, me().id, now()).map(venueOut)});
      if ((method === 'PUT' || method === 'DELETE') && parts[0] === 'me' && parts[1] === 'favourites' && parts.length === 3) {
        const a = me();
        if (method === 'PUT') {check(one('SELECT 1 FROM venues WHERE id=?', parts[2]), 'Venue not found', 404); run('INSERT OR IGNORE INTO favourites VALUES(?,?)', a.id, parts[2]);}
        else run('DELETE FROM favourites WHERE account=? AND venue=?', a.id, parts[2]);
        return send(200, {ok: true});
      }

      // ---- Buying BeerMat Pro on the website: a Stripe Checkout page for the venue's subscription ----
      if (method === 'GET' && p === '/v1/offers') return send(200, {trialDays: stripe ? trialDays() : 0, founding: {places: stripe?.foundingPlaces ?? 20, left: foundingLeft()}});
      if (method === 'POST' && p === '/v1/checkout') {
        limit('checkout:' + ip);
        check(stripe?.secretKey && stripe.prices, 'Payments aren’t set up yet. Email us instead.', 503);
        const venue = text(input.venue, 120, {required: true, name: 'Pub name'}), contact = text(input.name, 40, {required: true, name: 'Your name'});
        const street = text(input.address, 200, {name: 'Address'}), buyer = text(input.email, 200, {required: true, name: 'Email'}).toLowerCase();
        check(/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(buyer), 'Enter a valid email address');
        check(Object.hasOwn(stripe.prices, input.interval), 'Choose monthly or yearly');
        const postcode = text(input.postcode, 10, {required: true, name: 'Postcode'}).replace(/\s+/g, '').toUpperCase();
        let place;
        try {const r = await fetchImpl('https://api.postcodes.io/postcodes/' + encodeURIComponent(postcode), {signal: AbortSignal.timeout(8000)}); place = r.ok ? (await r.json()).result : null;}
        catch {throw new ApiError(502, 'We couldn’t check that postcode just now. Try again in a minute.');}
        check(place, 'That postcode wasn’t found. Check it and try again.');
        const town = (text(input.town, 80, {name: 'Town'}) || place.admin_district || place.parish || 'Unknown').slice(0, 80);
        const site = stripe.siteUrl || 'https://beermatquiz.co.uk';
        // The founding price while places are left; a free trial (no card asked) unless this email has had a venue before.
        const founding = foundingLeft() > 0, trial = trialDays() > 0 && !one('SELECT 1 FROM accounts a JOIN venues v ON v.owner=a.id WHERE a.email=?', buyer);
        const session = await stripeApi('POST', 'checkout/sessions', {mode: 'subscription', line_items: [{price: (founding ? stripe.founding : stripe.prices)[input.interval], quantity: 1}],
          // Never Stripe's Managed Payments (merchant of record, 3.5% more), even if the account turns it on by default.
          managed_payments: {enabled: false},
          customer_email: buyer, allow_promotion_codes: true, success_url: `${site}/pro/thanks`, cancel_url: `${site}/pro`,
          ...(trial && {payment_method_collection: 'if_required'}),
          metadata: {venue, contact, address: street, postcode: place.postcode, town, lat: String(place.latitude), lon: String(place.longitude), founding: founding ? '1' : '0'},
          // A trial ends by itself if no card was added by then: the venue goes back to Free, nothing is charged.
          subscription_data: {metadata: {venue}, ...(trial && {trial_period_days: trialDays(), trial_settings: {end_behavior: {missing_payment_method: 'cancel'}}})}});
        return send(200, {url: session.url});
      }

      // ---- Reports: anyone can flag a venue page that looks wrong or abusive; admins see them in the console ----
      // A player's name or picture on a public leaderboard (only players who chose to appear there can be reported).
      if (method === 'POST' && p === '/v1/reports' && input.kind === 'profile') {
        limit('report:' + ip);
        const target = typeof input.target === 'string' ? rows('SELECT id, privacy FROM accounts').find(a => privacy(a).leaderboards && profileRef(a.id) === input.target) : null;
        check(target, 'Player not found', 404);
        const reason = text(input.reason, 500, {required: true, name: 'What’s wrong'});
        run('INSERT INTO reports(id,kind,target,reason,reporter,created) VALUES(?,?,?,?,?,?)', id(), 'profile', target.id, reason, account?.id ?? null, now());
        return send(201, {reported: true});
      }
      if (method === 'POST' && p === '/v1/reports') {
        limit('report:' + ip);
        check(input.kind === 'venue' && typeof input.target === 'string' && one('SELECT 1 FROM venues WHERE id=?', input.target), 'Venue not found', 404);
        const reason = text(input.reason, 500, {required: true, name: 'What’s wrong'});
        run('INSERT INTO reports(id,kind,target,reason,reporter,created) VALUES(?,?,?,?,?,?)', id(), 'venue', input.target, reason, account?.id ?? null, now());
        return send(201, {reported: true});
      }

      // ---- The theme library (see themeOut) ----
      if (method === 'GET' && p === '/v1/themes') {
        const q = (url.searchParams.get('q') || '').trim().toLowerCase().slice(0, 60), like = `%${q.replace(/[%_]/g, '')}%`;
        return send(200, {themes: rows("SELECT id,name,look,tv,sounds,bytes,created FROM shared_themes WHERE removed IS NULL AND hidden=0 AND status='approved' AND (?='' OR lower(name) LIKE ?) ORDER BY created DESC LIMIT 500", q, like).map(themeOut)});
      }
      // Where a theme this laptop shared has got to (waiting, in the library, or turned down and why).
      if (method === 'GET' && parts[0] === 'themes' && parts.length === 2) {
        const t = one('SELECT id,name,status,note,hidden,removed FROM shared_themes WHERE id=?', parts[1]); check(t, 'No such theme', 404);
        return send(200, {id: t.id, name: t.name, status: t.removed ? 'removed' : t.hidden ? 'hidden' : t.status, note: t.status === 'rejected' ? t.note : ''});
      }
      if (method === 'POST' && p === '/v1/themes') {
        const request = input.request, v = proLaptop(request, 'beermat.theme-upload', themeLibrary);
        check(!v.library_banned, 'This venue can’t share any more. Email hello@beermatquiz.co.uk if you think that’s wrong.', 403);
        check(request.rights === true, 'Confirm you have the right to share everything in this theme');
        check(typeof input.bundle === 'string' && sha(input.bundle) === request.sha256, 'The theme doesn’t match what the laptop signed');
        check(one('SELECT COUNT(*) n FROM shared_themes WHERE venue=? AND created>?', v.id, now() - 86400000).n < 10, 'That’s 10 themes shared today: share more tomorrow', 429);
        let bundle; try {bundle = JSON.parse(input.bundle);} catch {check(false, 'Not a theme');}
        const themeId = 's-' + randomBytes(5).toString('hex'), theme = checkedTheme(bundle, themeId);
        checkTheme(bundleOf(theme));
        const stored = JSON.stringify(bundleOf(theme)), files = [...theme.files.keys()];
        if (input.previews !== undefined) check(input.previews && typeof input.previews === 'object' && !Array.isArray(input.previews), 'Previews are a TV and an app picture, 1 MB each');
        transaction(() => {
          run('INSERT INTO shared_themes(id,name,venue,venue_key,bundle,bytes,look,tv,sounds,created) VALUES(?,?,?,?,?,?,?,?,?,?)', themeId, theme.name, v.id, request.venueKey, stored,
            [...theme.files.values()].reduce((n, b) => n + b.length, 0), Number(files.includes('look.css')), Number(files.includes('tv.json')), Number(files.some(f => f.startsWith('sounds/'))), now());
          savePreviews(themeId, input.previews);
        });
        drawPictures(themeId);
        if (mail && adminEmail) mail({to: adminEmail, subject: `Theme waiting for a look: ${theme.name}`,
          text: `${v.name} shared “${theme.name}” (${files.length} files). It isn’t in the library until you approve it.\n\n${publicUrl.replace(/\/$/, '')}/admin/#themes\n`}).catch(e => console.error('Mail failed:', e.message));
        return send(201, {...themeOut(one('SELECT * FROM shared_themes WHERE id=?', themeId)), review: 'pending'});
      }
      // A preview of an approved theme (anyone may see it, as its name); an admin sees any theme's.
      if (method === 'GET' && parts[0] === 'themes' && parts.length === 4 && parts[2] === 'previews' && PREVIEW_KINDS.includes(parts[3])) {
        const t = one('SELECT * FROM shared_themes WHERE id=? AND removed IS NULL', parts[1]);
        const adminViewing = (() => {try {return !!me().admin;} catch {return false;}})();
        check(t && (adminViewing || (t.status === 'approved' && !t.hidden)), 'No such preview', 404);
        const picture = one('SELECT type,image FROM shared_theme_previews WHERE theme=? AND kind=?', t.id, parts[3]); check(picture, 'No such preview', 404);
        res.writeHead(200, {'Content-Type': picture.type, 'Cache-Control': adminViewing ? 'no-store' : 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff', 'Access-Control-Allow-Origin': '*'});
        return res.end(Buffer.from(picture.image));
      }
      if (method === 'POST' && parts[0] === 'themes' && parts.length === 3 && parts[2] === 'bundle') {
        // A BeerMat admin signed in on the desk downloads without a venue or Pro (to look at what's in the library).
        if (!account?.admin) {const request = input.request; proLaptop(request, 'beermat.theme-get', themeLibrary); check(request.theme === parts[1], 'Not a request for this theme');}
        const t = sharedTheme(parts[1]); check(t.status === 'approved' && !t.hidden, 'That theme isn’t in the library', 404);
        return send(200, {...themeOut(t), bundle: t.bundle});
      }
      // A venue takes back a theme it shared (whatever its plan now).
      if (method === 'POST' && parts[0] === 'themes' && parts.length === 3 && parts[2] === 'remove') {
        const request = input.request, v = proLaptop(request, 'beermat.theme-remove', {pro: false}); check(request.theme === parts[1], 'Not a request for this theme');
        const t = sharedTheme(parts[1]); check(t.venue === v.id, 'Only the venue that shared a theme can take it out', 403);
        run('UPDATE shared_themes SET removed=?,bundle=NULL WHERE id=?', now(), t.id);
        return send(200, {removed: true});
      }
      // One report per venue per theme; the third venue's report hides it, and BeerMat is told.
      if (method === 'POST' && parts[0] === 'themes' && parts.length === 3 && parts[2] === 'report') {
        const request = input.request, v = proLaptop(request, 'beermat.theme-report', themeLibrary); check(request.theme === parts[1], 'Not a request for this theme');
        const t = sharedTheme(parts[1]), reporter = 'venue:' + v.id, reason = text(request.reason, 500, {required: true, name: 'What’s wrong'});
        if (!one("SELECT 1 FROM reports WHERE kind='theme' AND target=? AND reporter=? AND resolved IS NULL", t.id, reporter))
          run('INSERT INTO reports(id,kind,target,reason,reporter,created) VALUES(?,?,?,?,?,?)', id(), 'theme', t.id, reason, reporter, now());
        const reports = one("SELECT COUNT(DISTINCT reporter) n FROM reports WHERE kind='theme' AND target=? AND resolved IS NULL", t.id).n;
        if (reports >= 3 && !t.hidden) {
          run('UPDATE shared_themes SET hidden=1 WHERE id=?', t.id);
          if (mail && adminEmail) mail({to: adminEmail, subject: `Shared theme hidden after ${reports} reports: ${t.name}`,
            text: `“${t.name}” was reported by ${reports} venues and is hidden from the library until you look at it.\n\nLatest report: ${reason}\n\n${publicUrl.replace(/\/$/, '')}/admin/#themes\n`}).catch(e => console.error('Mail failed:', e.message));
        }
        return send(201, {reported: true});
      }

      // ---- The quiz library (see quizOut) ----
      if (method === 'GET' && p === '/v1/quizzes') {
        const q = (url.searchParams.get('q') || '').trim().toLowerCase().slice(0, 60), like = `%${q.replace(/[%_]/g, '')}%`;
        return send(200, {quizzes: rows(`SELECT q.id,q.title,q.description,q.rounds,q.questions,q.formats,q.outline,q.bytes,q.created,q.venue_key,v.name venue_name
          FROM shared_quizzes q LEFT JOIN venues v ON v.id=q.venue WHERE q.removed IS NULL AND q.hidden=0 AND q.status='approved'
          AND (?='' OR lower(q.title) LIKE ? OR lower(q.description) LIKE ?) ORDER BY q.created DESC LIMIT 500`, q, like, like).map(quizOut)});
      }
      // Where a quiz this laptop shared has got to (waiting, in the library, or turned down and why).
      if (method === 'GET' && parts[0] === 'quizzes' && parts.length === 2) {
        const q = quizRow(parts[1]); check(q, 'No such quiz', 404);
        return send(200, {id: q.id, title: q.title, status: q.removed ? 'removed' : q.hidden ? 'hidden' : q.status, note: q.status === 'rejected' ? q.note : ''});
      }
      if (method === 'POST' && p === '/v1/quizzes') {
        const request = input.request, v = proLaptop(request, 'beermat.quiz-upload', quizLibrary);
        check(!v.library_banned, 'This venue can’t share any more. Email hello@beermatquiz.co.uk if you think that’s wrong.', 403);
        check(request.rights === true, 'Confirm you have the right to share everything in this quiz');
        check(typeof input.quiz === 'string' && sha(input.quiz) === request.sha256, 'The quiz doesn’t match what the laptop signed');
        check(one('SELECT COUNT(*) n FROM shared_quizzes WHERE venue=? AND created>?', v.id, now() - 86400000).n < 10, 'That’s 10 quizzes shared today: share more tomorrow', 429);
        let quiz; try {quiz = JSON.parse(input.quiz);} catch {check(false, 'Not a BeerMat quiz file');}
        const checked = checkedQuiz(quiz, input.description), quizId = 'q-' + randomBytes(5).toString('hex');
        storeQuiz(quizId, checked, {venue: v.id, venueKey: request.venueKey});
        if (mail && adminEmail) mail({to: adminEmail, subject: `Quiz waiting for a look: ${checked.title}`,
          text: `${v.name} shared “${checked.title}” (${checked.rounds} rounds, ${checked.questions} questions). It isn’t in the library until you approve it.\n\n${publicUrl.replace(/\/$/, '')}/admin/#quizzes\n`}).catch(e => console.error('Mail failed:', e.message));
        return send(201, {...quizOut(quizRow(quizId)), review: 'pending'});
      }
      if (method === 'POST' && parts[0] === 'quizzes' && parts.length === 3 && parts[2] === 'file') {
        if (!account?.admin) {const request = input.request; proLaptop(request, 'beermat.quiz-get', quizLibrary); check(request.quiz === parts[1], 'Not a request for this quiz');}
        const q = sharedQuiz(parts[1]); check(q.status === 'approved' && !q.hidden, 'That quiz isn’t in the library', 404);
        return send(200, {...quizOut(q), quiz: q.quiz});
      }
      // A venue takes back a quiz it shared (whatever its plan now).
      if (method === 'POST' && parts[0] === 'quizzes' && parts.length === 3 && parts[2] === 'remove') {
        const request = input.request, v = proLaptop(request, 'beermat.quiz-remove', {pro: false}); check(request.quiz === parts[1], 'Not a request for this quiz');
        const q = sharedQuiz(parts[1]); check(q.venue === v.id, 'Only the venue that shared a quiz can take it out', 403);
        run('UPDATE shared_quizzes SET removed=?,quiz=NULL WHERE id=?', now(), q.id);
        return send(200, {removed: true});
      }
      // One report per venue per quiz; the third venue's report hides it, and BeerMat is told.
      if (method === 'POST' && parts[0] === 'quizzes' && parts.length === 3 && parts[2] === 'report') {
        const request = input.request, v = proLaptop(request, 'beermat.quiz-report', quizLibrary); check(request.quiz === parts[1], 'Not a request for this quiz');
        const q = sharedQuiz(parts[1]), reporter = 'venue:' + v.id, reason = text(request.reason, 500, {required: true, name: 'What’s wrong'});
        if (!one("SELECT 1 FROM reports WHERE kind='quiz' AND target=? AND reporter=? AND resolved IS NULL", q.id, reporter))
          run('INSERT INTO reports(id,kind,target,reason,reporter,created) VALUES(?,?,?,?,?,?)', id(), 'quiz', q.id, reason, reporter, now());
        const reports = one("SELECT COUNT(DISTINCT reporter) n FROM reports WHERE kind='quiz' AND target=? AND resolved IS NULL", q.id).n;
        if (reports >= 3 && !q.hidden) {
          run('UPDATE shared_quizzes SET hidden=1 WHERE id=?', q.id);
          if (mail && adminEmail) mail({to: adminEmail, subject: `Shared quiz hidden after ${reports} reports: ${q.title}`,
            text: `“${q.title}” was reported by ${reports} venues and is hidden from the library until you look at it.\n\nLatest report: ${reason}\n\n${publicUrl.replace(/\/$/, '')}/admin/#quizzes\n`}).catch(e => console.error('Mail failed:', e.message));
        }
        return send(201, {reported: true});
      }

      // ---- The shared buzzer library (see proLaptop) ----
      if (method === 'GET' && p === '/v1/buzzers') {
        const q = (url.searchParams.get('q') || '').trim().toLowerCase().slice(0, 60), like = `%${q.replace(/[%_]/g, '')}%`;
        return send(200, {buzzers: rows("SELECT id,name,seconds,created FROM shared_buzzers WHERE removed IS NULL AND hidden=0 AND (?='' OR lower(name) LIKE ?) ORDER BY created DESC LIMIT 500", q, like).map(buzzerOut)});
      }
      if (method === 'POST' && p === '/v1/buzzers') {
        const request = input.request, v = proLaptop(request, 'beermat.buzzer-upload');
        check(!v.library_banned, 'This venue can’t share buzzers any more. Email hello@beermatquiz.co.uk if you think that’s wrong.', 403);
        check(request.rights === true, 'Confirm you have the right to share this clip');
        const name = text(request.name, 60, {required: true, name: 'Buzzer name'});
        check(typeof input.audio === 'string' && input.audio.length <= 3 * 1024 * 1024, 'Send the clip as base64 audio, up to 2 MB');
        const audio = Buffer.from(input.audio, 'base64');
        check(audio.length > 0 && sha(audio) === request.sha256, 'The clip doesn’t match what the laptop signed');
        check(one('SELECT COUNT(*) n FROM shared_buzzers WHERE venue=? AND created>?', v.id, now() - 86400000).n < 30, 'That’s 30 buzzers shared today: share more tomorrow', 429);
        const mp3 = await transcode(audio), buzzerId = id();
        run('INSERT INTO shared_buzzers(id,name,venue,venue_key,audio,seconds,created) VALUES(?,?,?,?,?,?,?)', buzzerId, name, v.id, request.venueKey, mp3, mp3.length * 8 / 128000, now());
        return send(201, buzzerOut(one('SELECT * FROM shared_buzzers WHERE id=?', buzzerId)));
      }
      if (method === 'POST' && parts[0] === 'buzzers' && parts.length === 3 && parts[2] === 'audio') {
        if (!account?.admin) {const request = input.request; proLaptop(request, 'beermat.buzzer-get'); check(request.buzzer === parts[1], 'Not a request for this buzzer');}
        const b = sharedBuzzer(parts[1]); check(!b.hidden, 'That buzzer has been reported and is waiting for a check', 404);
        return send(200, {...buzzerOut(b), audio: Buffer.from(b.audio).toString('base64')});
      }
      // A venue takes back a clip it shared (whatever its plan now).
      if (method === 'POST' && parts[0] === 'buzzers' && parts.length === 3 && parts[2] === 'remove') {
        const request = input.request, v = proLaptop(request, 'beermat.buzzer-remove', {pro: false}); check(request.buzzer === parts[1], 'Not a request for this buzzer');
        const b = sharedBuzzer(parts[1]); check(b.venue === v.id, 'Only the venue that shared a buzzer can take it out', 403);
        run('UPDATE shared_buzzers SET removed=?,audio=NULL WHERE id=?', now(), b.id);
        return send(200, {removed: true});
      }
      // One report per venue per clip; the third venue's report hides it, and BeerMat is told.
      if (method === 'POST' && parts[0] === 'buzzers' && parts.length === 3 && parts[2] === 'report') {
        const request = input.request, v = proLaptop(request, 'beermat.buzzer-report'); check(request.buzzer === parts[1], 'Not a request for this buzzer');
        const b = sharedBuzzer(parts[1]), reporter = 'venue:' + v.id, reason = text(request.reason, 500, {required: true, name: 'What’s wrong'});
        if (!one("SELECT 1 FROM reports WHERE kind='buzzer' AND target=? AND reporter=? AND resolved IS NULL", b.id, reporter))
          run('INSERT INTO reports(id,kind,target,reason,reporter,created) VALUES(?,?,?,?,?,?)', id(), 'buzzer', b.id, reason, reporter, now());
        const reports = one("SELECT COUNT(DISTINCT reporter) n FROM reports WHERE kind='buzzer' AND target=? AND resolved IS NULL", b.id).n;
        if (reports >= 3 && !b.hidden) {
          run('UPDATE shared_buzzers SET hidden=1 WHERE id=?', b.id);
          if (mail && adminEmail) mail({to: adminEmail, subject: `Shared buzzer hidden after ${reports} reports: ${b.name}`,
            text: `“${b.name}” was reported by ${reports} venues and is hidden from the library until you look at it.\n\nLatest report: ${reason}\n\nCheck it: ${publicUrl.replace(/\/$/, '')}/admin/#buzzers\n`}).catch(e => console.error('Email not sent:', e.message));
        }
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
          openReports: n('SELECT COUNT(*) n FROM reports WHERE resolved IS NULL'), awaitingApproval: n('SELECT COUNT(*) n FROM venues WHERE approved=0'),
          sharedBuzzers: n('SELECT COUNT(*) n FROM shared_buzzers WHERE removed IS NULL'), hiddenBuzzers: n('SELECT COUNT(*) n FROM shared_buzzers WHERE removed IS NULL AND hidden=1'),
          sharedThemes: n("SELECT COUNT(*) n FROM shared_themes WHERE removed IS NULL AND status='approved'"), pendingThemes: n("SELECT COUNT(*) n FROM shared_themes WHERE removed IS NULL AND status='pending'"),
          sharedQuizzes: n("SELECT COUNT(*) n FROM shared_quizzes WHERE removed IS NULL AND status='approved'"), pendingQuizzes: n("SELECT COUNT(*) n FROM shared_quizzes WHERE removed IS NULL AND status='pending'"), databaseBytes: (() => {try {return statSync(database).size;} catch {return null;}})(), lastBackup, startedAt, now: now()});
      }
      if (method === 'GET' && p === '/v1/admin/venues') {
        admin();
        return send(200, {venues: rows('SELECT v.*, a.email operator_email, a.display_name operator_name FROM venues v LEFT JOIN accounts a ON a.id=v.owner ORDER BY v.name COLLATE NOCASE').map(v => ({
          ...venueOut(v), operator: v.owner ? {email: v.operator_email, name: v.operator_name} : null, plan: planOf(v), planSet: v.plan, planUntil: v.plan_until, approved: !!v.approved, libraryBanned: !!v.library_banned, stripeCustomer: v.stripe_customer, stripeSubscription: v.stripe_subscription,
          laptops: rows('SELECT key_id id, added FROM venue_keys WHERE venue=? ORDER BY added', v.id),
          upcoming: rows('SELECT * FROM events WHERE venue=? AND cancelled=0 AND starts>? ORDER BY starts LIMIT 20', v.id, now()).map(e => ({id: e.id, title: e.title, startsAt: e.starts, regular: !!e.regular})),
          sharedResults: rows('SELECT r.summary, r.received FROM venue_results r JOIN venue_keys k ON k.public_key=r.venue_key WHERE k.venue=? ORDER BY r.received DESC LIMIT 10', v.id)
            .map(r => {const sum = JSON.parse(r.summary); return {title: sum.title, date: sum.date, teams: sum.teams.length, winner: sum.teams.find(t => t.rank === 1)?.name || '', received: r.received};}),
        }))});
      }
      if (method === 'GET' && p === '/v1/admin/reports') {
        admin();
        const list = rows(`SELECT r.*, v.name venue_name, b.name buzzer_name, th.name theme_name, sq.title quiz_name, pa.display_name profile_name, pa.email profile_email, a.email reporter_email, rv.name reporter_venue FROM reports r LEFT JOIN venues v ON r.kind='venue' AND v.id=r.target
          LEFT JOIN shared_buzzers b ON r.kind='buzzer' AND b.id=r.target AND b.removed IS NULL LEFT JOIN shared_themes th ON r.kind='theme' AND th.id=r.target AND th.removed IS NULL LEFT JOIN shared_quizzes sq ON r.kind='quiz' AND sq.id=r.target AND sq.removed IS NULL LEFT JOIN accounts pa ON r.kind='profile' AND pa.id=r.target LEFT JOIN accounts a ON a.id=r.reporter LEFT JOIN venues rv ON r.reporter='venue:' || rv.id
          WHERE ?=1 OR r.resolved IS NULL ORDER BY r.created DESC LIMIT 200`, Number(url.searchParams.get('all') === '1'));
        return send(200, {reports: list.map(r => ({id: r.id, kind: r.kind, target: r.target, targetName: r.venue_name || r.buzzer_name || r.theme_name || r.quiz_name || (r.profile_name ? `${r.profile_name} (${r.profile_email})` : '') || '(removed)', ...(r.profile_email && {email: r.profile_email}), reason: r.reason, reporter: r.reporter_email || r.reporter_venue || null, created: r.created, resolved: r.resolved}))});
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

      // Shared buzzers: every clip with who shared it and its open reports; an admin plays, hides, shows or removes one,
      // and can stop a venue sharing any more.
      if (method === 'GET' && p === '/v1/admin/buzzers') {
        admin();
        return send(200, {buzzers: rows(`SELECT b.id,b.name,b.seconds,b.created,b.hidden,b.venue,b.venue_key,v.name venue_name,(SELECT COUNT(*) FROM reports r WHERE r.kind='buzzer' AND r.target=b.id AND r.resolved IS NULL) reports
          FROM shared_buzzers b LEFT JOIN venues v ON v.id=b.venue WHERE b.removed IS NULL ORDER BY b.hidden DESC, reports DESC, b.created DESC LIMIT 1000`)
          .map(b => ({...buzzerOut(b), hidden: !!b.hidden, venue: b.venue, venueName: b.venue_key === 'beermat' ? '' : b.venue_name || '(venue removed)', reports: b.reports}))});
      }
      // BeerMat's own clips, added by an admin (only ones BeerMat has the right to share: CC0, public domain, its own).
      if (method === 'POST' && p === '/v1/admin/buzzers') {
        admin();
        const name = text(input.name, 60, {required: true, name: 'Buzzer name'});
        check(typeof input.audio === 'string' && input.audio.length <= 3 * 1024 * 1024, 'Send the clip as base64 audio, up to 2 MB');
        const audio = Buffer.from(input.audio, 'base64'); check(audio.length > 0, 'Choose a sound file');
        const mp3 = await transcode(audio), buzzerId = id();
        run("INSERT INTO shared_buzzers(id,name,venue,venue_key,audio,seconds,created) VALUES(?,?,NULL,'beermat',?,?,?)", buzzerId, name, mp3, mp3.length * 8 / 128000, now());
        return send(201, buzzerOut(one('SELECT * FROM shared_buzzers WHERE id=?', buzzerId)));
      }
      if (method === 'GET' && parts[0] === 'admin' && parts[1] === 'buzzers' && parts.length === 4 && parts[3] === 'audio') {
        admin(); const b = sharedBuzzer(parts[2]);
        res.writeHead(200, {'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'}); return res.end(Buffer.from(b.audio));
      }
      if (parts[0] === 'admin' && parts[1] === 'buzzers' && parts.length === 3 && (method === 'PATCH' || method === 'DELETE')) {
        admin(); const b = sharedBuzzer(parts[2]);
        if (method === 'DELETE') run('UPDATE shared_buzzers SET removed=?,audio=NULL WHERE id=?', now(), b.id);
        else {check(typeof input.hidden === 'boolean', 'Invalid setting'); run('UPDATE shared_buzzers SET hidden=? WHERE id=?', Number(input.hidden), b.id);}
        // Its reports are dealt with either way.
        run("UPDATE reports SET resolved=? WHERE kind='buzzer' AND target=? AND resolved IS NULL", now(), b.id);
        return send(200, {ok: true});
      }
      // Shared themes: waiting ones first. An admin looks at every file (images and sounds as they are, the stylesheet
      // and tv.json as text), then approves or turns it down with a note for the venue; hides, shows or removes one.
      if (method === 'GET' && p === '/v1/admin/themes') {
        admin();
        return send(200, {themes: rows(`SELECT t.id,t.name,t.look,t.tv,t.sounds,t.bytes,t.created,t.status,t.note,t.hidden,t.venue,t.venue_key,v.name venue_name,t.bundle,
            (SELECT COUNT(*) FROM reports r WHERE r.kind='theme' AND r.target=t.id AND r.resolved IS NULL) reports
          FROM shared_themes t LEFT JOIN venues v ON v.id=t.venue WHERE t.removed IS NULL ORDER BY t.status='pending' DESC, t.hidden DESC, reports DESC, t.created DESC LIMIT 500`)
          .map(t => ({...themeOut(t), status: t.status, note: t.note, hidden: !!t.hidden, venue: t.venue, venueName: t.venue_key === 'beermat' ? 'BeerMat' : t.venue_name || '(venue removed)', reports: t.reports,
            files: t.bundle ? Object.entries(JSON.parse(t.bundle).files).map(([name, data]) => ({name, bytes: Math.floor(data.length * 3 / 4)})) : []}))});
      }
      // BeerMat's own themes, added by an admin: a theme folder (checked as a venue's is, under a library id) that goes
      // straight into the library, with pictures of it on the TV and in the app if the admin has them.
      if (method === 'POST' && p === '/v1/admin/themes') {
        admin();
        const themeId = 's-' + randomBytes(5).toString('hex'), theme = checkedTheme(input.bundle, themeId);
        checkTheme(bundleOf(theme));
        if (input.previews !== undefined) check(input.previews && typeof input.previews === 'object' && !Array.isArray(input.previews), 'Previews are a TV and an app picture, 1 MB each');
        const files = [...theme.files.keys()];
        transaction(() => {
          run("INSERT INTO shared_themes(id,name,venue,venue_key,bundle,bytes,look,tv,sounds,created,status,reviewed) VALUES(?,?,NULL,'beermat',?,?,?,?,?,?,'approved',?)", themeId, theme.name,
            JSON.stringify(bundleOf(theme)), [...theme.files.values()].reduce((n, b) => n + b.length, 0), Number(files.includes('look.css')), Number(files.includes('tv.json')),
            Number(files.some(f => f.startsWith('sounds/'))), now(), now());
          savePreviews(themeId, input.previews);
        });
        drawPictures(themeId);
        return send(201, themeOut(one('SELECT * FROM shared_themes WHERE id=?', themeId)));
      }
      // New pictures of a theme on the TV or in the app, for one shared without them.
      if (method === 'PUT' && parts[0] === 'admin' && parts[1] === 'themes' && parts.length === 4 && parts[3] === 'previews') {
        admin(); const t = sharedTheme(parts[2]);
        if (input.previews !== undefined) check(input.previews && typeof input.previews === 'object' && !Array.isArray(input.previews), 'Previews are a TV and an app picture, 1 MB each');
        savePreviews(t.id, input.previews);
        return send(200, themeOut(t));
      }
      if (method === 'GET' && parts[0] === 'admin' && parts[1] === 'themes' && parts.length >= 5 && parts[3] === 'files') {
        admin(); const t = sharedTheme(parts[2]), name = parts.slice(4).join('/'), data = JSON.parse(t.bundle || '{"files":{}}').files[name];
        check(typeof data === 'string', 'No such file', 404);
        const type = {png: 'image/png', webp: 'image/webp', jpg: 'image/jpeg', svg: 'image/svg+xml', woff2: 'font/woff2', mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav'}[name.split('.').pop()] || 'text/plain; charset=utf-8';
        // Shown to an admin only, and never able to run: a sandbox with nothing allowed, whatever the file says.
        res.writeHead(200, {'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox"});
        return res.end(Buffer.from(data, 'base64'));
      }
      if (parts[0] === 'admin' && parts[1] === 'themes' && parts.length === 3 && (method === 'PATCH' || method === 'DELETE')) {
        admin(); const t = sharedTheme(parts[2]);
        if (method === 'DELETE') run('UPDATE shared_themes SET removed=?,bundle=NULL WHERE id=?', now(), t.id);
        else if (input.status !== undefined) {
          check(['approved', 'rejected'].includes(input.status), 'Approve it or turn it down');
          run('UPDATE shared_themes SET status=?,reviewed=?,note=? WHERE id=?', input.status, now(), input.status === 'rejected' ? text(input.note || '', 500, {name: 'Note'}) : '', t.id);
        } else {check(typeof input.hidden === 'boolean', 'Invalid setting'); run('UPDATE shared_themes SET hidden=? WHERE id=?', Number(input.hidden), t.id);}
        run("UPDATE reports SET resolved=? WHERE kind='theme' AND target=? AND resolved IS NULL", now(), t.id);
        return send(200, {ok: true});
      }
      // Shared quizzes: waiting ones first. An admin reads every question and answer (and sees its pictures, hears its
      // sounds), then approves or turns it down with a note for the venue; hides, shows or removes one.
      if (method === 'GET' && p === '/v1/admin/quizzes') {
        admin();
        return send(200, {quizzes: rows(`SELECT q.*, v.name venue_name, (SELECT COUNT(*) FROM reports r WHERE r.kind='quiz' AND r.target=q.id AND r.resolved IS NULL) reports
          FROM shared_quizzes q LEFT JOIN venues v ON v.id=q.venue WHERE q.removed IS NULL ORDER BY q.status='pending' DESC, q.hidden DESC, reports DESC, q.created DESC LIMIT 500`)
          .map(q => ({...quizOut(q), status: q.status, note: q.note, hidden: !!q.hidden, venue: q.venue, by: q.venue_key === 'beermat' ? 'BeerMat' : q.venue_name || '(venue removed)', reports: q.reports}))});
      }
      // One quiz in full, for reading before approving it.
      if (method === 'GET' && parts[0] === 'admin' && parts[1] === 'quizzes' && parts.length === 3) {
        admin(); const q = sharedQuiz(parts[2]);
        return send(200, {...quizOut(q), quiz: JSON.parse(q.quiz)});
      }
      // BeerMat's own quizzes, added by an admin: checked as a venue's is, straight into the library.
      if (method === 'POST' && p === '/v1/admin/quizzes') {
        admin();
        const checked = checkedQuiz(input.quiz, input.description), quizId = 'q-' + randomBytes(5).toString('hex');
        storeQuiz(quizId, checked, {venueKey: 'beermat', status: 'approved'});
        return send(201, quizOut(quizRow(quizId)));
      }
      if (parts[0] === 'admin' && parts[1] === 'quizzes' && parts.length === 3 && (method === 'PATCH' || method === 'DELETE')) {
        admin(); const q = sharedQuiz(parts[2]);
        if (method === 'DELETE') run('UPDATE shared_quizzes SET removed=?,quiz=NULL WHERE id=?', now(), q.id);
        else if (input.status !== undefined) {
          check(['approved', 'rejected'].includes(input.status), 'Approve it or turn it down');
          run('UPDATE shared_quizzes SET status=?,reviewed=?,note=? WHERE id=?', input.status, now(), input.status === 'rejected' ? text(input.note || '', 500, {name: 'Note'}) : '', q.id);
        } else if (input.description !== undefined) run('UPDATE shared_quizzes SET description=? WHERE id=?', text(input.description, QUIZ_LIMITS.description, {name: 'Description'}), q.id);
        else {check(typeof input.hidden === 'boolean', 'Invalid setting'); run('UPDATE shared_quizzes SET hidden=? WHERE id=?', Number(input.hidden), q.id);}
        run("UPDATE reports SET resolved=? WHERE kind='quiz' AND target=? AND resolved IS NULL", now(), q.id);
        return send(200, {ok: true});
      }
      if (method === 'POST' && parts[0] === 'admin' && parts[1] === 'venues' && parts.length === 4 && parts[3] === 'library') {
        admin(); check(one('SELECT 1 FROM venues WHERE id=?', parts[2]), 'Venue not found', 404); check(typeof input.banned === 'boolean', 'Invalid setting');
        run('UPDATE venues SET library_banned=? WHERE id=?', Number(input.banned), parts[2]);
        if (input.banned) {
          run('UPDATE shared_buzzers SET removed=?,audio=NULL WHERE venue=? AND removed IS NULL', now(), parts[2]);
          run('UPDATE shared_themes SET removed=?,bundle=NULL WHERE venue=? AND removed IS NULL', now(), parts[2]);
          run('UPDATE shared_quizzes SET removed=?,quiz=NULL WHERE venue=? AND removed IS NULL', now(), parts[2]);
        }
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
      // The phone deck: a ticket that lets this account's phone host the quiz on a laptop of its venue (or any laptop, for
      // an admin). The laptop checks it with the licence key, so it needs no internet itself.
      // ---- Quizmaster devices: found through the account, not the network ----
      // Venue Wi-Fi often keeps devices apart (client isolation), so a laptop running BeerMat tells the service where
      // it can be reached: its addresses on its networks and its quizmaster link (a Cloudflare tunnel, through the
      // internet). Another desk, a TV or a phone signed in to the same account finds it here and gets a ticket for it.
      // Roles: 'desk' (its own quiz, its desk on it), 'hosting' (its own quiz, the desk on another device) and
      // 'remote' (its desk is running another laptop's quiz). A laptop that hasn't said so for 90 seconds is closed.
      const DESK_OPEN_MS = 90000;
      const openDesks = accountId => rows('SELECT * FROM desks WHERE account=? AND seen>? ORDER BY seen DESC', accountId, now() - DESK_OPEN_MS).map(deskRow);
      const laptopRequest = (request, kind) => {
        check(request?.kind === kind && request.v === 1 && Number.isSafeInteger(request.at) && verifyClaim(request), 'Not a request from a quiz laptop');
        check(Math.abs(now() - request.at) < 10 * 60000, 'This laptop’s clock is wrong: set its date and time, then try again');
        return request.venueKey;
      };
      if (method === 'PUT' && p === '/v1/me/desk') {
        const publicKey = laptopRequest(input.request, 'beermat.desk');
        check(['desk', 'hosting', 'remote'].includes(input.role), 'Which role?');
        const addresses = Array.isArray(input.addresses) ? input.addresses.filter(a => typeof a === 'string' && /^https?:\/\/[\w.:[\]-]{1,80}$/.test(a)).slice(0, 8) : [];
        const link = typeof input.link === 'string' && /^https:\/\/[\w.-]{1,120}$/.test(input.link) ? input.link : null;
        run(`INSERT INTO desks VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(key_id) DO UPDATE SET public_key=excluded.public_key, account=excluded.account, name=excluded.name,
          title=excluded.title, role=excluded.role, addresses=excluded.addresses, link=excluded.link, seen=excluded.seen`,
        keyId(publicKey), publicKey, me().id, text(input.name, 60) || 'Quiz laptop', text(input.title, 120), input.role, JSON.stringify(addresses), link, now());
        // A laptop that closed without saying so: its addresses go after a day.
        run('DELETE FROM desks WHERE seen<?', now() - 86400000);
        // Tell the laptop whether a phone deck is waiting on the relay (so it starts pushing state).
        const kid = keyId(publicKey), relay = relays.get(kid);
        const relayActive = !!(relay && (relay.streams.size > 0 || relay.commands.length > 0));
        return send(200, {desks: openDesks(account.id).filter(d => d.venueKey !== publicKey), relay: relayActive});
      }
      if (method === 'POST' && p === '/v1/me/desk/closed') {run('DELETE FROM desks WHERE public_key=? AND account=?', laptopRequest(input.request, 'beermat.desk-closed'), me().id); return send(200, {ok: true});}
      if (method === 'GET' && p === '/v1/me/desks') return send(200, {desks: openDesks(me().id)});
      // A ticket for one of the account's laptops, for a role there: a phone deck ('deck'), another desk ('desk') or a
      // TV ('tv'). The laptop checks it with the licence key, once, within five minutes.
      const quizTicket = (acct, venueKey, role) => {
        check(licenceKey, 'Quizmaster devices aren’t set up on this service yet', 503);
        check(typeof venueKey === 'string' && venueKey.length < 200, 'Which laptop?');
        check(['deck', 'desk', 'tv'].includes(role), 'Which role?');
        const v = venueOfKey(venueKey), open = one('SELECT 1 FROM desks WHERE public_key=? AND account=? AND seen>?', venueKey, acct.id, now() - DESK_OPEN_MS);
        check(acct.admin || open || (v && v.owner === acct.id), v ? 'That laptop isn’t signed in to this account' : 'That laptop isn’t signed in to this account, or isn’t open', 403);
        return signDeckTicket({venueKey, account: acct.id, name: acct.display_name, admin: !!acct.admin, venue: v?.id || null, role, nonce: id(), issued: now(), expires: now() + 5 * 60000}, licenceKey);
      };
      // TVs: a TV signs in once by QR code (a phone signed in approves it) and keeps a device token; with it, the TV asks
      // here each time it starts which of the account's laptops is running a quiz, with a ticket for each.
      const deviceAccount = device => {
        check(typeof device === 'string' && device.length < 100, 'Sign this TV in again', 401);
        const d = one('SELECT d.hash, a.* FROM tv_devices d JOIN accounts a ON a.id=d.account WHERE d.hash=?', sha(device));
        check(d, 'Sign this TV in again', 401);
        run('UPDATE tv_devices SET seen=? WHERE hash=?', now(), d.hash);
        return d;
      };
      const newDevice = (accountId, name) => {const t = token(); run('INSERT INTO tv_devices VALUES(?,?,?,?,?)', sha(t), accountId, text(name, 60) || 'TV', now(), now()); return t;};
      if (method === 'POST' && p === '/v1/tv-pairings') {
        limit('pair:' + ip);
        const code = token();
        run('DELETE FROM tv_pairings WHERE expires<?', now());
        run('INSERT INTO tv_pairings VALUES(?,?,?,?)', sha(code), text(input.name, 60) || 'TV', null, now() + 10 * 60000);
        return send(200, {code, expires: now() + 10 * 60000});
      }
      if (parts[0] === 'tv-pairings' && parts[1] && parts.length <= 3) {
        const pairing = one('SELECT * FROM tv_pairings WHERE hash=? AND expires>?', sha(parts[1]), now());
        check(pairing, 'This TV’s code has run out: the TV shows a new one', 404);
        if (method === 'GET' && parts.length === 2) {
          if (!pairing.device) return send(200, {waiting: true, name: pairing.name});
          run('DELETE FROM tv_pairings WHERE hash=?', pairing.hash);
          return send(200, {device: pairing.device});
        }
        if (method === 'POST' && parts[2] === 'approve') {
          check(!pairing.device, 'This TV is already signed in');
          run('UPDATE tv_pairings SET device=? WHERE hash=?', newDevice(me().id, pairing.name), pairing.hash);
          return send(200, {ok: true, name: pairing.name});
        }
      }
      // A signed-in desk becoming a TV gets its device token straight away.
      if (method === 'POST' && p === '/v1/me/tv-devices') return send(200, {device: newDevice(me().id, input.name)});
      if (method === 'POST' && p === '/v1/tv/connect') {
        limit('tv:' + ip);
        const acct = deviceAccount(input.device);
        const laptops = openDesks(acct.id).filter(d => d.role !== 'remote');
        return send(200, {account: acct.display_name, desks: laptops.map(d => ({...d, ticket: quizTicket(acct, d.venueKey, 'tv')}))});
      }
      // /v1/deck-tickets: the phone deck's older name for it (role 'deck').
      if (method === 'POST' && (p === '/v1/desk-tickets' || p === '/v1/deck-tickets')) return send(200, {ticket: quizTicket(me(), input.venueKey, p === '/v1/deck-tickets' ? 'deck' : input.role || 'deck')});

      // ---- Phone deck relay: commands and state through BeerMat Online, no tunnel needed ----
      // The laptop pushes its deck state here every second; a phone deck reads it and sends commands back. This avoids
      // relying on Cloudflare quick tunnels (trycloudflare.com), which have no uptime guarantee.

      // The laptop pushes state and picks up queued commands. Authenticated by a signed claim.
      if (method === 'POST' && p === '/v1/me/desk/relay') {
        const publicKey = laptopRequest(input.request, 'beermat.relay-push');
        const kid = keyId(publicKey);
        check(input.state && typeof input.state === 'object', 'Send the deck state');
        let relay = relays.get(kid);
        if (!relay) {relay = {state: null, version: 0, commands: [], streams: new Set(), updatedAt: 0}; relays.set(kid, relay);}
        relay.state = input.state;
        relay.version++;
        relay.updatedAt = now();
        // Nudge all connected phone deck SSE streams.
        for (const stream of relay.streams) stream.write(`data: ${relay.version}\n\n`);
        // Update the desk's seen timestamp (counts as a heartbeat).
        run('UPDATE desks SET seen=? WHERE key_id=?', now(), kid);
        // Return queued commands and clear them.
        const commands = relay.commands.splice(0);
        return send(200, {commands, version: relay.version});
      }

      // A phone connects to the relay: validates account access, returns a relay token.
      if (method === 'POST' && p === '/v1/relay/connect') {
        const venueKey = text(input.venueKey, 200, {required: true, name: 'Venue key'});
        const acct = me();
        const v = venueOfKey(venueKey), open = one('SELECT 1 FROM desks WHERE public_key=? AND account=? AND seen>?', venueKey, acct.id, now() - DESK_OPEN_MS);
        check(acct.admin || open || (v && v.owner === acct.id), "That laptop isn't signed in to this account, or isn't open", 403);
        const kid = keyId(venueKey);
        const expires = now() + 12 * 60 * 60 * 1000;
        const relayToken = createHmac('sha256', relaySecret).update(`${kid}:${acct.id}:${expires}`).digest('base64url');
        const token = `${kid}:${acct.id}:${expires}:${relayToken}`;
        const relay = relays.get(kid);
        return send(200, {keyId: kid, token, state: relay?.state || null});
      }

      // Relay token validation: keyId:accountId:expires:hmac.
      const relayAuth = () => {
        const token = url.searchParams.get('token') || input.token || '';
        const [kid, accountId, exp, sig] = token.split(':');
        check(kid && accountId && exp && sig, 'Relay token required', 401);
        check(Number(exp) > now(), 'Relay token expired', 401);
        const expected = createHmac('sha256', relaySecret).update(`${kid}:${accountId}:${exp}`).digest('base64url');
        check(sig === expected, 'Invalid relay token', 401);
        return {keyId: kid, accountId};
      };

      // SSE stream: the phone listens for state changes.
      if (method === 'GET' && parts[0] === 'relay' && parts[1] && parts[2] === 'events' && parts.length === 3) {
        const {keyId: kid} = relayAuth();
        check(kid === parts[1], 'Token does not match this relay', 403);
        res.writeHead(200, {...headers(req), 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive'});
        const relay = relays.get(kid);
        if (relay?.state) res.write(`data: ${relay.version}\n\n`);
        const stream = res;
        if (relay) relay.streams.add(stream);
        else {const r = {state: null, version: 0, commands: [], streams: new Set([stream]), updatedAt: now()}; relays.set(kid, r);}
        const ping = setInterval(() => {try {res.write(': keep-alive\n\n');} catch {clearInterval(ping);}}, 15000);
        req.on('close', () => {clearInterval(ping); relays.get(kid)?.streams.delete(stream);});
        return;
      }

      // The phone fetches the latest deck state.
      if (method === 'GET' && parts[0] === 'relay' && parts[1] && parts[2] === 'state' && parts.length === 3) {
        const {keyId: kid} = relayAuth();
        check(kid === parts[1], 'Token does not match this relay', 403);
        const relay = relays.get(kid);
        return send(200, {state: relay?.state || null, version: relay?.version || 0});
      }

      // The phone sends a command to the laptop (queued until the laptop's next relay push).
      if (method === 'POST' && parts[0] === 'relay' && parts[1] && parts[2] === 'command' && parts.length === 3) {
        const {keyId: kid} = relayAuth();
        check(kid === parts[1], 'Token does not match this relay', 403);
        const ALLOWED = ['send', 'close', 'reveal', 'next', 'back', 'mark', 'buzz', 'board', 'recap', 'pause', 'resume', 'deck-command', 'var', 'settings', 'logout'];
        check(typeof input.route === 'string' && ALLOWED.includes(input.route), 'Unknown command');
        limit('relay-cmd:' + kid);
        const relay = relays.get(kid);
        check(relay?.state, "The laptop isn't relaying right now", 503);
        check(relay.commands.length < 10, 'Too many pending commands', 429);
        relay.commands.push({route: input.route, body: input.body || {}, at: now()});
        return send(200, {ok: true});
      }

      // The relay deck page: serves the laptop's deck.html with relay config injected.
      if (method === 'GET' && p === '/relay-deck') {
        const deckHtml = readFileSync(path.join(here, '..', 'web', 'deck.html'), 'utf8');
        const csp = "default-src 'self' 'unsafe-inline'; style-src 'self'; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'";
        res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-cache',
          'Content-Security-Policy': csp});
        // The hash carries the relay token; the page script reads it and sets window.__relay before deck.js runs.
        const script = `<script>const h=new URLSearchParams(location.hash.slice(1));window.__relay={keyId:h.get('keyId'),token:h.get('token'),base:location.origin+'/v1'};history.replaceState(null,'',location.pathname);</script>`;
        return res.end(deckHtml.replace('</head>', script + '</head>'));
      }
      // Static files the relay deck page needs (deck.js and its imports, served from the web/ directory).
      const deckFiles = {'/deck.js': 'deck.js', '/compat.js': 'compat.js', '/app.js': 'app.js', '/i18n.js': 'i18n.js', '/style.css': 'style.css'};
      if (method === 'GET' && deckFiles[p]) {
        const file = path.join(here, '..', 'web', deckFiles[p]);
        if (existsSync(file)) {
          res.writeHead(200, {'Content-Type': staticTypes[path.extname(file)], 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache'});
          return res.end(readFileSync(file));
        }
      }

      if (method === 'POST' && p === '/v1/licence') {
        limit('licence:' + ip);
        check(licenceKey, 'Licences aren’t set up on this service yet', 503);
        check(input.kind === 'beermat.licence-request' && input.v === 1 && Number.isSafeInteger(input.at) && verifyClaim(input), 'Not a licence request from a quiz laptop');
        check(Math.abs(now() - input.at) < 10 * 60000, 'This laptop’s clock is wrong: set its date and time, then try again');
        const v = venueOfKey(input.venueKey), month0 = 31 * 86400000, grace0 = 14 * 86400000;
        // A desk signed in with a BeerMat admin account gets Pro on that laptop, venue or not (for BeerMat's own testing
        // and demos). Like any licence it lasts a month plus the grace period and renews while the admin stays signed in.
        if (account?.admin && !v) return send(200, {licence: signLicence({plan: 'pro', venue: 'admin', venueName: 'BeerMat (admin)', venueKey: input.venueKey, issued: now(), expires: now() + month0 + grace0, paidUntil: null}, licenceKey)});
        check(v, 'Register this laptop with your venue first (desk: Venue)', 403);
        if (account?.admin && planOf(v) !== 'pro') return send(200, {licence: signLicence({plan: 'pro', venue: v.id, venueName: v.name, venueKey: input.venueKey, issued: now(), expires: now() + month0 + grace0, paidUntil: null}, licenceKey)});
        const plan = planOf(v), month = 31 * 86400000, grace = 14 * 86400000;
        // A free trial ends when it ends: no grace period after it (that's for paid venues off the internet).
        const trial = plan === 'pro' && v.trial_until && v.trial_until > now();
        const expires = (plan === 'pro' ? Math.min(v.plan_until ?? Infinity, now() + month) : now() + month) + (trial ? 0 : grace);
        return send(200, {licence: signLicence({plan, venue: v.id, venueName: v.name, venueKey: input.venueKey, issued: now(), expires, paidUntil: plan === 'pro' ? v.plan_until : null, ...(trial && {trialUntil: v.trial_until})}, licenceKey)});
      }

      // ---- Venues and events (venue operators) ----
      const myVenue = venueId => {const v = one('SELECT * FROM venues WHERE id=?', venueId); check(v, 'Venue not found', 404); check(v.owner === me().id || me().admin, 'Only the venue’s operator can change it', 403); return v;};
      if (method === 'GET' && p === '/v1/me/venues') return send(200, {venues: rows('SELECT * FROM venues WHERE owner=? ORDER BY name', me().id).map(v => ({...venueOut(v), plan: planOf(v), planUntil: v.plan_until, approved: !!v.approved, billing: !!v.stripe_customer, keys: rows('SELECT key_id FROM venue_keys WHERE venue=?', v.id).map(k => k.key_id),
        // For the account page on the website: a trial's end, the founding price, and when each laptop was registered.
        trialUntil: v.trial_until || null, founding: !!v.founding, laptops: rows('SELECT key_id id, added FROM venue_keys WHERE venue=? ORDER BY added', v.id)}))});
      // Every venue, for the map: public details and its next quiz night.
      if (method === 'GET' && p === '/v1/venues') {
        const next = v => {const e = one('SELECT * FROM events WHERE venue=? AND starts>? AND cancelled=0 ORDER BY starts LIMIT 1', v.id, now() - 6 * 3600000); return e ? {id: e.id, title: e.title, startsAt: e.starts} : null;};
        return send(200, {venues: rows(`SELECT * FROM venues WHERE ${PRO_SQL} ORDER BY name COLLATE NOCASE`, now()).map(v => ({...venueOut(v), next: next(v)})), fetchedAt: now()});
      }
      // Venues don't add themselves: they come from the venue list, or an admin adds one here.
      if (method === 'POST' && p === '/v1/venues') {
        check(me().admin, 'Venues are added by BeerMat: ask to be added', 403);
        const fields = validVenue(input), venueId = newVenueId(fields.name, fields.town);
        run('INSERT INTO venues(id,name,town,postcode,address,website,lat,lon,quiz_nights,created) VALUES(?,?,?,?,?,?,?,?,?,?)', venueId, fields.name, fields.town, fields.postcode, fields.address, fields.website, fields.lat ?? null, fields.lon ?? null, fields.quiz_nights, now());
        publishRegular(venueId);
        return send(201, venueOut(one('SELECT * FROM venues WHERE id=?', venueId)));
      }
      if (parts[0] === 'venues' && parts.length >= 2) {
        if (method === 'GET' && parts.length === 2) {
          const v = one('SELECT * FROM venues WHERE id=?', parts[1]); check(v && ((planOf(v) === 'pro' && v.approved) || account?.admin || (account && v.owner === account.id)), 'Venue not found', 404);
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
        // The venue's operator manages its subscription (card, monthly or yearly, cancelling) on Stripe's own page.
        if (method === 'POST' && parts[2] === 'billing' && parts.length === 3) {
          const v = myVenue(parts[1]); check(v.stripe_customer, 'This venue’s plan isn’t paid by card. Email us to change it.', 404);
          // A founding venue's portal offers only the founding prices (and an ordinary venue's only the ordinary ones).
          return send(200, {url: (await stripeApi('POST', 'billing_portal/sessions', {customer: v.stripe_customer, return_url: stripe.siteUrl || 'https://beermatquiz.co.uk',
            ...(v.founding_offer && stripe.portalFounding && {configuration: stripe.portalFounding})})).url});
        }
        // Venues bought on the website wait for an admin before they're on the map.
        if (method === 'POST' && parts[2] === 'approve' && parts.length === 3) {
          check(me().admin, 'Admins only', 403); check(one('SELECT 1 FROM venues WHERE id=?', parts[1]), 'Venue not found', 404);
          run('UPDATE venues SET approved=? WHERE id=?', input.approved === false ? 0 : 1, parts[1]); return send(200, {ok: true});
        }
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
        const venues = new Map(rows(`SELECT * FROM venues WHERE ${PRO_SQL}`, now()).map(v => [v.id, v]));
        let list = rows('SELECT * FROM events WHERE cancelled=0 AND starts>? AND starts<? ORDER BY starts LIMIT 500', now() - 3 * 3600000, now() + 120 * 86400000)
          .filter(e => venues.has(e.venue)).map(e => ({out: eventOut(e, venues.get(e.venue)), venue: venues.get(e.venue)}));
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
      // The website's counter. A quiz laptop sends one random id when a live quiz finishes (nothing else: no venue, team
      // or score), unless its venue switched counting off; the same id twice counts once.
      if (method === 'POST' && p === '/v1/quiz-runs') {
        limit('run:' + ip);
        check(typeof input.run === 'string' && /^[0-9a-f]{16}$/.test(input.run), 'Not a quiz run');
        run('INSERT OR IGNORE INTO quiz_runs VALUES(?,?)', input.run, now());
        return send(201, {counted: true});
      }
      // Venues using BeerMat (a registered quiz laptop, or Pro) and quizzes run, for the website.
      if (method === 'GET' && p === '/v1/stats') {
        return send(200, {venues: one(`SELECT COUNT(*) n FROM venues WHERE id IN (SELECT venue FROM venue_keys) OR (${PRO_SQL})`, now()).n,
          quizzes: one('SELECT COUNT(*) n FROM quiz_runs').n});
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
          board.set(a.id, {ref: profileRef(a.id), name: a.display_name, avatar: p2.photo ? a.avatar : null, quizzes: s.quizzes, wins: s.wins, points: s.points, accuracy: s.accuracy});
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
  return {server, db, importVenues, publishRegular, close: () => new Promise(resolve => {clearInterval(regularTimer); clearInterval(relayCleanup); for (const r of relays.values()) for (const s of r.streams) try {s.end();} catch {} relays.clear(); server.close(() => {db.close(); resolve();}); server.closeAllConnections();})};
}

// The HTML side of an email: tables and inline styles, which every email app understands, in BeerMat's colours.
const escape = s => String(s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c]);
export function emailHtml({base, title, name, intro, button, url, outro}) {
  const font = "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>${escape(title)}</title>
<style>:root{color-scheme:light dark;supported-color-schemes:light dark}
@media (prefers-color-scheme: dark){.bm-page{background:#0d0720!important}.bm-card{background:#221447!important}.bm-h{color:#ffffff!important}.bm-text{color:#fff3d6!important}
.bm-soft{color:#c8b9e4!important}.bm-soft a{color:#c8b9e4!important}.bm-foot{border-top-color:#33215f!important}}</style></head>
<body class="bm-page" style="margin:0;padding:0;background:#f3eefb;">
<table class="bm-page" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3eefb;"><tr><td align="center" style="padding:32px 16px;">
<table class="bm-card" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:18px;overflow:hidden;">
<tr><td align="center" style="background:#140b2e;padding:28px 24px;"><img src="${base}/brand/logo-email.png" width="200" height="75" alt="BeerMat" style="display:block;border:0;width:200px;height:auto;"></td></tr>
<tr><td style="height:4px;background:#ff3d81;background-image:linear-gradient(90deg,#ff3d81,#ffb21a,#1fd6c6);font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td style="padding:32px 32px 8px;font-family:${font};color:#1c1036;">
<h1 class="bm-h" style="margin:0 0 16px;font-size:24px;line-height:1.25;color:#140b2e;">Hi ${escape(name)},</h1>
<p class="bm-text" style="margin:0 0 24px;font-size:16px;line-height:1.55;color:#3b2d5c;">${escape(intro)}</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px;"><tr><td style="border-radius:999px;background:#ffb21a;"><a href="${escape(url)}" style="display:inline-block;padding:14px 28px;font-family:${font};font-size:16px;font-weight:700;color:#140b2e;text-decoration:none;border-radius:999px;">${escape(button)}</a></td></tr></table>
<p class="bm-soft" style="margin:0 0 8px;font-size:14px;line-height:1.5;color:#6b5d89;">${escape(outro)}</p>
<p class="bm-soft" style="margin:0 0 24px;font-size:12px;line-height:1.5;color:#8d82a8;word-break:break-all;">Button not working? Copy this into your browser:<br><a href="${escape(url)}" style="color:#8d82a8;">${escape(url)}</a></p>
</td></tr>
<tr><td class="bm-soft bm-foot" style="padding:18px 32px;border-top:1px solid #eee8f6;font-family:${font};font-size:12px;line-height:1.5;color:#8d82a8;">BeerMat · gettin’ quizzy with it<br><a href="https://beermatquiz.co.uk" style="color:#8d82a8;">beermatquiz.co.uk</a></td></tr>
</table></td></tr></table></body></html>`;
}

// Email through Resend (resend.com: RESEND_API_KEY, and MAIL_FROM on a domain verified there).
export const resendMail = (key, from) => async ({to, subject, text, html}) => {
  const response = await fetch('https://api.resend.com/emails', {method: 'POST', headers: {Authorization: 'Bearer ' + key, 'Content-Type': 'application/json'},
    body: JSON.stringify({from, to: [to], subject, text, html}), signal: AbortSignal.timeout(10000)});
  if (!response.ok) throw Error(`Resend said ${response.status}`);
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const service = createService({database: process.env.ONLINE_DB || 'online.sqlite', allowedOrigins: (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean),
    backupDir: process.env.BACKUP_DIR || '', trustProxy: process.env.TRUST_PROXY === '1', licenceKey: process.env.LICENCE_KEY_FILE && existsSync(process.env.LICENCE_KEY_FILE) ? readFileSync(process.env.LICENCE_KEY_FILE, 'utf8').trim() : '',
    publicUrl: process.env.PUBLIC_URL || '', adminEmail: process.env.ADMIN_EMAIL || '',
    stripe: process.env.STRIPE_SECRET_KEY ? {secretKey: process.env.STRIPE_SECRET_KEY, webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '', siteUrl: process.env.SITE_URL || '',
      prices: {monthly: process.env.STRIPE_PRICE_MONTHLY, yearly: process.env.STRIPE_PRICE_YEARLY},
      // The founding price for the first venues to pay (none: no founding offer), its own customer portal, and the trial.
      founding: process.env.STRIPE_PRICE_FOUNDING_MONTHLY ? {monthly: process.env.STRIPE_PRICE_FOUNDING_MONTHLY, yearly: process.env.STRIPE_PRICE_FOUNDING_YEARLY} : null,
      portalFounding: process.env.STRIPE_PORTAL_FOUNDING || '', foundingPlaces: Number(process.env.STRIPE_FOUNDING_PLACES || 20), trialDays: Number(process.env.STRIPE_TRIAL_DAYS ?? 14)} : null, mail: process.env.RESEND_API_KEY ? resendMail(process.env.RESEND_API_KEY, process.env.MAIL_FROM || 'BeerMat <noreply@example.com>') : null,
    // Shared themes' browser previews, when this server has Playwright's Chromium (online/preview.js); none otherwise.
    renderPreview: await import('./preview.js').then(m => m.browserPreview()).catch(e => {console.log('Theme browser previews off:', e.message); return null;}),
    drawPreviews: await import('./qt-preview.js').then(m => m.qtPreviews()).catch(e => {console.log('Theme TV and app pictures off:', e.message); return null;})});
  service.server.listen(Number(process.env.PORT || 8080), process.env.BIND || '127.0.0.1', () => console.log(`BeerMat Online on http://${process.env.BIND || '127.0.0.1'}:${process.env.PORT || 8080} (put HTTPS in front before going public)`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => service.close().then(() => process.exit(0)));
}
