import http from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes, randomInt, timingSafeEqual, createHash} from 'node:crypto';
import {existsSync, mkdirSync, writeFileSync, statSync, createReadStream, unlinkSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {offensive} from './names.js';
import {createSpotify} from './spotify.js';
import {QuizError, requireValue, validateQuestion, validateLibrary, answerValue, isCorrect, basePoints, rankNearest, autoMarked, speedBonusOf, hostDriven, isBingo, bingoCard, musicCard, bingoLines, bingoNeeded, snakeGrid, shuffleTiles, mediaPattern} from './model.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const token = () => randomBytes(24).toString('hex');
const hash = value => createHash('sha256').update(value).digest('hex');
const equal = (a, b) => typeof a === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const types = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav'};
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
const readOnly = new Set(['/api/state', '/api/draft', '/api/login', '/api/host/state', '/api/host/library', '/api/host/review', '/api/host/export', '/api/host/logout', '/api/device', '/api/host/spotify/status', '/api/host/spotify/import', '/api/host/spotify/token']);

export function createQuiz({database = 'quiz.sqlite', hostKey, now = Date.now, mediaDir = path.join(root, 'media'), allowedAddresses = null, clientAddress = null, spotifyAccountsUrl, spotifyApiUrl} = {}) {
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
    CREATE TABLE IF NOT EXISTS bingo_calls(question INTEGER REFERENCES questions(id),seq INTEGER NOT NULL,number INTEGER NOT NULL,at INTEGER NOT NULL,PRIMARY KEY(question,seq));
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
  const defaultSettings = {title: 'PubQuiz', registrationOpen: true, leaderboardVisible: true, displayMode: 'auto', ended: false, joinSsid: 'PubQuiz', joinUrl: 'http://10.42.0.1', scrambleKeypads: false, bingoPhrases: true, teamPhotos: true, language: 'en', onlineAfterJoin: true, waitingRoom: false, maxTeams: 0, showScores: true};
  const SOUNDS = 8;
  const settings = () => ({...defaultSettings, ...getMeta('settings', {})});
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

  // Live updates: every client keeps one server-sent event stream and refetches state on each nudge.
  const streams = new Set(); let version = 0, notifyTimer = null, lastPending = null, ticks = 0;
  function notify() {
    if (notifyTimer) return;
    notifyTimer = setTimeout(() => {
      notifyTimer = null; version++;
      for (const stream of streams) stream.res.write(`data: ${version}\n\n`);
    }, 20);
  }
  const liveTeams = () => new Set([...streams].map(s => s.team).filter(Boolean));
  const ticker = setInterval(() => {
    // Expiry is time-driven, so announce it as soon as it happens.
    const q = latest(), state = (q ? `${q.id}:${pending(q)}:${accepting(q)}:${q.agree_deadline > now()}` : '') + ':' + tvView();
    if (state !== lastPending) {lastPending = state; if (q) settle(q); notify();}
    if (++ticks % 60 === 0) for (const stream of streams) stream.res.write(': keep-alive\n\n');
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
  function bingoState(q, data, teamId, host) {
    if (!isBingo(data.type)) return null;
    const called = calledNumbers(q), winners = rows('SELECT t.name FROM answers a JOIN teams t ON t.id=a.team WHERE a.question=? AND a.points>0 ORDER BY a.submitted,a.rowid', q.id).map(w => w.name);
    const mine = teamId ? {claimed: !!one('SELECT 1 FROM answers WHERE team=? AND question=?', teamId, q.id)} : {};
    if (data.type === 'bingo') return {mode: data.mode, called, last: called.at(-1) ?? null, winners, ...mine, ...(teamId ? {card: ticket(data, teamId, q)} : {})};
    // Music bingo hides the song now playing (teams must recognise it) unless the host chose to reveal titles straight away.
    const shown = data.revealNow || !pending(q) ? called : called.slice(0, -1);
    return {mode: data.mode, music: true, played: called.length, titles: shown.map(n => data.songs[n - 1].title), winners, ...mine,
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
    const {answer, aliases, itemAnswers, answerNote, correct, target, clips, targetClip, songs, snake, tiles, ...safe} = data;
    // Sequence items are shown shuffled; the stored order is the answer.
    const result = {...safe, id: q.id, deadline: q.deadline, open: accepting(q), live: pending(q), paused: pending(q) && q.paused_ms !== null,
      remaining: q.paused_ms ?? Math.max(0, q.deadline - now()), revealed: !!q.revealed, buzz: buzzState(q, data, teamId), bingo: bingoState(q, data, teamId, host), clipGame: clipState(q, data, teamId)};
    if (data.type === 'sequence') result.order = shuffleOrder(data.items.length, q.id);
    if (snake) {
      result.grid = {size: snake.size, letters: snake.grid};
      // Going wide shows a team only the squares on the answer's path.
      if (teamId && one('SELECT 1 FROM go_wide WHERE team=? AND question=?', teamId, q.id)) result.wideCells = snake.path;
    }
    if (host || q.revealed) Object.assign(result, {answer, answerNote: answerNote || '', aliases: aliases || [], itemAnswers: itemAnswers || [], correct, target, clips, targetClip, songs, snakePath: snake?.path, tiles, tally: tally(q, data),
      correctCount: one('SELECT COUNT(*) n FROM answers WHERE question=? AND points>0', q.id).n, scorers: scorers(q)});
    return result;
  }
  // Teams that scored, quickest answer first (each team's clock starts as for the speed bonus).
  // Answers the quizmaster marked by hand have no answer time and come last.
  function scorers(q) {
    const shown = settings().showScores;
    return rows('SELECT a.team,a.points,a.submitted,t.name FROM answers a JOIN teams t ON t.id=a.team WHERE a.question=? AND a.points>0 AND t.enabled=1', q.id)
      .map(a => ({name: a.name, points: shown ? a.points : null, ms: a.submitted === null ? null : Math.max(0, a.submitted - q.opened - lateness(q, a.team))}))
      .sort((a, b) => (a.ms ?? Infinity) - (b.ms ?? Infinity) || a.name.localeCompare(b.name));
  }
  function shuffleOrder(length, seed) {
    const order = Array.from({length}, (_, i) => i); let s = seed * 9301 + 49297;
    for (let i = length - 1; i > 0; i--) {s = (s * 9301 + 49297) % 233280; const j = Math.floor(s / 233280 * (i + 1)); [order[i], order[j]] = [order[j], order[i]];}
    if (order.every((v, i) => v === i)) order.reverse();
    return order;
  }
  function scores(includeDisabled = false) {
    const live = liveTeams();
    const teams = rows(`SELECT id,name,seen,enabled,waiting,photo,photo_status,note,
      COALESCE((SELECT SUM(a.points) FROM answers a JOIN questions q ON a.question=q.id WHERE a.team=teams.id AND (q.closed=1 OR q.settled=1)),0)
      +COALESCE((SELECT SUM(points) FROM adjustments WHERE team=teams.id),0) score FROM teams ${includeDisabled ? '' : 'WHERE enabled=1 AND waiting=0'} ORDER BY score DESC,name`);
    let rank = 0, previous;
    return teams.map((t, i) => {if (previous !== t.score) rank = i + 1; previous = t.score; return {...t, rank, connected: !!t.enabled && (live.has(t.id) || now() - t.seen < 15000)};});
  }
  // Only photos the quizmaster approved are ever shown to other teams or on the TV.
  const publicPhoto = t => settings().teamPhotos && t.photo_status === 'approved' ? t.photo : null;
  function removePhoto(team) {
    if (team.photo) try {unlinkSync(path.join(mediaDir, path.basename(team.photo)));} catch {}
    run('UPDATE teams SET photo=NULL,photo_status=NULL WHERE id=?', team.id);
  }
  function publicScores() {
    // With scores switched off, the board shows positions only.
    const shown = settings().showScores;
    return settings().leaderboardVisible ? scores().map(({seen, connected, enabled, waiting, photo, photo_status, note, ...t}) => ({...t, score: shown ? t.score : null, photo: publicPhoto({photo, photo_status})})) : [];
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
  const ROUND_BOARD_MS = 10000;
  function tvView() {
    const s = settings();
    if (s.displayMode !== 'auto') return s.displayMode;
    if (s.ended) return 'winner';
    const q = latest();
    if (!q) return s.registrationOpen ? 'join' : 'leaderboard';
    if (pending(q) || !roundOver(q)) return 'question';
    const since = q.revealed ? q.revealed_at : q.closed_at ?? q.deadline;
    return since && now() - since >= ROUND_BOARD_MS ? 'leaderboard' : 'question';
  }
  // A saved question ends its round when every question in that round has been played.
  function roundOver(q) {
    const id = dataOf(q).sourceId, round = id && library().rounds.find(r => r.questions.some(x => x.id === id));
    if (!round) return false;
    const played = new Set(rows('SELECT data FROM questions').map(p => dataOf(p).sourceId));
    return round.questions.every(x => played.has(x.id));
  }
  function publicState() { return {serverTime: now(), settings: settings(), view: tvView(), question: publicQuestion(latest()), teams: publicScores(), wheel: getMeta('wheel', null), timer: getMeta('timer', null)}; }

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
    // Each play gets a fresh word-snake grid and tile shuffle.
    if (q.type === 'wordsnake') q.snake = snakeGrid(q.answer, random);
    if (q.type === 'tiles') q.pieces = shuffleTiles(q.tiles, random);
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
      const marks = data.items.map((_, i) => data.itemAnswers?.[i] ? Number(isCorrect(values[i], {type: 'text', answer: data.itemAnswers[i]})) : null);
      return {points: marks.reduce((a, b) => a + (b ?? 0), 0), marks};
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
  function openStream(req, res, url) {
    const auth = url.searchParams.get('key') || '';
    const team = auth ? one('SELECT id,enabled FROM teams WHERE secret=?', auth) : null;
    requireValue(!auth || team || isHost(auth), 'Invalid key', 401);
    res.writeHead(200, {...security, 'Content-Type': 'text/event-stream', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no'});
    res.write(`retry: 1000\ndata: ${version}\n\n`);
    const stream = {res, team: team?.id || null}; streams.add(stream);
    if (team) notify();
    req.on('close', () => {streams.delete(stream); if (team) notify();});
  }
  // Phones are recognised by their address on the quiz Wi-Fi. The laptop itself (loopback) is never a team device.
  const clientIp = req => clientAddress ? clientAddress(req) : (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
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
  const localAllowed = req => !allowedAddresses || allowedAddresses.includes((req.socket.localAddress || '').replace(/^::ffff:/, ''));
  const server = http.createServer(async (req, res) => {
    const send = (status, data) => {res.writeHead(status, {...security, 'Content-Type': 'application/json'}); res.end(JSON.stringify(data));};
    try {
      if (!localAllowed(req)) return send(403, {error: 'Not available on this network'});
      const url = new URL(req.url, 'http://quiz.local'); const p = url.pathname;
      const auth = req.headers.authorization?.replace(/^Bearer /, '');
      settle(latest());
      if (req.method === 'GET' && p === '/api/events') return openStream(req, res, url);
      if ((req.method === 'GET' || req.method === 'HEAD') && !p.startsWith('/api/')) {
        const routes = {'/host': 'host.html', '/display': 'display.html', '/app.js': 'app.js', '/host.js': 'host.js', '/client.js': 'client.js', '/sqimport.js': 'sqimport.js', '/qr.js': 'qr.js', '/i18n.js': 'i18n.js', '/style.css': 'style.css'};
        if (p.startsWith('/media/')) {
          requireValue(mediaPattern.test(p), 'Media not found', 404);
          const file = path.join(mediaDir, path.basename(p));
          requireValue(existsSync(file) && statSync(file).isFile(), 'Media not found', 404);
          return sendFile(req, res, file);
        }
        if (p === '/health') return send(200, {ok: true});
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
        return sendFile(req, res, path.join(root, routes[p] || 'player.html'), p === '/host' ? deskSecurity : security);
      }
      if (req.method === 'GET' && p === '/api/leaderboard') return send(200, publicState());
      requireValue(req.method === 'POST', 'POST required', 405);
      requireValue(!req.headers.origin || req.headers.origin === `http://${req.headers.host}`, 'Origin rejected', 403);
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
        const ip = req.socket.remoteAddress; const a = attempts.get(ip) || {n: 0, time: now()};
        if (now() - a.time >= 60000) {a.n = 0; a.time = now();} attempts.set(ip, a);
        requireValue(++a.n <= 10, 'Wait one minute before trying again', 429);
        requireValue(equal(body.key, hostKey), 'Incorrect key', 403);
        const key = token(); run('INSERT INTO host_sessions VALUES(?,?)', hash(key), now() + SESSION_MS); return send(200, {key});
      }
      if (p.startsWith('/api/host/')) {
        requireValue(isHost(auth), 'Host login required', 403);
        if (p === '/api/host/logout') {run('DELETE FROM host_sessions WHERE hash=?', hash(auth)); return send(200, {ok: true});}
        if (p === '/api/host/state') {
          const q = latest(), stats = teamStats();
          return send(200, {serverTime: now(), settings: settings(), view: tvView(), timer: getMeta('timer', null), blockedWords: getMeta('blockedWords', []), libraryRevision: library().revision,
            teams: scores(true).map(t => ({...t, stats: stats[t.id] || {answered: 0, scored: 0, fastest: null}})), question: publicQuestion(q, true), away: awayList(q), answers: rows('SELECT * FROM answers WHERE question=?', q?.id || 0),
            history: rows('SELECT * FROM questions ORDER BY id DESC LIMIT 300').map(h => publicQuestion(h, true))});
        }
        if (p === '/api/host/library') return send(200, library());
        if (p === '/api/host/library/save') {
          const old = library(); requireValue(body.revision === old.revision, 'Quiz changed in another window. Reload before saving.', 409);
          const next = {...validateLibrary(body.quiz, mediaDir), revision: old.revision + 1};
          setMeta('library', next); return send(200, next);
        }
        if (p === '/api/host/settings') {
          const next = {...settings()};
          for (const k of ['registrationOpen', 'leaderboardVisible', 'ended', 'scrambleKeypads', 'bingoPhrases', 'teamPhotos', 'onlineAfterJoin', 'waitingRoom', 'showScores']) if (Object.hasOwn(body, k)) {requireValue(typeof body[k] === 'boolean', 'Invalid setting'); next[k] = body[k];}
          if (Object.hasOwn(body, 'title')) {requireValue(typeof body.title === 'string' && body.title.trim() && body.title.length <= 100, 'Title must contain 1–100 characters'); next.title = body.title.trim();}
          // Shown on the projector's join screen; the Wi-Fi name should match the hotspot's --ssid.
          if (Object.hasOwn(body, 'joinSsid')) {requireValue(typeof body.joinSsid === 'string' && body.joinSsid.trim() && Buffer.byteLength(body.joinSsid.trim()) <= 32, 'Wi-Fi name must be 1–32 bytes'); next.joinSsid = body.joinSsid.trim();}
          if (Object.hasOwn(body, 'joinUrl')) {requireValue(typeof body.joinUrl === 'string' && /^https?:\/\/[^\s]{1,150}$/.test(body.joinUrl.trim()), 'Join address must start with http:// and have no spaces'); next.joinUrl = body.joinUrl.trim();}
          if (Object.hasOwn(body, 'maxTeams')) {requireValue(Number.isInteger(body.maxTeams) && body.maxTeams >= 0 && body.maxTeams <= 250, 'Maximum teams must be 0 (no limit) to 250'); next.maxTeams = body.maxTeams;}
          if (Object.hasOwn(body, 'language')) {requireValue(['en', 'fr', 'es'].includes(body.language), 'Unknown language'); next.language = body.language;}
          if (Object.hasOwn(body, 'displayMode')) {requireValue(['auto', 'join', 'leaderboard', 'question', 'wheel', 'winner', 'blank'].includes(body.displayMode), 'Invalid projector view'); next.displayMode = body.displayMode;}
          // Extra blocked team-name words stay private to the desk.
          if (Object.hasOwn(body, 'blockedWords')) {
            requireValue(typeof body.blockedWords === 'string' && body.blockedWords.length <= 2000, 'Blocked words must be up to 2,000 characters');
            setMeta('blockedWords', body.blockedWords.split(/[\n,]/).map(w => w.trim().toLowerCase()).filter(Boolean));
          }
          if (next.ended) {closeQuestion(latest()); next.registrationOpen = false;}
          setMeta('settings', next); return send(200, next);
        }
        if (p === '/api/host/open') return send(200, openQuestion(body));
        if (p === '/api/host/start' || p === '/api/host/next') {
          requireValue(body.expectedQuestion === (latest()?.id || null), 'Current question changed; refresh before opening another', 409);
          const all = library().rounds.flatMap(r => r.questions.map(q => ({...q, round: r.title})));
          const played = new Set(rows('SELECT data FROM questions').map(q => dataOf(q).sourceId).filter(Boolean));
          const chosen = p === '/api/host/start' ? all.find(q => q.id === body.id) : all.find(q => !played.has(q.id));
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
        if (p === '/api/host/bingo') {
          const q = questionById(body.question); requireValue(q && pending(q) && isBingo(dataOf(q).type), 'No live bingo game', 409);
          requireValue(q.paused_ms === null, 'Resume the game first', 409);
          requireValue(!one('SELECT 1 FROM answers WHERE question=? AND points>0', q.id), 'A team has called bingo — end the game', 409);
          const data = dataOf(q), called = new Set(calledNumbers(q));
          const remaining = Array.from({length: data.type === 'musicbingo' ? data.songs.length : 90}, (_, i) => i + 1).filter(n => !called.has(n));
          requireValue(remaining.length, data.type === 'musicbingo' ? 'Every song has been played' : 'Every number has been called', 409);
          const number = remaining[randomInt(remaining.length)];
          run('INSERT INTO bingo_calls VALUES(?,?,?,?)', q.id, called.size + 1, number, now());
          // A Spotify song starts on the laptop's Spotify app; if that fails the call still stands and the desk is told why.
          const song = data.type === 'musicbingo' && data.songs[number - 1];
          if (song?.spotify) try {await spotify.play(song.spotify, data.startAt);} catch (e) {if (!(e instanceof QuizError)) throw e; return send(200, {number, warning: e.message});}
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
        if (p === '/api/host/spotify/status') return send(200, {...await spotify.status(), redirectUri: spotifyRedirect()});
        if (p === '/api/host/spotify/connect') return send(200, {url: spotify.authorizeUrl(body.clientId, spotifyRedirect())});
        // The desk's Spotify player needs a current access token; the long-lived sign-in token never leaves the server.
        if (p === '/api/host/spotify/token') return send(200, await spotify.accessToken());
        if (p === '/api/host/spotify/disconnect') {spotify.disconnect(); return send(200, {ok: true});}
        if (p === '/api/host/spotify/device') {spotify.device(body.id); return send(200, {ok: true});}
        if (p === '/api/host/spotify/import') return send(200, {songs: await spotify.tracks(body.links)});
        if (p === '/api/host/spotify/pause') {await spotify.pause(); return send(200, {ok: true});}
        // A Spotify sound clip: start it, then log it as playing so taps count against it.
        if (p === '/api/host/spotify/play') {
          const q = questionById(body.question); requireValue(q && pending(q) && dataOf(q).type === 'clips', 'No live sound clips game', 409);
          const clip = dataOf(q).clips[body.clip]; requireValue(Number.isInteger(body.clip) && clip?.spotify, 'Not a Spotify clip');
          await spotify.play(clip.spotify, clip.start);
          run('INSERT INTO clip_plays VALUES(?,?,?,?)', q.id, (nowPlaying(q)?.seq || 0) + 1, body.clip, now()); return send(200, {ok: true});
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
          run('UPDATE questions SET revealed=?,revealed_at=? WHERE id=?', body.revealed === false ? 0 : 1, body.revealed === false ? null : now(), q.id); return send(200, {ok: true});
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
            marks = body.marks; points = marks.reduce((a, b) => a + b, 0);
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
            let code; do code = String(randomInt(1000, 10000)); while (one('SELECT 1 FROM teams WHERE transfer_code=? AND transfer_expires>?', code, now()));
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
        if (p === '/api/host/export') return send(200, {version: 3, settings: settings(), library: library(), teams: rows('SELECT id,name,enabled FROM teams'), questions: rows('SELECT * FROM questions'), answers: rows('SELECT * FROM answers'), adjustments: rows('SELECT * FROM adjustments'), markingLog: rows('SELECT * FROM marking_log'), buzzes: rows('SELECT * FROM buzzes'), agrees: rows('SELECT * FROM agrees'), bingoCalls: rows('SELECT * FROM bingo_calls'), clipPlays: rows('SELECT * FROM clip_plays')});
        throw new QuizError('Unknown host action', 404);
      }
      if (p === '/api/transfer') {
        const ip = req.socket.remoteAddress, a = attempts.get('transfer:' + ip) || {n: 0, time: now()};
        if (now() - a.time >= 60000) {a.n = 0; a.time = now();} attempts.set('transfer:' + ip, a);
        requireValue(++a.n <= 10, 'Wait one minute before trying again', 429);
        const team = typeof body.code === 'string' && /^\d{4}$/.test(body.code) && one('SELECT id,secret FROM teams WHERE transfer_code=? AND transfer_expires>?', body.code, now());
        requireValue(team, 'That code is wrong or has expired. Ask the quizmaster for a new one.', 403);
        run('UPDATE teams SET transfer_code=NULL,transfer_expires=NULL WHERE id=?', team.id);
        return send(200, {secret: team.secret});
      }
      if (p === '/api/join') {
        requireValue(settings().registrationOpen && !settings().ended, 'Registration is closed. Ask the quizmaster.', 409);
        requireValue(typeof body.name === 'string' && body.name.trim().length >= 2 && body.name.trim().length <= 40, 'Team name must be 2–40 characters');
        requireValue(!offensive(body.name, getMeta('blockedWords', [])), 'Please choose a different team name', 400);
        requireValue(!one('SELECT id FROM teams WHERE name=? COLLATE NOCASE', body.name.trim()), 'Name taken. Use your recovery code to reconnect.', 409);
        requireValue(one('SELECT COUNT(*) n FROM teams').n < 250, 'Team limit reached. Ask the quizmaster.', 409);
        const {maxTeams, waitingRoom} = settings();
        requireValue(!maxTeams || one('SELECT COUNT(*) n FROM teams WHERE enabled=1').n < maxTeams, 'The quiz is full. Ask the quizmaster.', 409);
        // With the waiting room on, a new team waits until the quizmaster lets it in.
        const id = token(), secret = token(); run('INSERT INTO teams(id,name,secret,seen,waiting) VALUES(?,?,?,?,?)', id, body.name.trim(), secret, now(), Number(waitingRoom));
        rememberDevice(req, id); return send(200, {id, secret, waiting: waitingRoom});
      }
      // A phone that already played (e.g. in the Wi-Fi sign-in window) can carry on in its normal browser.
      if (p === '/api/device') {const team = deviceTeam(req); return send(200, {team: team ? {name: team.name} : null});}
      if (p === '/api/device/continue') {
        const team = deviceTeam(req); requireValue(team, 'This phone has not joined a team yet', 404);
        rememberDevice(req, team.id); return send(200, {secret: team.secret});
      }
      const team = one('SELECT * FROM teams WHERE secret=?', auth || ''); requireValue(team, 'Team recovery code required', 401);
      requireValue(team.enabled, 'This team is disabled. Ask the quizmaster.', 403);
      run('UPDATE teams SET seen=? WHERE id=?', now(), team.id); rememberDevice(req, team.id);
      const teamInfo = {id: team.id, name: team.name, sound: team.sound, photo: team.photo, photoStatus: team.photo_status, waiting: !!team.waiting};
      if (team.waiting) {
        requireValue(p === '/api/state' || p === '/api/team/sound', 'Waiting for the quizmaster to let you in', 403);
        if (p === '/api/state') return send(200, {...publicState(), question: null, team: teamInfo, answer: null, draft: null});
      }
      if (p === '/api/state') {
        const q = latest();
        if (q && pending(q)) run('INSERT OR IGNORE INTO deliveries VALUES(?,?,?)', team.id, q.id, now());
        const a = q && one('SELECT value,points,marks,submitted FROM answers WHERE team=? AND question=?', team.id, q.id);
        // Points stay hidden until scoring is final.
        const answer = !a || a.submitted === null && !q.settled && !q.closed ? null : pending(q) ? {value: a.value} : {value: a.value, points: a.points, marks: a.marks};
        return send(200, {...publicState(), question: publicQuestion(q, false, team.id), team: teamInfo, answer,
          draft: one('SELECT value FROM drafts WHERE team=? AND question=?', team.id, q?.id || 0) || null});
      }
      if (p === '/api/team/sound') {
        requireValue(Number.isInteger(body.sound) && body.sound >= 0 && body.sound < SOUNDS, 'Unknown buzzer sound');
        run('UPDATE teams SET sound=? WHERE id=?', body.sound, team.id); return send(200, {ok: true});
      }
      if (p === '/api/bingo') {
        const q = latest(); requireValue(q && body.question === q.id && pending(q) && q.paused_ms === null && isBingo(dataOf(q).type) && !settings().ended, 'No live bingo game', 409);
        requireValue(!one('SELECT 1 FROM answers WHERE team=? AND question=?', team.id, q.id), 'Already claimed', 409);
        const data = dataOf(q), called = new Set(calledNumbers(q));
        requireValue(bingoLines(ticket(data, team.id, q), called) >= bingoNeeded(data.mode), 'Not yet — keep marking your ticket', 409);
        // The first claim takes the bonus; later claims on the same call score the standard points.
        const first = !one('SELECT 1 FROM answers WHERE question=? AND points>0', q.id);
        award(team.id, q, `BINGO on call ${called.size}`, data.points + (first ? speedBonusOf(data) : 0));
        return send(200, {ok: true, first});
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
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  let closing = null;
  function close() {
    clearInterval(ticker); clearInterval(keepAlive); clearTimeout(notifyTimer);
    for (const stream of streams) stream.res.end();
    closing ||= new Promise(resolve => {server.close(() => {db.close(); resolve();}); server.closeAllConnections();});
    return closing;
  }
  return {server, db, close};
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // ALLOWED_ADDRESSES limits which local addresses answer, e.g. 127.0.0.1,10.42.0.1 for hotspot-only play.
  const allowedAddresses = process.env.ALLOWED_ADDRESSES ? process.env.ALLOWED_ADDRESSES.split(',').map(s => s.trim()).filter(Boolean) : null;
  const quiz = createQuiz({hostKey: process.env.HOST_KEY, database: process.env.QUIZ_DB || path.join(root, 'quiz.sqlite'), allowedAddresses});
  quiz.server.listen(Number(process.env.PORT || 3000), process.env.BIND || '0.0.0.0', () => {
    console.log('PubQuiz ready. Quizmaster: http://localhost:' + (process.env.PORT || 3000) + '/host');
    if (!allowedAddresses && (process.env.BIND || '0.0.0.0') === '0.0.0.0') console.log('Note: reachable from every network this laptop is on. Use ./scripts/start.sh --hotspot to answer only on the quiz Wi-Fi.');
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => quiz.close().then(() => process.exit(0)));
}
