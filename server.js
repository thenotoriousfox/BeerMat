import http from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes, timingSafeEqual} from 'node:crypto';
import {readFileSync, existsSync, mkdirSync, writeFileSync, statSync, createReadStream} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {QuizError, requireValue, validateQuestion, validateLibrary, matches, mediaPattern} from './model.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const token = () => randomBytes(24).toString('hex');
const equal = (a, b) => typeof a === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const types = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav'};
const security = {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; media-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"};

export function createQuiz({database = 'quiz.sqlite', hostKey, now = Date.now, mediaDir = path.join(root, 'media')} = {}) {
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
  `);
  function column(table, name, definition) {
    if (!db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  }
  column('teams', 'enabled', 'INTEGER NOT NULL DEFAULT 1');
  column('questions', 'paused_ms', 'INTEGER');
  column('questions', 'revealed', 'INTEGER NOT NULL DEFAULT 0');
  column('answers', 'submitted', 'INTEGER');
  column('answers', 'marks', 'TEXT');
  const rows = (sql, ...params) => db.prepare(sql).all(...params);
  const getMeta = (key, fallback) => {
    const value = db.prepare('SELECT value FROM metadata WHERE key=?').get(key);
    return value ? JSON.parse(value.value) : fallback;
  };
  const setMeta = (key, value) => db.prepare('INSERT INTO metadata VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value));
  const defaultSettings = {title: 'PubQuiz', registrationOpen: true, leaderboardVisible: true, displayMode: 'leaderboard', ended: false};
  const settings = () => ({...defaultSettings, ...getMeta('settings', {})});
  const library = () => getMeta('library', {revision: 0, title: 'My quiz', rounds: []});
  const latest = () => db.prepare('SELECT * FROM questions ORDER BY id DESC LIMIT 1').get();
  const questionById = id => Number.isSafeInteger(id) && id > 0 ? db.prepare('SELECT * FROM questions WHERE id=?').get(id) : null;
  const pending = q => !!q && !q.closed && (q.paused_ms !== null || now() < q.deadline);
  const accepting = q => pending(q) && q.paused_ms === null && !settings().ended;
  const sessions = new Map(); const attempts = new Map();
  function isHost(auth) {
    const expiry = sessions.get(auth);
    if (expiry && expiry > now()) return true;
    sessions.delete(auth); return false;
  }
  function publicQuestion(q, host = false) {
    if (!q) return null;
    const {answer, aliases, itemAnswers, ...safe} = JSON.parse(q.data);
    const result = {...safe, id: q.id, deadline: q.deadline, open: accepting(q), paused: pending(q) && q.paused_ms !== null,
      remaining: q.paused_ms ?? Math.max(0, q.deadline - now()), revealed: !!q.revealed};
    if (host || q.revealed) Object.assign(result, {answer, aliases: aliases || [], itemAnswers: itemAnswers || []});
    return result;
  }
  function scores(includeDisabled = false) {
    const teams = rows(`SELECT id,name,seen,enabled,
      COALESCE((SELECT SUM(a.points) FROM answers a JOIN questions q ON a.question=q.id WHERE a.team=teams.id AND (q.closed=1 OR (q.paused_ms IS NULL AND q.deadline<=?))),0)
      +COALESCE((SELECT SUM(points) FROM adjustments WHERE team=teams.id),0) score FROM teams ${includeDisabled ? '' : 'WHERE enabled=1'} ORDER BY score DESC,name`, now());
    let rank = 0, previous;
    return teams.map((t, i) => {if (previous !== t.score) rank = i + 1; previous = t.score; return {...t, rank, connected: !!t.enabled && now() - t.seen < 15000};});
  }
  function publicScores() {
    return settings().leaderboardVisible ? scores().map(({seen, connected, enabled, ...t}) => t) : [];
  }
  function publicState() { return {serverTime: now(), settings: settings(), question: publicQuestion(latest()), teams: publicScores()}; }
  function openQuestion(data, sourceId = null) {
    requireValue(!settings().ended, 'Quiz has finished. Resume it first.', 409);
    requireValue(!pending(latest()), 'Close current question first', 409);
    const q = validateQuestion(data, mediaDir);
    if (sourceId) q.sourceId = sourceId;
    const result = db.prepare('INSERT INTO questions(data,opened,deadline) VALUES(?,?,?)').run(JSON.stringify(q), now(), now() + q.seconds * 1000);
    return {ok: true, id: Number(result.lastInsertRowid)};
  }
  function answerValue(value, q, final = true) {
    if (q.type === 'sheet') {
      requireValue(Array.isArray(value) && value.length === q.items.length && value.every(x => typeof x === 'string' && x.length <= 300), 'Answer sheet must contain one answer per question');
      return JSON.stringify(value.map(x => x.trim()));
    }
    requireValue(typeof value === 'string' && value.length <= 300 && (!final || value.trim()), 'Answer must contain 1–300 characters');
    requireValue(q.type !== 'choice' || (!final && value === '') || q.options.includes(value), 'Select a valid choice');
    return value.trim();
  }
  function autoMark(value, q, current) {
    if (q.type === 'sheet') {
      const values = JSON.parse(value);
      const marks = q.items.map((_, i) => q.itemAnswers?.[i] ? Number(matches(values[i], [q.itemAnswers[i]])) : null);
      return {points: marks.reduce((a, b) => a + (b ?? 0), 0), marks};
    }
    const correct = q.answer && matches(value, [q.answer, ...(q.aliases || [])]);
    // Bonus decays against the question's accepted time; pause extends the deadline.
    return {points: correct ? q.points + Math.floor((q.speedBonus || 0) * Math.min(1, Math.max(0, current.deadline - now()) / (q.seconds * 1000))) : 0, marks: null};
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
  const server = http.createServer(async (req, res) => {
    const send = (status, data) => {res.writeHead(status, {...security, 'Content-Type': 'application/json'}); res.end(JSON.stringify(data));};
    try {
      const url = new URL(req.url, 'http://quiz.local'); const p = url.pathname;
      const auth = req.headers.authorization?.replace(/^Bearer /, '');
      if ((req.method === 'GET' || req.method === 'HEAD') && !p.startsWith('/api/')) {
        const routes = {'/host': 'host.html', '/display': 'display.html', '/app.js': 'app.js', '/host.js': 'host.js', '/client.js': 'client.js', '/style.css': 'style.css'};
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
      try {body = JSON.parse((await readBody(req, 1024 * 1024)).toString() || '{}');} catch (e) {if (e instanceof QuizError) throw e; throw new QuizError('Invalid JSON');}
      requireValue(body && typeof body === 'object' && !Array.isArray(body), 'Invalid request');
      if (p === '/api/login') {
        const ip = req.socket.remoteAddress; const a = attempts.get(ip) || {n: 0, time: now()};
        if (now() - a.time >= 60000) {a.n = 0; a.time = now();} attempts.set(ip, a);
        requireValue(++a.n <= 10, 'Wait one minute before trying again', 429);
        requireValue(equal(body.key, hostKey), 'Incorrect key', 403);
        const key = token(); sessions.set(key, now() + 12 * 60 * 60 * 1000); return send(200, {key});
      }
      if (p.startsWith('/api/host/')) {
        requireValue(isHost(auth), 'Host login required', 403);
        if (p === '/api/host/logout') {sessions.delete(auth); return send(200, {ok: true});}
        if (p === '/api/host/state') return send(200, {serverTime: now(), settings: settings(), libraryRevision: library().revision,
          teams: scores(true), question: publicQuestion(latest(), true), answers: rows('SELECT * FROM answers WHERE question=?', latest()?.id || 0),
          history: rows('SELECT * FROM questions ORDER BY id DESC LIMIT 300').map(q => publicQuestion(q, true))});
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
          if (Object.hasOwn(body, 'displayMode')) {requireValue(['leaderboard', 'question', 'blank'].includes(body.displayMode), 'Invalid projector view'); next.displayMode = body.displayMode;}
          if (next.ended) {db.prepare('UPDATE questions SET closed=1,paused_ms=NULL WHERE id=?').run(latest()?.id || 0); next.registrationOpen = false;}
          setMeta('settings', next); return send(200, next);
        }
        if (p === '/api/host/open') return send(200, openQuestion(body));
        if (p === '/api/host/start' || p === '/api/host/next') {
          requireValue(body.expectedQuestion === (latest()?.id || null), 'Current question changed; refresh before opening another', 409);
          const all = library().rounds.flatMap(r => r.questions.map(q => ({...q, round: r.title})));
          const played = new Set(rows('SELECT data FROM questions').map(q => JSON.parse(q.data).sourceId).filter(Boolean));
          const chosen = p === '/api/host/start' ? all.find(q => q.id === body.id) : all.find(q => !played.has(q.id));
          requireValue(chosen, 'No unplayed questions. Add questions or choose a saved question.', 409);
          requireValue(!played.has(chosen.id) || body.repeat === true, 'Question already played. Confirm repeat explicitly.', 409);
          return send(200, openQuestion(chosen, chosen.id));
        }
        if (['/api/host/close', '/api/host/pause', '/api/host/resume'].includes(p) && Object.hasOwn(body, 'expectedQuestion')) {
          requireValue(body.expectedQuestion === (latest()?.id || null), 'Current question changed; refresh before controlling it', 409);
        }
        if (p === '/api/host/close') {db.prepare('UPDATE questions SET closed=1,paused_ms=NULL WHERE id=?').run(latest()?.id || 0); return send(200, {ok: true});}
        if (p === '/api/host/pause') {
          const q = latest(); requireValue(accepting(q), 'No running question to pause', 409);
          db.prepare('UPDATE questions SET paused_ms=? WHERE id=?').run(q.deadline - now(), q.id); return send(200, {ok: true});
        }
        if (p === '/api/host/resume') {
          const q = latest(); requireValue(q && pending(q) && q.paused_ms !== null, 'No paused question to resume', 409);
          db.prepare('UPDATE questions SET deadline=?,paused_ms=NULL WHERE id=?').run(now() + q.paused_ms, q.id); return send(200, {ok: true});
        }
        if (p === '/api/host/reveal') {
          const q = questionById(body.question); requireValue(q && !pending(q), 'Close question before revealing', 409);
          db.prepare('UPDATE questions SET revealed=? WHERE id=?').run(body.revealed === false ? 0 : 1, q.id); return send(200, {ok: true});
        }
        if (p === '/api/host/review') {
          const q = questionById(body.question); requireValue(q, 'Question not found', 404);
          return send(200, {question: publicQuestion(q, true), answers: rows('SELECT * FROM answers WHERE question=?', q.id)});
        }
        if (p === '/api/host/mark') {
          const q = questionById(body.question); requireValue(q && !pending(q), 'Close question before marking', 409);
          const data = JSON.parse(q.data); let points = body.points; let marks = null;
          if (Object.hasOwn(body, 'marks')) {
            requireValue(data.type === 'sheet' && Array.isArray(body.marks) && body.marks.length === data.items.length && body.marks.every(m => m === 0 || m === 1), 'Each sheet item needs a zero or one mark');
            marks = body.marks; points = marks.reduce((a, b) => a + b, 0);
          }
          requireValue(Number.isInteger(points) && Math.abs(points) <= 200, 'Points must be a whole number between −200 and 200');
          requireValue(typeof body.team === 'string' && db.prepare('SELECT id FROM teams WHERE id=?').get(body.team), 'Team not found', 404);
          const previous = db.prepare('SELECT points FROM answers WHERE team=? AND question=?').get(body.team, q.id);
          // Also mark absent/delivered-on-paper answers, preserving an audit row.
          db.exec('BEGIN IMMEDIATE');
          try {
          db.prepare(`INSERT INTO answers(team,question,value,points,submitted,marks) VALUES(?,?,?,?,?,?)
            ON CONFLICT(team,question) DO UPDATE SET points=excluded.points,marks=excluded.marks`).run(body.team, q.id, data.type === 'sheet' ? JSON.stringify(data.items.map(() => '')) : '(host marked)', points, now(), marks ? JSON.stringify(marks) : null);
          db.prepare('INSERT INTO marking_log(team,question,previous_points,new_points,marks,changed) VALUES(?,?,?,?,?,?)').run(body.team, q.id, previous?.points ?? null, points, marks ? JSON.stringify(marks) : null, now());
          db.exec('COMMIT');
          } catch (e) {db.exec('ROLLBACK'); throw e;}
          return send(200, {ok: true});
        }
        if (p === '/api/host/adjust') {
          requireValue(Number.isInteger(body.points) && Math.abs(body.points) <= 100 && typeof body.reason === 'string' && body.reason.trim() && body.reason.length <= 200 && typeof body.team === 'string' && db.prepare('SELECT id FROM teams WHERE id=?').get(body.team), 'Valid team, points and reason required');
          if (body.requestId) {
            requireValue(typeof body.requestId === 'string' && /^[a-zA-Z0-9_-]{8,100}$/.test(body.requestId), 'Invalid request ID');
            const result = db.prepare('SELECT result FROM actions WHERE key=?').get(body.requestId);
            if (result) return send(200, JSON.parse(result.result));
          }
          db.exec('BEGIN IMMEDIATE');
          try {
            const result = db.prepare('INSERT INTO adjustments(team,points,reason) VALUES(?,?,?)').run(body.team, body.points, body.reason.trim());
            const response = {ok: true, id: Number(result.lastInsertRowid)};
            if (body.requestId) db.prepare('INSERT INTO actions VALUES(?,?)').run(body.requestId, JSON.stringify(response));
            db.exec('COMMIT'); return send(200, response);
          } catch (e) {db.exec('ROLLBACK'); throw e;}
        }
        if (p === '/api/host/team') {
          requireValue(typeof body.id === 'string', 'Team ID required');
          const team = db.prepare('SELECT * FROM teams WHERE id=?').get(body.id); requireValue(team, 'Team not found', 404);
          if (body.action === 'recover') {const secret = token(); db.prepare('UPDATE teams SET secret=?,seen=0 WHERE id=?').run(secret, team.id); return send(200, {secret});}
          if (body.action === 'rename') {
            requireValue(typeof body.name === 'string' && body.name.trim().length >= 2 && body.name.trim().length <= 40, 'Team name must be 2–40 characters');
            requireValue(!db.prepare('SELECT id FROM teams WHERE name=? COLLATE NOCASE AND id<>?').get(body.name.trim(), team.id), 'Team name already taken', 409);
            db.prepare('UPDATE teams SET name=? WHERE id=?').run(body.name.trim(), team.id);
          } else {
            requireValue(['disable', 'restore'].includes(body.action), 'Unknown team action');
            db.prepare('UPDATE teams SET enabled=? WHERE id=?').run(Number(body.action === 'restore'), team.id);
          }
          return send(200, {ok: true});
        }
        if (p === '/api/host/export') return send(200, {version: 2, settings: settings(), library: library(), teams: rows('SELECT id,name,enabled FROM teams'), questions: rows('SELECT * FROM questions'), answers: rows('SELECT * FROM answers'), adjustments: rows('SELECT * FROM adjustments'), markingLog: rows('SELECT * FROM marking_log')});
        throw new QuizError('Unknown host action', 404);
      }
      if (p === '/api/join') {
        requireValue(settings().registrationOpen && !settings().ended, 'Registration is closed. Ask the quizmaster.', 409);
        requireValue(typeof body.name === 'string' && body.name.trim().length >= 2 && body.name.trim().length <= 40, 'Team name must be 2–40 characters');
        requireValue(!db.prepare('SELECT id FROM teams WHERE name=? COLLATE NOCASE').get(body.name.trim()), 'Name taken. Use your recovery code to reconnect.', 409);
        requireValue(rows('SELECT id FROM teams').length < 250, 'Team limit reached. Ask the quizmaster.', 409);
        const id = token(), secret = token(); db.prepare('INSERT INTO teams(id,name,secret,seen) VALUES(?,?,?,?)').run(id, body.name.trim(), secret, now()); return send(200, {id, secret});
      }
      const team = db.prepare('SELECT * FROM teams WHERE secret=?').get(auth || ''); requireValue(team, 'Team recovery code required', 401);
      requireValue(team.enabled, 'This team is disabled. Ask the quizmaster.', 403);
      db.prepare('UPDATE teams SET seen=? WHERE id=?').run(now(), team.id);
      if (p === '/api/state') {
        const q = latest();
        return send(200, {...publicState(), team: {id: team.id, name: team.name}, answer: db.prepare('SELECT value,points,marks FROM answers WHERE team=? AND question=?').get(team.id, q?.id || 0) ? (() => {
          const a = db.prepare('SELECT value,points,marks FROM answers WHERE team=? AND question=?').get(team.id, q.id);
          return pending(q) ? {value: a.value} : a;
        })() : null, draft: db.prepare('SELECT value FROM drafts WHERE team=? AND question=?').get(team.id, q?.id || 0) || null});
      }
      if (p === '/api/answer' || p === '/api/draft') {
        const q = latest(); requireValue(q && body.question === q.id && accepting(q), 'Question closed, paused or outdated', 409);
        const data = JSON.parse(q.data); const value = answerValue(body.value, data, p === '/api/answer');
        requireValue(!db.prepare('SELECT 1 FROM answers WHERE team=? AND question=?').get(team.id, q.id), 'Already submitted', 409);
        if (p === '/api/draft') {
          db.prepare('INSERT INTO drafts VALUES(?,?,?) ON CONFLICT(team,question) DO UPDATE SET value=excluded.value').run(team.id, q.id, value); return send(200, {ok: true});
        }
        const marked = autoMark(value, data, q);
        db.prepare('INSERT INTO answers(team,question,value,points,submitted,marks) VALUES(?,?,?,?,?,?)').run(team.id, q.id, value, marked.points, now(), marked.marks ? JSON.stringify(marked.marks) : null);
        db.prepare('DELETE FROM drafts WHERE team=? AND question=?').run(team.id, q.id); return send(200, {ok: true});
      }
      throw new QuizError('Unknown action', 404);
    } catch (e) {
      if (res.headersSent) return res.destroy();
      if (!(e instanceof QuizError)) console.error(e);
      send(e.status || 500, {error: e instanceof QuizError ? e.message : 'Server error. Check the server terminal.'});
    }
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  return {server, db, close: () => new Promise(resolve => server.close(() => {db.close(); resolve();}))};
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const quiz = createQuiz({hostKey: process.env.HOST_KEY, database: process.env.QUIZ_DB || path.join(root, 'quiz.sqlite')});
  quiz.server.listen(Number(process.env.PORT || 3000), process.env.BIND || '0.0.0.0', () => console.log('PubQuiz ready. Quizmaster: http://localhost:' + (process.env.PORT || 3000) + '/host'));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => quiz.close().then(() => process.exit(0)));
}
