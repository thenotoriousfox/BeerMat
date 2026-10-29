import http from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes, randomInt, timingSafeEqual, createHash} from 'node:crypto';
import {existsSync, mkdirSync, writeFileSync, statSync, statfsSync, createReadStream, unlinkSync, readdirSync, readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {offensive} from './names.js';
import {createSpotify} from './spotify.js';
import {createLaptop} from './laptop.js';
import {lanAddresses, joinUrlFor, diagnose, hotspotAddresses, fetchProbe} from './network.js';
import {teamResults} from './results.js';
import {newVenueKey, signClaim, keyId} from '../shared/claims.js';
import {readLicence, licencePublicKey} from '../shared/licence.js';
import {edition} from './edition.js';
import {slotFiles, skippedBuzzerPacks, bingoCallsFile, callColours} from '../web/soundnames.js';
import {typeGroups} from './looks.js';
import {loadThemes} from './themes.js';
import {fetchDriveQuiz} from './drive.js';
import {createSimulator, cleanOptions, fastSeconds} from './rehearsal.js';
import {QuizError, requireValue, types as questionTypes, validateQuestion, validateLibrary, answerValue, isCorrect, basePoints, rankNearest, autoMarked, speedBonusOf, soundSlots, audioPath, hostDriven, isBingo, bingoStages, stagePoints, bingoCard, musicCard, bingoLines, bingoNeeded, snakeGrid, shuffleTiles, mediaPattern, sheetPoints, spotifyTrack} from './model.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..'), web = path.join(root, 'web');
const token = () => randomBytes(24).toString('hex');
const hash = value => createHash('sha256').update(value).digest('hex');
const equal = (a, b) => typeof a === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const brandFiles = new Set(['mark.svg', 'logo.svg', 'logo-stacked.svg', 'wordmark.svg', 'mark-print.svg', 'logo-print.svg', 'fredoka.woff2']);
const types = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.svg': 'image/svg+xml', '.woff2': 'font/woff2'};
const security = {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; media-src 'self'; img-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"};
// Only the quiz desk may load Spotify's Web Playback SDK (its script, its hidden player frame and the audio it streams).
// Phones and the TV keep the strict, local-only policy.
const deskSecurity = {...security, 'Content-Security-Policy': security['Content-Security-Policy']
  .replace("script-src 'self'", "script-src 'self' https://sdk.scdn.co").replace("media-src 'self'", "media-src 'self' blob: https://*.scdn.co https://*.spotifycdn.com")
  .replace("connect-src 'self'", "connect-src 'self' https://*.spotify.com wss://*.spotify.com https://*.scdn.co https://*.spotifycdn.com") + '; frame-src https://sdk.scdn.co'};
// A late phone may not gain more than this much speed-bonus time over the moment the question opened.
const DELIVERY_GRACE_MS = 2000;
const SESSION_MS = 12 * 60 * 60 * 1000;
// Read-only routes never notify clients of a change.
const readOnly = new Set(['/api/host/results', '/api/team/result', '/api/host/laptop', '/api/host/network', '/api/host/network/check', '/api/state', '/api/draft', '/api/login', '/api/host/state', '/api/host/library', '/api/host/review', '/api/host/export', '/api/host/logout', '/api/device', '/api/host/spotify/status', '/api/host/spotify/import', '/api/host/spotify/token', '/api/host/drive', '/api/host/spotify/preview', '/api/host/spotify/pause', '/api/host/online/account', '/api/host/online/signin', '/api/host/online/signup', '/api/host/online/signout', '/api/host/online/call', '/api/host/online/locate', '/api/host/plan', '/api/host/buzzer-library', '/api/host/buzzer-library/play', '/api/host/buzzer-library/share', '/api/host/buzzer-library/remove', '/api/host/buzzer-library/report', '/api/host/preflight']);

// A sound pack is a folder: general/<name>.mp3 for each moment (soundnames.js), buzzers/<pack>/*.mp3, Themes/<name>/,
// and optionally bingo-calls.json at the top. `prefix` is the URL they are served under.
function loadPack(dir, prefix) {
  const audio = f => /\.(mp3|ogg|wav)$/i.test(f), url = relative => prefix + relative.split('/').map(encodeURIComponent).join('/');
  const list = (folder, dirs = false) => {try {return readdirSync(path.join(dir, folder), {withFileTypes: true}).filter(e => dirs ? e.isDirectory() : e.isFile() && audio(e.name)).map(e => e.name).sort((a, b) => a.localeCompare(b));} catch {return [];}};
  // Moments found in one folder: general/ for the standard sounds, Themes/<name>/ for a theme.
  const slotsIn = folder => {
    const slots = {};
    for (const [slot, names] of Object.entries(slotFiles)) {
      const file = names.flatMap(name => ['.mp3', '.ogg', '.wav'].map(ext => `${folder}/${name}${ext}`)).find(f => existsSync(path.join(dir, f)));
      if (file) slots[slot] = url(file);
    }
    return slots;
  };
  const slots = slotsIn('general'), themes = Object.fromEntries(list('Themes', true).map(theme => [theme, slotsIn(`Themes/${theme}`)]).filter(([, s]) => Object.keys(s).length));
  const buzzers = list('buzzers', true).filter(pack => !skippedBuzzerPacks.test(pack))
    .flatMap(pack => list(`buzzers/${pack}`).map(f => ({name: f.replace(/\.[^.]+$/, '').slice(0, 60), media: url(`buzzers/${pack}/${f}`)})));
  // A spoken caller: bingo_voice/<n>.mp3 says number n's call (scripts/bingo-voice.mjs records them).
  const voice = Array.from({length: 90}, (_, i) => existsSync(path.join(dir, 'bingo_voice', `${i + 1}.mp3`)) ? url(`bingo_voice/${i + 1}.mp3`) : null);
  let calls = null;
  try {
    const data = JSON.parse(readFileSync(path.join(dir, bingoCallsFile), 'utf8'));
    calls = Array.from({length: 90}, (_, i) => {const c = Array.isArray(data) ? data[i] : data[i + 1]; return typeof c === 'string' ? c.trim().slice(0, 150) : '';});
    if (!calls.some(Boolean)) calls = null;
  } catch {}
  return {slots, themes, buzzers, calls, voice: voice.some(Boolean) ? voice : null};
}

// BeerMat Online (online/service.js, deployed by online/deploy.sh). Only used when the quizmaster shares results or
// runs their venue from the desk.
export const onlineDefault = 'https://online.beermatquiz.co.uk';

export function createQuiz({database = 'quiz.sqlite', hostKey, now = Date.now, mediaDir = path.join(root, 'media'), allowedAddresses = null, clientAddress = null, spotifyAccountsUrl, spotifyApiUrl, packDir = path.join(root, 'soundpack'), soundsDir = path.join(root, 'sounds'), themesDir = path.join(root, 'themes'), laptop = null, deskTicket = null, onQuit = null, publicPort = 3001, interfaces, networkCheck = diagnose, reachProbe = fetchProbe, fetchImpl = globalThis.fetch, plan: fixedPlan = null, licenceKey = licencePublicKey} = {}) {
  if (typeof hostKey !== 'string' || hostKey.length < 12) throw Error('HOST_KEY must contain at least 12 characters');
  const db = new DatabaseSync(database);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS teams(id TEXT PRIMARY KEY,name TEXT UNIQUE COLLATE NOCASE,secret TEXT UNIQUE,seen INTEGER);
    CREATE TABLE IF NOT EXISTS questions(id INTEGER PRIMARY KEY AUTOINCREMENT,data TEXT,opened INTEGER,deadline INTEGER,closed INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS answers(team TEXT REFERENCES teams(id),question INTEGER REFERENCES questions(id),value TEXT,points INTEGER DEFAULT 0,PRIMARY KEY(team,question));
    CREATE TABLE IF NOT EXISTS adjustments(id INTEGER PRIMARY KEY,team TEXT REFERENCES teams(id),points INTEGER,reason TEXT);
    CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS drafts(team TEXT REFERENCES teams(id),question INTEGER REFERENCES questions(id),value TEXT,PRIMARY KEY(team,question));
    CREATE TABLE IF NOT EXISTS actions(key TEXT PRIMARY KEY,result TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS marking_log(id INTEGER PRIMARY KEY,team TEXT,question INTEGER,previous_points INTEGER,new_points INTEGER,marks TEXT,changed INTEGER);
    CREATE TABLE IF NOT EXISTS deliveries(team TEXT REFERENCES teams(id),question INTEGER REFERENCES questions(id),at INTEGER NOT NULL,PRIMARY KEY(team,question));
    CREATE TABLE IF NOT EXISTS buzzes(team TEXT REFERENCES teams(id),question INTEGER REFERENCES questions(id),at INTEGER NOT NULL,status TEXT NOT NULL,PRIMARY KEY(team,question));
    CREATE TABLE IF NOT EXISTS agrees(team TEXT REFERENCES teams(id),question INTEGER REFERENCES questions(id),at INTEGER NOT NULL,PRIMARY KEY(team,question));
    CREATE TABLE IF NOT EXISTS host_sessions(hash TEXT PRIMARY KEY,expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS go_wide(team TEXT REFERENCES teams(id),question INTEGER REFERENCES questions(id),PRIMARY KEY(team,question));
    CREATE TABLE IF NOT EXISTS device_ips(ip TEXT PRIMARY KEY,team TEXT REFERENCES teams(id),seen INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS away(team TEXT REFERENCES teams(id),question INTEGER REFERENCES questions(id),ms INTEGER NOT NULL DEFAULT 0,count INTEGER NOT NULL DEFAULT 0,since INTEGER,PRIMARY KEY(team,question));
    CREATE TABLE IF NOT EXISTS clip_plays(question INTEGER REFERENCES questions(id),seq INTEGER NOT NULL,clip INTEGER NOT NULL,at INTEGER NOT NULL,PRIMARY KEY(question,seq));
    CREATE TABLE IF NOT EXISTS bingo_shouts(id INTEGER PRIMARY KEY,question INTEGER REFERENCES questions(id),team TEXT REFERENCES teams(id),stage INTEGER NOT NULL,seq INTEGER NOT NULL,at INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'pending');
    CREATE TABLE IF NOT EXISTS bingo_claims(question INTEGER REFERENCES questions(id),team TEXT REFERENCES teams(id),stage INTEGER NOT NULL,seq INTEGER NOT NULL,at INTEGER NOT NULL,PRIMARY KEY(question,team,stage));
    CREATE TABLE IF NOT EXISTS bingo_calls(question INTEGER REFERENCES questions(id),seq INTEGER NOT NULL,number INTEGER NOT NULL,at INTEGER NOT NULL,PRIMARY KEY(question,seq));
    CREATE TABLE IF NOT EXISTS event_results(event TEXT PRIMARY KEY,title TEXT NOT NULL,finished INTEGER NOT NULL,data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS regulars(id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE COLLATE NOCASE,pin TEXT NOT NULL UNIQUE,sound INTEGER,photo TEXT,last_played INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sync_outbox(id TEXT PRIMARY KEY,kind TEXT NOT NULL,payload TEXT NOT NULL,created INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,last_error TEXT,sent INTEGER);
  `);
  function column(table, name, definition) {
    if (!db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  }
  column('teams', 'enabled', 'INTEGER NOT NULL DEFAULT 1');
  column('teams', 'sound', 'INTEGER');
  column('teams', 'photo', 'TEXT');
  column('teams', 'photo_status', 'TEXT');
  column('teams', 'note', 'TEXT');
  column('teams', 'transfer_code', 'TEXT');
  column('teams', 'transfer_expires', 'INTEGER');
  column('teams', 'waiting', 'INTEGER NOT NULL DEFAULT 0');
  column('teams', 'regular', 'TEXT');
  // What a team is: a real team ('player'), a rehearsal's simulated team ('sim'), or a real phone that joined a rehearsal
  // to test its connection ('device'), which may never play. Teams from before rehearsals existed are players.
  column('teams', 'kind', "TEXT NOT NULL DEFAULT 'player'");
  column('questions', 'paused_ms', 'INTEGER');
  column('questions', 'revealed', 'INTEGER NOT NULL DEFAULT 0');
  column('questions', 'settled', 'INTEGER NOT NULL DEFAULT 0');
  column('questions', 'agree_deadline', 'INTEGER');
  column('questions', 'announced', 'TEXT');
  column('answers', 'submitted', 'INTEGER');
  column('questions', 'closed_at', 'INTEGER');
  column('questions', 'revealed_at', 'INTEGER');
  column('answers', 'marks', 'TEXT');
  const rows = (sql, ...params) => db.prepare(sql).all(...params);
  const one = (sql, ...params) => db.prepare(sql).get(...params);
  const run = (sql, ...params) => db.prepare(sql).run(...params);
  let depth = 0;
  function transaction(fn) {
    if (depth) return fn();
    db.exec('BEGIN IMMEDIATE'); depth++;
    try {const result = fn(); db.exec('COMMIT'); return result;} catch (e) {db.exec('ROLLBACK'); throw e;} finally {depth--;}
  }
  const getMeta = (key, fallback) => {
    const value = one('SELECT value FROM metadata WHERE key=?', key);
    return value ? JSON.parse(value.value) : fallback;
  };
  const setMeta = (key, value) => run('INSERT INTO metadata VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, JSON.stringify(value));
  const defaultSettings = {title: 'BeerMat', registrationOpen: true, leaderboardVisible: true, displayMode: 'auto', ended: false, joinSsid: 'BeerMat', joinUrl: 'http://10.42.0.1', joinMode: 'hotspot', joinPassword: '', shareResults: false, onlineService: onlineDefault, scrambleKeypads: false, bingoPhrases: true, bingoVoice: true, bingoBoard: false, teamPhotos: true, language: 'en', onlineAfterJoin: true, deskOnline: false, waitingRoom: true, maxTeams: 0, showScores: true, soundTheme: '', soundThemeByType: {}, look: 'stage', lookByType: {}};
  const SOUNDS = 8;
  // Sound effects for the TV and extra buzzer sounds, both from the quizmaster's own files; custom bingo calls (1–90).
  // This laptop's sound pack (soundpack/) supplies the defaults until the desk changes them; a desk choice of
  // the built-in bingo calls is stored as null.
  // BeerMat ships CC0 sounds in sounds/; a laptop's own soundpack/ (same layout) takes priority over them.
  // A sound theme (the pack's Themes/<name>) replaces the moments it has a sound for. Desk choices, stored
  // separately for moments and buzzers, override the defaults. Reloaded after the bingo caller is recorded.
  // Themes in themes/<id>/ (themes.js) bring a look and, with a sounds/ folder, a sound theme under the theme's name.
  let shipped, local, themes;
  const folders = loadThemes(themesDir);
  const reloadPack = () => {
    shipped = loadPack(soundsDir, '/sounds/'); local = loadPack(packDir, '/pack/');
    themes = {...shipped.themes, ...Object.fromEntries(folders.themes.filter(t => Object.keys(t.sounds).length).map(t => [t.name, t.sounds])), ...local.themes};
  };
  reloadPack();
  // Seasonal themes (Halloween) are only used when chosen.
  const seasonal = name => folders.themes.some(t => t.seasonal && (t.id === name || t.name === name));
  const looks = folders.themes.map(t => [t.id, t.name]);
  const defaults = theme => ({slots: {...shipped.slots, ...local.slots, ...themes[theme]}, buzzers: [...local.buzzers, ...shipped.buzzers].slice(0, 200)});
  // The theme can be fixed, random for each question (stable per question) or chosen by question type.
  // By type, the default spreads the themes over groups of formats; the desk can change any type.
  const themesByType = () => {
    const names = Object.keys(themes).filter(name => !seasonal(name)).sort(), chosen = settings().soundThemeByType || {};
    const auto = Object.fromEntries(typeGroups.flatMap((types, i) => types.map(type => [type, names.length ? names[i % names.length] : ''])));
    return {...auto, ...Object.fromEntries(Object.entries(chosen).filter(([, theme]) => theme === '' || Object.hasOwn(themes, theme)))};
  };
  function themeFor(q) {
    const mode = settings().soundTheme;
    if (Object.hasOwn(themes, mode)) return mode;
    if (!q || !['@random', '@type'].includes(mode)) return '';
    if (mode === '@type') return themesByType()[dataOf(q).type] ?? '';
    const pool = ['', ...Object.keys(themes).filter(name => !seasonal(name)).sort()];
    return pool[pickFor(q.id, 0x27d4eb2f, pool.length)];
  }
  // The TV and phones' look: fixed, random for each question (stable per question), or by question type, where the
  // default gives each group of formats its own look.
  // A random-looking but fixed choice for each question (a small integer hash; `salt` keeps looks and sounds apart).
  const pickFor = (id, salt, count) => {
    let h = Math.imul(id ^ salt, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
    return (h >>> 0) % count;
  };
  const lookIds = looks.map(([id]) => id), groupLooks = ['stage', 'ocean', 'sunset', 'neon', 'emerald'].filter(id => lookIds.includes(id));
  const looksByType = () => ({...Object.fromEntries(typeGroups.flatMap((types, i) => types.map(type => [type, groupLooks[i % groupLooks.length] ?? 'stage']))), ...settings().lookByType});
  function lookFor(q) {
    const mode = settings().look;
    if (lookIds.includes(mode) || mode === 'stage') return mode;
    if (!q) return 'stage';
    if (mode === '@type') return looksByType()[dataOf(q).type] ?? 'stage';
    const pool = lookIds.filter(id => !seasonal(id));
    return mode === '@random' && pool.length ? pool[pickFor(q.id, 0x5bd1e995, pool.length)] : 'stage';
  }
  // Desk choices for single moments sit on top of the theme (null removes a moment's sound).
  const soundPack = (q = latest()) => {
    const saved = getMeta('soundPack', {}), base = defaults(themeFor(q));
    const slots = Object.fromEntries(Object.entries({...base.slots, ...saved.slots}).filter(([slot, media]) => media && soundSlots.includes(slot)));
    return {slots, buzzers: saved.buzzers ?? base.buzzers};
  };
  const bingoCalls = () => getMeta('bingoCalls', local.calls ?? shipped.calls);
  // The spoken caller has to say the calls on screen: the pack's recordings go with the pack's calls file, the shipped
  // ones with BeerMat's own calls, and calls typed on the desk have none. Silent while the caller or the bingo phrases
  // are switched off.
  function bingoVoice(n) {
    if (!settings().bingoVoice || !settings().bingoPhrases) return null;
    const saved = getMeta('bingoCalls', undefined);
    const voice = saved === undefined ? (local.calls ? local.voice : shipped.voice) : saved === null ? shipped.voice : null;
    return voice?.[n - 1] ?? null;
  }
  const bingoColours = () => callColours(bingoCalls());
  // Only audio files inside the two sound folders are ever served.
  const packFile = p => {
    const [prefix, dir] = p.startsWith('/pack/') ? ['/pack/', packDir] : p.startsWith('/sounds/') ? ['/sounds/', soundsDir] : [];
    if (!prefix) return null;
    let relative; try {relative = decodeURIComponent(p.slice(prefix.length));} catch {return null;}
    const base = path.resolve(dir), file = path.resolve(base, relative);
    return file.startsWith(base + path.sep) && /\.(mp3|ogg|wav)$/i.test(file) && existsSync(file) && statSync(file).isFile() ? file : null;
  };
  const settings = () => ({...defaultSettings, ...getMeta('settings', {})});
  // BeerMat Online's address: the desk's own, or BeerMat's when the box was saved empty.
  const onlineBase = () => settings().onlineService || onlineDefault;
  // Each event has an ID, so phones can tell "a new quiz has started" from a revoked code.
  if (!getMeta('event', '')) setMeta('event', token().slice(0, 12));
  // Events saved before the automatic TV existed start on it once.
  if (!getMeta('autoTv', false)) {const saved = getMeta('settings', null); if (saved) setMeta('settings', {...saved, displayMode: 'auto'}); setMeta('autoTv', true);}
  const library = () => getMeta('library', {revision: 0, title: 'My quiz', rounds: []});
  const spotify = createSpotify({getMeta, setMeta, now, accountsUrl: spotifyAccountsUrl, apiUrl: spotifyApiUrl});
  // Spotify only accepts loopback redirect addresses written as an IP, so sign-in returns to 127.0.0.1 on this port.
  const spotifyRedirect = () => `http://127.0.0.1:${server.address().port}/spotify/callback`;
  const usesSpotify = data => (data.songs || data.clips || []).some(x => x.spotify);
  const latest = () => one('SELECT * FROM questions ORDER BY id DESC LIMIT 1');
  const questionById = id => Number.isSafeInteger(id) && id > 0 ? one('SELECT * FROM questions WHERE id=?', id) : null;
  const dataOf = q => JSON.parse(q.data);
  const pending = q => !!q && !q.closed && (hostDriven(dataOf(q).type) || q.paused_ms !== null || now() < q.deadline);
  // A reveal can be held back for a few seconds (while the TV plays its drum roll); until then it is "revealing".
  const revealedNow = q => !!q?.revealed && (q.revealed_at ?? 0) <= now();
  const accepting = q => pending(q) && q.paused_ms === null && !settings().ended && now() < q.deadline;

  // Host sessions survive restarts; only a hash of each token is stored.
  function isHost(auth) {
    if (typeof auth !== 'string' || !auth) return false;
    const session = one('SELECT expires FROM host_sessions WHERE hash=?', hash(auth));
    return !!session && session.expires > now();
  }
  const attempts = new Map();
  function prune() {
    run('DELETE FROM host_sessions WHERE expires<=?', now());
    for (const [ip, a] of attempts) if (now() - a.time >= 60000) attempts.delete(ip);
  }

  // Live updates: every client keeps one server-sent event stream (or, online, a WebSocket) and refetches state on each nudge.
  const streams = new Set(); let version = 0, notifyTimer = null, lastPending = null, ticks = 0;
  function notify() {
    if (notifyTimer) return;
    notifyTimer = setTimeout(() => {
      notifyTimer = null; version++;
      for (const stream of streams) stream.send(version);
      rehearsalTick();
    }, 20);
  }
  const liveTeams = () => new Set([...streams].map(s => s.team).filter(Boolean));
  const ticker = setInterval(() => {
    // Expiry is time-driven, so announce it as soon as it happens.
    const q = latest(), state = (q ? `${q.id}:${pending(q)}:${accepting(q)}:${q.agree_deadline > now()}:${revealedNow(q)}` : '') + ':' + tvView();
    if (state !== lastPending) {lastPending = state; if (q) settle(q); notify();}
    if (++ticks % 60 === 0) for (const stream of streams) stream.ping();
  }, 250);
  const keepAlive = setInterval(prune, 60000);
  ticker.unref(); keepAlive.unref();

  function tally(q, data) {
    if (!['choice', 'multi', 'vote', 'letter', 'number'].includes(data.type)) return null;
    const counts = {};
    for (const a of rows('SELECT value FROM answers WHERE question=? AND submitted IS NOT NULL', q.id)) {
      for (const value of data.type === 'multi' ? JSON.parse(a.value) : [a.value]) counts[value] = (counts[value] || 0) + 1;
    }
    return counts;
  }
  function buzzState(q, data, teamId = null) {
    if (data.type !== 'buzzer') return null;
    const queue = rows(`SELECT b.team,b.at,b.status,t.name,t.sound,t.photo,t.photo_status FROM buzzes b JOIN teams t ON t.id=b.team WHERE b.question=? ORDER BY b.at,b.rowid`, q.id);
    const active = queue.find(b => b.status === 'active');
    return {variation: data.variation, queue: queue.map(({team, name, status}) => ({team, name, status})), active: active ? {team: active.team, name: active.name, sound: active.sound, photo: publicPhoto(active)} : null,
      announced: q.announced || '', agreeOpen: q.agree_deadline > now(), agreeDeadline: q.agree_deadline || null,
      agreeCount: one('SELECT COUNT(*) n FROM agrees WHERE question=?', q.id).n,
      ...(teamId ? {buzzed: queue.find(b => b.team === teamId)?.status || null, agreed: !!one('SELECT 1 FROM agrees WHERE question=? AND team=?', q.id, teamId), lockedOut: lockedOut(q, teamId)} : {})};
  }
  // Classic buzzer: a team ruled wrong sits out the next buzzer question.
  function lockedOut(q, teamId) {
    const previous = rows('SELECT id,data FROM questions WHERE id<? ORDER BY id DESC LIMIT 20', q.id).find(p => dataOf(p).type === 'buzzer');
    return !!previous && dataOf(previous).variation === 'classic' && !!one(`SELECT 1 FROM buzzes WHERE question=? AND team=? AND status='wrong'`, previous.id, teamId);
  }
  const calledNumbers = q => rows('SELECT number FROM bingo_calls WHERE question=? ORDER BY seq', q.id).map(r => r.number);
  const ticket = (data, teamId, q) => data.type === 'musicbingo' ? musicCard(`${teamId}:${q.id}`, data.songs.length) : bingoCard(`${teamId}:${q.id}`);
  // Bingo is played in stages: just one (line, two lines or full house) or, in a full game, all three in turn.
  // A stage stays open for claims on the number that won it (ties share it); the next number moves play on.
  function bingoProgress(q, data) {
    const stages = bingoStages(data.mode), called = calledNumbers(q).length;
    const claims = rows('SELECT c.team,c.stage,c.seq,t.name FROM bingo_claims c JOIN teams t ON t.id=c.team WHERE c.question=? ORDER BY c.at,c.rowid', q.id);
    let current = 0;
    for (; current < stages.length; current++) {const first = claims.find(c => c.stage === current); if (!first || first.seq === called) break;}
    return {stages, claims, current: current < stages.length ? current : null, over: claims.some(c => c.stage === stages.length - 1)};
  }
  function bingoState(q, data, teamId, host) {
    if (!isBingo(data.type)) return null;
    const called = calledNumbers(q), {stages, claims, current, over} = bingoProgress(q, data);
    const names = i => claims.filter(c => c.stage === i).map(c => c.name), won = stages.map((_, i) => i).filter(i => names(i).length), last = won.at(-1);
    // Once a stage has its winner, teams play for the next one (ties on the same number still count for the old one).
    const next = current === null ? stages.length : current + (names(current).length ? 1 : 0);
    const progress = {playingFor: over || next >= stages.length ? null : stages[next], stageWins: won.map(i => ({stage: stages[i], names: names(i)})),
      winners: last === undefined ? [] : names(last), lastStage: last === undefined ? null : stages[last], over, claims: claims.length};
    // Shouts of "bingo!" wait for the quizmaster's verdict. The desk also sees whether each ticket checks out.
    const shouts = rows('SELECT s.id,s.team,s.stage,s.seq,s.status,t.name FROM bingo_shouts s JOIN teams t ON t.id=s.team WHERE s.question=? ORDER BY s.id', q.id);
    const checks = s => bingoLines(ticket(data, s.team, q), new Set(called.slice(0, s.seq))) >= bingoNeeded(stages[s.stage]);
    progress.shouts = shouts.map(s => ({id: s.id, name: s.name, status: s.status, seq: s.seq, ...host && s.status === 'pending' && {stage: stages[s.stage], checks: checks(s)}}));
    progress.pending = shouts.filter(s => s.status === 'pending').length;
    const myShout = teamId && shouts.filter(s => s.team === teamId).at(-1);
    const mine = teamId ? {claimed: current !== null && claims.some(c => c.team === teamId && c.stage === current), myWins: claims.filter(c => c.team === teamId).map(c => stages[c.stage]),
      // After a wrong call a team waits for the next number before calling again.
      myShout: myShout ? {status: myShout.status, seq: myShout.seq} : null} : {};
    const winners = progress.winners;
    // Teams have to listen: unless the quizmaster puts the board on, phones and the TV get only the latest call and how
    // many there have been, until the game ends. The desk always has the full list.
    const board = host || settings().bingoBoard || !pending(q);
    if (data.type === 'bingo') return {mode: data.mode, ...progress, board, colours: bingoColours(), called: board ? called : null, count: called.length, last: called.at(-1) ?? null, phrase: called.length ? bingoCalls()?.[called.at(-1) - 1] || null : null, voice: called.length ? bingoVoice(called.at(-1)) : null, winners, ...mine, ...(teamId ? {card: ticket(data, teamId, q)} : {})};
    // Music bingo hides the song now playing (teams must recognise it) unless the host chose to reveal titles straight away.
    const shown = data.revealNow || !pending(q) ? called : called.slice(0, -1);
    return {mode: data.mode, ...progress, music: true, board, played: called.length, titles: (board ? shown : shown.slice(-1)).map(n => data.songs[n - 1].title), winners, ...mine,
      ...(teamId ? {card: ticket(data, teamId, q).map(row => row.map(n => data.songs[n - 1].title))} : {}),
      ...(host ? {current: called.length ? {number: called.at(-1), ...data.songs[called.at(-1) - 1]} : null} : {})};
  }
  // Sound clips: the desk logs when each clip starts (clip -1 = gap/stopped); a tap counts for whatever was playing.
  const nowPlaying = q => one('SELECT seq,clip,at FROM clip_plays WHERE question=? ORDER BY seq DESC LIMIT 1', q.id);
  function clipState(q, data, teamId) {
    if (data.type !== 'clips') return null;
    const playing = nowPlaying(q), tap = teamId && one('SELECT value FROM answers WHERE team=? AND question=?', teamId, q.id);
    return {count: data.clips.length, playing: playing && playing.clip >= 0 ? playing.clip + 1 : null, taps: one('SELECT COUNT(*) n FROM answers WHERE question=?', q.id).n,
      ...(teamId ? {tapped: tap ? tap.value : null} : {})};
  }
  function publicQuestion(q, host = false, teamId = null) {
    if (!q) return null;
    const data = dataOf(q);
    const {answer, aliases, itemAnswers, itemAliases, answerNote, correct, target, clips, targetClip, songs, snake, tiles, clip, ...safe} = data;
    // Sequence items are shown shuffled; the stored order is the answer.
    const result = {...safe, id: q.id, deadline: q.deadline, open: accepting(q), live: pending(q), paused: pending(q) && q.paused_ms !== null,
      remaining: q.paused_ms ?? Math.max(0, q.deadline - now()), revealed: revealedNow(q) && (host || !secretQuestion(q)), revealing: !!q.revealed && !revealedNow(q) && (host || !secretQuestion(q)), buzz: buzzState(q, data, teamId), bingo: bingoState(q, data, teamId, host), clipGame: clipState(q, data, teamId)};
    // A question playing a Spotify song says so (not which song), so the TV keeps its music and countdown quiet.
    if (clip) result.playsSong = true;
    if (data.type === 'sequence') result.order = shuffleOrder(data.items.length, q.id);
    if (snake) {
      result.grid = {size: snake.size, letters: snake.grid};
      // Going wide shows a team only the squares on the answer's path.
      if (teamId && one('SELECT 1 FROM go_wide WHERE team=? AND question=?', teamId, q.id)) result.wideCells = snake.path;
    }
    if (host || revealedNow(q) && !secretQuestion(q)) Object.assign(result, {answer, answerNote: answerNote || '', aliases: aliases || [], itemAnswers: itemAnswers || [], itemAliases: itemAliases || [], correct, target, clips, clip, targetClip, songs, snakePath: snake?.path, tiles, tally: tally(q, data),
      correctCount: one('SELECT COUNT(*) n FROM answers WHERE question=? AND points>0', q.id).n, scorers: scorers(q), first: firstPlace(q, data)});
    return result;
  }
  // Teams that scored, quickest answer first (each team's clock starts as for the speed bonus).
  // Answers the quizmaster marked by hand have no answer time and come last.
  // Closest-wins lists them closest first, with what they answered.
  function scorers(q) {
    const data = dataOf(q);
    // A tie-breaker scores nothing, so its reveal lists every answer, closest first.
    if (data.tieBreaker) {
      const answers = rows('SELECT a.team,a.value,a.submitted,t.name FROM answers a JOIN teams t ON t.id=a.team WHERE a.question=? AND a.submitted IS NOT NULL AND t.enabled=1', q.id), byTeam = new Map(answers.map(a => [a.team, a]));
      return rankNearest(data, answers).map(r => {const a = byTeam.get(r.team); return {name: a.name, points: null, ms: Math.max(0, a.submitted - q.opened - lateness(q, a.team)), answer: a.value};});
    }
    const shown = settings().showScores, nearest = data.type === 'nearest';
    return rows('SELECT a.team,a.points,a.submitted,a.value,t.name FROM answers a JOIN teams t ON t.id=a.team WHERE a.question=? AND a.points>0 AND t.enabled=1', q.id)
      .map(a => ({name: a.name, points: shown ? a.points : null, ms: a.submitted === null ? null : Math.max(0, a.submitted - q.opened - lateness(q, a.team)), ...nearest && {answer: a.value, rawPoints: a.points}}))
      .sort((a, b) => (nearest ? b.rawPoints - a.rawPoints : 0) || (a.ms ?? Infinity) - (b.ms ?? Infinity) || a.name.localeCompare(b.name))
      .map(({rawPoints, ...a}) => a);
  }
  // The team that came first on a fastest-fingers or closest-wins question, shown large on the TV at the reveal with
  // its photo and buzzer sound. Answers marked by hand have no time, so they never come first on speed.
  function firstPlace(q, data) {
    const nearest = data.type === 'nearest';
    if (!nearest && !data.fastestFingers) return null;
    // A tie-breaker scores nothing: the closest answer wins it.
    if (data.tieBreaker) {
      const answers = rows('SELECT a.team,a.value,a.submitted,t.name,t.sound,t.photo,t.photo_status FROM answers a JOIN teams t ON t.id=a.team WHERE a.question=? AND a.submitted IS NOT NULL AND t.enabled=1', q.id);
      const best = answers.find(a => a.team === rankNearest(data, answers)[0]?.team);
      return best ? {kind: 'tieBreaker', name: best.name, sound: best.sound, photo: publicPhoto(best), ms: Math.max(0, best.submitted - q.opened - lateness(q, best.team)), answer: best.value} : null;
    }
    const best = rows('SELECT a.team,a.points,a.submitted,a.value,t.name,t.sound,t.photo,t.photo_status FROM answers a JOIN teams t ON t.id=a.team WHERE a.question=? AND a.points>0 AND t.enabled=1 AND a.submitted IS NOT NULL', q.id)
      .map(a => ({...a, ms: Math.max(0, a.submitted - q.opened - lateness(q, a.team))}))
      .sort((a, b) => (nearest ? b.points - a.points : 0) || a.ms - b.ms || a.name.localeCompare(b.name))[0];
    return best ? {kind: nearest ? 'nearest' : 'fastest', name: best.name, sound: best.sound, photo: publicPhoto(best), ms: best.ms, ...nearest && {answer: best.value}} : null;
  }
  function shuffleOrder(length, seed) {
    const order = Array.from({length}, (_, i) => i); let s = seed * 9301 + 49297;
    for (let i = length - 1; i > 0; i--) {s = (s * 9301 + 49297) % 233280; const j = Math.floor(s / 233280 * (i + 1)); [order[i], order[j]] = [order[j], order[i]];}
    if (order.every((v, i) => v === i)) order.reverse();
    return order;
  }
  function scores(includeDisabled = false) {
    const live = liveTeams();
    const teams = rows(`SELECT id,name,seen,enabled,waiting,sound,photo,photo_status,note,
      COALESCE((SELECT SUM(a.points) FROM answers a JOIN questions q ON a.question=q.id WHERE a.team=teams.id AND (q.closed=1 OR q.settled=1)),0)
      +COALESCE((SELECT SUM(points) FROM adjustments WHERE team=teams.id),0) score FROM teams WHERE kind<>'device' ${includeDisabled ? '' : 'AND enabled=1 AND waiting=0'} ORDER BY score DESC,name`);
    // Teams level on points are split by the latest tie-breaker once it has closed: closest first, then the quicker
    // answer; teams that didn't answer it stay level with each other, behind those that did.
    const tie = tieOrder();
    if (tie) teams.sort((a, b) => b.score - a.score || (tie.get(a.id) ?? Infinity) - (tie.get(b.id) ?? Infinity) || a.name.localeCompare(b.name));
    let rank = 0, previous;
    return teams.map((t, i) => {
      const key = `${t.score}:${tie?.get(t.id) ?? ''}`;
      if (previous !== key) rank = i + 1; previous = key;
      return {...t, rank, connected: !!t.enabled && (live.has(t.id) || now() - t.seen < 15000)};
    });
  }
  // Teams level for first place once every saved question but the tie-breakers has been played (and nothing is live):
  // the desk offers the first unplayed tie-breaker. Null when there is no tie for first, or the quiz isn't over yet.
  function tieForFirst() {
    const q = latest(); if (!q || pending(q)) return null;
    const all = library().rounds.flatMap(r => r.questions), played = new Set(rows('SELECT data FROM questions').map(p => dataOf(p).sourceId).filter(Boolean));
    if (all.some(x => !x.tieBreaker && !played.has(x.id))) return null;
    const top = scores().filter(t => t.rank === 1);
    if (top.length < 2) return null;
    const breaker = all.find(x => x.tieBreaker && !played.has(x.id));
    return {teams: top.map(t => t.name), points: top[0].score, breaker: breaker ? {id: breaker.id, text: breaker.text} : null};
  }
  function tieOrder() {
    const q = rows('SELECT * FROM questions WHERE closed=1 OR settled=1 ORDER BY id DESC').find(q => dataOf(q).tieBreaker);
    if (!q) return null;
    const ranked = rankNearest(dataOf(q), rows('SELECT team,value,submitted FROM answers WHERE question=? AND submitted IS NOT NULL', q.id));
    return new Map(ranked.map((r, i) => [r.team, i]));
  }
  // Only photos the quizmaster approved are ever shown to other teams or on the TV.
  const publicPhoto = t => settings().teamPhotos && t.photo_status === 'approved' ? t.photo : null;
  function removePhoto(team) {
    if (team.photo && !one('SELECT 1 FROM regulars WHERE photo=?', team.photo)) try {unlinkSync(path.join(mediaDir, path.basename(team.photo)));} catch {}
    run('UPDATE teams SET photo=NULL,photo_status=NULL WHERE id=?', team.id);
  }
  function publicScores() {
    // With scores switched off, the board shows positions only.
    const shown = settings().showScores;
    // After a closest-wins answer is revealed, the board shows what each team put until the next question.
    const q = latest(), put = q && revealedNow(q) && dataOf(q).type === 'nearest' ? new Map(rows('SELECT team,value FROM answers WHERE question=? AND submitted IS NOT NULL', q.id).map(a => [a.team, a.value])) : null;
    return settings().leaderboardVisible && !secretRound() ? scores().map(({seen, connected, enabled, waiting, photo, photo_status, note, ...t}) => ({...t, score: shown ? t.score : null, photo: publicPhoto({photo, photo_status}), ...put && {answer: put.get(t.id) ?? null}})) : [];
  }
  // Desk-only statistics: answers given, answers that scored, and the quickest scoring answer.
  function teamStats() {
    const stats = {};
    for (const row of rows(`SELECT a.team, COUNT(*) answered, SUM(a.points>0) scored, MIN(CASE WHEN a.points>0 THEN a.submitted-q.opened END) fastest
      FROM answers a JOIN questions q ON q.id=a.question WHERE a.submitted IS NOT NULL GROUP BY a.team`)) stats[row.team] = {answered: row.answered, scored: row.scored, fastest: row.fastest};
    return stats;
  }
  // Automatic TV: join screen before the first question, the question while it runs and after it closes,
  // the leaderboard once a round's last question has been revealed (or closed unrevealed) for a few seconds,
  // and the winner when the quiz is finished. Any other projector view chosen on the desk overrides it.
  const WHEEL_SHOW_MS = 16000;
  // A new id each time the server starts: phones and the TV reload when it changes, so they never keep running the
  // page as it was before an update.
  const build = token().slice(0, 8);
  function tvView() {
    const s = settings();
    // The quizmaster revealing the leaderboard position by position takes the TV until the next question.
    if (boardReveal()) return 'leaderboard';
    if (s.displayMode !== 'auto') return s.displayMode;
    // A spin takes over the TV while the wheel turns and its result shows, then Auto carries on.
    const wheel = getMeta('wheel', null);
    if (wheel && now() - wheel.spun < WHEEL_SHOW_MS) return 'wheel';
    if (s.ended) return 'leaderboard';
    const q = latest();
    if (!q) return s.registrationOpen ? 'join' : 'leaderboard';
    // At the end of a round the TV stays on the question until the quizmaster shows the leaderboard (boardReveal).
    return 'question';
  }
  // The leaderboard revealed position by position from the desk (after a round, and when the quiz finishes): `shown`
  // rows from the bottom; one more than the rows below first place reveals first place, and the whole board.
  function boardReveal() {
    const q = latest(), b = getMeta('board', null);
    if (!b || !q || b.question !== q.id || pending(q)) return null;
    const rest = scores().filter(t => t.rank > 1).length;
    return {question: q.id, shown: b.shown, rest, done: b.shown > rest};
  }
  // What the desk's Next button can do with the board: show it at the end of a round (when there is a board to show
  // and more questions to come; the last round's reveal comes with Finish quiz), then reveal it.
  function boardStep() {
    const q = latest(), reveal = boardReveal(), visible = publicScores().length > 0;
    const played = new Set(rows('SELECT data FROM questions').map(p => dataOf(p).sourceId)), more = library().rounds.some(r => r.questions.some(x => !x.tieBreaker && !played.has(x.id)));
    return {...reveal, active: !!reveal, canShow: !reveal && !!q && !pending(q) && roundOver(q) && more && visible && !settings().ended, roundOver: !!q && !pending(q) && roundOver(q)};
  }
  // A saved question ends its round when every question in that round has been played.
  function roundOver(q) {
    const id = dataOf(q).sourceId, round = id && library().rounds.find(r => r.questions.some(x => x.id === id));
    if (!round) return false;
    const played = new Set(rows('SELECT data FROM questions').map(p => dataOf(p).sourceId));
    return round.questions.every(x => played.has(x.id));
  }
  function exportResults() {return {version: 3, settings: settings(), library: library(), teams: rows('SELECT id,name,enabled FROM teams'), questions: rows('SELECT * FROM questions'), answers: rows('SELECT * FROM answers'), adjustments: rows('SELECT * FROM adjustments'), markingLog: rows('SELECT * FROM marking_log'), buzzes: rows('SELECT * FROM buzzes'), agrees: rows('SELECT * FROM agrees'), bingoCalls: rows('SELECT * FROM bingo_calls'), bingoClaims: rows('SELECT * FROM bingo_claims'), bingoShouts: rows('SELECT * FROM bingo_shouts'), clipPlays: rows('SELECT * FROM clip_plays')};}
  // Results kept on this laptop after each quiz (results.js): worked out from the server's own marking, tie-breakers
  // left out of the counts. They outlive "End quiz & start next".
  function eventResults() {
    const titles = new Map(library().rounds.flatMap(r => r.questions.map(q => [q.id, r.title])));
    const played = rows('SELECT id,opened,data FROM questions WHERE closed=1 OR settled=1').map(q => ({id: q.id, opened: q.opened, data: dataOf(q)})).filter(q => !q.data.tieBreaker);
    return teamResults({teams: scores(), questions: played, answers: rows('SELECT team,question,points,submitted FROM answers WHERE submitted IS NOT NULL OR points<>0'), roundOf: d => titles.get(d.sourceId) || ''});
  }
  // This install's signing key for results (claims.js), made the first time it is needed.
  const venueKey = () => {let k = getMeta('venueKey', null); if (!k) {k = newVenueKey(); setMeta('venueKey', k);} return k;};
  const teamRef = (event, teamId) => hash(`${event}:${teamId}`).slice(0, 24);
  function recordResults() {
    // A rehearsal's results stay on the desk: no results history, returning teams, online sharing or signed results.
    if (!liveNow()) return;
    const event = getMeta('event', ''), results = eventResults();
    if (!results.length) return;
    rememberTeams();
    run('INSERT INTO event_results VALUES(?,?,?,?) ON CONFLICT(event) DO UPDATE SET title=excluded.title,finished=excluded.finished,data=excluded.data', event, settings().title, now(), JSON.stringify(results));
    // Shared online only when the quizmaster has switched it on: team names, positions and points, signed by this laptop.
    if (settings().shareResults) {
      const summary = signClaim({v: 1, kind: 'beermat.event', event, title: settings().title, date: now(), teams: results.map(r => ({ref: teamRef(event, r.team), name: r.name, rank: r.rank, points: r.points}))}, venueKey());
      run('INSERT INTO sync_outbox(id,kind,payload,created) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,sent=NULL,attempts=0', 'event:' + event, 'event', JSON.stringify(summary), now());
      flushOutbox();
    }
  }
  // Returning teams: every team that answered is remembered with a 4-digit PIN. At a later quiz the quizmaster reads
  // a team its PIN, and the phone gets the team back with its name, approved photo and buzzer sound.
  const newPin = () => {let pin; do pin = String(randomInt(1000, 10000)); while (one('SELECT 1 FROM regulars WHERE pin=?', pin) || one('SELECT 1 FROM teams WHERE transfer_code=? AND transfer_expires>?', pin, now())); return pin;};
  function rememberTeams() {
    for (const t of rows('SELECT id,name,sound,photo,photo_status,regular FROM teams WHERE enabled=1 AND waiting=0 AND id IN (SELECT team FROM answers WHERE submitted IS NOT NULL)')) {
      const photo = t.photo_status === 'approved' ? t.photo : null;
      const known = (t.regular && one('SELECT * FROM regulars WHERE id=?', t.regular)) || one('SELECT * FROM regulars WHERE name=?', t.name);
      if (!known) {
        const id = token(); run('INSERT INTO regulars VALUES(?,?,?,?,?,?)', id, t.name, newPin(), t.sound, photo, now());
        run('UPDATE teams SET regular=? WHERE id=?', id, t.id); continue;
      }
      // A rename keeps the PIN, unless another returning team already has that name.
      const name = one('SELECT 1 FROM regulars WHERE name=? AND id<>?', t.name, known.id) ? known.name : t.name;
      if (photo && known.photo && known.photo !== photo && !one('SELECT 1 FROM teams WHERE photo=?', known.photo)) try {unlinkSync(path.join(mediaDir, path.basename(known.photo)));} catch {}
      run('UPDATE regulars SET name=?,sound=?,photo=?,last_played=? WHERE id=?', name, t.sound, photo || known.photo, now(), known.id);
      run('UPDATE teams SET regular=? WHERE id=?', known.id, t.id);
    }
  }
  // A returning team's PIN: back into its team if it is already in this quiz, otherwise it joins as itself.
  function comeBack(regular, req) {
    const here = one('SELECT id,secret FROM teams WHERE regular=?', regular.id);
    if (here) {rememberDevice(req, here.id); return here.secret;}
    requireValue(settings().registrationOpen && !settings().ended, 'Registration is closed. Ask the quizmaster.', 409);
    requireValue(!one('SELECT id FROM teams WHERE name=?', regular.name), 'A team with your name has already joined. Ask the quizmaster.', 409);
    requireValue(one('SELECT COUNT(*) n FROM teams').n < 250, 'Team limit reached. Ask the quizmaster.', 409);
    const {maxTeams} = settings();
    requireValue(!maxTeams || one("SELECT COUNT(*) n FROM teams WHERE enabled=1 AND kind<>'device'").n < maxTeams, 'The quiz is full. Ask the quizmaster.', 409);
    const sound = regular.sound !== null && regular.sound < SOUNDS + soundPack().buzzers.length ? regular.sound : null;
    const photo = regular.photo && existsSync(path.join(mediaDir, path.basename(regular.photo))) ? regular.photo : null;
    // The PIN came from the quizmaster, so a returning team skips the waiting room.
    const id = token(), secret = token();
    run('INSERT INTO teams(id,name,secret,seen,waiting,sound,photo,photo_status,regular,kind) VALUES(?,?,?,?,0,?,?,?,?,?)', id, regular.name, secret, now(), sound, photo, photo && 'approved', regular.id, liveNow() ? 'player' : 'device');
    rememberDevice(req, id); return secret;
  }
  // Sends queued results when the online service can be reached; until then they wait, however long that takes.
  // The service treats a repeat of the same event as the same upload, so a retry never counts twice.
  let flushing = null;
  function flushOutbox() {
    const base = onlineBase();
    if (flushing || !base || !fetchImpl) return flushing;
    flushing = (async () => {
      for (const item of rows('SELECT * FROM sync_outbox WHERE sent IS NULL ORDER BY created')) {
        try {
          const response = await fetchImpl(base.replace(/\/$/, '') + '/v1/venue-results', {method: 'POST', headers: {'Content-Type': 'application/json', 'Idempotency-Key': item.id}, body: item.payload, signal: AbortSignal.timeout(10000)});
          if (response.ok || response.status === 409) run('UPDATE sync_outbox SET sent=?,last_error=NULL WHERE id=?', now(), item.id);
          else run('UPDATE sync_outbox SET attempts=attempts+1,last_error=? WHERE id=?', `The online service said ${response.status}`, item.id);
        } catch (e) {run('UPDATE sync_outbox SET attempts=attempts+1,last_error=? WHERE id=?', 'Not reachable: ' + (e.message || 'offline'), item.id);}
      }
    })().finally(() => {flushing = null;});
    return flushing;
  }
  const syncTimer = setInterval(flushOutbox, 5 * 60 * 1000); syncTimer.unref?.();
  // The plan comes from the licence BeerMat Online signed for this laptop's venue key (free without one, or once it
  // runs out). `plan` fixes it instead, for tests.
  const licence = () => readLicence(getMeta('licence', null), {venueKey: venueKey().publicKey, now: now(), publicKey: licenceKey});
  const plan = () => {
    if (fixedPlan) return {...edition(fixedPlan), venue: '', expires: null, paidUntil: null};
    const l = licence();
    return {...edition(l?.plan), venue: l?.venueName || '', expires: l?.expires || null, paidUntil: l?.paidUntil || null};
  };
  const planOut = () => {const {has, ...out} = plan(); return out;};
  // ---- Live or rehearsal ----
  // A live quiz has real teams playing; it needs BeerMat Pro. A rehearsal runs the same quiz with simulated teams, and
  // real phones can join only to test their connection. Without a choice made, a Pro laptop is live and a Free one
  // rehearses. Once a live quiz has started under Pro it carries on for up to a day if the licence lapses meanwhile,
  // so a quiz in progress is never cut off; new live quizzes need a valid licence.
  const LIVE_GRACE_MS = 24 * 60 * 60 * 1000;
  const sessionMode = () => getMeta('mode', null) ?? (plan().has('live') ? 'live' : 'rehearsal');
  const liveNow = () => sessionMode() === 'live' && (plan().has('live') || (getMeta('liveEvent', null) === getMeta('event', '') && now() - getMeta('liveSince', 0) < LIVE_GRACE_MS));
  const rehearsalOptions = () => liveNow() ? null : getMeta('rehearsal', null);
  // Simulated teams join with a token that only this process hands out, one per join.
  const simTokens = new Set();
  const simToken = () => {const t = token(); simTokens.add(t); return t;};
  let simulator = null, rehearsalLog = [];
  function rehearsalTick() {
    if (closing) return;
    const options = rehearsalOptions();
    if (!options) {if (simulator) {simulator.stop(); simulator = null;} return;}
    if (!simulator && server.listening) {
      simulator = createSimulator({port: server.address().port, joinToken: simToken, options,
        privateQuestion: () => {const q = latest(); return q ? {...dataOf(q), id: q.id, deadline: q.deadline, open: accepting(q)} : null;},
        log: entry => {rehearsalLog = [entry, ...rehearsalLog].slice(0, 200); notify();}});
      simulator.adopt(rows("SELECT name,secret FROM teams WHERE kind='sim'"));
    }
    simulator?.update();
  }
  function rehearsalState() {
    const options = rehearsalOptions(), mode = liveNow() ? 'live' : 'rehearsal';
    const sims = simulator ? new Map(simulator.teams().map(t => [t.name, t])) : new Map();
    return {mode, canGoLive: plan().has('live'), options,
      sims: rows("SELECT name FROM teams WHERE kind='sim' ORDER BY name").map(t => ({name: t.name, connected: !!sims.get(t.name)?.connected, manual: !!sims.get(t.name)?.manual})),
      devices: scoresOfDevices(), log: rehearsalLog.slice(0, 50)};
  }
  const scoresOfDevices = () => {const live = liveTeams(); return rows("SELECT id,name,seen FROM teams WHERE kind='device' ORDER BY seen DESC").map(d => ({name: d.name, connected: live.has(d.id) || now() - d.seen < 15000, seen: d.seen}));};
  // Clears the quiz room for the next quiz: teams, answers and questions go; the quiz's questions stay. A live quiz's
  // results are saved (and downloaded by the desk) first; a rehearsal's are not kept.
  function resetEvent({nextLibrary = null, title} = {}) {
    let saved = null, results = null;
    if (liveNow()) {
      recordResults();
      results = exportResults(); const folder = path.join(path.dirname(path.resolve(database)), 'results');
      const file = `${new Date(now()).toISOString().replace(/[:.]/g, '-').slice(0, 19)}-${settings().title.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'quiz'}.json`;
      mkdirSync(folder, {recursive: true}); writeFileSync(path.join(folder, file), JSON.stringify(results, null, 2), {mode: 0o600});
      saved = path.join('results', file);
    }
    simulator?.stop(); simulator = null; rehearsalLog = [];
    const photos = rows('SELECT photo FROM teams WHERE photo IS NOT NULL AND photo NOT IN (SELECT photo FROM regulars WHERE photo IS NOT NULL)').map(t => t.photo);
    transaction(() => {
      for (const table of ['answers', 'drafts', 'deliveries', 'buzzes', 'agrees', 'go_wide', 'away', 'clip_plays', 'bingo_shouts', 'bingo_claims', 'bingo_calls', 'marking_log', 'adjustments', 'device_ips', 'actions', 'questions', 'teams']) run(`DELETE FROM ${table}`);
      if (nextLibrary) setMeta('library', {...nextLibrary, revision: library().revision + 1});
      setMeta('timer', null); setMeta('wheel', null); setMeta('board', null); setMeta('event', token().slice(0, 12));
      setMeta('settings', {...settings(), title: title || nextLibrary?.title || library().title, ended: false, registrationOpen: true, displayMode: 'auto'});
    });
    for (const photo of photos) try {unlinkSync(path.join(mediaDir, path.basename(photo)));} catch {}
    return {saved, results};
  }
  async function startRehearsalTeams() {
    simulator?.stop(); simulator = null;
    rehearsalTick();
    if (simulator) await simulator.start(rehearsalOptions().teams);
    notify();
  }
  // ---- Preflight: what can be checked before a quiz night, in plain words. Each check passed, warned, failed, or
  // couldn't be checked from here ('unknown'); nothing is reported as passed without being checked. The desk adds the
  // screen and sound checks, which only the desktop app can see.
  async function preflight() {
    const checks = [], add = (id, label, status, text) => checks.push({id, label, status, text});
    add('server', 'Quiz server', 'pass', `Running on port ${server.address()?.port}.`);
    try {
      const ok = one('PRAGMA quick_check')?.quick_check === 'ok';
      add('database', 'Quiz database', ok ? 'pass' : 'fail', ok ? 'Saved and readable.' : 'The database reports damage. Back up the quiz and restart BeerMat; it restores the last good copy.');
    } catch (e) {add('database', 'Quiz database', 'fail', `It can’t be read: ${e.message}`);}
    const quiz = library(), all = quiz.rounds.flatMap(r => r.questions);
    if (!all.length) add('quiz', 'The quiz', 'fail', 'There are no questions yet. Build the quiz under Quizzes, or load a quiz file.');
    else {
      const problems = [];
      for (const r of quiz.rounds) for (const q of r.questions) try {validateQuestion(q, mediaDir);} catch (e) {problems.push(`“${(q.text || '').slice(0, 40)}”: ${e.message}`);}
      const empty = quiz.rounds.filter(r => !r.questions.length).map(r => r.title);
      add('quiz', 'The quiz', problems.length ? 'fail' : empty.length ? 'warn' : 'pass', problems.length ? `${problems.length} question${problems.length === 1 ? ' needs' : 's need'} fixing: ${problems.slice(0, 3).join('; ')}`
        : empty.length ? `${all.length} questions in ${quiz.rounds.length} rounds; ${empty.join(', ')} ha${empty.length === 1 ? 's' : 've'} no questions.` : `${all.length} questions in ${quiz.rounds.length} rounds.`);
    }
    // Every picture and sound the quiz uses, on this laptop.
    const media = new Set(all.flatMap(q => [q.media, ...(q.clips || []).map(c => c.media), ...(q.songs || []).map(c => c.media)]).filter(m => typeof m === 'string' && m.startsWith('/')));
    const missing = [...media].filter(m => /^\/(pack|sounds)\//.test(m) ? !packFile(m) : !existsSync(path.join(mediaDir, path.basename(m))));
    add('media', 'Pictures and sounds', missing.length ? 'fail' : 'pass', missing.length ? `${missing.length} of ${media.size} can’t be found on this laptop. Open those questions under Quizzes and add the files again.` : media.size ? `All ${media.size} are on this laptop.` : 'This quiz uses none.');
    try {
      const fs = statfsSync(path.dirname(path.resolve(database))), free = fs.bavail * fs.bsize, mb = Math.round(free / 1048576);
      add('disk', 'Disk space', mb < 100 ? 'fail' : mb < 500 ? 'warn' : 'pass', mb < 500 ? `Only ${mb} MB free. Free some space so the quiz can keep saving.` : `${(free / 1073741824).toFixed(1)} GB free.`);
    } catch {add('disk', 'Disk space', 'unknown', 'Couldn’t be checked on this system.');}
    try {
      const found = await networkCheck({port: server.address().port, addresses: lanAddresses(interfaces)});
      const warn = found.filter(c => c.status === 'warn');
      add('network', 'Network', warn.length ? 'warn' : 'pass', warn.length ? warn.map(c => c.text).join(' ') : found.filter(c => c.status === 'ok').map(c => c.text).join(' ') || 'Phones can reach this laptop.');
    } catch {add('network', 'Network', 'unknown', 'The network couldn’t be checked.');}
    if (settings().joinMode === 'hotspot') {
      if (!laptop) add('hotspot', 'Quiz Wi-Fi', 'unknown', 'Quiz Wi-Fi is managed outside BeerMat here, so it couldn’t be checked.');
      else try {
        const w = await laptop.wifi();
        add('hotspot', 'Quiz Wi-Fi', w.running ? 'pass' : w.available && w.wifiOn ? 'warn' : 'fail', w.running ? `On, as “${w.running.ssid}”.` : w.available && w.wifiOn ? 'Ready, but not on yet: start it on Tonight before teams arrive.' : w.available ? 'Wi-Fi is switched off on this laptop.' : 'This laptop can’t run a quiz Wi-Fi. Use the venue’s Wi-Fi instead (Settings → Joining).');
        // Windows: the quiz Wi-Fi keeps players off the internet only while BeerMat's filters are on.
        const iso = w.running?.isolation && (await isolationView(w.running, server.address().port)).isolation;
        if (iso) add('isolation', 'Players kept off the internet', !iso.configured || iso.reached ? 'fail' : iso.verified ? 'pass' : 'warn', iso.text);
      } catch {add('hotspot', 'Quiz Wi-Fi', 'unknown', 'The Wi-Fi couldn’t be checked.');}
    }
    return checks;
  }
  // A quiz that has started (questions played or teams in) and would be lost by switching.
  const quizStarted = () => !!one('SELECT 1 FROM questions LIMIT 1') || !!one("SELECT 1 FROM teams WHERE kind='player' LIMIT 1");
  // Asks BeerMat Online for a fresh licence: a request signed with this laptop's venue key, so no sign-in is needed.
  async function refreshLicence() {
    const base = onlineBase();
    requireValue(base && fetchImpl, 'Set the BeerMat Online address first');
    let response;
    try {
      // The desk's BeerMat Online sign-in goes along: an admin account's laptop gets Pro (online/service.js).
      const session = getMeta('onlineSession', null);
      response = await fetchImpl(base.replace(/\/$/, '') + '/v1/licence', {method: 'POST', headers: {'Content-Type': 'application/json', ...(session && {Authorization: 'Bearer ' + session.token})},
        body: JSON.stringify(signClaim({v: 1, kind: 'beermat.licence-request', at: now()}, venueKey())), signal: AbortSignal.timeout(10000)});
    } catch {throw new QuizError('BeerMat Online can’t be reached. Is this laptop on the internet?', 502);}
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new QuizError(data.error || `BeerMat Online said ${response.status}`, response.status >= 500 ? 502 : 400);
    requireValue(readLicence(data.licence, {venueKey: venueKey().publicKey, now: now(), publicKey: licenceKey}), 'BeerMat Online sent a licence this laptop can’t check', 502);
    setMeta('licence', data.licence);
    return planOut();
  }
  // Once a laptop has a licence, it renews it by itself whenever it can reach the service.
  const renew = () => {if (getMeta('licence', null) && !fixedPlan) refreshLicence().catch(() => {});};
  const licenceTimer = setInterval(renew, 6 * 3600 * 1000); licenceTimer.unref?.();
  const firstRenew = setTimeout(renew, 5000); firstRenew.unref?.();
  // The desk's Venue section: this laptop signs in to BeerMat Online for the venue's operator and passes on the few
  // calls that run a venue. The session stays on the laptop; the desk page never talks to the internet itself.
  const onlineCalls = [
    ['GET', /^\/v1\/me\/venues$/], ['GET', /^\/v1\/venues\/[\w-]{1,64}$/], ['PATCH', /^\/v1\/venues\/[\w-]{1,64}$/],
    ['POST', /^\/v1\/venues\/[\w-]{1,64}\/keys$/], ['POST', /^\/v1\/venues\/[\w-]{1,64}\/billing$/], ['POST', /^\/v1\/venues\/[\w-]{1,64}\/events$/], ['PATCH', /^\/v1\/events\/[\w-]{1,64}$/], ['DELETE', /^\/v1\/events\/[\w-]{1,64}$/],
  ];
  async function onlineApi(method, route, body) {
    const base = onlineBase();
    requireValue(base, 'Set the BeerMat Online address first');
    const session = getMeta('onlineSession', null);
    let response;
    try {
      response = await fetchImpl(base.replace(/\/$/, '') + route, {method, headers: {'Content-Type': 'application/json', ...(session ? {Authorization: 'Bearer ' + session.token} : {})},
        ...(body === undefined ? {} : {body: JSON.stringify(body)}), signal: AbortSignal.timeout(10000)});
    } catch {throw new QuizError('BeerMat Online can’t be reached. Is this laptop on the internet?', 502);}
    const data = await response.json().catch(() => ({}));
    if (response.status === 401 && route !== '/v1/sessions') setMeta('onlineSession', null);
    if (!response.ok) throw new QuizError(data.error || `BeerMat Online said ${response.status}`, response.status === 401 ? 401 : response.status >= 500 ? 502 : 400);
    return data;
  }
  // The shared buzzer library on BeerMat Online: anyone can see what's in it; playing, adding, sharing and reporting
  // are BeerMat Pro, asked for with a request signed by this laptop's venue key (like its licence).
  async function libraryApi(route, request, extra = {}, timeout = 15000) {
    const base = onlineBase();
    requireValue(base && fetchImpl, 'Set the BeerMat Online address first');
    let response;
    try {
      response = await fetchImpl(base.replace(/\/$/, '') + route, {method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({request: signClaim({v: 1, at: now(), ...request}, venueKey()), ...extra}), signal: AbortSignal.timeout(timeout)});
    } catch {throw new QuizError('BeerMat Online can’t be reached. Is this laptop on the internet?', 502);}
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new QuizError(data.error || `BeerMat Online said ${response.status}`, response.status >= 500 ? 502 : response.status === 403 ? 403 : 400);
    return data;
  }
  const libraryClip = buzzer => libraryApi(`/v1/buzzers/${encodeURIComponent(buzzer)}/audio`, {kind: 'beermat.buzzer-get', buzzer});
  // Online mode: phones and the TV get the public link as the join address.
  const onlineUrl = () => laptop?.online?.()?.ready ? laptop.online().url : null;
  // A secret round (usually the last): from its first question until the quiz ends, phones and the TV get no marks, no
  // answer reveal and no leaderboard, so the winner is only known when the quizmaster ends the quiz.
  const secretQuestion = q => !!q && dataOf(q).secret === true && !settings().ended;
  const secretRound = () => !settings().ended && rows('SELECT data FROM questions').some(q => dataOf(q).secret === true);
  const shownSettings = () => {
    const url = onlineUrl(), secret = secretRound(), s = {...settings(), ...secret && {leaderboardVisible: false, secretRound: true}};
    return url ? {...s, joinUrl: url, joinPassword: '', online: true} : s;
  };
  function publicState() { return {serverTime: now(), build, rehearsal: !liveNow(), settings: shownSettings(), look: lookFor(latest()), sounds: soundPack(), event: getMeta('event', ''), view: tvView(), question: publicQuestion(latest()), teams: publicScores(), reveal: publicScores().length ? boardReveal() : null, wheel: getMeta('wheel', null), timer: getMeta('timer', null)}; }

  // Final scoring once answers stop: nearest-wins needs every answer before it can rank them.
  function settle(q) {
    if (!q || q.settled || pending(q)) return;
    const data = dataOf(q);
    transaction(() => {
      if (data.type === 'nearest') {
        const ranked = rankNearest(data, rows('SELECT team,value,submitted FROM answers WHERE question=? AND submitted IS NOT NULL', q.id));
        for (const r of ranked) run('UPDATE answers SET points=? WHERE team=? AND question=?', r.points, r.team, q.id);
      }
      // Fixed speed bonus: once answers stop, the quickest fully right answers get it.
      if (data.bonusMode === 'fixed' && speedBonusOf(data)) {
        const right = rows('SELECT team,value,submitted FROM answers WHERE question=? AND submitted IS NOT NULL', q.id)
          .filter(a => basePoints(a.value, data) === data.points && isCorrect(a.value, data))
          .map(a => ({team: a.team, ms: a.submitted - q.opened - lateness(q, a.team), submitted: a.submitted}))
          .sort((a, b) => a.ms - b.ms || a.submitted - b.submitted);
        for (const a of right.slice(0, data.bonusPlaces)) run('UPDATE answers SET points=points+? WHERE team=? AND question=?', speedBonusOf(data), a.team, q.id);
      }
      run('UPDATE questions SET settled=1 WHERE id=?', q.id);
      endAway(q);
    });
  }
  // Time away stops counting when the question ends.
  const endAway = q => run('UPDATE away SET ms=ms+(?-since),since=NULL WHERE question=? AND since IS NOT NULL', now(), q.id);
  function openQuestion(data, sourceId = null) {
    requireValue(!settings().ended, 'Quiz has finished. Resume it first.', 409);
    const current = latest();
    requireValue(!pending(current), 'Close current question first', 409);
    settle(current);
    const q = validateQuestion(data, mediaDir), random = () => randomInt(2 ** 32) / 2 ** 32;
    if (sourceId) q.sourceId = sourceId;
    // A secret round's questions keep their marks and the scores to themselves until the quiz ends.
    if (data.secret === true) q.secret = true;
    // Each play gets a fresh word-snake grid and tile shuffle.
    if (q.type === 'wordsnake') q.snake = snakeGrid(q.answer, random);
    if (q.type === 'tiles') q.pieces = shuffleTiles(q.tiles, random);
    // A rehearsal with fast timers gives each question a third of its time; the server's clock and checks are unchanged.
    if (!liveNow() && rehearsalOptions()?.speed === 'fast' && q.type !== 'buzzer') q.seconds = fastSeconds(q.seconds);
    const result = run('INSERT INTO questions(data,opened,deadline) VALUES(?,?,?)', JSON.stringify(q), now(), now() + q.seconds * 1000);
    return {ok: true, id: Number(result.lastInsertRowid)};
  }
  function closeQuestion(q) {
    if (!q) return;
    run('UPDATE questions SET closed=1,closed_at=COALESCE(closed_at,?),paused_ms=NULL,agree_deadline=NULL WHERE id=?', now(), q.id); endAway(q);
    if (usesSpotify(dataOf(q)) && spotify.connected()) spotify.pause();
    settle(questionById(q.id));
  }
  function autoMark(value, data, q, teamId) {
    if (data.type === 'sheet') {
      const values = JSON.parse(value);
      const marks = data.items.map((_, i) => data.itemAnswers?.[i] ? Number(isCorrect(values[i], {type: 'text', answer: data.itemAnswers[i], aliases: data.itemAliases?.[i] || []})) : null);
      return {points: sheetPoints(marks, data), marks};
    }
    const base = basePoints(value, data);
    // Evil Mode: an answer that scores nothing loses the question's points.
    if (data.evil && base === 0 && autoMarked(data)) return {points: -data.points, marks: null};
    // Only a fully right answer earns the speed bonus (every right tick for multi-tap, the first tap for pinpoint).
    // A fixed bonus is handed out when the question settles.
    if (base !== data.points || !isCorrect(value, data) || data.bonusMode === 'fixed') return {points: base, marks: null};
    // The bonus decays over the accepted time (a pause extends the deadline).
    const fraction = Math.min(1, Math.max(0, q.deadline - now() + lateness(q, teamId)) / (data.seconds * 1000));
    return {points: data.points + Math.floor(speedBonusOf(data) * fraction), marks: null};
  }
  // Each team's clock starts when its phone received the question, but never more than a short grace period after opening.
  function lateness(q, teamId) {
    const delivered = one('SELECT at FROM deliveries WHERE team=? AND question=?', teamId, q.id)?.at ?? q.opened;
    return Math.min(DELIVERY_GRACE_MS, Math.max(0, delivered - q.opened));
  }
  function award(teamId, q, value, points) {
    run(`INSERT INTO answers(team,question,value,points,submitted) VALUES(?,?,?,?,?)
      ON CONFLICT(team,question) DO UPDATE SET value=excluded.value,points=excluded.points`, teamId, q.id, value, points, now());
  }
  function nextBuzzer(q) {
    const next = one(`SELECT team FROM buzzes WHERE question=? AND status='queued' ORDER BY at,rowid LIMIT 1`, q.id);
    if (next) run(`UPDATE buzzes SET status='active' WHERE team=? AND question=?`, next.team, q.id);
    run('UPDATE questions SET agree_deadline=NULL,announced=NULL WHERE id=?', q.id);
  }
  function hostBuzz(body) {
    const q = questionById(body.question);
    requireValue(q && pending(q) && dataOf(q).type === 'buzzer', 'No live buzzer question', 409);
    const data = dataOf(q), active = one(`SELECT team FROM buzzes WHERE question=? AND status='active'`, q.id);
    requireValue(['agree', 'correct', 'wrong', 'pass'].includes(body.action), 'Unknown buzzer action');
    requireValue(active, 'Nobody has buzzed yet', 409);
    transaction(() => {
      if (body.action === 'agree') {
        requireValue(data.variation === 'advanced', 'Agree voting is only for advanced buzzer questions', 409);
        requireValue(typeof body.announced === 'string' && body.announced.length <= 300, 'Answer text must be up to 300 characters');
        run('DELETE FROM agrees WHERE question=?', q.id);
        run('UPDATE questions SET agree_deadline=?,announced=? WHERE id=?', now() + data.agreeSeconds * 1000, body.announced.trim(), q.id);
        return;
      }
      if (body.action === 'pass') {
        run(`UPDATE buzzes SET status='passed' WHERE team=? AND question=?`, active.team, q.id);
        award(active.team, q, '(passed)', -data.passPenalty);
        return nextBuzzer(q);
      }
      const correct = body.action === 'correct';
      run(`UPDATE buzzes SET status=? WHERE team=? AND question=?`, correct ? 'correct' : 'wrong', active.team, q.id);
      if (data.variation === 'classic') {
        award(active.team, q, correct ? '(buzzed: correct)' : '(buzzed: wrong)', correct ? data.points : -data.penalty);
        if (!correct) return nextBuzzer(q);
      } else {
        award(active.team, q, `${q.announced || '(spoken answer)'} — ${correct ? 'correct' : 'wrong'}`, correct ? data.points : -data.penalty);
        // Everyone else scores for agreeing with a right answer or not agreeing with a wrong one.
        const agreed = new Set(rows('SELECT team FROM agrees WHERE question=?', q.id).map(a => a.team));
        for (const t of rows('SELECT id FROM teams WHERE enabled=1 AND waiting=0 AND id<>?', active.team)) {
          if (one(`SELECT 1 FROM buzzes WHERE question=? AND team=? AND status IN ('passed','wrong','correct')`, q.id, t.id)) continue;
          award(t.id, q, agreed.has(t.id) ? 'agreed' : 'did not agree', agreed.has(t.id) === correct ? data.agreePoints : 0);
        }
      }
      closeQuestion(q);
    });
  }
  async function readBody(req, limit) {
    const chunks = []; let length = 0;
    for await (const chunk of req) {
      length += chunk.length;
      requireValue(length <= limit, 'Request too large', 413);
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
  function sendFile(req, res, location, policy = security) {
    const size = statSync(location).size;
    const headers = {...policy, 'Content-Type': types[path.extname(location).toLowerCase()], 'Accept-Ranges': 'bytes'};
    if (req.headers.range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      if (!match || (!match[1] && !match[2])) {res.writeHead(416, {...headers, 'Content-Range': `bytes */${size}`}); return res.end();}
      const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
      const end = match[1] ? (match[2] ? Math.min(size - 1, Number(match[2])) : size - 1) : size - 1;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) {res.writeHead(416, {...headers, 'Content-Range': `bytes */${size}`}); return res.end();}
      res.writeHead(206, {...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1});
      if (req.method === 'HEAD') return res.end();
      const stream = createReadStream(location, {start, end}); stream.on('error', () => res.destroy()); res.on('close', () => stream.destroy()); return stream.pipe(res);
    }
    res.writeHead(200, {...headers, 'Content-Length': size});
    if (req.method === 'HEAD') return res.end();
    const stream = createReadStream(location); stream.on('error', () => res.destroy()); res.on('close', () => stream.destroy()); stream.pipe(res);
  }
  const streamTeam = url => {
    const auth = url.searchParams.get('key') || '';
    const team = auth ? one('SELECT id,enabled FROM teams WHERE secret=?', auth) : null;
    requireValue(!auth || team || isHost(auth), 'Invalid key', 401);
    return team;
  };
  function addStream(stream, closed) {
    streams.add(stream); if (stream.team) notify();
    closed(() => {if (streams.delete(stream) && stream.team) notify();});
  }
  function openStream(req, res, url) {
    const team = streamTeam(url);
    res.writeHead(200, {...security, 'Content-Type': 'text/event-stream', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no'});
    res.write(`retry: 1000\ndata: ${version}\n\n`);
    addStream({team: team?.id || null, send: v => res.write(`data: ${v}\n\n`), ping: () => res.write(': keep-alive\n\n'), end: () => res.end()}, done => req.on('close', done));
  }
  // The same nudges over a WebSocket, for online play: Cloudflare's quick tunnels hold server-sent events back.
  // Only the server talks; from the browser it needs nothing but close and pong frames.
  function openSocket(req, socket) {
    socket.on('error', () => socket.destroy());
    const refuse = () => socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    let team;
    try {
      const url = new URL(req.url, 'http://quiz.local'), key = req.headers['sec-websocket-key'];
      if (url.pathname !== '/api/events' || !localAllowed(req) || !/^[A-Za-z0-9+/]{22}==$/.test(key || '') || !originOk(req)) return refuse();
      team = streamTeam(url);
      socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '
        + createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64') + '\r\n\r\n');
    } catch {return refuse();}
    const frame = (opcode, text = '') => {const body = Buffer.from(String(text)); if (!socket.destroyed) socket.write(Buffer.concat([Buffer.from([0x80 | opcode, body.length]), body]));};
    // A close frame from the browser (opcode 8) ends it; anything else it sends is ignored.
    socket.on('data', data => {if ((data[0] & 0x0f) === 8) socket.end();});
    socket.setTimeout(0); socket.setNoDelay(true);
    frame(1, version);
    addStream({team: team?.id || null, send: v => frame(1, v), ping: () => frame(9), end: () => {frame(8); socket.end();}}, done => socket.on('close', done));
  }
  // Same-site requests only; online the page is on https (Cloudflare's end of the tunnel).
  const originOk = req => !req.headers.origin || req.headers.origin === `http://${req.headers.host}` || (req.viaTunnel && req.headers.origin === `https://${req.headers.host}`);
  // Phones are recognised by their address on the quiz Wi-Fi. The laptop itself (loopback) is never a team device.
  // Online players all arrive through the tunnel from this laptop, so they have no address of their own here.
  const clientIp = req => req.viaTunnel ? '' : clientAddress ? clientAddress(req) : (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  const loopback = ip => ip.startsWith('127.') || ip === '::1';
  const DEVICE_MS = 12 * 60 * 60 * 1000;
  function rememberDevice(req, teamId) {
    const ip = clientIp(req); if (!ip || loopback(ip)) return;
    run('INSERT INTO device_ips VALUES(?,?,?) ON CONFLICT(ip) DO UPDATE SET team=excluded.team,seen=excluded.seen', ip, teamId, now());
  }
  const deviceTeam = req => {
    const ip = clientIp(req);
    return loopback(ip) ? null : one('SELECT t.id,t.name,t.secret FROM device_ips d JOIN teams t ON t.id=d.team WHERE d.ip=? AND d.seen>? AND t.enabled=1', ip, now() - DEVICE_MS);
  };
  // Once a phone has joined, answer its operating system's "is there internet?" check with the expected reply,
  // so the phone keeps the quiz Wi-Fi as its main connection instead of falling back to mobile data.
  const probes = {'/generate_204': 'android', '/gen_204': 'android', '/hotspot-detect.html': 'apple', '/library/test/success.html': 'apple',
    '/connecttest.txt': 'Microsoft Connect Test', '/ncsi.txt': 'Microsoft NCSI', '/success.txt': 'success\n'};
  function answerProbe(req, res, p) {
    if (!probes[p] || !settings().onlineAfterJoin || !deviceTeam(req)) return false;
    if (probes[p] === 'android') {res.writeHead(204, {'Cache-Control': 'no-store'}); res.end(); return true;}
    const apple = probes[p] === 'apple';
    res.writeHead(200, {'Content-Type': apple ? 'text/html' : 'text/plain', 'Cache-Control': 'no-store'});
    res.end(apple ? '<HTML><HEAD><TITLE>Success</TITLE></HEAD><BODY>Success</BODY></HTML>' : probes[p]); return true;
  }
  function awayList(q) {
    if (!q) return [];
    return rows('SELECT a.ms,a.count,a.since,t.name FROM away a JOIN teams t ON t.id=a.team WHERE a.question=? ORDER BY t.name', q.id)
      .map(a => ({name: a.name, count: a.count, ms: a.ms + (a.since ? now() - a.since : 0), awayNow: a.since !== null}));
  }
  // While the desk's quiz Wi-Fi is up, BeerMat answers only on it and on this laptop, like start.sh --hotspot.
  // (Windows' Mobile Hotspot reports its adapter's address, normally 192.168.137.1.)
  let hotspotOnly = null, hotspotNow = null;
  const onlyOn = running => running ? ['127.0.0.1', '::1', running.address || '10.42.0.1'] : null;
  const track = running => {hotspotOnly = onlyOn(running); hotspotNow = running || null;};
  const localAddress = req => (req.socket.localAddress || '').replace(/^::ffff:/, '');
  const localAllowed = req => {const only = allowedAddresses || hotspotOnly; return !only || only.includes(localAddress(req));};
  // Windows: whether players are kept off the internet. The script says whether its filters are on ("configured");
  // "verified" needs phones on the quiz Wi-Fi to have tried the internet and failed. Players' browsers try once each
  // (web/client.js, isolationCheck); their answers are kept until the quiz Wi-Fi is started again.
  const isolationReports = new Map();
  const wantsIsolationCheck = req => !!hotspotNow?.isolation && localAddress(req) === hotspotNow.address && !isolationReports.has(clientIp(req));
  async function isolationView(running, port) {
    if (!running?.isolation) return running;
    const reports = [...isolationReports.values()], reached = reports.filter(r => r.ipv4 || r.ipv6 || r.dns);
    const reachable = running.address ? await reachProbe(joinUrlFor(running.address, port)) : false;
    const view = {...running.isolation, phones: reports.length, reached: reached.length, reachedBy: reached.map(r => r.team).slice(0, 5),
      verified: !!running.isolation.configured && reports.length > 0 && !reached.length};
    return {...running, reachable, isolation: {...view, text: isolationText(view)}};
  }
  const isolationText = iso => !iso.configured ? 'Not guaranteed: ' + (iso.reason || 'BeerMat’s filters are not on.') + ' Phones on the quiz Wi-Fi may be able to use the internet.'
    : iso.reached ? `${iso.reached} ${iso.reached === 1 ? 'phone' : 'phones'} on the quiz Wi-Fi reached the internet (${iso.reachedBy.join(', ')}). A phone with mobile data on may have used that instead; if not, stop the quiz Wi-Fi: players are not kept off the internet.`
    : iso.verified ? `Checked: ${iso.phones} ${iso.phones === 1 ? 'phone' : 'phones'} on the quiz Wi-Fi tried the internet and could not reach it.`
    : 'BeerMat’s filters are on. Not checked yet: the first phone to join tries the internet and reports back.';
  const laptopStatus = async () => {
    const status = await laptop.status(); track(status.wifi.running);
    return {...status, wifi: {...status.wifi, running: await isolationView(status.wifi.running, server.address().port)}, canQuit: !!onQuit};
  };
  if (laptop) laptop.wifi().then(w => track(w.running));
  // The app launcher (scripts/beermat-app.sh) opens the desk with a one-time ticket instead of asking for the key twice;
  // the desktop app asks for a new one (newDeskTicket) each time it opens the desk.
  let deskLink = deskTicket;
  const handle = async (req, res) => {
    const send = (status, data) => {res.writeHead(status, {...security, 'Content-Type': 'application/json'}); res.end(JSON.stringify(data));};
    try {
      if (!localAllowed(req)) return send(403, {error: 'Not available on this network'});
      const url = new URL(req.url, 'http://quiz.local'); const p = url.pathname;
      // The online link reaches the players' and TV pages; the desk only while the quizmaster allows it (Desk on the
      // online link), and Spotify sign-in never.
      if (req.viaTunnel && (p === '/spotify/callback' || (!settings().deskOnline && (['/host', '/host.js', '/api/login'].includes(p) || p.startsWith('/api/host/'))))) return send(404, {error: 'Not found'});
      const auth = req.headers.authorization?.replace(/^Bearer /, '');
      settle(latest());
      if (req.method === 'GET' && p === '/api/events') return openStream(req, res, url);
      if ((req.method === 'GET' || req.method === 'HEAD') && !p.startsWith('/api/')) {
        const routes = {'/host': 'host.html', '/display': 'display.html', '/app.js': 'app.js', '/host.js': 'host.js', '/client.js': 'client.js', '/qr.js': 'qr.js', '/soundnames.js': 'soundnames.js', '/i18n.js': 'i18n.js', '/style.css': 'style.css'};
        if (p.startsWith('/media/')) {
          requireValue(mediaPattern.test(p), 'Media not found', 404);
          const file = path.join(mediaDir, path.basename(p));
          requireValue(existsSync(file) && statSync(file).isFile(), 'Media not found', 404);
          return sendFile(req, res, file);
        }
        if (p === '/health') return send(200, {ok: true});
        if (p === '/themes.css') {res.writeHead(200, {...security, 'Content-Type': 'text/css; charset=utf-8'}); return res.end(folders.css);}
        if (p.startsWith('/themes/')) {
          const [, id, ...rest] = p.slice(1).split('/'), file = folders.file(id, rest.join('/'));
          requireValue(file && existsSync(file) && statSync(file).isFile(), 'Not found', 404); return sendFile(req, res, file);
        }
        // BeerMat's logos and font (brand/), for every page.
        if (p.startsWith('/brand/')) {requireValue(brandFiles.has(p.slice(7)), 'Not found', 404); return sendFile(req, res, path.join(root, 'brand', p.slice(7)));}
        if (p.startsWith('/pack/') || p.startsWith('/sounds/')) {const file = packFile(p); requireValue(file, 'Sound not found', 404); return sendFile(req, res, file);}
        if (p === '/spotify/callback') {
          // Sign-in only ever finishes in a browser on the laptop itself.
          const page = (title, text) => {res.writeHead(200, {...security, 'Content-Type': 'text/html; charset=utf-8'}); res.end(`<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font:18px system-ui;background:#0c1220;color:#f3f4f6;padding:40px"><h1>${title}</h1><p>${text}</p>`);};
          if (!loopback(clientIp(req))) return page('Not here', 'Connect Spotify from the quiz laptop.');
          if (url.searchParams.get('error')) return page('Spotify not connected', 'Spotify sign-in was cancelled. Close this tab and try again from the quiz desk.');
          try {await spotify.callback(url.searchParams.get('code'), url.searchParams.get('state'));}
          catch (e) {return page('Spotify not connected', (e instanceof QuizError ? e.message : 'Something went wrong.').replace(/[<>&]/g, ''));}
          return page('Spotify connected', 'Close this tab and go back to the quiz desk.');
        }
        if (answerProbe(req, res, p)) return;
        // OS HTTP probes and arbitrary HTTP landing URLs get registration.
        return sendFile(req, res, path.join(web, routes[p] || 'player.html'), p === '/host' ? deskSecurity : security);
      }
      if (req.method === 'GET' && p === '/api/leaderboard') return send(200, publicState());
      requireValue(req.method === 'POST', 'POST required', 405);
      requireValue(originOk(req), 'Origin rejected', 403);
      if (!readOnly.has(p)) res.on('finish', () => {if (res.statusCode < 400) notify();});
      if (p === '/api/host/media') {
        requireValue(isHost(auth), 'Host login required', 403);
        const ext = path.extname(url.searchParams.get('name') || '').toLowerCase();
        requireValue(['.png', '.jpg', '.jpeg', '.webp', '.mp3', '.ogg', '.wav'].includes(ext), 'Use PNG, JPEG, WebP, MP3, Ogg or WAV');
        const data = await readBody(req, 20 * 1024 * 1024);
        const signature = ext === '.png' ? data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
          : ['.jpg', '.jpeg'].includes(ext) ? data[0] === 255 && data[1] === 216
          : ext === '.webp' ? data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP'
          : ext === '.wav' ? data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WAVE'
          : ext === '.ogg' ? data.toString('ascii', 0, 4) === 'OggS'
          : data.toString('ascii', 0, 3) === 'ID3' || (data[0] === 255 && (data[1] & 224) === 224);
        requireValue(data.length > 0 && signature, 'File content does not match its extension');
        mkdirSync(mediaDir, {recursive: true});
        const name = `${token()}${ext}`; writeFileSync(path.join(mediaDir, name), data, {flag: 'wx', mode: 0o600});
        return send(200, {media: '/media/' + name});
      }
      if (p === '/api/team/photo') {
        const team = one('SELECT * FROM teams WHERE secret=?', auth || ''); requireValue(team, 'Team recovery code required', 401);
        requireValue(team.enabled && settings().teamPhotos, 'Team photos are switched off', 403);
        const data = await readBody(req, 512 * 1024);
        requireValue(data.length > 3 && data[0] === 255 && data[1] === 216 && data[2] === 255, 'Photo must be a JPEG');
        mkdirSync(mediaDir, {recursive: true});
        const name = `team-${token()}.jpg`; writeFileSync(path.join(mediaDir, name), data, {flag: 'wx', mode: 0o600});
        removePhoto(team); run(`UPDATE teams SET photo=?,photo_status='pending' WHERE id=?`, '/media/' + name, team.id);
        return send(200, {photo: '/media/' + name, status: 'pending'});
      }
      let body;
      try {body = JSON.parse((await readBody(req, 4 * 1024 * 1024)).toString() || '{}');} catch (e) {if (e instanceof QuizError) throw e; throw new QuizError('Invalid JSON');}
      requireValue(body && typeof body === 'object' && !Array.isArray(body), 'Invalid request');
      if (p === '/api/login') {
        // Ten tries a minute per address. Online everyone arrives from this laptop, so count by the visitor's own
        // address (from Cloudflare), plus at most 30 a minute through the link altogether.
        const count = ip => {const a = attempts.get(ip) || {n: 0, time: now()}; if (now() - a.time >= 60000) {a.n = 0; a.time = now();} attempts.set(ip, a); return ++a.n;};
        requireValue(count(req.viaTunnel ? 'online:' + (req.headers['cf-connecting-ip'] || '') : req.socket.remoteAddress) <= 10 && (!req.viaTunnel || count('online') <= 30), 'Wait one minute before trying again', 429);
        if (typeof body.ticket === 'string') {
          requireValue(deskLink && loopback(clientIp(req)) && equal(body.ticket, deskLink), 'This link has been used. Unlock with the key.', 403); deskLink = null;
        } else requireValue(equal(body.key, hostKey), 'Incorrect key', 403);
        const key = token(); run('INSERT INTO host_sessions VALUES(?,?)', hash(key), now() + SESSION_MS); return send(200, {key});
      }
      if (p.startsWith('/api/host/')) {
        requireValue(isHost(auth), 'Host login required', 403);
        if (p === '/api/host/logout') {run('DELETE FROM host_sessions WHERE hash=?', hash(auth)); return send(200, {ok: true});}
        if (p === '/api/host/plan') return send(200, planOut());
        if (p === '/api/host/plan/refresh') return send(200, await refreshLicence());
        if (p === '/api/host/state') {
          const q = latest(), stats = teamStats();
          return send(200, {serverTime: now(), plan: planOut(), rehearsal: rehearsalState(), settings: settings(), sounds: soundPack(), look: lookFor(latest()), looks, tie: tieForFirst(), looksByType: looksByType(), soundThemes: Object.keys(themes).sort(), soundThemesByType: themesByType(), soundThemeNow: themeFor(latest()), bingoCalls: bingoCalls(), view: tvView(), board: boardStep(), timer: getMeta('timer', null), blockedWords: getMeta('blockedWords', []), libraryRevision: library().revision,
            teams: scores(true).map(t => ({...t, stats: stats[t.id] || {answered: 0, scored: 0, fastest: null}})), question: publicQuestion(q, true), away: awayList(q), answers: rows('SELECT * FROM answers WHERE question=?', q?.id || 0),
            history: rows('SELECT * FROM questions ORDER BY id DESC LIMIT 300').map(h => publicQuestion(h, true))});
        }
        if (p === '/api/host/library') return send(200, library());
        if (p.startsWith('/api/host/laptop')) {
          requireValue(laptop, 'Laptop controls are not available here', 404);
          if (p === '/api/host/laptop') return send(200, {...await laptopStatus(), local: loopback(clientIp(req))});
          if (p === '/api/host/laptop/wifi') {
            // Its password prompt opens on the laptop's own screen.
            requireValue(loopback(clientIp(req)), 'The quiz Wi-Fi can only be changed at the laptop', 403);
            if (body.action === 'on') {await laptop.wifiOn(); return send(200, {ok: true});}
            requireValue(['start', 'stop'].includes(body.action), 'Unknown Wi-Fi action');
            if (body.action === 'stop') laptop.stopWifi(r => {if (r.ok) track(null); notify();});
            else {
              const port = server.address().port;
              isolationReports.clear();
              laptop.startWifi({card: body.card, ssid: body.ssid, ...(body.password !== undefined ? {password: body.password} : {})}, r => {
                if (!r.ok) return notify();
                laptop.wifi().then(w => {
                  track(w.running);
                  // Windows: the join address is the one the hotspot's adapter really got.
                  if (w.platform === 'windows' && w.running?.address && settings().joinMode === 'hotspot') setMeta('settings', {...settings(), joinUrl: joinUrlFor(w.running.address, port)});
                  notify();
                });
              }, port);
              // The TV's join screen names the same network (and, on Windows, its password and the quiz's port).
              const windows = (await laptop.wifi()).platform === 'windows';
              const w = windows && await laptop.wifi();
              setMeta('settings', {...settings(), joinMode: 'hotspot', joinSsid: body.ssid.trim(), joinPassword: windows ? body.password : '',
                joinUrl: windows ? joinUrlFor(w.address || hotspotAddresses[1], port) : 'http://' + hotspotAddresses[0]});
            }
            return send(200, {ok: true});
          }
          if (p === '/api/host/laptop/online') {
            requireValue(['start', 'stop'].includes(body.action), 'Unknown online action');
            if (body.action === 'start') laptop.goOnline(publicServer.address()?.port || publicPort, notify); else laptop.goOffline();
            return send(200, {ok: true});
          }
          if (p === '/api/host/laptop/setup') {
            requireValue(body.job === 'bingoVoice', 'Unknown setup step');
            laptop[body.job](r => {if (r.ok) reloadPack(); notify();});
            return send(200, {ok: true});
          }
          if (p === '/api/host/laptop/quit') {
            requireValue(onQuit, 'BeerMat was not started from the app icon; stop it in its terminal', 400);
            send(200, {ok: true});
            // The quiz Wi-Fi comes down first (one more password prompt), then BeerMat stops.
            const status = await laptop.wifi();
            if (status.running) await new Promise(resolve => {try {laptop.stopWifi(resolve);} catch {resolve();}});
            return onQuit();
          }
        }
        // Past quizzes kept on this laptop, and results waiting to go to the online service.
        if (p === '/api/host/results') {
          const outbox = one('SELECT COUNT(*) n, MAX(last_error) error FROM sync_outbox WHERE sent IS NULL');
          return send(200, {events: rows('SELECT event,title,finished,data FROM event_results ORDER BY finished DESC').map(e => {const r = JSON.parse(e.data); return {event: e.event, title: e.title, finished: e.finished, teams: r.length, winner: r.find(t => t.rank === 1)?.name || ''};}),
            venueKey: venueKey().publicKey, venueKeyId: keyId(venueKey().publicKey), pending: outbox.n, lastError: outbox.error,
            regulars: rows('SELECT id,name,pin,photo,last_played lastPlayed FROM regulars ORDER BY name COLLATE NOCASE')});
        }
        if (p === '/api/host/results/delete') {
          requireValue(body.all === true || typeof body.event === 'string', 'Choose a quiz to delete');
          if (body.all === true) run('DELETE FROM event_results'); else run('DELETE FROM event_results WHERE event=?', body.event);
          return send(200, {ok: true});
        }
        if (p === '/api/host/regulars/forget') {
          const regular = one('SELECT * FROM regulars WHERE id=?', body.id); requireValue(regular, 'Unknown returning team', 404);
          transaction(() => {run('DELETE FROM regulars WHERE id=?', regular.id); run('UPDATE teams SET regular=NULL WHERE regular=?', regular.id);});
          if (regular.photo && !one('SELECT 1 FROM teams WHERE photo=?', regular.photo)) try {unlinkSync(path.join(mediaDir, path.basename(regular.photo)));} catch {}
          return send(200, {ok: true});
        }
        if (p === '/api/host/online/account') {const session = getMeta('onlineSession', null); return send(200, {service: onlineBase(), signedIn: !!session, email: session?.email || '', name: session?.name || ''});}
        if (p === '/api/host/online/signin' || p === '/api/host/online/signup') {
          requireValue(typeof body.email === 'string' && typeof body.password === 'string', 'Enter your email and password');
          const data = p.endsWith('signin') ? await onlineApi('POST', '/v1/sessions', {email: body.email, password: body.password})
            : await onlineApi('POST', '/v1/accounts', {email: body.email, password: body.password, displayName: body.displayName});
          setMeta('onlineSession', {token: data.token, email: data.account.email, name: data.account.displayName});
          return send(200, {signedIn: true, email: data.account.email, name: data.account.displayName});
        }
        if (p === '/api/host/online/signout') {
          if (getMeta('onlineSession', null)) await onlineApi('DELETE', '/v1/sessions').catch(() => {});
          setMeta('onlineSession', null); return send(200, {signedIn: false});
        }
        if (p === '/api/host/online/call') {
          requireValue(typeof body.method === 'string' && typeof body.path === 'string' && onlineCalls.some(([m, re]) => m === body.method && re.test(body.path)), 'Not a venue call');
          requireValue(getMeta('onlineSession', null), 'Sign in to BeerMat Online first', 401);
          // Registering this laptop always sends this laptop's own key.
          const sent = body.path.endsWith('/keys') ? {publicKey: venueKey().publicKey} : body.body;
          return send(200, await onlineApi(body.method, body.path, sent));
        }
        if (p === '/api/host/buzzer-library') {
          const q = typeof body.q === 'string' ? body.q.trim().slice(0, 60) : '';
          const {buzzers} = await onlineApi('GET', '/v1/buzzers' + (q ? '?q=' + encodeURIComponent(q) : ''));
          return send(200, {buzzers, pro: plan().has('buzzerLibrary'), shared: getMeta('sharedBuzzers', [])});
        }
        if (p.startsWith('/api/host/buzzer-library/')) {
          const buzzer = typeof body.id === 'string' && /^[\w-]{1,40}$/.test(body.id) ? body.id : null, what = p.slice('/api/host/buzzer-library/'.length);
          // A clip this laptop shared can always be taken back out, whatever its plan now.
          if (what === 'remove') {
            const shared = getMeta('sharedBuzzers', []);
            requireValue(buzzer && shared.includes(buzzer), 'Only buzzers this laptop shared can be taken out');
            await libraryApi(`/v1/buzzers/${buzzer}/remove`, {kind: 'beermat.buzzer-remove', buzzer}).catch(e => {if (e.status !== 400 || !/any more/.test(e.message)) throw e;});
            setMeta('sharedBuzzers', shared.filter(x => x !== buzzer)); return send(200, {removed: true});
          }
          requireValue(plan().has('buzzerLibrary'), 'Playing, adding and sharing buzzers is part of BeerMat Pro', 403);
          if (what === 'play') {requireValue(buzzer, 'Choose a buzzer'); const clip = await libraryClip(buzzer); return send(200, {name: clip.name, audio: clip.audio});}
          if (what === 'add') {
            requireValue(buzzer, 'Choose a buzzer');
            const clip = await libraryClip(buzzer), current = soundPack().buzzers;
            requireValue(current.length < 200, 'That’s 200 buzzer sounds already: remove some first');
            const taken = new Set(current.map(b => b.name.toLowerCase()));
            let name = clip.name.slice(0, 60);
            for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${clip.name.slice(0, 55)} (${i})`;
            mkdirSync(mediaDir, {recursive: true});
            const file = `${token()}.mp3`; writeFileSync(path.join(mediaDir, file), Buffer.from(clip.audio, 'base64'), {flag: 'wx', mode: 0o600});
            const saved = getMeta('soundPack', {});
            setMeta('soundPack', {...saved, buzzers: [...current, {name, media: '/media/' + file}]});
            return send(200, {name, sounds: soundPack()});
          }
          if (what === 'share') {
            requireValue(body.rights === true, 'Tick the box to confirm you have the right to share this clip');
            requireValue(typeof body.name === 'string' && body.name.trim() && body.name.trim().length <= 60, 'Give the buzzer a name (up to 60 characters)');
            const file = typeof body.media === 'string' && audioPath(body.media) ? path.join(mediaDir, path.basename(body.media)) : null;
            requireValue(file && existsSync(file), 'Choose a sound file to share');
            const audio = readFileSync(file);
            requireValue(audio.length <= 2 * 1024 * 1024, 'Clips up to 2 MB can be shared: use a shorter one (10 seconds at most is kept)');
            const added = await libraryApi('/v1/buzzers', {kind: 'beermat.buzzer-upload', name: body.name.trim(), sha256: createHash('sha256').update(audio).digest('hex'), rights: true},
              {audio: audio.toString('base64')}, 60000);
            setMeta('sharedBuzzers', [...getMeta('sharedBuzzers', []), added.id]);
            return send(200, added);
          }
          if (what === 'report') {
            requireValue(buzzer, 'Choose a buzzer');
            requireValue(typeof body.reason === 'string' && body.reason.trim() && body.reason.length <= 500, 'Say what’s wrong with it (up to 500 characters)');
            return send(200, await libraryApi(`/v1/buzzers/${buzzer}/report`, {kind: 'beermat.buzzer-report', buzzer, reason: body.reason.trim()}));
          }
          throw new QuizError('Not found', 404);
        }
        // Where a UK postcode is, for the venue's map pin (postcodes.io, free and keyless; only when asked).
        if (p === '/api/host/online/locate') {
          requireValue(typeof body.postcode === 'string' && /^[A-Za-z0-9 ]{2,10}$/.test(body.postcode.trim()), 'Enter a postcode');
          let found;
          try {found = await (await fetchImpl('https://api.postcodes.io/postcodes/' + encodeURIComponent(body.postcode.trim()), {signal: AbortSignal.timeout(10000)})).json();}
          catch {throw new QuizError('The postcode lookup can’t be reached. Is this laptop on the internet?', 502);}
          requireValue(found?.status === 200 && found.result, 'Postcode not found', 404);
          return send(200, {lat: Math.round(found.result.latitude * 1e5) / 1e5, lon: Math.round(found.result.longitude * 1e5) / 1e5, town: found.result.admin_district || ''});
        }
        if (p === '/api/host/results/sync') {await flushOutbox(); return send(200, {pending: one('SELECT COUNT(*) n FROM sync_outbox WHERE sent IS NULL').n});}
        // Playing on the venue's own network: this laptop's addresses, and checks for what stops phones reaching it.
        if (p === '/api/host/network') return send(200, {port: server.address().port, addresses: lanAddresses(interfaces), local: loopback(clientIp(req))});
        if (p === '/api/host/network/check') return send(200, {checks: await networkCheck({port: server.address().port, addresses: lanAddresses(interfaces)})});
        if (p === '/api/host/library/save') {
          const old = library(); requireValue(body.revision === old.revision, 'Quiz changed in another window. Reload before saving.', 409);
          const next = {...validateLibrary(body.quiz, mediaDir), revision: old.revision + 1};
          setMeta('library', next); return send(200, next);
        }
        if (p === '/api/host/settings') {
          const next = {...settings()};
          for (const k of ['registrationOpen', 'leaderboardVisible', 'ended', 'scrambleKeypads', 'bingoPhrases', 'bingoVoice', 'bingoBoard', 'teamPhotos', 'onlineAfterJoin', 'deskOnline', 'waitingRoom', 'showScores']) if (Object.hasOwn(body, k)) {requireValue(typeof body[k] === 'boolean', 'Invalid setting'); next[k] = body[k];}
          if (Object.hasOwn(body, 'title')) {requireValue(typeof body.title === 'string' && body.title.trim() && body.title.length <= 100, 'Title must contain 1–100 characters'); next.title = body.title.trim();}
          // Shown on the projector's join screen; the Wi-Fi name should match the hotspot's --ssid.
          if (Object.hasOwn(body, 'joinSsid')) {requireValue(typeof body.joinSsid === 'string' && body.joinSsid.trim() && Buffer.byteLength(body.joinSsid.trim()) <= 32, 'Wi-Fi name must be 1–32 bytes'); next.joinSsid = body.joinSsid.trim();}
          // hotspot: the TV's code joins the quiz Wi-Fi; lan: phones are already on the venue's network, so it opens the quiz.
          if (Object.hasOwn(body, 'joinMode')) {requireValue(['hotspot', 'lan'].includes(body.joinMode), 'Unknown way to join'); next.joinMode = body.joinMode;}
          if (Object.hasOwn(body, 'joinPassword')) {requireValue(typeof body.joinPassword === 'string' && (body.joinPassword === '' || /^[\x20-\x7e]{8,63}$/.test(body.joinPassword)), 'Wi-Fi password must be empty or 8–63 characters'); next.joinPassword = body.joinPassword;}
          if (Object.hasOwn(body, 'joinUrl')) {requireValue(typeof body.joinUrl === 'string' && /^https?:\/\/[^\s]{1,150}$/.test(body.joinUrl.trim()), 'Join address must start with http:// and have no spaces'); next.joinUrl = body.joinUrl.trim();}
          // Picking a theme puts every moment back to that theme's sounds; added buzzer sounds stay.
          if (Object.hasOwn(body, 'soundTheme')) {
            requireValue(['', '@random', '@type'].includes(body.soundTheme) || Object.hasOwn(themes, body.soundTheme), 'Unknown sound theme');
            next.soundTheme = body.soundTheme; const saved = getMeta('soundPack', {}); delete saved.slots; setMeta('soundPack', saved);
          }
          if (Object.hasOwn(body, 'look')) {requireValue(['@random', '@type', ...lookIds].includes(body.look), 'Unknown look'); next.look = body.look;}
          if (Object.hasOwn(body, 'lookByType')) {
            const map = body.lookByType;
            requireValue(map && typeof map === 'object' && Object.entries(map).every(([type, look]) => questionTypes.includes(type) && lookIds.includes(look)), 'Unknown question type or look');
            next.lookByType = {...settings().lookByType, ...map};
          }
          if (Object.hasOwn(body, 'soundThemeByType')) {
            const map = body.soundThemeByType;
            requireValue(map && typeof map === 'object' && Object.entries(map).every(([type, theme]) => questionTypes.includes(type) && (theme === '' || Object.hasOwn(themes, theme))), 'Unknown question type or sound theme');
            next.soundThemeByType = {...settings().soundThemeByType, ...map};
          }
          if (Object.hasOwn(body, 'maxTeams')) {requireValue(Number.isInteger(body.maxTeams) && body.maxTeams >= 0 && body.maxTeams <= 250, 'Maximum teams must be 0 (no limit) to 250'); next.maxTeams = body.maxTeams;}
          if (Object.hasOwn(body, 'language')) {requireValue(['en', 'fr', 'es'].includes(body.language), 'Unknown language'); next.language = body.language;}
          // Choosing a projector view ends a leaderboard reveal, which otherwise holds the TV until the next question.
          if (Object.hasOwn(body, 'displayMode')) {requireValue(['auto', 'join', 'leaderboard', 'question', 'wheel', 'winner', 'blank'].includes(body.displayMode), 'Invalid projector view'); next.displayMode = body.displayMode; setMeta('board', null);}
          // Extra blocked team-name words stay private to the desk.
          if (Object.hasOwn(body, 'blockedWords')) {
            requireValue(typeof body.blockedWords === 'string' && body.blockedWords.length <= 2000, 'Blocked words must be up to 2,000 characters');
            setMeta('blockedWords', body.blockedWords.split(/[\n,]/).map(w => w.trim().toLowerCase()).filter(Boolean));
          }
          if (Object.hasOwn(body, 'onlineService')) {requireValue(typeof body.onlineService === 'string' && (body.onlineService === '' || /^https:\/\/[^\s/]{1,100}(\/[^\s]{0,100})?$|^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/[^\s]*)?$/.test(body.onlineService)), 'Online service address must start with https://'); next.onlineService = body.onlineService.trim();}
          if (Object.hasOwn(body, 'shareResults')) {requireValue(typeof body.shareResults === 'boolean', 'Invalid setting'); next.shareResults = body.shareResults;}
          if (next.ended) {closeQuestion(latest()); next.registrationOpen = false;}
          setMeta('settings', next);
          if (next.ended) recordResults();
          return send(200, next);
        }
        if (p === '/api/host/open') return send(200, openQuestion(body));
        if (p === '/api/host/board') {
          requireValue(['show', 'next'].includes(body.action), 'Unknown board action');
          const q = latest(), reveal = boardReveal();
          if (body.action === 'show') {requireValue(q && !pending(q), 'Close the question before showing the leaderboard', 409); setMeta('board', {question: q.id, shown: 0});}
          else {requireValue(reveal && !reveal.done, 'No leaderboard being revealed', 409); setMeta('board', {question: q.id, shown: reveal.shown + 1});}
          return send(200, boardStep());
        }
        if (p === '/api/host/start' || p === '/api/host/next') {
          requireValue(body.expectedQuestion === (latest()?.id || null), 'Current question changed; refresh before opening another', 409);
          const all = library().rounds.flatMap(r => r.questions.map(q => ({...q, round: r.title, ...r.secret && {secret: true}})));
          const played = new Set(rows('SELECT data FROM questions').map(q => dataOf(q).sourceId).filter(Boolean));
          // Next never opens a tie-breaker: the desk offers one when teams are level for first place (tieForFirst).
          const chosen = p === '/api/host/start' ? all.find(q => q.id === body.id) : all.find(q => !played.has(q.id) && !q.tieBreaker);
          requireValue(chosen, 'No unplayed questions. Add questions or choose a saved question.', 409);
          requireValue(!played.has(chosen.id) || body.repeat === true, 'Question already played. Confirm repeat explicitly.', 409);
          return send(200, openQuestion(chosen, chosen.id));
        }
        if (['/api/host/close', '/api/host/pause', '/api/host/resume'].includes(p) && Object.hasOwn(body, 'expectedQuestion')) {
          requireValue(body.expectedQuestion === (latest()?.id || null), 'Current question changed; refresh before controlling it', 409);
        }
        if (p === '/api/host/close') {closeQuestion(latest()); return send(200, {ok: true});}
        if (p === '/api/host/pause') {
          const q = latest(); requireValue(accepting(q), 'No running question to pause', 409);
          run('UPDATE questions SET paused_ms=? WHERE id=?', q.deadline - now(), q.id); return send(200, {ok: true});
        }
        if (p === '/api/host/resume') {
          const q = latest(); requireValue(q && pending(q) && q.paused_ms !== null, 'No paused question to resume', 409);
          run('UPDATE questions SET deadline=?,paused_ms=NULL WHERE id=?', now() + q.paused_ms, q.id); return send(200, {ok: true});
        }
        if (p === '/api/host/buzz') {hostBuzz(body); return send(200, {ok: true});}
        // The quizmaster's verdict on a shout of "bingo!". Correct wins the prize being played for, as at the moment of the call.
        if (p === '/api/host/bingo-verdict') {
          const shout = one('SELECT * FROM bingo_shouts WHERE id=?', body.shout), q = shout && questionById(shout.question);
          requireValue(q && shout.status === 'pending' && typeof body.correct === 'boolean', 'That bingo call has already been dealt with', 409);
          const data = dataOf(q), {stages, claims, current} = bingoProgress(q, data);
          if (!body.correct || current === null || claims.some(c => c.team === shout.team && c.stage === current)) {
            run(`UPDATE bingo_shouts SET status='wrong' WHERE id=?`, shout.id); return send(200, {ok: true, correct: false});
          }
          // Each stage pays its own points; the first claim of a stage also takes the bonus (with fastest fingers first).
          const first = !claims.some(c => c.stage === current), points = stagePoints(data)[current] + (first ? speedBonusOf(data) : 0);
          const label = {line: 'Line', twoLines: 'Two lines', fullHouse: 'Full house'}[stages[current]];
          transaction(() => {
            run(`UPDATE bingo_shouts SET status='correct' WHERE id=?`, shout.id);
            run('INSERT INTO bingo_claims VALUES(?,?,?,?,?)', q.id, shout.team, current, shout.seq, now());
            const previous = one('SELECT value,points FROM answers WHERE team=? AND question=?', shout.team, q.id);
            award(shout.team, q, `${previous ? previous.value + '; ' : ''}${label} on call ${shout.seq}`, (previous?.points || 0) + points);
          });
          return send(200, {ok: true, correct: true, first, stage: stages[current]});
        }
        if (p === '/api/host/bingo') {
          const q = questionById(body.question); requireValue(q && pending(q) && isBingo(dataOf(q).type), 'No live bingo game', 409);
          requireValue(q.paused_ms === null, 'Resume the game first', 409);
          requireValue(!bingoProgress(q, dataOf(q)).over, 'The game has been won — end it when ready', 409);
          requireValue(!one(`SELECT 1 FROM bingo_shouts WHERE question=? AND status='pending'`, q.id), 'Someone has called bingo — say whether it is correct first', 409);
          const data = dataOf(q), called = new Set(calledNumbers(q));
          const remaining = Array.from({length: data.type === 'musicbingo' ? data.songs.length : 90}, (_, i) => i + 1).filter(n => !called.has(n));
          requireValue(remaining.length, data.type === 'musicbingo' ? 'Every song has been played' : 'Every number has been called', 409);
          const number = remaining[randomInt(remaining.length)];
          run('INSERT INTO bingo_calls VALUES(?,?,?,?)', q.id, called.size + 1, number, now());
          // A Spotify song starts on the laptop's Spotify app; if that fails the call still stands and the desk is told why.
          const song = data.type === 'musicbingo' && data.songs[number - 1];
          if (song?.spotify) try {await spotify.play(song.spotify, song.start ?? data.startAt);} catch (e) {if (!(e instanceof QuizError)) throw e; return send(200, {number, warning: e.message});}
          return send(200, {number});
        }
        if (p === '/api/host/clip') {
          const q = questionById(body.question); requireValue(q && pending(q) && dataOf(q).type === 'clips', 'No live sound clips game', 409);
          requireValue(Number.isInteger(body.clip) && body.clip >= -1 && body.clip < dataOf(q).clips.length, 'Unknown clip');
          run('INSERT INTO clip_plays VALUES(?,?,?,?)', q.id, (nowPlaying(q)?.seq || 0) + 1, body.clip, now()); return send(200, {ok: true});
        }
        if (p === '/api/host/wheel') {
          const items = body.items ?? scores().map(t => t.name);
          requireValue(Array.isArray(items) && items.length >= 2 && items.length <= 60 && items.every(i => typeof i === 'string' && i.trim() && i.length <= 60), 'The wheel needs 2–60 entries of up to 60 characters');
          const wheel = {id: (getMeta('wheel', null)?.id || 0) + 1, items: items.map(i => i.trim()), result: randomInt(items.length), spun: now()};
          setMeta('wheel', wheel); return send(200, wheel);
        }
        if (p === '/api/host/spotify/status') return send(200, {...await spotify.status(), redirectUri: spotifyRedirect(), locked: !plan().has('spotify')});
        if (p.startsWith('/api/host/spotify/')) requireValue(plan().has('spotify'), 'Spotify music rounds are part of BeerMat Pro: see Settings → Plan.', 403);
        if (p === '/api/host/spotify/connect') return send(200, {url: spotify.authorizeUrl(body.clientId, spotifyRedirect())});
        // The desk's Spotify player needs a current access token; the long-lived sign-in token never leaves the server.
        if (p === '/api/host/spotify/token') return send(200, await spotify.accessToken());
        if (p === '/api/host/spotify/disconnect') {spotify.disconnect(); return send(200, {ok: true});}
        if (p === '/api/host/spotify/device') {spotify.device(body.id); return send(200, {ok: true});}
        if (p === '/api/host/drive') return send(200, {quiz: await fetchDriveQuiz(body.url, fetchImpl)});
        if (p === '/api/host/spotify/import') return send(200, {songs: await spotify.tracks(body.links)});
        if (p === '/api/host/spotify/pause') {await spotify.pause(); return send(200, {ok: true});}
        // Quizzes: hear a track from its start point on the chosen Spotify player; nothing is logged or shown to teams.
        if (p === '/api/host/spotify/preview') {
          const uri = spotifyTrack(body.link), start = body.start ?? 0;
          requireValue(uri, 'Not a Spotify song link'); requireValue(Number.isInteger(start) && start >= 0 && start <= 3600, 'Start must be 0–3,600 seconds');
          await spotify.play(uri, start); return send(200, {ok: true});
        }
        // A Spotify sound clip: start it, then log it as playing so taps count against it.
        if (p === '/api/host/spotify/play') {
          const q = questionById(body.question), data = q && dataOf(q);
          // An audio question's Spotify clip, played when it opens (and again on request).
          if (data?.clip) {requireValue(pending(q), 'No live Spotify audio question', 409); await spotify.play(data.clip.spotify, data.clip.start); return send(200, {ok: true, seconds: data.clip.seconds});}
          requireValue(q && pending(q) && data.type === 'clips', 'No live sound clips game', 409);
          const clip = dataOf(q).clips[body.clip]; requireValue(Number.isInteger(body.clip) && clip?.spotify, 'Not a Spotify clip');
          await spotify.play(clip.spotify, clip.start);
          run('INSERT INTO clip_plays VALUES(?,?,?,?)', q.id, (nowPlaying(q)?.seq || 0) + 1, body.clip, now()); return send(200, {ok: true});
        }
        if (p === '/api/host/sounds') {
          const pack = structuredClone(soundPack()), exists = media => typeof media === 'string' && (/^\/(pack|sounds)\//.test(media) ? !!packFile(media) : audioPath(media) && existsSync(path.join(mediaDir, path.basename(media))));
          if (Object.hasOwn(body, 'slots')) {
            requireValue(body.slots && typeof body.slots === 'object' && Object.entries(body.slots).every(([slot, media]) => soundSlots.includes(slot) && (media === null || exists(media))), 'Each sound needs an uploaded MP3, Ogg or WAV');
          }
          if (Object.hasOwn(body, 'buzzers')) {
            requireValue(Array.isArray(body.buzzers) && body.buzzers.length <= 200 && body.buzzers.every(b => b && typeof b.name === 'string' && b.name.trim() && b.name.length <= 60 && exists(b.media)), 'Buzzer sounds need a name (up to 60 characters) and an uploaded audio file; 200 at most');
            pack.buzzers = body.buzzers.map(b => ({name: b.name.trim(), media: b.media}));
            // Teams whose custom sound no longer exists go back to the default.
            run('UPDATE teams SET sound=NULL WHERE sound>=?', SOUNDS + pack.buzzers.length); run('UPDATE regulars SET sound=NULL WHERE sound>=?', SOUNDS + pack.buzzers.length);
          }
          const saved = getMeta('soundPack', {});
          setMeta('soundPack', {...saved, ...(Object.hasOwn(body, 'slots') ? {slots: {...saved.slots, ...body.slots}} : {}), ...(Object.hasOwn(body, 'buzzers') ? {buzzers: pack.buzzers} : {})});
          return send(200, soundPack());
        }
        if (p === '/api/host/bingo-calls') {
          requireValue(body.calls === null || (Array.isArray(body.calls) && body.calls.length === 90 && body.calls.every(c => typeof c === 'string' && c.length <= 150)), 'Bingo calls need 90 entries of up to 150 characters');
          setMeta('bingoCalls', body.calls && body.calls.map(c => c.trim())); return send(200, {ok: true});
        }
        if (p === '/api/host/admit') {run('UPDATE teams SET waiting=0 WHERE waiting=1 AND enabled=1'); return send(200, {ok: true});}
        // A countdown on the TV, separate from question timers (e.g. "5 minutes to hand in sheets").
        if (p === '/api/host/timer') {
          const timer = getMeta('timer', null);
          requireValue(['start', 'pause', 'resume', 'stop'].includes(body.action), 'Unknown timer action');
          if (body.action === 'start') {
            requireValue(Number.isInteger(body.seconds) && body.seconds >= 1 && body.seconds <= 7200, 'Timer must be 1 second to 2 hours');
            requireValue(body.label === undefined || (typeof body.label === 'string' && body.label.length <= 100), 'Timer label must be up to 100 characters');
            const next = {id: (timer?.id || 0) + 1, seconds: body.seconds, label: body.label?.trim() || '', endsAt: now() + body.seconds * 1000, remaining: null};
            setMeta('timer', next); return send(200, next);
          }
          if (body.action === 'stop') {setMeta('timer', null); return send(200, {ok: true});}
          requireValue(timer, 'No timer running', 409);
          if (body.action === 'pause') {requireValue(timer.endsAt !== null && timer.endsAt > now(), 'Timer is not running', 409); setMeta('timer', {...timer, endsAt: null, remaining: timer.endsAt - now()});}
          else {requireValue(timer.endsAt === null, 'Timer is not paused', 409); setMeta('timer', {...timer, endsAt: now() + timer.remaining, remaining: null});}
          return send(200, getMeta('timer', null));
        }
        if (p === '/api/host/reveal') {
          const q = questionById(body.question); requireValue(q && !pending(q), 'Close question before revealing', 409);
          // `delay` (up to 10 s) holds the answer back while the TV plays the reveal sound.
          const delay = body.delay ?? 0; requireValue(Number.isInteger(delay) && delay >= 0 && delay <= 10000, 'Reveal delay must be 0–10 seconds');
          run('UPDATE questions SET revealed=?,revealed_at=? WHERE id=?', body.revealed === false ? 0 : 1, body.revealed === false ? null : now() + delay, q.id); return send(200, {ok: true});
        }
        if (p === '/api/host/review') {
          const q = questionById(body.question); requireValue(q, 'Question not found', 404);
          return send(200, {question: publicQuestion(q, true), answers: rows('SELECT * FROM answers WHERE question=?', q.id), away: awayList(q)});
        }
        if (p === '/api/host/mark') {
          const q = questionById(body.question); requireValue(q && !pending(q), 'Close question before marking', 409);
          const data = dataOf(q); let points = body.points; let marks = null;
          if (Object.hasOwn(body, 'marks')) {
            requireValue(data.type === 'sheet' && Array.isArray(body.marks) && body.marks.length === data.items.length && body.marks.every(m => m === 0 || m === 1), 'Each sheet item needs a zero or one mark');
            marks = body.marks; points = sheetPoints(marks, data);
          }
          requireValue(Number.isInteger(points) && Math.abs(points) <= 200, 'Points must be a whole number between −200 and 200');
          requireValue(typeof body.team === 'string' && one('SELECT id FROM teams WHERE id=?', body.team), 'Team not found', 404);
          // Also mark absent/delivered-on-paper answers, preserving an audit row.
          transaction(() => {
            const previous = one('SELECT points FROM answers WHERE team=? AND question=?', body.team, q.id);
            run(`INSERT INTO answers(team,question,value,points,submitted,marks) VALUES(?,?,?,?,NULL,?)
              ON CONFLICT(team,question) DO UPDATE SET points=excluded.points,marks=excluded.marks`, body.team, q.id, data.type === 'sheet' ? JSON.stringify(data.items.map(() => '')) : '(host marked)', points, marks ? JSON.stringify(marks) : null);
            run('INSERT INTO marking_log(team,question,previous_points,new_points,marks,changed) VALUES(?,?,?,?,?,?)', body.team, q.id, previous?.points ?? null, points, marks ? JSON.stringify(marks) : null, now());
          });
          return send(200, {ok: true});
        }
        if (p === '/api/host/adjust') {
          requireValue(Number.isInteger(body.points) && Math.abs(body.points) <= 100 && typeof body.reason === 'string' && body.reason.trim() && body.reason.length <= 200 && typeof body.team === 'string' && one('SELECT id FROM teams WHERE id=?', body.team), 'Valid team, points and reason required');
          if (body.requestId) {
            requireValue(typeof body.requestId === 'string' && /^[a-zA-Z0-9_-]{8,100}$/.test(body.requestId), 'Invalid request ID');
            const result = one('SELECT result FROM actions WHERE key=?', body.requestId);
            if (result) return send(200, JSON.parse(result.result));
          }
          return send(200, transaction(() => {
            const result = run('INSERT INTO adjustments(team,points,reason) VALUES(?,?,?)', body.team, body.points, body.reason.trim());
            const response = {ok: true, id: Number(result.lastInsertRowid)};
            if (body.requestId) run('INSERT INTO actions VALUES(?,?)', body.requestId, JSON.stringify(response));
            return response;
          }));
        }
        if (p === '/api/host/team') {
          requireValue(typeof body.id === 'string', 'Team ID required');
          const team = one('SELECT * FROM teams WHERE id=?', body.id); requireValue(team, 'Team not found', 404);
          if (body.action === 'approvePhoto') {requireValue(team.photo, 'No photo to approve', 409); run(`UPDATE teams SET photo_status='approved' WHERE id=?`, team.id); return send(200, {ok: true});}
          if (body.action === 'rejectPhoto') {removePhoto(team); return send(200, {ok: true});}
          if (body.action === 'admit') {run('UPDATE teams SET waiting=0 WHERE id=?', team.id); return send(200, {ok: true});}
          if (body.action === 'note') {
            requireValue(typeof body.note === 'string' && body.note.length <= 500, 'Notes must be up to 500 characters');
            run('UPDATE teams SET note=? WHERE id=?', body.note.trim() || null, team.id); return send(200, {ok: true});
          }
          if (body.action === 'transfer') {
            // A short code to move a team to another phone; valid for five minutes, used once.
            let code; do code = String(randomInt(1000, 10000)); while (one('SELECT 1 FROM teams WHERE transfer_code=? AND transfer_expires>?', code, now()) || one('SELECT 1 FROM regulars WHERE pin=?', code));
            run('UPDATE teams SET transfer_code=?,transfer_expires=? WHERE id=?', code, now() + 5 * 60 * 1000, team.id); return send(200, {code});
          }
          if (body.action === 'recover') {const secret = token(); run('UPDATE teams SET secret=?,seen=0 WHERE id=?', secret, team.id); return send(200, {secret});}
          if (body.action === 'rename') {
            requireValue(typeof body.name === 'string' && body.name.trim().length >= 2 && body.name.trim().length <= 40, 'Team name must be 2–40 characters');
            requireValue(!one('SELECT id FROM teams WHERE name=? COLLATE NOCASE AND id<>?', body.name.trim(), team.id), 'Team name already taken', 409);
            run('UPDATE teams SET name=? WHERE id=?', body.name.trim(), team.id);
          } else {
            requireValue(['disable', 'restore'].includes(body.action), 'Unknown team action');
            run('UPDATE teams SET enabled=? WHERE id=?', Number(body.action === 'restore'), team.id);
          }
          return send(200, {ok: true});
        }
        if (p === '/api/host/export') return send(200, exportResults());
        // End this quiz and start the next: the results are kept on the laptop (and returned for download),
        // then teams, answers and scores are cleared. Settings, join details and question media stay.
        if (p === '/api/host/new-event') {
          requireValue(['keep', 'empty', 'load'].includes(body.questions), 'Choose which questions the next quiz uses');
          const nextLibrary = body.questions === 'load' ? validateLibrary(body.quiz, mediaDir) : body.questions === 'empty' ? {title: 'My quiz', rounds: []} : null;
          requireValue(body.title === undefined || (typeof body.title === 'string' && body.title.trim() && body.title.length <= 100), 'Event name must be 1–100 characters');
          const reset = resetEvent({nextLibrary, title: body.title?.trim()});
          // A rehearsal starts again with its simulated teams.
          if (!liveNow() && rehearsalOptions()) await startRehearsalTeams();
          return send(200, reset);
        }
        // ---- Rehearsal and live (see sessionMode) ----
        if (p === '/api/host/rehearsal/start') {
          const options = cleanOptions(body.options);
          // Rehearsing replaces a live quiz in progress only when the quizmaster says so (its results are saved first).
          requireValue(!liveNow() || !quizStarted() || body.endLive === true, 'A live quiz is in progress. End it first, or confirm to save its results and rehearse.', 409);
          const reset = resetEvent({});
          setMeta('mode', 'rehearsal'); setMeta('rehearsal', options);
          await startRehearsalTeams();
          return send(200, {...reset, rehearsal: rehearsalState()});
        }
        if (p === '/api/host/rehearsal/stop') {
          requireValue(!liveNow(), 'This is a live quiz, not a rehearsal', 409);
          resetEvent({}); setMeta('rehearsal', null);
          return send(200, {rehearsal: rehearsalState()});
        }
        if (p === '/api/host/rehearsal/team') {
          requireValue(!liveNow() && simulator, 'Simulated teams only take part in a rehearsal', 409);
          requireValue(typeof body.name === 'string', 'Choose a rehearsal team');
          if (typeof body.manual === 'boolean') {simulator.setManual(body.name, body.manual); return send(200, {rehearsal: rehearsalState()});}
          requireValue(['right', 'wrong', 'duplicate', 'invalid', 'stale', 'buzz', 'agree', 'disconnect', 'reconnect'].includes(body.action), 'Unknown rehearsal action');
          const result = await simulator.act(body.name, body.action);
          return send(200, {result: {ok: result.status >= 200 && result.status < 300, detail: result.error || ''}, rehearsal: rehearsalState()});
        }
        if (p === '/api/host/live') {
          requireValue(plan().has('live'), 'Hosting a live quiz with real teams is part of BeerMat Pro: see Settings → Plan.', 403);
          // Going live clears a rehearsal (nothing from it is kept).
          if (!liveNow()) resetEvent({});
          transaction(() => {setMeta('mode', 'live'); setMeta('rehearsal', null); setMeta('liveEvent', getMeta('event', '')); setMeta('liveSince', now());});
          return send(200, {rehearsal: rehearsalState()});
        }
        if (p === '/api/host/preflight') return send(200, {checks: await preflight()});
        throw new QuizError('Unknown host action', 404);
      }
      if (p === '/api/transfer') {
        const ip = req.socket.remoteAddress, a = attempts.get('transfer:' + ip) || {n: 0, time: now()};
        if (now() - a.time >= 60000) {a.n = 0; a.time = now();} attempts.set('transfer:' + ip, a);
        requireValue(++a.n <= 10, 'Wait one minute before trying again', 429);
        const team = typeof body.code === 'string' && /^\d{4}$/.test(body.code) && one('SELECT id,secret FROM teams WHERE transfer_code=? AND transfer_expires>?', body.code, now());
        const regular = !team && typeof body.code === 'string' && /^\d{4}$/.test(body.code) && one('SELECT * FROM regulars WHERE pin=?', body.code);
        if (regular) return send(200, {secret: comeBack(regular, req)});
        requireValue(team, 'That code is wrong or has expired. Ask the quizmaster for a new one.', 403);
        run('UPDATE teams SET transfer_code=NULL,transfer_expires=NULL WHERE id=?', team.id);
        return send(200, {secret: team.secret});
      }
      if (p === '/api/join') {
        requireValue(settings().registrationOpen && !settings().ended, 'Registration is closed. Ask the quizmaster.', 409);
        requireValue(typeof body.name === 'string' && body.name.trim().length >= 2 && body.name.trim().length <= 40, 'Team name must be 2–40 characters');
        requireValue(!offensive(body.name, getMeta('blockedWords', [])), 'Please choose a different team name', 400);
        requireValue(!one('SELECT id FROM teams WHERE name=? COLLATE NOCASE', body.name.trim()), 'Name taken. Use your recovery code to reconnect.', 409);
        // 250 teams is the technical ceiling for one laptop, whatever the plan.
        requireValue(one('SELECT COUNT(*) n FROM teams').n < 250, 'Team limit reached. Ask the quizmaster.', 409);
        // Who is joining: in a live quiz, a team; in a rehearsal, a simulated team (it carries a token only this server
        // hands out) or else a real phone testing its connection, which can never play.
        const sim = typeof body.simToken === 'string' && simTokens.delete(body.simToken);
        requireValue(!sim || !liveNow(), 'Simulated teams only take part in a rehearsal', 403);
        const kind = sim ? 'sim' : liveNow() ? 'player' : 'device';
        const {maxTeams} = settings(), waitingRoom = kind === 'player' && settings().waitingRoom;
        requireValue(kind === 'device' || !maxTeams || one("SELECT COUNT(*) n FROM teams WHERE enabled=1 AND kind<>'device'").n < maxTeams, 'The quiz is full. Ask the quizmaster.', 409);
        // With the waiting room on, a new team waits until the quizmaster lets it in.
        const id = token(), secret = token(); run('INSERT INTO teams(id,name,secret,seen,waiting,kind) VALUES(?,?,?,?,?,?)', id, body.name.trim(), secret, now(), Number(waitingRoom), kind);
        if (!sim) rememberDevice(req, id);
        return send(200, {id, secret, waiting: waitingRoom, ...(kind === 'device' && {rehearsal: true})});
      }
      // A phone that already played (e.g. in the Wi-Fi sign-in window) can carry on in its normal browser.
      if (p === '/api/device') {const team = deviceTeam(req); return send(200, {team: team ? {name: team.name} : null});}
      if (p === '/api/device/continue') {
        const team = deviceTeam(req); requireValue(team, 'This phone has not joined a team yet', 404);
        rememberDevice(req, team.id); return send(200, {secret: team.secret});
      }
      const team = one('SELECT * FROM teams WHERE secret=?', auth || ''); requireValue(team, 'Team recovery code required', 401);
      requireValue(team.enabled, 'This team is disabled. Ask the quizmaster.', 403);
      run('UPDATE teams SET seen=? WHERE id=?', now(), team.id); if (team.kind !== 'sim') rememberDevice(req, team.id);
      // A phone on the Windows quiz Wi-Fi says whether it could reach the internet (see isolationView).
      if (p === '/api/team/isolation') {
        requireValue(wantsIsolationCheck(req), 'Not needed', 409);
        isolationReports.set(clientIp(req), {team: team.name, ipv4: body.ipv4 === true, ipv6: body.ipv6 === true, dns: body.dns === true, at: now()});
        return send(200, {ok: true});
      }
      const check = wantsIsolationCheck(req) ? {isolationCheck: true} : {};
      // Who may play is decided here, for every player route: real teams only in a live quiz, simulated ones only in a
      // rehearsal, and a phone that joined a rehearsal never. Such a phone sees a connection screen and nothing else.
      if (team.kind === 'device') {
        requireValue(p === '/api/state', 'This is a rehearsal: your phone is connected, but playing is switched off.', 403);
        return send(200, {serverTime: now(), build, settings: shownSettings(), look: lookFor(null), event: getMeta('event', ''), question: null, teams: [],
          team: {id: team.id, name: team.name, waiting: false}, answer: null, draft: null, rehearsal: {device: true, connected: true, title: settings().title}, ...check});
      }
      requireValue(team.kind === 'sim' ? !liveNow() : liveNow(), team.kind === 'sim' ? 'Simulated teams only take part in a rehearsal' : 'This quiz isn’t live yet. Ask the quizmaster.', 403);
      const teamInfo = {id: team.id, name: team.name, sound: team.sound, photo: team.photo, photoStatus: team.photo_status, waiting: !!team.waiting};
      if (team.waiting) {
        requireValue(p === '/api/state' || p === '/api/team/sound', 'Waiting for the quizmaster to let you in', 403);
        if (p === '/api/state') return send(200, {...publicState(), question: null, team: teamInfo, answer: null, draft: null, ...check});
      }
      if (p === '/api/state') {
        const q = latest();
        if (q && pending(q)) run('INSERT OR IGNORE INTO deliveries VALUES(?,?,?)', team.id, q.id, now());
        const a = q && one('SELECT value,points,marks,submitted FROM answers WHERE team=? AND question=?', team.id, q.id);
        // Points stay hidden until scoring is final.
        const answer = !a || a.submitted === null && !q.settled && !q.closed ? null : pending(q) || secretQuestion(q) ? {value: a.value} : {value: a.value, points: a.points, marks: a.marks};
        return send(200, {...publicState(), question: publicQuestion(q, false, team.id), team: teamInfo, answer,
          draft: one('SELECT value FROM drafts WHERE team=? AND question=?', team.id, q?.id || 0) || null, ...check});
      }
      // A team's signed result once the quiz is finished, for players who choose to keep it in an online profile.
      if (p === '/api/team/result') {
        requireValue(liveNow() && team.kind === 'player', 'A rehearsal has no results to keep', 409);
        requireValue(settings().ended, 'Results are ready once the quizmaster finishes the quiz', 409);
        const event = getMeta('event', ''), saved = one('SELECT finished,data FROM event_results WHERE event=?', event);
        const mine = saved && JSON.parse(saved.data).find(r => r.team === team.id); requireValue(mine, 'No result for this team', 404);
        const {team: _id, ...result} = mine;
        return send(200, {claim: signClaim({v: 1, kind: 'beermat.result', event, title: settings().title, date: saved.finished, team: teamRef(event, team.id), result}, venueKey())});
      }
      if (p === '/api/team/sound') {
        requireValue(Number.isInteger(body.sound) && body.sound >= 0 && body.sound < SOUNDS + soundPack().buzzers.length, 'Unknown buzzer sound');
        run('UPDATE teams SET sound=? WHERE id=?', body.sound, team.id); return send(200, {ok: true});
      }
      if (p === '/api/bingo') {
        const q = latest(); requireValue(q && body.question === q.id && pending(q) && q.paused_ms === null && isBingo(dataOf(q).type) && !settings().ended, 'No live bingo game', 409);
        const data = dataOf(q), called = new Set(calledNumbers(q)), {stages, claims, current} = bingoProgress(q, data);
        requireValue(current !== null, 'The game is over', 409);
        requireValue(!claims.some(c => c.team === team.id && c.stage === current), 'Already claimed', 409);
        // A team can shout whenever it likes; the quizmaster checks the ticket and says whether it's a bingo.
        const last = one('SELECT status,seq FROM bingo_shouts WHERE question=? AND team=? ORDER BY id DESC LIMIT 1', q.id, team.id);
        requireValue(last?.status !== 'pending', 'The quizmaster is checking your call', 409);
        requireValue(!(last?.status === 'wrong' && last.seq === called.size), 'Wait for the next number before calling again', 409);
        run('INSERT INTO bingo_shouts(question,team,stage,seq,at) VALUES(?,?,?,?,?)', q.id, team.id, current, called.size, now());
        return send(200, {ok: true, pending: true});
      }
      // Phones report leaving the quiz page (switching app, locking) while a question is open.
      if (p === '/api/away') {
        const q = latest(); requireValue(q && body.question === q.id && pending(q) && ['left', 'back'].includes(body.state), 'Not during a live question', 409);
        run('INSERT OR IGNORE INTO away(team,question) VALUES(?,?)', team.id, q.id);
        if (body.state === 'left') run('UPDATE away SET since=COALESCE(since,?),count=count+(since IS NULL) WHERE team=? AND question=?', now(), team.id, q.id);
        else run('UPDATE away SET ms=ms+CASE WHEN since IS NULL THEN 0 ELSE ?-since END,since=NULL WHERE team=? AND question=?', now(), team.id, q.id);
        return send(200, {ok: true});
      }
      if (p === '/api/gowide') {
        const q = latest(); requireValue(q && body.question === q.id && accepting(q) && dataOf(q).type === 'wordsnake' && dataOf(q).goWide, 'Going wide is not available now', 409);
        requireValue(!one('SELECT 1 FROM answers WHERE team=? AND question=?', team.id, q.id), 'Already submitted', 409);
        run('INSERT OR IGNORE INTO go_wide VALUES(?,?)', team.id, q.id); return send(200, {cells: dataOf(q).snake.path});
      }
      if (p === '/api/tap') {
        const q = latest(); requireValue(q && body.question === q.id && pending(q) && q.paused_ms === null && dataOf(q).type === 'clips' && !settings().ended, 'No live sound clips game', 409);
        const data = dataOf(q), playing = nowPlaying(q);
        requireValue(playing, 'Wait for the clips to start', 409);
        requireValue(!one('SELECT 1 FROM answers WHERE team=? AND question=?', team.id, q.id), 'You have already tapped', 409);
        // Full points for tapping during the right clip, plus a bonus that fades over its first five seconds.
        const right = playing.clip === data.targetClip, elapsed = now() - playing.at;
        const points = right ? data.points + Math.floor(speedBonusOf(data) * Math.max(0, 1 - elapsed / 5000)) : 0;
        award(team.id, q, playing.clip >= 0 ? `Clip ${playing.clip + 1}` : 'Between clips', points);
        return send(200, {ok: true, clip: playing.clip >= 0 ? playing.clip + 1 : null});
      }
      if (p === '/api/buzz' || p === '/api/agree') {
        const q = latest(); requireValue(q && body.question === q.id && pending(q) && q.paused_ms === null && dataOf(q).type === 'buzzer' && !settings().ended, 'No live buzzer question', 409);
        if (p === '/api/agree') {
          requireValue(q.agree_deadline > now(), 'Agree voting is closed', 409);
          requireValue(!one(`SELECT 1 FROM buzzes WHERE question=? AND team=? AND status IN ('active','passed','wrong')`, q.id, team.id), 'The answering team cannot vote', 409);
          run('INSERT OR IGNORE INTO agrees VALUES(?,?,?)', team.id, q.id, now()); return send(200, {ok: true});
        }
        requireValue(now() < q.deadline, 'Buzzing has closed', 409);
        requireValue(!lockedOut(q, team.id), 'Locked out after a wrong answer last question', 409);
        requireValue(!one('SELECT 1 FROM buzzes WHERE question=? AND team=?', q.id, team.id), 'Already buzzed', 409);
        const position = transaction(() => {
          const active = one(`SELECT 1 FROM buzzes WHERE question=? AND status='active'`, q.id);
          run('INSERT INTO buzzes VALUES(?,?,?,?)', team.id, q.id, now(), active ? 'queued' : 'active');
          return one(`SELECT COUNT(*) n FROM buzzes WHERE question=? AND status IN ('active','queued')`, q.id).n;
        });
        return send(200, {ok: true, position});
      }
      if (p === '/api/answer' || p === '/api/draft') {
        const q = latest(); requireValue(q && body.question === q.id && accepting(q), 'Question closed, paused or outdated', 409);
        const data = dataOf(q); let value = answerValue(body.value, data, p === '/api/answer');
        if (data.type === 'wordsnake' && p === '/api/answer') value = JSON.stringify({path: JSON.parse(value), wide: !!one('SELECT 1 FROM go_wide WHERE team=? AND question=?', team.id, q.id)});
        requireValue(!one('SELECT 1 FROM answers WHERE team=? AND question=?', team.id, q.id), 'Already submitted', 409);
        if (p === '/api/draft') {
          run('INSERT INTO drafts VALUES(?,?,?) ON CONFLICT(team,question) DO UPDATE SET value=excluded.value', team.id, q.id, value); return send(200, {ok: true});
        }
        const marked = autoMark(value, data, q, team.id);
        run('INSERT INTO answers(team,question,value,points,submitted,marks) VALUES(?,?,?,?,?,?)', team.id, q.id, value, marked.points, now(), marked.marks ? JSON.stringify(marked.marks) : null);
        run('DELETE FROM drafts WHERE team=? AND question=?', team.id, q.id); return send(200, {ok: true});
      }
      throw new QuizError('Unknown action', 404);
    } catch (e) {
      if (res.headersSent) return res.destroy();
      if (!(e instanceof QuizError)) console.error(e);
      send(e.status || 500, {error: e instanceof QuizError ? e.message : 'Server error. Check the server terminal.'});
    }
  };
  // Two doors to the same quiz: the main port (laptop, quiz Wi-Fi) and a laptop-only port for the online tunnel.
  const server = http.createServer(handle), publicServer = http.createServer((req, res) => {req.viaTunnel = true; handle(req, res);});
  publicServer.on('upgrade', (req, socket) => {req.viaTunnel = true; openSocket(req, socket);});
  server.on('upgrade', openSocket);
  for (const s of [server, publicServer]) {s.requestTimeout = 15000; s.headersTimeout = 10000;}
  let closing = null;
  function close() {
    simulator?.stop(); simulator = null;
    clearInterval(ticker); clearInterval(keepAlive); clearInterval(syncTimer); clearInterval(licenceTimer); clearTimeout(firstRenew); clearTimeout(notifyTimer);
    for (const stream of streams) stream.end();
    laptop?.goOffline?.();
    const shut = s => new Promise(resolve => {s.close(() => resolve()); s.closeAllConnections();});
    closing ||= Promise.all([shut(server), shut(publicServer), flushing?.catch(() => {})]).then(() => db.close());
    return closing;
  }
  // A fresh one-time desk login for the desktop app, which runs the server and opens the desk itself.
  const newDeskTicket = () => (deskLink = token());
  return {server, publicServer, db, close, newDeskTicket};
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // ALLOWED_ADDRESSES limits which local addresses answer, e.g. 127.0.0.1,10.42.0.1 for hotspot-only play.
  const allowedAddresses = process.env.ALLOWED_ADDRESSES ? process.env.ALLOWED_ADDRESSES.split(',').map(s => s.trim()).filter(Boolean) : null;
  // Started from the app icon (scripts/beermat-app.sh): the desk can also close BeerMat.
  const app = process.env.BEERMAT_APP === '1';
  // QUIZ_DB, MEDIA_DIR and PACK_DIR move the quiz's own files out of the program folder (the desktop app keeps them
  // in the user's data folder).
  const packDir = process.env.PACK_DIR || path.join(root, 'soundpack');
  const quiz = createQuiz({hostKey: process.env.HOST_KEY, database: process.env.QUIZ_DB || path.join(root, 'quiz.sqlite'), allowedAddresses,
    mediaDir: process.env.MEDIA_DIR || path.join(root, 'media'), packDir,
    laptop: ['linux', 'win32'].includes(process.platform) ? createLaptop({root, packDir}) : null, publicPort: Number(process.env.PUBLIC_PORT || 3001), deskTicket: process.env.DESK_TICKET || null, onQuit: app ? () => quiz.close().then(() => process.exit(0)) : null});
  quiz.server.listen(Number(process.env.PORT || 3000), process.env.BIND || '0.0.0.0', () => {
    console.log('BeerMat ready. Quizmaster: http://localhost:' + (process.env.PORT || 3000) + '/host');
    if (!allowedAddresses && (process.env.BIND || '0.0.0.0') === '0.0.0.0') console.log('Note: reachable from every network this laptop is on. Use ./scripts/start.sh --hotspot to answer only on the quiz Wi-Fi.');
  });
  // Online mode's tunnel connects here; only this laptop can reach it.
  quiz.publicServer.on('error', e => console.log(`Online mode unavailable: port ${process.env.PUBLIC_PORT || 3001} is busy (${e.code}).`));
  quiz.publicServer.listen(Number(process.env.PUBLIC_PORT || 3001), '127.0.0.1');
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => quiz.close().then(() => process.exit(0)));
}
