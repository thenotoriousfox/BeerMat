// Turning what the player scans or types into a quiz address. Plain functions, tested in Node (tests/mobile.test.js).
// The app opens the quiz's own player page, the same one phone browsers use, so app and browser teams play the
// same quiz side by side.

// The quiz hotspot's address: Linux (BeerMat's own hotspot) answers on port 80; Windows' Mobile Hotspot on the
// app's usual port.
export const hotspotCandidates = ['http://10.42.0.1', 'http://192.168.137.1:3000'];

// A quiz address from a link, an IP with or without a port, or a pubquiz://join?url= link. Only http(s), no
// passwords in the address, and nothing but the site itself (the player page is always /).
export function normaliseAddress(input) {
  let text = String(input || '').trim();
  if (!text) throw Error('Type the address shown on the TV');
  const deep = /^pubquiz:\/\/join\?url=(.+)$/i.exec(text);
  if (deep) text = decodeURIComponent(deep[1]);
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = 'http://' + text;
  let url;
  try {url = new URL(text);} catch {throw Error('That doesn’t look like a quiz address');}
  if (!['http:', 'https:'].includes(url.protocol)) throw Error('Quiz addresses start with http:// or https://');
  if (url.username || url.password) throw Error('That doesn’t look like a quiz address');
  if (!url.hostname || /\s/.test(url.hostname)) throw Error('That doesn’t look like a quiz address');
  return url.origin;
}

// Wi-Fi codes (WIFI:T:WPA;S:name;P:password;;) with \-escapes.
function wifiFields(text) {
  const fields = {}; let key = '', value = '', inValue = false;
  for (let i = 5; i < text.length; i++) {
    const c = text[i];
    if (c === '\\' && i + 1 < text.length) {(inValue ? (value += text[++i]) : (key += text[++i])); continue;}
    if (!inValue && c === ':') {inValue = true; continue;}
    if (inValue && c === ';') {fields[key] = value; key = ''; value = ''; inValue = false; continue;}
    if (inValue) value += c; else key += c;
  }
  return fields;
}

// What the TV's code says: a quiz address (venue Wi-Fi, online link, or the hotspot's second code), or the quiz
// Wi-Fi itself, after which the phone has to be on that Wi-Fi before the quiz can open.
export function parseScan(text) {
  const raw = String(text || '').trim();
  if (/^WIFI:/i.test(raw)) {
    const f = wifiFields(raw);
    if (!f.S) return {type: 'invalid', reason: 'That Wi-Fi code has no network name'};
    return {type: 'wifi', ssid: f.S, password: f.P || '', open: !f.T || /^nopass$/i.test(f.T), candidates: hotspotCandidates};
  }
  try {return {type: 'quiz', url: normaliseAddress(raw)};}
  catch (e) {return {type: 'invalid', reason: 'That code isn’t a BeerMat code'};}
}

// Results handed over by the quiz page (#claim=<base64url JSON>).
export function readClaim(hash) {
  const m = /[#&]claim=([A-Za-z0-9_-]+)/.exec(hash || '');
  if (!m) return null;
  try {
    const b64 = m[1].replace(/-/g, '+').replace(/_/g, '/'), bytes = Uint8Array.from(atob(b64 + '='.repeat((4 - b64.length % 4) % 4)), c => c.charCodeAt(0));
    const claim = JSON.parse(new TextDecoder().decode(bytes));
    return claim && claim.kind === 'pubquiz.result' && typeof claim.sig === 'string' ? claim : null;
  } catch {return null;}
}

// Recently played quizzes, newest first, at most eight.
export function remember(list, url, title, now = Date.now()) {
  return [{url, title: title || '', at: now}, ...list.filter(r => r.url !== url)].slice(0, 8);
}

// A calendar file for quizzes when the phone has no reminder support (and in the web app).
export function calendarFile(event) {
  const stamp = t => new Date(t).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const esc = s => String(s || '').replace(/[\\;,]/g, m => '\\' + m).replace(/\n/g, '\\n');
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//BeerMat//App//EN', 'BEGIN:VEVENT', `UID:${event.id}@beermat`, `DTSTAMP:${stamp(Date.now())}`,
    `DTSTART:${stamp(event.startsAt)}`, `DTEND:${stamp(event.startsAt + 2 * 3600000)}`, `SUMMARY:${esc(event.title)} — ${esc(event.venue.name)}`,
    `LOCATION:${esc([event.venue.address, event.venue.town, event.venue.postcode].filter(Boolean).join(', '))}`, `DESCRIPTION:${esc([event.format, event.entry].filter(Boolean).join('. '))}`,
    'BEGIN:VALARM', 'TRIGGER:-PT2H', 'ACTION:DISPLAY', `DESCRIPTION:${esc(event.title)}`, 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
}
