// PubQuiz Online's admin console: venues, accounts and an overview, through the admin API (online/service.js).
// The session token is kept for this browser tab only.
const $ = id => document.getElementById(id);
const el = (tag, text, className) => {const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (className) e.className = className; return e;};
const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const cap = d => d[0].toUpperCase() + d.slice(1);
const clock = t => {const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}${m ? ':' + String(m).padStart(2, '0') : ''}${h < 12 ? 'am' : 'pm'}`;};
const nights = list => list.map(n => `${cap(n.day).slice(0, 3)} ${clock(n.time)}`).join(', ');
const when = t => new Date(t).toLocaleString(undefined, {weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'});
const date = t => new Date(t).toLocaleDateString(undefined, {day: 'numeric', month: 'short', year: 'numeric'});
const ago = t => {const m = Math.round((Date.now() - t) / 60000); return m < 2 ? 'just now' : m < 120 ? `${m} minutes ago` : m < 2880 ? `${Math.round(m / 60)} hours ago` : `${Math.round(m / 1440)} days ago`;};

let token = sessionStorage.getItem('pq-admin') || '', venues = [], editing = null;
function toast(text, error = false) {
  $('toast').textContent = text; $('toast').classList.toggle('error', error); $('toast').hidden = false;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => {$('toast').hidden = true;}, error ? 6000 : 3000);
}
async function api(method, route, body) {
  const res = await fetch(route, {method, headers: {'Content-Type': 'application/json', ...(token ? {Authorization: 'Bearer ' + token} : {})}, ...(body === undefined ? {} : {body: JSON.stringify(body)})});
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) signedOut();
  if (!res.ok) throw Error(data.error || `The server said ${res.status}`);
  return data;
}
// Runs an action, showing its error, or `done` when it worked (a handler returning false was called off).
const guarded = (fn, done) => async e => {e?.preventDefault?.(); try {if (await fn(e) !== false && done) toast(done);} catch (error) {toast(error.message, true);}};

// ---- Signing in ----
function signedOut() {token = ''; sessionStorage.removeItem('pq-admin'); $('signIn').hidden = false; $('console').hidden = true; $('who').hidden = true;}
async function start() {
  if (!token) return signedOut();
  let me;
  try {me = await api('GET', '/v1/me');} catch {return signedOut();}
  if (!me.admin) {toast('That account isn’t an admin.', true); await api('DELETE', '/v1/sessions').catch(() => {}); return signedOut();}
  $('whoName').textContent = `${me.displayName} · ${me.email}`; $('who').hidden = false;
  $('signIn').hidden = true; $('console').hidden = false;
  show(location.hash.slice(1) || 'overview');
}
$('signInForm').onsubmit = guarded(async () => {
  const {token: t} = await api('POST', '/v1/sessions', {email: $('email').value, password: $('password').value});
  token = t; sessionStorage.setItem('pq-admin', t); $('password').value = ''; await start();
});
$('signOut').onclick = guarded(async () => {await api('DELETE', '/v1/sessions').catch(() => {}); signedOut();});

// ---- Tabs ----
function show(tab) {
  if (!['overview', 'venues', 'accounts'].includes(tab)) tab = 'overview';
  for (const b of document.querySelectorAll('.tabs button')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
  for (const s of document.querySelectorAll('.tab')) s.hidden = s.id !== tab;
  history.replaceState(null, '', '#' + tab);
  ({overview: loadOverview, venues: loadVenues, accounts: loadAccounts})[tab]().catch(e => toast(e.message, true));
}
for (const b of document.querySelectorAll('.tabs button')) b.onclick = () => show(b.dataset.tab);

// ---- Overview ----
async function loadOverview() {
  const o = await api('GET', '/v1/admin/overview');
  const tile = (n, label, note) => {const d = el('div', undefined, 'stat'); d.append(el('strong', String(n)), el('span', label)); if (note) d.append(el('small', note)); return d;};
  $('stats').replaceChildren(
    tile(o.venues, 'venues', `${o.verifiedVenues} verified · ${o.operatedVenues} with an operator · ${o.mappedVenues} on the map`),
    tile(o.upcoming, 'quizzes in the next 7 days'),
    tile(o.accounts, 'accounts', `${o.newAccounts} new this week · ${o.admins} admin${o.admins === 1 ? '' : 's'}`),
    tile(o.results, 'results kept by players'),
    tile(o.laptops, 'quiz laptops registered', `${o.venueResults} quizzes shared`));
  const backupOld = !o.lastBackup || Date.now() - o.lastBackup > 36 * 3600000;
  const facts = [['Running since', `${when(o.startedAt)} (${ago(o.startedAt)})`], ['Database', o.databaseBytes === null ? '—' : `${(o.databaseBytes / 1048576).toFixed(1)} MB`],
    ['Last backup', o.lastBackup ? `${when(o.lastBackup)} (${ago(o.lastBackup)})` : 'none found']];
  $('health').replaceChildren(...facts.flatMap(([k, v]) => [el('dt', k), el('dd', v, k === 'Last backup' && backupOld ? 'warn' : undefined)]));
}

// ---- Venues ----
async function loadVenues() {
  venues = (await api('GET', '/v1/admin/venues')).venues;
  renderVenues();
  if (editing) {const fresh = venues.find(v => v.id === editing.id); if (fresh) fillExtras(fresh);}
}
function renderVenues() {
  const find = $('venueSearch').value.trim().toLowerCase(), filter = $('venueFilter').value;
  const shown = venues.filter(v => (!find || `${v.name} ${v.town} ${v.postcode} ${v.id}`.toLowerCase().includes(find))
    && (filter !== 'unverified' || !v.verified) && (filter !== 'nooperator' || !v.operator) && (filter !== 'unmapped' || v.lat === null) && (filter !== 'nonights' || !v.quizNights.length));
  $('venueRows').replaceChildren(...shown.map(v => {
    const tr = el('tr'), name = el('td');
    name.append(el('strong', v.name), el('span', ` ${v.town}${v.postcode ? ', ' + v.postcode : ''}`, 'muted'));
    if (v.verified) name.append(el('span', '✓ verified', 'badge good'));
    if (v.lat === null) name.append(el('span', 'not on map', 'badge warn'));
    const edit = el('button', 'Open', 'ghost'); edit.type = 'button'; edit.onclick = () => openVenue(v);
    const action = el('td'); action.append(edit);
    tr.append(name, el('td', v.quizNights.length ? nights(v.quizNights) : '—'), el('td', v.operator ? v.operator.email : '—', v.operator ? undefined : 'muted'),
      el('td', v.upcoming[0] ? when(v.upcoming[0].startsAt) : '—'), el('td', String(v.laptops.length)), action);
    tr.ondblclick = () => openVenue(v);
    return tr;
  }));
  $('venuesEmpty').hidden = shown.length > 0;
}
$('venueSearch').oninput = renderVenues; $('venueFilter').onchange = renderVenues;
$('addVenue').onclick = () => openVenue(null);

function openVenue(v) {
  editing = v;
  $('venueTitle').textContent = v ? v.name : 'Add a venue';
  for (const [field, key] of [['vName', 'name'], ['vTown', 'town'], ['vPostcode', 'postcode'], ['vAddress', 'address'], ['vWebsite', 'website'], ['vLat', 'lat'], ['vLon', 'lon']]) $(field).value = v?.[key] ?? '';
  $('vNights').replaceChildren(...days.map(day => {
    const night = v?.quizNights.find(n => n.day === day), label = el('label', undefined, 'night'), on = el('input'), time = el('input');
    on.type = 'checkbox'; on.checked = !!night; on.dataset.day = day; time.type = 'time'; time.value = night?.time || '20:00'; time.dataset.time = day; time.disabled = !night;
    on.onchange = () => {time.disabled = !on.checked;};
    label.append(on, document.createTextNode(` ${cap(day).slice(0, 3)} `), time);
    return label;
  }));
  $('venueExtras').hidden = !v;
  if (v) fillExtras(v);
  $('venueDialog').showModal();
}
function fillExtras(v) {
  editing = v;
  $('vVerified').checked = v.verified;
  $('vOperator').textContent = v.operator ? `Run by ${v.operator.name} (${v.operator.email}): they edit this venue and its quiz nights from their quiz desk.` : 'No operator yet. Link the account of whoever runs the quiz here; they sign up in the PubQuiz Player app or on their quiz desk first.';
  $('vUnlink').hidden = !v.operator; $('vOperatorEmail').value = '';
  const row = (text, button) => {const li = el('li', text); if (button) li.append(button); return li;};
  const remove = (label, fn, done, ask) => {const b = el('button', label, 'ghost small'); b.type = 'button'; b.onclick = guarded(async () => {if (ask && !confirm(ask)) return false; await fn(); await loadVenues();}, done); return b;};
  $('vLaptops').replaceChildren(...v.laptops.map(k => row(`Laptop ${k.id} · registered ${date(k.added)} `, remove('Remove', () => api('DELETE', `/v1/venues/${v.id}/keys/${k.id}`), 'Laptop removed', 'Remove this laptop? Its results stop counting for this venue until it is registered again.'))));
  if (!v.laptops.length) $('vLaptops').append(el('li', 'None registered yet (the operator does it from the desk’s Venue tab).', 'muted'));
  $('vUpcoming').replaceChildren(...v.upcoming.slice(0, 8).map(e => row(`${when(e.startsAt)} · ${e.title}${e.regular ? ' (regular)' : ''} `, remove('Cancel', () => api('DELETE', `/v1/events/${e.id}`), 'Quiz night cancelled', `Cancel ${e.title} on ${when(e.startsAt)}?`))));
  if (!v.upcoming.length) $('vUpcoming').append(el('li', 'Nothing published.', 'muted'));
  $('vResults').replaceChildren(...v.sharedResults.map(r => row(`${date(r.date)} · ${r.title}: ${r.teams} teams, won by ${r.winner || '—'}`)));
  if (!v.sharedResults.length) $('vResults').append(el('li', 'None shared yet.', 'muted'));
}
for (const b of document.querySelectorAll('[data-close]')) b.onclick = () => $('venueDialog').close();
$('venueDialog').addEventListener('close', () => {editing = null;});
$('vLocate').onclick = guarded(async () => {
  const code = $('vPostcode').value.trim();
  if (!code) throw Error('Enter a postcode first');
  const res = await (await fetch('https://api.postcodes.io/postcodes/' + encodeURIComponent(code))).json();
  if (res.status !== 200) throw Error('Postcode not found');
  $('vLat').value = Math.round(res.result.latitude * 1e5) / 1e5; $('vLon').value = Math.round(res.result.longitude * 1e5) / 1e5;
  if (!$('vTown').value) $('vTown').value = res.result.admin_district || '';
}, 'Location found: save to keep it');
$('venueForm').onsubmit = guarded(async e => {
  e.preventDefault();
  const lat = $('vLat').value.trim(), lon = $('vLon').value.trim();
  if (!lat !== !lon || (lat && (!Number.isFinite(+lat) || !Number.isFinite(+lon)))) throw Error('Give both latitude and longitude as numbers, or neither');
  const body = {name: $('vName').value, town: $('vTown').value, postcode: $('vPostcode').value, address: $('vAddress').value, website: $('vWebsite').value.trim(),
    lat: lat ? +lat : null, lon: lon ? +lon : null, quizNights: days.filter(d => document.querySelector(`#vNights [data-day=${d}]`).checked).map(d => ({day: d, time: document.querySelector(`#vNights [data-time=${d}]`).value || '20:00'}))};
  const saved = editing ? await api('PATCH', `/v1/venues/${editing.id}`, body) : await api('POST', '/v1/venues', body);
  await loadVenues();
  openVenue(venues.find(v => v.id === saved.id));
}, 'Venue saved');
$('vVerified').onchange = guarded(async () => {await api('POST', `/v1/venues/${editing.id}/verify`, {verified: $('vVerified').checked}); await loadVenues();}, 'Saved');
$('operatorForm').onsubmit = guarded(async () => {await api('POST', `/v1/venues/${editing.id}/operator`, {email: $('vOperatorEmail').value.trim()}); await loadVenues();}, 'Operator linked');
$('vUnlink').onclick = guarded(async () => {if (!confirm('Unlink the operator? They can no longer edit this venue.')) return false; await api('POST', `/v1/venues/${editing.id}/operator`, {email: null}); await loadVenues();}, 'Operator unlinked');
$('vDelete').onclick = guarded(async () => {
  const v = editing;
  if (prompt(`Delete ${v.name} with its quiz nights and laptops? Type the venue’s name to confirm.`) !== v.name) return false;
  await api('DELETE', `/v1/venues/${v.id}`); $('venueDialog').close(); await loadVenues();
}, 'Venue deleted');

// ---- Accounts ----
let searchTimer;
async function loadAccounts() {
  const {accounts, total} = await api('GET', '/v1/admin/accounts?q=' + encodeURIComponent($('accountSearch').value.trim()));
  $('accountTotal').textContent = `${total} account${total === 1 ? '' : 's'}`;
  $('accountRows').replaceChildren(...accounts.map(a => {
    const tr = el('tr'), who = el('td');
    who.append(el('strong', a.displayName), el('span', ` ${a.email}`, 'muted'));
    if (a.admin) who.append(el('span', 'admin', 'badge good'));
    const actions = el('td', undefined, 'actions');
    const button = (label, fn, done, cls = 'ghost small') => {const b = el('button', label, cls); b.type = 'button'; b.onclick = guarded(async () => {if (await fn() === false) return false; await loadAccounts();}, done); return b;};
    actions.append(button(a.admin ? 'Remove admin' : 'Make admin', () => confirm(a.admin ? `Remove ${a.email}’s admin rights?` : `Give ${a.email} admin rights? They can change every venue and account.`) ? api('PATCH', `/v1/admin/accounts/${a.id}`, {admin: !a.admin}) : false, 'Saved'));
    if (a.photo) actions.append(button('Remove photo', () => confirm(`Remove ${a.displayName}’s profile picture?`) ? api('PATCH', `/v1/admin/accounts/${a.id}`, {removePhoto: true}) : false, 'Photo removed'));
    actions.append(button('Delete…', () => prompt(`Delete ${a.email} and everything kept for it? Type the email to confirm.`) === a.email ? api('DELETE', `/v1/admin/accounts/${a.id}`) : false, 'Account deleted', 'danger small'));
    tr.append(who, el('td', date(a.created)), el('td', a.venues || '—', a.venues ? undefined : 'muted'), el('td', String(a.results)), actions);
    return tr;
  }));
  if (!accounts.length) {const tr = el('tr'), td = el('td', 'No accounts match.', 'muted'); td.colSpan = 5; tr.append(td); $('accountRows').append(tr);}
}
$('accountSearch').oninput = () => {clearTimeout(searchTimer); searchTimer = setTimeout(() => loadAccounts().catch(e => toast(e.message, true)), 250);};

start();
