// BeerMat Online's TV page (/tv): a TV signs in once by QR code, approved on a phone signed in to the account
// (/connect#tv=…), and keeps a device token. Then, each time, it asks which of the account's laptops is running a quiz,
// gets a ticket for it, and opens that laptop's TV page (its address on this network, or its quizmaster link). The
// laptop's TV page comes back here when it loses the laptop. BeerMat TV (Android TV) opens this page too (?app=1).
import {qrMatrix} from './qr.js';
import {$, say, api, store, stored, ticketParam, reachable, choices} from './link.js';

const DEVICE = 'beermat-tv-device';
let timer = null;
const wait = (fn, ms) => {clearTimeout(timer); timer = setTimeout(fn, ms);};
const show = id => {for (const s of ['pair', 'pick']) $(s).hidden = s !== id;};

function drawQr(text) {
  const rows = qrMatrix(text), size = rows.length + 8, ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg'); svg.setAttribute('viewBox', `0 0 ${size} ${size}`); svg.setAttribute('shape-rendering', 'crispEdges');
  const back = document.createElementNS(ns, 'rect'); back.setAttribute('width', size); back.setAttribute('height', size); back.setAttribute('fill', '#fff'); svg.append(back);
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', rows.flatMap((row, y) => row.map((dark, x) => dark ? `M${x + 4} ${y + 4}h1v1h-1z` : '')).join(''));
  svg.append(path); $('qr').replaceChildren(svg);
}

async function pair() {
  show('pair'); $('forget').hidden = true;
  try {
    const {code} = await api('POST', '/v1/tv-pairings', {name: 'TV'});
    drawQr(`${location.origin}/connect#tv=${code}`);
    say('Waiting for your phone…');
    const poll = async () => {
      try {
        const reply = await api('GET', '/v1/tv-pairings/' + code);
        if (reply.device) {store(DEVICE, reply.device); return connect();}
        wait(poll, 2000);
      } catch (e) {if (e.status === 404) pair(); else wait(poll, 5000);}
    };
    wait(poll, 2000);
  } catch (e) {say(e.message, true); wait(pair, 10000);}
}

async function connect() {
  const device = stored(DEVICE);
  if (!device) return pair();
  $('forget').hidden = false;
  try {
    const {account, desks} = await api('POST', '/v1/tv/connect', {device});
    if (!desks.length) {show(null); say(`No quiz laptop is open on ${account}’s account. Open BeerMat on the laptop, signed in to BeerMat Online.`); return wait(connect, 10000);}
    if (desks.length === 1) return open(desks[0]);
    show('pick'); say('');
    choices($('laptops'), desks, open);
  } catch (e) {
    if (e.status === 401) {store(DEVICE, null); return pair();}
    say(e.message, true); wait(connect, 10000);
  }
}

async function open(laptop) {
  show(null); say(`Opening ${laptop.title || 'the quiz'} on ${laptop.name}…`);
  const base = await reachable(laptop);
  if (!base) {say(`${laptop.name} can’t be reached: it has no quizmaster link yet. Check the laptop is on the internet.`, true); return wait(connect, 10000);}
  location.href = `${base}/tv${location.search}#ticket=${ticketParam(laptop.ticket)}&back=${encodeURIComponent(location.origin + '/tv' + location.search)}`;
}

$('forget').onclick = () => {store(DEVICE, null); pair();};
connect();
