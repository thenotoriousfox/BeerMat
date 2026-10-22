// Minimal QR code encoder (ISO/IEC 18004): byte mode, error correction level M, versions 1–10
// (up to 213 bytes). Runs offline in the browser; returns rows of booleans (true = dark).
const BLOCKS = [null, [10, [1, 16]], [16, [1, 28]], [26, [1, 44]], [18, [2, 32]], [24, [2, 43]], [16, [4, 27]], [18, [4, 31]],
  [22, [2, 38], [2, 39]], [22, [3, 36], [2, 37]], [26, [4, 43], [1, 44]]]; // [EC codewords per block, [blocks, data codewords]...]
const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
const EXP = new Array(512), LOG = new Array(256);
for (let i = 0, x = 1; i < 255; i++) {EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11d;}
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
const mul = (a, b) => a && b ? EXP[LOG[a] + LOG[b]] : 0;

function reedSolomon(data, degree) {
  let gen = [1]; // product of (x - α^i), highest power first
  for (let i = 0; i < degree; i++) {
    const next = [...gen, 0];
    for (let j = 1; j < next.length; j++) next[j] ^= mul(gen[j - 1], EXP[i]);
    gen = next;
  }
  const rem = new Array(degree).fill(0);
  for (const byte of data) {
    const factor = byte ^ rem.shift(); rem.push(0);
    for (let j = 0; j < degree; j++) rem[j] ^= mul(gen[j + 1], factor);
  }
  return rem;
}

function codewords(bytes) {
  const version = BLOCKS.findIndex((b, v) => b && b.slice(1).reduce((n, [count, size]) => n + count * size, 0) * 8 >= 4 + (v < 10 ? 8 : 16) + bytes.length * 8);
  if (version < 1) throw Error('Text too long for a QR code');
  const [ec, ...groups] = BLOCKS[version], capacity = groups.reduce((n, [count, size]) => n + count * size, 0) * 8;
  const bits = [];
  const put = (value, length) => {for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);};
  put(4, 4); put(bytes.length, version < 10 ? 8 : 16); bytes.forEach(b => put(b, 8));
  put(0, Math.min(4, capacity - bits.length)); while (bits.length % 8) bits.push(0);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) put(pad, 8);
  const data = []; for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  const blocks = []; let offset = 0;
  for (const [count, size] of groups) for (let i = 0; i < count; i++) {const block = data.slice(offset, offset += size); blocks.push({data: block, ec: reedSolomon(block, ec)});}
  const out = [];
  for (let i = 0; i < Math.max(...blocks.map(b => b.data.length)); i++) for (const b of blocks) if (i < b.data.length) out.push(b.data[i]);
  for (let i = 0; i < ec; i++) for (const b of blocks) out.push(b.ec[i]);
  return {version, out};
}

const MASKS = [(r, c) => (r + c) % 2 === 0, r => r % 2 === 0, (r, c) => c % 3 === 0, (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0, (r, c) => r * c % 2 + r * c % 3 === 0,
  (r, c) => (r * c % 2 + r * c % 3) % 2 === 0, (r, c) => ((r + c) % 2 + r * c % 3) % 2 === 0];

function penalty(m) {
  const n = m.length; let score = 0, dark = 0;
  const lines = [...m, ...m.map((_, c) => m.map(row => row[c]))];
  for (const line of lines) {
    let run = 1;
    for (let i = 1; i <= n; i++) {
      if (i < n && line[i] === line[i - 1]) run++;
      else {if (run >= 5) score += run - 2; run = 1;}
    }
    const s = line.map(Number).join('');
    for (const pattern of ['10111010000', '00001011101']) for (let i = s.indexOf(pattern); i >= 0; i = s.indexOf(pattern, i + 1)) score += 40;
  }
  for (let r = 0; r < n - 1; r++) for (let c = 0; c < n - 1; c++) {
    const v = m[r][c]; if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) score += 3;
  }
  m.forEach(row => row.forEach(v => {dark += v;}));
  return score + 10 * Math.floor(Math.abs(dark * 100 / (n * n) - 50) / 5);
}

export function qrMatrix(text) {
  const {version, out} = codewords([...new TextEncoder().encode(text)]);
  const n = version * 4 + 17, base = Array.from({length: n}, () => Array(n).fill(false)), fixed = Array.from({length: n}, () => Array(n).fill(false));
  const set = (r, c, dark, m = base) => {if (r >= 0 && c >= 0 && r < n && c < n) {m[r][c] = dark; fixed[r][c] = true;}};
  for (const [r0, c0] of [[0, 0], [0, n - 7], [n - 7, 0]]) for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) {
    const edge = Math.max(Math.abs(r - 3), Math.abs(c - 3)); set(r0 + r, c0 + c, edge !== 2 && edge !== 4);
  }
  for (let i = 8; i < n - 8; i++) {set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0);}
  const centres = ALIGN[version];
  const last = centres.length - 1;
  centres.forEach((r, i) => centres.forEach((c, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return; // finder corners
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
  }));
  // Format information: level M (00) plus the mask number, BCH-protected, in two copies.
  const format = (mask, m = base) => {
    let rem = mask; for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((mask << 10) | rem) ^ 0x5412, bit = i => ((bits >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) set(i, 8, bit(i), m);
    set(7, 8, bit(6), m); set(8, 8, bit(7), m); set(8, 7, bit(8), m);
    for (let i = 9; i < 15; i++) set(8, 14 - i, bit(i), m);
    for (let i = 0; i < 8; i++) set(8, n - 1 - i, bit(i), m);
    for (let i = 8; i < 15; i++) set(n - 15 + i, 8, bit(i), m);
    set(n - 8, 8, true, m);
  };
  format(0);
  if (version >= 7) {
    let rem = version; for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {const dark = ((bits >>> i) & 1) === 1, a = n - 11 + i % 3, b = Math.floor(i / 3); set(b, a, dark); set(a, b, dark);}
  }
  const dataBits = out.flatMap(byte => Array.from({length: 8}, (_, i) => (byte >>> (7 - i)) & 1));
  let k = 0;
  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < n; vert++) for (let j = 0; j < 2; j++) {
      const c = right - j, upward = ((right + 1) & 2) === 0, r = upward ? n - 1 - vert : vert;
      if (!fixed[r][c]) base[r][c] = dataBits[k++] === 1;
    }
  }
  let best = null;
  for (let mask = 0; mask < 8; mask++) {
    const m = base.map((row, r) => row.map((v, c) => fixed[r][c] ? v : v !== MASKS[mask](r, c)));
    format(mask, m);
    const score = penalty(m);
    if (!best || score < best.score) best = {score, m};
  }
  return best.m;
}

// A Wi-Fi joining code for an open network; phones offer to connect when they scan it.
const wifiEscape = text => text.replace(/([\\;,:"])/g, '\\$1');
// An open network, or WPA with its password (Windows' Mobile Hotspot always has one).
export const wifiCode = (ssid, password = '') => password ? `WIFI:T:WPA;S:${wifiEscape(ssid)};P:${wifiEscape(password)};;` : `WIFI:T:nopass;S:${wifiEscape(ssid)};;`;
