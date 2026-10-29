// BeerMat Online's admin console: venues, accounts, reports, shared buzzers, themes and quizzes, and an overview, through the admin API (online/service.js).
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

let token = sessionStorage.getItem('beermat-admin') || '', venues = [], editing = null;
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
function signedOut() {token = ''; sessionStorage.removeItem('beermat-admin'); $('signIn').hidden = false; $('console').hidden = true; $('who').hidden = true;}
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
  token = t; sessionStorage.setItem('beermat-admin', t); $('password').value = ''; await start();
});
$('signOut').onclick = guarded(async () => {await api('DELETE', '/v1/sessions').catch(() => {}); signedOut();});

// ---- Tabs ----
function show(tab) {
  if (!['overview', 'venues', 'accounts', 'reports', 'buzzers', 'themes', 'quizzes'].includes(tab)) tab = 'overview';
  for (const b of document.querySelectorAll('.tabs button')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
  for (const s of document.querySelectorAll('.tab')) s.hidden = s.id !== tab;
  history.replaceState(null, '', '#' + tab);
  ({overview: loadOverview, venues: loadVenues, accounts: loadAccounts, reports: loadReports, buzzers: loadBuzzers, themes: loadThemes, quizzes: loadQuizzes})[tab]().catch(e => toast(e.message, true));
}
for (const b of document.querySelectorAll('.tabs button')) b.onclick = () => show(b.dataset.tab);

// ---- Overview ----
async function loadOverview() {
  const o = await api('GET', '/v1/admin/overview');
  const tile = (n, label, note) => {const d = el('div', undefined, 'stat'); d.append(el('strong', String(n)), el('span', label)); if (note) d.append(el('small', note)); return d;};
  $('stats').replaceChildren(
    tile(o.venues, 'venues', `${o.verifiedVenues} verified · ${o.operatedVenues} with an operator · ${o.mappedVenues} on the map`),
    tile(o.proVenues, 'venues on Pro'),
    tile(o.openReports, 'reports to look at'),
    tile(o.awaitingApproval, 'new venues to approve'),
    tile(o.upcoming, 'quizzes in the next 7 days'),
    tile(o.accounts, 'accounts', `${o.newAccounts} new this week · ${o.admins} admin${o.admins === 1 ? '' : 's'}`),
    tile(o.results, 'results kept by players'),
    tile(o.laptops, 'quiz laptops registered', `${o.venueResults} quizzes shared`),
    tile(o.sharedBuzzers, 'shared buzzers', o.hiddenBuzzers ? `${o.hiddenBuzzers} hidden after reports` : undefined),
    tile(o.sharedThemes, 'shared themes', o.pendingThemes ? `${o.pendingThemes} waiting for you` : undefined),
    tile(o.sharedQuizzes, 'shared quizzes', o.pendingQuizzes ? `${o.pendingQuizzes} waiting for you` : undefined));
  $('pendingThemes').textContent = String(o.pendingThemes); $('pendingThemes').hidden = !o.pendingThemes;
  $('pendingQuizzes').textContent = String(o.pendingQuizzes); $('pendingQuizzes').hidden = !o.pendingQuizzes;
  $('reportCount').textContent = String(o.openReports); $('reportCount').hidden = !o.openReports;
  $('hiddenCount').textContent = String(o.hiddenBuzzers); $('hiddenCount').hidden = !o.hiddenBuzzers;
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
    && (filter !== 'awaiting' || !v.approved) && (filter !== 'unverified' || !v.verified) && (filter !== 'nooperator' || !v.operator) && (filter !== 'unmapped' || v.lat === null) && (filter !== 'nonights' || !v.quizNights.length));
  $('venueRows').replaceChildren(...shown.map(v => {
    const tr = el('tr'), name = el('td');
    name.append(el('strong', v.name), el('span', ` ${v.town}${v.postcode ? ', ' + v.postcode : ''}`, 'muted'));
    if (!v.approved) name.append(el('span', 'awaiting approval', 'badge warn'));
    if (v.verified) name.append(el('span', '✓ verified', 'badge good'));
    if (v.lat === null) name.append(el('span', 'not on map', 'badge warn'));
    const edit = el('button', 'Open', 'ghost'); edit.type = 'button'; edit.onclick = () => openVenue(v);
    const action = el('td'); action.append(edit);
    tr.append(name, el('td', v.quizNights.length ? nights(v.quizNights) : '—'), el('td', v.operator ? v.operator.email : '—', v.operator ? undefined : 'muted'),
      el('td', v.upcoming[0] ? when(v.upcoming[0].startsAt) : '—'), el('td', String(v.laptops.length)), el('td', v.plan === 'pro' ? 'Pro' : 'Free', v.plan === 'pro' ? 'pro' : 'muted'), action);
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
  $('vApproved').checked = v.approved;
  // Stripe's dashboard for this venue's subscription (test-mode ids open in test mode).
  $('vStripe').replaceChildren();
  if (v.stripeCustomer) {
    const a = el('a', 'Open its subscription in Stripe'); a.target = '_blank'; a.rel = 'noopener';
    a.href = `https://dashboard.stripe.com/customers/${v.stripeCustomer}`;
    $('vStripe').append(document.createTextNode('Paid by card. '), a);
  } else $('vStripe').textContent = v.plan === 'pro' ? 'Pro set by hand (not paid by card).' : '';
  $('vPlan').value = v.planSet; $('vPlanUntil').value = v.planUntil ? new Date(v.planUntil).toISOString().slice(0, 10) : '';
  $('vPlanNow').textContent = v.plan === 'pro' ? `On Pro${v.planUntil ? ' until ' + date(v.planUntil) : ', with no end date'}.` : v.planSet === 'pro' ? `Pro ended ${date(v.planUntil)}: on Free.` : 'On Free: 3 questions and 3 teams per quiz.';
  $('vOperator').textContent = v.operator ? `Run by ${v.operator.name} (${v.operator.email}): they edit this venue and its quiz nights from their quiz desk.` : 'No operator yet. Link the account of whoever runs the quiz here; they sign up in the BeerMat app or on their quiz desk first.';
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
$('vApproved').onchange = guarded(async () => {await api('POST', `/v1/venues/${editing.id}/approve`, {approved: $('vApproved').checked}); await loadVenues();}, 'Saved');
$('vVerified').onchange = guarded(async () => {await api('POST', `/v1/venues/${editing.id}/verify`, {verified: $('vVerified').checked}); await loadVenues();}, 'Saved');
$('planForm').onsubmit = guarded(async () => {
  const until = $('vPlanUntil').value, plan = $('vPlan').value;
  // The end of the chosen day, UK time near enough.
  await api('PATCH', `/v1/admin/venues/${editing.id}`, {plan, planUntil: plan === 'pro' && until ? new Date(until + 'T23:59:59').getTime() : null}); await loadVenues();
}, 'Plan saved');
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
    if (!a.emailVerified) who.append(el('span', 'email not confirmed', 'badge warn'));
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

// ---- Reports ----
async function loadReports() {
  // The Open buttons need the venue list.
  if (!venues.length) venues = (await api('GET', '/v1/admin/venues')).venues;
  const {reports} = await api('GET', '/v1/admin/reports' + ($('reportsAll').checked ? '?all=1' : ''));
  $('reportCount').textContent = String(reports.filter(r => !r.resolved).length); $('reportCount').hidden = !reports.some(r => !r.resolved);
  $('reportRows').replaceChildren(...reports.map(r => {
    const tr = el('tr'), act = el('td', undefined, 'actions'), venue = el('td'), open = r.kind === 'venue' && venues.find(v => v.id === r.target);
    venue.append(el('strong', r.kind === 'buzzer' ? `🔊 ${r.targetName}` : r.kind === 'profile' ? `👤 ${r.targetName}` : r.targetName));
    if (open) {const b = el('button', 'Open', 'ghost small'); b.type = 'button'; b.onclick = () => openVenue(open); venue.append(document.createTextNode(' '), b);}
    if (r.email) {const b = el('button', 'Open', 'ghost small'); b.type = 'button'; b.onclick = () => {$('accountSearch').value = r.email; show('accounts');}; venue.append(document.createTextNode(' '), b);}
    if (r.kind === 'buzzer' && r.targetName !== '(removed)') {const b = el('button', 'Open', 'ghost small'); b.type = 'button'; b.onclick = () => show('buzzers'); venue.append(document.createTextNode(' '), b);}
    const done = el('button', r.resolved ? 'Reopen' : 'Dealt with', 'ghost small'); done.type = 'button';
    done.onclick = guarded(async () => {await api('PATCH', `/v1/admin/reports/${r.id}`, {resolved: !r.resolved}); await loadReports();}, 'Saved');
    act.append(done);
    tr.append(venue, el('td', r.reason), el('td', r.reporter || 'someone not signed in', r.reporter ? undefined : 'muted'), el('td', when(r.created)), act);
    if (r.resolved) tr.className = 'muted';
    return tr;
  }));
  if (!reports.length) {const tr = el('tr'), td = el('td', 'Nothing reported.', 'muted'); td.colSpan = 5; tr.append(td); $('reportRows').append(tr);}
}
$('reportsAll').onchange = () => loadReports().catch(e => toast(e.message, true));

// ---- Shared buzzers ----
let buzzers = [], playing = null;
async function loadBuzzers() {
  buzzers = (await api('GET', '/v1/admin/buzzers')).buzzers;
  const hidden = buzzers.filter(b => b.hidden).length;
  $('hiddenCount').textContent = String(hidden); $('hiddenCount').hidden = !hidden;
  renderBuzzers();
}
// The clip itself, fetched with the admin's session (an <audio> can't send it).
async function play(b) {
  const res = await fetch(`/v1/admin/buzzers/${b.id}/audio`, {headers: {Authorization: 'Bearer ' + token}});
  if (!res.ok) throw Error('That clip can’t be played');
  if (playing) {playing.pause(); URL.revokeObjectURL(playing.src);}
  playing = new Audio(URL.createObjectURL(await res.blob())); await playing.play();
}
function renderBuzzers() {
  const find = $('buzzerSearch').value.trim().toLowerCase(), shown = buzzers.filter(b => !find || `${b.name} ${b.venueName}`.toLowerCase().includes(find));
  $('buzzerTotal').textContent = `${buzzers.length} in the library`;
  const button = (label, fn, done, cls = 'ghost small') => {const b = el('button', label, cls); b.type = 'button'; b.onclick = guarded(async () => {if (await fn() === false) return false; await loadBuzzers();}, done); return b;};
  $('buzzerRows').replaceChildren(...shown.map(b => {
    const tr = el('tr'), name = el('td'), actions = el('td', undefined, 'actions');
    name.append(el('strong', b.name), el('span', ` ${b.seconds}s`, 'muted'));
    if (b.hidden) name.append(el('span', 'hidden', 'badge warn'));
    const listen = el('button', '▶ Play', 'ghost small'); listen.type = 'button'; listen.onclick = guarded(() => play(b));
    actions.append(listen, button(b.hidden ? 'Show again' : 'Hide', () => api('PATCH', `/v1/admin/buzzers/${b.id}`, {hidden: !b.hidden}), b.hidden ? 'Back in the library' : 'Hidden'),
      button('Remove', () => confirm(`Remove “${b.name}” from the library for good?`) ? api('DELETE', `/v1/admin/buzzers/${b.id}`) : false, 'Removed', 'danger small'));
    if (b.venue) actions.append(button('Stop venue sharing…', () => prompt(`Stop ${b.venueName} sharing buzzers, and remove every clip it has shared? Type the venue’s name to confirm.`) === b.venueName ? api('POST', `/v1/admin/venues/${b.venue}/library`, {banned: true}) : false, 'Venue stopped from sharing', 'danger small'));
    tr.append(name, el('td', b.venueName || '—', b.venueName ? undefined : 'muted'), el('td', date(b.added)), el('td', String(b.reports), b.reports ? 'warn' : 'muted'), actions);
    return tr;
  }));
  if (!shown.length) {const tr = el('tr'), td = el('td', buzzers.length ? 'No buzzers match.' : 'Nothing shared yet.', 'muted'); td.colSpan = 5; tr.append(td); $('buzzerRows').append(tr);}
}
$('buzzerSearch').oninput = renderBuzzers;
$('buzzerAdd').onsubmit = guarded(async () => {
  const files = [...$('buzzerFiles').files];
  for (const file of files) {
    if (file.size > 2 * 1024 * 1024) throw Error(`${file.name}: clips up to 2 MB`);
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = ''; for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    await api('POST', '/v1/admin/buzzers', {name: file.name.replace(/\.[^.]+$/, '').replace(/_+/g, ' ').trim().slice(0, 60), audio: btoa(binary)});
  }
  $('buzzerAdd').reset(); await loadBuzzers();
  return files.length;
}, 'Added to the library');

// ---- Shared themes ----
// Pictures and files are fetched with the admin's session (an <img> can't send it) and shown as blobs; text files
// as text, never run.
let themes = [], picturesTimer = null;
// Added in the last two minutes without its TV or app picture yet: BeerMat Online is drawing them.
const drawing = t => Date.now() - t.added < 2 * 60000 && (!t.previews.includes('tv') || !t.previews.includes('app'));
const authed = async url => {const res = await fetch(url, {headers: {Authorization: 'Bearer ' + token}}); if (!res.ok) throw Error('That file can’t be opened'); return res;};
async function loadThemes() {
  themes = (await api('GET', '/v1/admin/themes')).themes;
  const pending = themes.filter(t => t.status === 'pending').length;
  $('pendingThemes').textContent = String(pending); $('pendingThemes').hidden = !pending;
  renderThemes();
}
function renderThemes() {
  const find = $('themeSearch').value.trim().toLowerCase(), shown = themes.filter(t => !find || `${t.name} ${t.venueName}`.toLowerCase().includes(find));
  $('themeTotal').textContent = `${themes.filter(t => t.status === 'approved').length} in the library · ${themes.filter(t => t.status === 'pending').length} waiting`;
  const button = (label, fn, done, cls = 'ghost small') => {const b = el('button', label, cls); b.type = 'button'; b.onclick = guarded(async () => {if (await fn() === false) return false; await loadThemes();}, done); return b;};
  $('themeCards').replaceChildren(...shown.map(t => {
    const card = el('article', undefined, 'theme-card'), head = el('header'), pictures = el('div', undefined, 'theme-previews'), files = el('ul', undefined, 'theme-files'), actions = el('div', undefined, 'actions');
    head.append(el('strong', t.name), el('span', {pending: 'waiting', approved: 'in the library', rejected: 'turned down'}[t.status], `badge ${t.status === 'pending' ? 'warn' : ''}`));
    if (t.hidden) head.append(el('span', 'hidden after reports', 'badge warn'));
    head.append(el('span', ` ${t.venueName} · ${date(t.added)} · ${Math.round(t.bytes / 1024)} KB${t.reports ? ` · ${t.reports} reports` : ''}`, 'muted'));
    for (const kind of ['tv', 'app', 'browser']) {
      const label = {tv: 'TV', app: 'app', browser: 'browser'}[kind];
      if (!t.previews.includes(kind)) {
        // The browser picture needs Chromium on the server: without one, there's simply no slot for it.
        if (kind === 'browser') continue;
        pictures.append(el('span', drawing(t) ? `Drawing the ${label} picture…` : `No ${label} picture`, `preview-${kind} no-picture`)); continue;
      }
      const img = el('img', undefined, `preview-${kind}`); img.alt = `The theme in the ${label}`;
      authed(`/v1/themes/${t.id}/previews/${kind}`).then(r => r.blob()).then(b => {img.src = URL.createObjectURL(b);}).catch(() => {});
      pictures.append(img);
    }
    for (const f of t.files) {
      const li = el('li'), open = el('button', f.name, 'link'); open.type = 'button';
      open.onclick = guarded(async () => {
        const res = await authed(`/v1/admin/themes/${t.id}/files/${f.name}`), view = $('themeFile');
        if (/\.(png|webp|jpg|svg)$/.test(f.name)) {const img = el('img'); img.src = URL.createObjectURL(await res.blob()); view.replaceChildren(img);}
        else if (/\.(mp3|ogg|wav)$/.test(f.name)) {const audio = el('audio'); audio.controls = true; audio.src = URL.createObjectURL(await res.blob()); view.replaceChildren(audio); audio.play().catch(() => {});}
        else if (/\.woff2$/.test(f.name)) view.textContent = `${f.name}: a font (${f.bytes} bytes)`;
        else view.textContent = await res.text();
        view.hidden = false; view.scrollIntoView({behavior: 'smooth'});
      });
      li.append(open, el('span', ` ${Math.round(f.bytes / 1024 * 10) / 10} KB`, 'muted')); files.append(li);
    }
    if (t.status !== 'approved') actions.append(button('Approve', () => api('PATCH', `/v1/admin/themes/${t.id}`, {status: 'approved'}), 'In the library', 'primary small'));
    if (t.status !== 'rejected') actions.append(button('Turn down…', () => {const note = prompt(`Why is “${t.name}” turned down? The venue sees this.`); return note === null ? false : api('PATCH', `/v1/admin/themes/${t.id}`, {status: 'rejected', note});}, 'Turned down'));
    if (t.status === 'approved') actions.append(button(t.hidden ? 'Show again' : 'Hide', () => api('PATCH', `/v1/admin/themes/${t.id}`, {hidden: !t.hidden}), t.hidden ? 'Back in the library' : 'Hidden'));
    actions.append(button('Remove', () => confirm(`Remove “${t.name}” for good?`) ? api('DELETE', `/v1/admin/themes/${t.id}`) : false, 'Removed', 'danger small'));
    actions.append(button('TV picture…', () => pickPicture(t, 'tv'), 'Picture saved'), button('App picture…', () => pickPicture(t, 'app'), 'Picture saved'));
    if (t.venue) actions.append(button('Stop venue sharing…', () => prompt(`Stop ${t.venueName} sharing, and remove every buzzer and theme it has shared? Type the venue’s name to confirm.`) === t.venueName ? api('POST', `/v1/admin/venues/${t.venue}/library`, {banned: true}) : false, 'Venue stopped from sharing', 'danger small'));
    card.append(head, pictures, files, actions);
    return card;
  }));
  if (!shown.length) $('themeCards').append(el('p', themes.length ? 'No themes match.' : 'Nothing shared yet.', 'muted'));
  // A theme just added has its pictures drawn by BeerMat Online a few seconds later: look again until they're in.
  clearTimeout(picturesTimer);
  if (themes.some(drawing)) picturesTimer = setTimeout(() => loadThemes().catch(() => {}), 3000);
}
$('themeSearch').oninput = renderThemes;
// BeerMat's own themes: a folder from the file picker, sent as a theme bundle ({id, files: {path: base64}}) as the
// desk shares one, keeping only the files a theme may have (shared/theme-bundle.js checks them again on the server).
const base64 = async file => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = ''; for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
};
const themeFile = /^(theme\.json|look\.css|tv\.json|CREDITS\.md|[a-zA-Z0-9_-]+(\/[a-zA-Z0-9_-]+)*\.(png|webp|jpg|svg|woff2|mp3|ogg|wav))$/;
async function pictures(tv, app) {
  const previews = {};
  for (const [kind, file] of [['tv', tv], ['app', app]]) if (file) {
    if (file.size > 1024 * 1024) throw Error(`The ${kind === 'tv' ? 'TV' : 'app'} picture is over 1 MB`);
    previews[kind] = await base64(file);
  }
  return previews;
}
$('themeAdd').onsubmit = guarded(async () => {
  const chosen = [...$('themeFolder').files];
  if (!chosen.length) throw Error('Choose a theme folder');
  const folder = chosen[0].webkitRelativePath.split('/')[0], files = {};
  for (const file of chosen) {
    const path = file.webkitRelativePath.split('/').slice(1).join('/');
    if (themeFile.test(path)) files[path] = await base64(file);
  }
  if (!files['theme.json']) throw Error(`${folder} has no theme.json: choose the theme’s own folder`);
  const id = folder.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'theme';
  await api('POST', '/v1/admin/themes', {bundle: {id, files}, previews: await pictures($('themeTvPicture').files[0], $('themeAppPicture').files[0])});
  $('themeAdd').reset(); await loadThemes();
}, 'Added to the library: its pictures follow in a few seconds');
// A new picture of a theme on the TV or in the app, for one shared without it (or with a poor one).
function pickPicture(t, kind) {
  return new Promise((resolve, reject) => {
    const input = el('input'); input.type = 'file'; input.accept = 'image/jpeg,image/png,image/webp';
    input.onchange = async () => {
      try {resolve(await api('PUT', `/v1/admin/themes/${t.id}/previews`, {previews: await pictures(kind === 'tv' && input.files[0], kind === 'app' && input.files[0])}));}
      catch (e) {reject(e);}
    };
    input.oncancel = () => resolve(false);
    input.click();
  });
}

// ---- Shared quizzes ----
let quizzes = [];
async function loadQuizzes() {
  quizzes = (await api('GET', '/v1/admin/quizzes')).quizzes;
  const pending = quizzes.filter(q => q.status === 'pending').length;
  $('pendingQuizzes').textContent = String(pending); $('pendingQuizzes').hidden = !pending;
  renderQuizzes();
}
function renderQuizzes() {
  const find = $('quizSearch').value.trim().toLowerCase(), shown = quizzes.filter(q => !find || `${q.title} ${q.by} ${q.description}`.toLowerCase().includes(find));
  $('quizTotal').textContent = `${quizzes.filter(q => q.status === 'approved').length} in the library · ${quizzes.filter(q => q.status === 'pending').length} waiting`;
  const button = (label, fn, done, cls = 'ghost small') => {const b = el('button', label, cls); b.type = 'button'; b.onclick = guarded(async () => {if (await fn() === false) return false; await loadQuizzes();}, done); return b;};
  $('quizCards').replaceChildren(...shown.map(q => {
    const card = el('article', undefined, 'theme-card'), head = el('header'), actions = el('div', undefined, 'actions');
    head.append(el('strong', q.title), el('span', {pending: 'waiting', approved: 'in the library', rejected: 'turned down'}[q.status], `badge ${q.status === 'pending' ? 'warn' : ''}`));
    if (q.hidden) head.append(el('span', 'hidden after reports', 'badge warn'));
    head.append(el('span', ` ${q.by} · ${date(q.added)} · ${q.rounds} rounds · ${q.questions} questions · ${Math.round(q.bytes / 1024)} KB${q.reports ? ` · ${q.reports} reports` : ''}`, 'muted'));
    const about = el('p', q.description || 'No description.', q.description ? '' : 'muted');
    const outline = el('p', q.outline.map(r => `${r.title} (${r.questions})`).join(' · ') + ` — ${q.formats.join(', ')}`, 'muted');
    actions.append(button('Read it', () => readQuiz(q), undefined, 'primary small'));
    if (q.status !== 'approved') actions.append(button('Approve', () => api('PATCH', `/v1/admin/quizzes/${q.id}`, {status: 'approved'}), 'In the library', 'primary small'));
    if (q.status !== 'rejected') actions.append(button('Turn down…', () => {const note = prompt(`Why is “${q.title}” turned down? The venue sees this.`); return note === null ? false : api('PATCH', `/v1/admin/quizzes/${q.id}`, {status: 'rejected', note});}, 'Turned down'));
    actions.append(button('Description…', () => {const d = prompt('The line venues see about this quiz:', q.description); return d === null ? false : api('PATCH', `/v1/admin/quizzes/${q.id}`, {description: d});}, 'Saved'));
    if (q.status === 'approved') actions.append(button(q.hidden ? 'Show again' : 'Hide', () => api('PATCH', `/v1/admin/quizzes/${q.id}`, {hidden: !q.hidden}), q.hidden ? 'Back in the library' : 'Hidden'));
    actions.append(button('Remove', () => confirm(`Remove “${q.title}” for good?`) ? api('DELETE', `/v1/admin/quizzes/${q.id}`) : false, 'Removed', 'danger small'));
    if (q.venue) actions.append(button('Stop venue sharing…', () => prompt(`Stop ${q.by} sharing, and remove every buzzer, theme and quiz it has shared? Type the venue’s name to confirm.`) === q.by ? api('POST', `/v1/admin/venues/${q.venue}/library`, {banned: true}) : false, 'Venue stopped from sharing', 'danger small'));
    card.append(head, about, outline, actions);
    return card;
  }));
  if (!shown.length) $('quizCards').append(el('p', quizzes.length ? 'No quizzes match.' : 'Nothing shared yet.', 'muted'));
}
$('quizSearch').oninput = renderQuizzes;
// The whole quiz, every question with its answer, pictures shown and sounds playable, all as text (never run).
async function readQuiz(q) {
  const {quiz} = await api('GET', `/v1/admin/quizzes/${q.id}`), view = $('quizRead');
  const media = m => {
    if (typeof m !== 'string' || !m.startsWith('data:')) return null;
    // Made into a blob here: the console's policy lets it show blobs, not fetch data: URLs.
    const [head, data] = m.split(','), bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], {type: head.slice(5, head.indexOf(';'))}));
    if (m.startsWith('data:image/')) {const img = el('img'); img.src = url; return img;}
    const audio = el('audio'); audio.controls = true; audio.src = url; return audio;
  };
  const answerOf = x => [x.answer, x.correct?.length && `correct: ${x.correct.join(', ')}`, x.items?.length && `items: ${x.items.join(' → ')}`,
    x.itemAnswers?.length && `answers: ${x.itemAnswers.join(' · ')}`, x.aliases?.length && `also: ${x.aliases.join(', ')}`].filter(Boolean).join(' · ');
  view.replaceChildren(el('h3', `${quiz.title} — read before approving`), ...quiz.rounds.map(r => {
    const round = el('section'); round.append(el('h4', r.title + (r.secret ? ' (secret round)' : '')));
    const list = el('ol');
    for (const x of r.questions) {
      const li = el('li'); li.append(el('strong', x.text), el('span', ` [${x.type}, ${x.points ?? ''} pt]`, 'muted'));
      if (x.options?.length) li.append(el('div', 'Options: ' + x.options.join(' / ')));
      const answer = answerOf(x); if (answer) li.append(el('div', 'Answer: ' + answer, 'answer'));
      if (x.answerNote) li.append(el('div', x.answerNote, 'muted'));
      const m = media(x.media); if (m) li.append(m);
      for (const c of [...(x.clips || []), ...(x.songs || [])]) {li.append(el('div', c.label || c.title || 'clip', 'muted')); const cm = media(c.media); if (cm) li.append(cm);}
      list.append(li);
    }
    round.append(list); return round;
  }));
  view.hidden = false; view.scrollIntoView({behavior: 'smooth'});
  return false;
}
$('quizAdd').onsubmit = guarded(async () => {
  const file = $('quizFile').files[0];
  if (!file) throw Error('Choose a quiz file');
  let quiz; try {quiz = JSON.parse(await file.text());} catch {throw Error(`${file.name} isn’t a BeerMat quiz file`);}
  await api('POST', '/v1/admin/quizzes', {quiz, description: $('quizDescription').value});
  $('quizAdd').reset(); await loadQuizzes();
}, 'Added to the library');

start();
