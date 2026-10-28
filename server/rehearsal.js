// Rehearsal teams: simulated players that take part through the quiz server's own player routes, exactly as phones do.
// They join with /api/join (carrying a one-time token only this process knows, so no phone can pass for one), keep an
// event stream open while "connected", read /api/state and answer with /api/answer, /api/buzz and /api/agree. The
// server validates, times and scores everything they send as it would a phone's; nothing here sets a score.
//
// The simulator is told each question's private details (the answer) by the server it runs in, so it can choose to be
// right or wrong. It never has more say than that: a right answer still has to pass the server's checks.
import http from 'node:http';

export const SIM_NAMES = ['The Quizzly Bears', 'Les Quizerables', 'Agatha Quiztie', 'Universally Challenged', 'Tequila Mockingbird', 'Quiz Team Aguilera',
  'Sherlock Ohms', 'The Know-It-Ales', 'Quizteama Aguilera', 'Mr Quizzard', 'E=MC Hammered', 'The Pun Intended', 'Trivia Newton John', 'Bad Decisions',
  'The Smarty Pints', 'Norfolk Enchants', 'Spinal Tapas', 'Les Mis-Steaks', 'The Brew-niversity', 'Big Quiz Energy', 'Quiz in My Pants', 'The Beer Necessities',
  'Ctrl Alt Defeat', 'Risky Quizness', 'The Leftovers', 'Pop Pickers', 'The Mighty Quiz', 'Lord of the Pints', 'Kiss My Quiz', 'Brains Not Included'];
export const MAX_SIM_TEAMS = 30;
// Accelerated timers: a question's time is cut to a third (at least 5 seconds).
export const fastSeconds = seconds => Math.max(5, Math.ceil(seconds / 3));

export const defaultOptions = {teams: 6, auto: true, accuracy: 0.6, speed: 'normal', disconnects: false, buzzers: true, phones: true};
export function cleanOptions(input = {}) {
  const o = {...defaultOptions, ...input};
  const teams = Number.isInteger(o.teams) ? Math.min(MAX_SIM_TEAMS, Math.max(0, o.teams)) : defaultOptions.teams;
  const accuracy = typeof o.accuracy === 'number' && o.accuracy >= 0 && o.accuracy <= 1 ? o.accuracy : defaultOptions.accuracy;
  return {teams, auto: o.auto !== false, accuracy, speed: o.speed === 'fast' ? 'fast' : 'normal', disconnects: o.disconnects === true, buzzers: o.buzzers !== false, phones: o.phones !== false};
}

// A value a team would send for this question: right (when it can work one out) or wrong, in the shape the server expects.
export function answerFor(q, right, random = Math.random) {
  const pick = list => list[Math.floor(random() * list.length)];
  const shuffle = list => {const a = [...list]; for (let i = a.length - 1; i > 0; i--) {const j = Math.floor(random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]];} return a;};
  switch (q.type) {
    case 'choice': return right && q.options.includes(q.answer) ? q.answer : pick(q.options.filter(o => o !== q.answer).length ? q.options.filter(o => o !== q.answer) : q.options);
    case 'vote': return pick(q.options);
    case 'multi': return right ? [...q.correct] : [pick(q.options)];
    case 'letter': return right && /^[a-z]$/i.test(String(q.answer).trim()) ? String(q.answer).trim() : pick('QXZJVKWY'.split(''));
    case 'number': case 'nearest': {
      const n = Number(q.answer);
      if (!Number.isFinite(n)) return String(Math.floor(random() * 100));
      return String(right ? (q.type === 'nearest' ? Math.round(n + (random() - .5) * Math.max(2, Math.abs(n) * .05)) : n) : Math.round(n + (random() < .5 ? -1 : 1) * Math.max(1, Math.abs(n) * (.1 + random() * .5))));
    }
    case 'sequence': {const order = q.items.map((_, i) => i); return right ? order : shuffle(order).sort(() => random() - .5);}
    case 'tiles': {
      // The tiles in the right order are the pieces, in turn, that spell the answer.
      if (right) {const used = new Set(); return q.tiles.map(t => {const i = q.pieces.findIndex((p, j) => p === t && !used.has(j)); used.add(i); return i;});}
      return shuffle(q.pieces.map((_, i) => i));
    }
    case 'wordsnake': return right ? [...q.snake.path] : q.snake.path.slice(0, Math.max(1, q.snake.path.length - 1));
    case 'pinpoint': {
      const t = q.target;
      if (right) return [[t.x, t.y]];
      const far = v => (v + .5) % 1;
      return [[Math.min(1, Math.max(0, far(t.x))), Math.min(1, Math.max(0, far(t.y)))]];
    }
    case 'sheet': return q.items.map((_, i) => right && q.itemAnswers?.[i] ? q.itemAnswers[i] : `Guess ${i + 1}`);
    case 'text': case 'picture': case 'audio': return right && q.answer ? String(q.answer) : pick(['No idea', 'Pass', 'Something else', 'Banana']);
    default: return null; // buzzer, bingo, music bingo and sound clips have their own buttons
  }
}

// Plain HTTP to the quiz server, as a phone (no Origin header, like a native client).
function request(port, method, route, body, key = '') {
  return new Promise(resolve => {
    const data = body === undefined ? '' : JSON.stringify(body);
    const req = http.request({host: '127.0.0.1', port, method, path: route, headers: {'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...(key && {Authorization: 'Bearer ' + key})}, timeout: 10000}, res => {
      let text = ''; res.setEncoding('utf8'); res.on('data', c => {text += c;});
      res.on('end', () => {let json = {}; try {json = JSON.parse(text);} catch {} resolve({status: res.statusCode, ...json});});
    });
    req.on('error', e => resolve({status: 0, error: e.message}));
    req.on('timeout', () => req.destroy(Error('timed out')));
    req.end(data);
  });
}

export function createSimulator({port, privateQuestion, joinToken, options, log = () => {}, random = Math.random, setTimer = setTimeout, clearTimer = clearTimeout}) {
  const teams = new Map(); // name -> {name, secret, connected, stream, manual}
  const timers = new Set();
  let stopped = false, seenQuestion = null;
  const later = (ms, fn) => {const t = setTimer(() => {timers.delete(t); if (!stopped) fn();}, ms); timers.add(t); return t;};
  const record = (team, action, result) => log({at: Date.now(), team: team.name, action, ok: result.status >= 200 && result.status < 300, detail: result.error || ''});

  // The team's live connection: an event stream to the server, as a phone keeps open.
  function connect(team) {
    if (team.stream || stopped) return;
    const req = http.get({host: '127.0.0.1', port, path: '/api/events?key=' + encodeURIComponent(team.secret), headers: {Accept: 'text/event-stream'}}, res => res.resume());
    req.on('error', () => {});
    team.stream = req; team.connected = true;
  }
  function disconnect(team) {team.stream?.destroy(); team.stream = null; team.connected = false;}

  async function join(name) {
    const result = await request(port, 'POST', '/api/join', {name, simToken: joinToken()});
    if (!result.secret) {log({at: Date.now(), team: name, action: 'join', ok: false, detail: result.error || 'no answer'}); return null;}
    const team = {name, secret: result.secret, connected: false, stream: null, manual: false};
    teams.set(name, team); connect(team); record(team, 'join', result);
    return team;
  }

  // What a team does when a question opens: answer (right or wrong) after a while, sometimes too late, sometimes not at all.
  function onQuestion(q) {
    if (!options.auto) return;
    const ms = Math.max(1000, q.deadline - Date.now());
    for (const team of teams.values()) {
      if (team.manual) continue;
      if (q.type === 'buzzer') {
        if (options.buzzers && random() < .5) later(400 + random() * Math.min(ms, 8000), () => act(team, 'buzz'));
        continue;
      }
      if (['bingo', 'musicbingo', 'clips'].includes(q.type)) continue;
      const roll = random();
      if (roll < .08) continue; // no answer this time
      const late = roll > .95;
      const delay = late ? ms + 500 + random() * 1500 : 600 + Math.pow(random(), 1.6) * ms * .85;
      later(delay, () => act(team, random() < options.accuracy ? 'right' : 'wrong'));
    }
    if (options.disconnects) for (const team of teams.values()) if (random() < .15) {
      later(random() * ms * .5, () => {disconnect(team); log({at: Date.now(), team: team.name, action: 'disconnect', ok: true, detail: 'simulated'});
        later(4000 + random() * 8000, () => {connect(team); log({at: Date.now(), team: team.name, action: 'reconnect', ok: true, detail: 'simulated'});});});
    }
  }

  // One thing a team does, through the player routes. Returns the server's answer.
  async function act(team, action) {
    const q = privateQuestion();
    if (!q && !['disconnect', 'reconnect'].includes(action)) {const r = {status: 409, error: 'No question open'}; record(team, action, r); return r;}
    let result;
    if (action === 'disconnect') {disconnect(team); result = {status: 200};}
    else if (action === 'reconnect') {connect(team); result = {status: 200};}
    else if (action === 'buzz') result = await request(port, 'POST', '/api/buzz', {question: q.id}, team.secret);
    else if (action === 'agree') result = await request(port, 'POST', '/api/agree', {question: q.id}, team.secret);
    else if (action === 'invalid') result = await request(port, 'POST', '/api/answer', {question: q.id, value: {not: 'an answer'}}, team.secret);
    else if (action === 'stale') result = await request(port, 'POST', '/api/answer', {question: q.id - 1, value: answerFor(q, true, random) ?? ''}, team.secret);
    else {
      const value = answerFor(q, action !== 'wrong', random);
      if (value === null) result = {status: 409, error: 'This format uses buttons, not an answer'};
      else {
        result = await request(port, 'POST', '/api/answer', {question: q.id, value}, team.secret);
        // A second send of the same answer, to test that it counts once.
        if (action === 'duplicate') result = await request(port, 'POST', '/api/answer', {question: q.id, value}, team.secret);
      }
    }
    record(team, action, result);
    return result;
  }

  return {
    async start(count) {for (const name of SIM_NAMES.slice(0, Math.min(MAX_SIM_TEAMS, count))) await join(name);},
    // After a restart: the rehearsal teams already in the quiz carry on.
    adopt(existing) {for (const {name, secret} of existing) if (!teams.has(name)) {const team = {name, secret, connected: false, stream: null, manual: false}; teams.set(name, team); connect(team);}},
    // Called whenever the quiz changes; acts once per new question.
    update() {const q = privateQuestion(); if (q && q.open && q.id !== seenQuestion) {seenQuestion = q.id; onQuestion(q);}},
    act(name, action) {const team = teams.get(name); if (!team) return Promise.resolve({status: 404, error: 'No such rehearsal team'}); return act(team, action);},
    setManual(name, manual) {const team = teams.get(name); if (team) team.manual = !!manual;},
    teams: () => [...teams.values()].map(({name, connected, manual}) => ({name, connected, manual})),
    secretOf: name => teams.get(name)?.secret ?? null,
    stop() {stopped = true; for (const t of timers) clearTimer(t); timers.clear(); for (const team of teams.values()) disconnect(team);},
  };
}
