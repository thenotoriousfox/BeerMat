import http from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes, randomInt, timingSafeEqual, createHash} from 'node:crypto';
import {existsSync, mkdirSync, writeFileSync, statSync, createReadStream} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {QuizError, requireValue, validateQuestion, validateLibrary, answerValue, isCorrect, basePoints, rankNearest, hostDriven, bingoCard, bingoLines, bingoNeeded, mediaPattern} from './model.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const token = () => randomBytes(24).toString('hex');
const hash = value => createHash('sha256').update(value).digest('hex');
const equal = (a, b) => typeof a === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const types = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav'};
const security = {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; media-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"};
// A late phone may not gain more than this much speed-bonus time over the moment the question opened.
const DELIVERY_GRACE_MS = 2000;
const SESSION_MS = 12 * 60 * 60 * 1000;
// Read-only routes never notify clients of a change.
const readOnly = new Set(['/api/state', '/api/draft', '/api/login', '/api/host/state', '/api/host/library', '/api/host/review', '/api/host/export', '/api/host/logout']);

export function createQuiz({database = 'quiz.sqlite', hostKey, now = Date.now, mediaDir = path.join(root, 'media'), allowedAddresses = null} = {}) {
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
    CREATE TABLE IF NOT EXISTS bingo_calls(question INTEGER REFERENCES questions(id),seq INTEGER NOT NULL,number INTEGER NOT NULL,at INTEGER NOT NULL,PRIMARY KEY(question,seq));
  `);
  function column(table, name, definition) {
    if (!db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  }
  column('teams', 'enabled', 'INTEGER NOT NULL DEFAULT 1');
  column('teams', 'sound', 'INTEGER');
  column('questions', 'paused_ms', 'INTEGER');
  column('questions', 'revealed', 'INTEGER NOT NULL DEFAULT 0');
  column('questions', 'settled', 'INTEGER NOT NULL DEFAULT 0');
  column('questions', 'agree_deadline', 'INTEGER');
  column('questions', 'announced', 'TEXT');
  column('answers', 'submitted', 'INTEGER');
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
  const defaultSettings = {title: 'PubQuiz', registrationOpen: true, leaderboardVisible: true, displayMode: 'leaderboard', ended: false, joinSsid: 'PubQuiz', joinUrl: 'http://10.42.0.1'};
  const SOUNDS = 8;
  const settings = () => ({...defaultSettings, ...getMeta('settings', {})});
  const library = () => getMeta('library', {revision: 0, title: 'My quiz', rounds: []});
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
    const q = latest(), state = q ? `${q.id}:${pending(q)}:${accepting(q)}:${q.agree_deadline > now()}` : '';
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
    const queue = rows(`SELECT b.team,b.at,b.status,t.name,t.sound FROM buzzes b JOIN teams t ON t.id=b.team WHERE b.question=? ORDER BY b.at,b.rowid`, q.id);
    const active = queue.find(b => b.status === 'active');
    return {variation: data.variation, queue: queue.map(({team, name, status}) => ({team, name, status})), active: active ? {team: active.team, name: active.name, sound: active.sound} : null,
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
  function bingoState(q, data, teamId) {
    if (data.type !== 'bingo') return null;
    const called = calledNumbers(q);
    return {mode: data.mode, called, last: called.at(-1) ?? null, winners: rows('SELECT t.name FROM answers a JOIN teams t ON t.id=a.team WHERE a.question=? AND a.points>0 ORDER BY a.submitted,a.rowid', q.id).map(w => w.name),
      ...(teamId ? {card: bingoCard(`${teamId}:${q.id}`), claimed: !!one('SELECT 1 FROM answers WHERE team=? AND question=?', teamId, q.id)} : {})};
  }
  function publicQuestion(q, host = false, teamId = null) {
    if (!q) return null;
    const data = dataOf(q);
    const {answer, aliases, itemAnswers, answerNote, correct, target, ...safe} = data;
    // Sequence items are shown shuffled; the stored order is the answer.
    const result = {...safe, id: q.id, deadline: q.deadline, open: accepting(q), live: pending(q), paused: pending(q) && q.paused_ms !== null,
      remaining: q.paused_ms ?? Math.max(0, q.deadline - now()), revealed: !!q.revealed, buzz: buzzState(q, data, teamId), bingo: bingoState(q, data, teamId)};
    if (data.type === 'sequence') result.order = shuffleOrder(data.items.length, q.id);
    if (host || q.revealed) Object.assign(result, {answer, answerNote: answerNote || '', aliases: aliases || [], itemAnswers: itemAnswers || [], correct, target, tally: tally(q, data),
      correctCount: one('SELECT COUNT(*) n FROM answers WHERE question=? AND points>0', q.id).n});
    return result;
  }
  function shuffleOrder(length, seed) {
    const order = Array.from({length}, (_, i) => i); let s = seed * 9301 + 49297;
    for (let i = length - 1; i > 0; i--) {s = (s * 9301 + 49297) % 233280; const j = Math.floor(s / 233280 * (i + 1)); [order[i], order[j]] = [order[j], order[i]];}
    if (order.every((v, i) => v === i)) order.reverse();
    return order;
  }
  function scores(includeDisabled = false) {
    const live = liveTeams();
    const teams = rows(`SELECT id,name,seen,enabled,
      COALESCE((SELECT SUM(a.points) FROM answers a JOIN questions q ON a.question=q.id WHERE a.team=teams.id AND (q.closed=1 OR q.settled=1)),0)
      +COALESCE((SELECT SUM(points) FROM adjustments WHERE team=teams.id),0) score FROM teams ${includeDisabled ? '' : 'WHERE enabled=1'} ORDER BY score DESC,name`);
    let rank = 0, previous;
    return teams.map((t, i) => {if (previous !== t.score) rank = i + 1; previous = t.score; return {...t, rank, connected: !!t.enabled && (live.has(t.id) || now() - t.seen < 15000)};});
  }
  function publicScores() {
    return settings().leaderboardVisible ? scores().map(({seen, connected, enabled, ...t}) => t) : [];
  }
  function publicState() { return {serverTime: now(), settings: settings(), question: publicQuestion(latest()), teams: publicScores(), wheel: getMeta('wheel', null)}; }

  // Final scoring once answers stop: nearest-wins needs every answer before it can rank them.
  function settle(q) {
    if (!q || q.settled || pending(q)) return;
    const data = dataOf(q);
    transaction(() => {
      if (data.type === 'nearest') {
        const ranked = rankNearest(data, rows('SELECT team,value,submitted FROM answers WHERE question=? AND submitted IS NOT NULL', q.id));
        for (const r of ranked) run('UPDATE answers SET points=? WHERE team=? AND question=?', r.points, r.team, q.id);
      }
      run('UPDATE questions SET settled=1 WHERE id=?', q.id);
    });
  }
  function openQuestion(data, sourceId = null) {
    requireValue(!settings().ended, 'Quiz has finished. Resume it first.', 409);
    const current = latest();
    requireValue(!pending(current), 'Close current question first', 409);
    settle(current);
    const q = validateQuestion(data, mediaDir);
    if (sourceId) q.sourceId = sourceId;
    const result = run('INSERT INTO questions(data,opened,deadline) VALUES(?,?,?)', JSON.stringify(q), now(), now() + q.seconds * 1000);
    return {ok: true, id: Number(result.lastInsertRowid)};
  }
  function closeQuestion(q) {
    if (!q) return;
    run('UPDATE questions SET closed=1,paused_ms=NULL,agree_deadline=NULL WHERE id=?', q.id);
    settle(questionById(q.id));
  }
  function autoMark(value, data, q, teamId) {
    if (data.type === 'sheet') {
      const values = JSON.parse(value);
      const marks = data.items.map((_, i) => data.itemAnswers?.[i] ? Number(isCorrect(values[i], {type: 'text', answer: data.itemAnswers[i]})) : null);
      return {points: marks.reduce((a, b) => a + (b ?? 0), 0), marks};
    }
    const base = basePoints(value, data);
    // Only a fully right answer earns the speed bonus (every right tick for multi-tap, the first tap for pinpoint).
    if (base !== data.points || !isCorrect(value, data)) return {points: base, marks: null};
    // The bonus decays over the accepted time (a pause extends the deadline). Each team's clock starts
    // when its phone received the question, but never more than a short grace period after opening.
    const delivered = one('SELECT at FROM deliveries WHERE team=? AND question=?', teamId, q.id)?.at ?? q.opened;
    const lateness = Math.min(DELIVERY_GRACE_MS, Math.max(0, delivered - q.opened));
    const fraction = Math.min(1, Math.max(0, q.deadline - now() + lateness) / (data.seconds * 1000));
    return {points: data.points + Math.floor((data.speedBonus || 0) * fraction), marks: null};
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
        for (const t of rows('SELECT id FROM teams WHERE enabled=1 AND id<>?', active.team)) {
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
  function sendFile(req, res, location) {
    const size = statSync(location).size;
    const headers = {...security, 'Content-Type': types[path.extname(location).toLowerCase()], 'Accept-Ranges': 'bytes'};
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
        const routes = {'/host': 'host.html', '/display': 'display.html', '/app.js': 'app.js', '/host.js': 'host.js', '/client.js': 'client.js', '/sqimport.js': 'sqimport.js', '/qr.js': 'qr.js', '/style.css': 'style.css'};
        if (p.startsWith('/media/')) {
          requireValue(mediaPattern.test(p), 'Media not found', 404);
          const file = path.join(mediaDir, path.basename(p));
          requireValue(existsSync(file) && statSync(file).isFile(), 'Media not found', 404);
          return sendFile(req, res, file);
        }
        if (p === '/health') return send(200, {ok: true});
        // OS HTTP probes and arbitrary HTTP landing URLs get registration.
        return sendFile(req, res, path.join(root, routes[p] || 'player.html'));
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
          const q = latest();
          return send(200, {serverTime: now(), settings: settings(), libraryRevision: library().revision,
            teams: scores(true), question: publicQuestion(q, true), answers: rows('SELECT * FROM answers WHERE question=?', q?.id || 0),
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
          for (const k of ['registrationOpen', 'leaderboardVisible', 'ended']) if (Object.hasOwn(body, k)) {requireValue(typeof body[k] === 'boolean', 'Invalid setting'); next[k] = body[k];}
          if (Object.hasOwn(body, 'title')) {requireValue(typeof body.title === 'string' && body.title.trim() && body.title.length <= 100, 'Title must contain 1–100 characters'); next.title = body.title.trim();}
          // Shown on the projector's join screen; the Wi-Fi name should match the hotspot's --ssid.
          if (Object.hasOwn(body, 'joinSsid')) {requireValue(typeof body.joinSsid === 'string' && body.joinSsid.trim() && Buffer.byteLength(body.joinSsid.trim()) <= 32, 'Wi-Fi name must be 1–32 bytes'); next.joinSsid = body.joinSsid.trim();}
          if (Object.hasOwn(body, 'joinUrl')) {requireValue(typeof body.joinUrl === 'string' && /^https?:\/\/[^\s]{1,150}$/.test(body.joinUrl.trim()), 'Join address must start with http:// and have no spaces'); next.joinUrl = body.joinUrl.trim();}
          if (Object.hasOwn(body, 'displayMode')) {requireValue(['join', 'leaderboard', 'question', 'wheel', 'blank'].includes(body.displayMode), 'Invalid projector view'); next.displayMode = body.displayMode;}
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
          const q = questionById(body.question); requireValue(q && pending(q) && dataOf(q).type === 'bingo', 'No live bingo game', 409);
          requireValue(q.paused_ms === null, 'Resume the game first', 409);
          requireValue(!one('SELECT 1 FROM answers WHERE question=? AND points>0', q.id), 'A team has called bingo — end the game', 409);
          const called = new Set(calledNumbers(q)), remaining = Array.from({length: 90}, (_, i) => i + 1).filter(n => !called.has(n));
          requireValue(remaining.length, 'Every number has been called', 409);
          const number = remaining[randomInt(remaining.length)];
          run('INSERT INTO bingo_calls VALUES(?,?,?,?)', q.id, called.size + 1, number, now()); return send(200, {number});
        }
        if (p === '/api/host/wheel') {
          const items = body.items ?? scores().map(t => t.name);
          requireValue(Array.isArray(items) && items.length >= 2 && items.length <= 60 && items.every(i => typeof i === 'string' && i.trim() && i.length <= 60), 'The wheel needs 2–60 entries of up to 60 characters');
          const wheel = {id: (getMeta('wheel', null)?.id || 0) + 1, items: items.map(i => i.trim()), result: randomInt(items.length), spun: now()};
          setMeta('wheel', wheel); return send(200, wheel);
        }
        if (p === '/api/host/reveal') {
          const q = questionById(body.question); requireValue(q && !pending(q), 'Close question before revealing', 409);
          run('UPDATE questions SET revealed=? WHERE id=?', body.revealed === false ? 0 : 1, q.id); return send(200, {ok: true});
        }
        if (p === '/api/host/review') {
          const q = questionById(body.question); requireValue(q, 'Question not found', 404);
          return send(200, {question: publicQuestion(q, true), answers: rows('SELECT * FROM answers WHERE question=?', q.id)});
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
        if (p === '/api/host/export') return send(200, {version: 3, settings: settings(), library: library(), teams: rows('SELECT id,name,enabled FROM teams'), questions: rows('SELECT * FROM questions'), answers: rows('SELECT * FROM answers'), adjustments: rows('SELECT * FROM adjustments'), markingLog: rows('SELECT * FROM marking_log'), buzzes: rows('SELECT * FROM buzzes'), agrees: rows('SELECT * FROM agrees'), bingoCalls: rows('SELECT * FROM bingo_calls')});
        throw new QuizError('Unknown host action', 404);
      }
      if (p === '/api/join') {
        requireValue(settings().registrationOpen && !settings().ended, 'Registration is closed. Ask the quizmaster.', 409);
        requireValue(typeof body.name === 'string' && body.name.trim().length >= 2 && body.name.trim().length <= 40, 'Team name must be 2–40 characters');
        requireValue(!one('SELECT id FROM teams WHERE name=? COLLATE NOCASE', body.name.trim()), 'Name taken. Use your recovery code to reconnect.', 409);
        requireValue(one('SELECT COUNT(*) n FROM teams').n < 250, 'Team limit reached. Ask the quizmaster.', 409);
        const id = token(), secret = token(); run('INSERT INTO teams(id,name,secret,seen) VALUES(?,?,?,?)', id, body.name.trim(), secret, now()); return send(200, {id, secret});
      }
      const team = one('SELECT * FROM teams WHERE secret=?', auth || ''); requireValue(team, 'Team recovery code required', 401);
      requireValue(team.enabled, 'This team is disabled. Ask the quizmaster.', 403);
      run('UPDATE teams SET seen=? WHERE id=?', now(), team.id);
      if (p === '/api/state') {
        const q = latest();
        if (q && pending(q)) run('INSERT OR IGNORE INTO deliveries VALUES(?,?,?)', team.id, q.id, now());
        const a = q && one('SELECT value,points,marks,submitted FROM answers WHERE team=? AND question=?', team.id, q.id);
        // Points stay hidden until scoring is final.
        const answer = !a || a.submitted === null && !q.settled && !q.closed ? null : pending(q) ? {value: a.value} : {value: a.value, points: a.points, marks: a.marks};
        return send(200, {...publicState(), question: publicQuestion(q, false, team.id), team: {id: team.id, name: team.name, sound: team.sound}, answer,
          draft: one('SELECT value FROM drafts WHERE team=? AND question=?', team.id, q?.id || 0) || null});
      }
      if (p === '/api/team/sound') {
        requireValue(Number.isInteger(body.sound) && body.sound >= 0 && body.sound < SOUNDS, 'Unknown buzzer sound');
        run('UPDATE teams SET sound=? WHERE id=?', body.sound, team.id); return send(200, {ok: true});
      }
      if (p === '/api/bingo') {
        const q = latest(); requireValue(q && body.question === q.id && pending(q) && q.paused_ms === null && dataOf(q).type === 'bingo' && !settings().ended, 'No live bingo game', 409);
        requireValue(!one('SELECT 1 FROM answers WHERE team=? AND question=?', team.id, q.id), 'Already claimed', 409);
        const data = dataOf(q), called = new Set(calledNumbers(q));
        requireValue(bingoLines(bingoCard(`${team.id}:${q.id}`), called) >= bingoNeeded(data.mode), 'Not yet — keep marking your ticket', 409);
        // The first claim takes the bonus; later claims on the same call score the standard points.
        const first = !one('SELECT 1 FROM answers WHERE question=? AND points>0', q.id);
        award(team.id, q, `BINGO on call ${called.size}`, data.points + (first ? data.speedBonus : 0));
        return send(200, {ok: true, first});
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
        const data = dataOf(q); const value = answerValue(body.value, data, p === '/api/answer');
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
