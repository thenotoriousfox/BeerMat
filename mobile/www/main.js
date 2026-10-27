// BeerMat: the app's own screens around the quiz. Play opens a quiz's player page (served by the quiz laptop,
// the same page phone browsers get); Profile and Find a quiz use BeerMat Online when it is set up and reachable.
// The same files run as the web app BeerMat Online serves at /app/, without the phone-only extras.
import {createOnlineClient} from './shared/online-client.js';
import {badges} from './shared/achievements.js';
import {parseScan, normaliseAddress, readClaim, remember, calendarFile} from './join.js';
import {onlineService, venueListUrl} from './config.js';

const $ = id => document.getElementById(id);
const native = !!window.Capacitor?.isNativePlatform?.();
const platform = window.Capacitor?.getPlatform?.() || 'web';
// Native plugins when the app has them; null in the web app.
const plugin = name => native ? window.Capacitor.Plugins?.[name] || window.Capacitor.registerPlugin?.(name) || null : null;
const store = {get: (k, d) => {try {return JSON.parse(localStorage.getItem(k)) ?? d;} catch {return d;}}, set: (k, v) => {try {localStorage.setItem(k, JSON.stringify(v));} catch {}}};
// As the web app (served by BeerMat Online at /app/), the service is wherever the page came from.
const client = createOnlineClient({baseUrl: location.protocol.startsWith('http') && location.pathname.startsWith('/app/') ? location.origin : onlineService, venueListUrl, storage: localStorage});
const say = (text, error = false) => {$('status').textContent = text; $('status').classList.toggle('error', error);};
const el = (tag, text, className) => {const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (className) e.className = className; return e;};
const when = t => new Date(t).toLocaleString(undefined, {weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'});
const ago = t => {const m = Math.round((Date.now() - t) / 60000); return m < 2 ? 'just now' : m < 120 ? `${m} minutes ago` : m < 2880 ? `${Math.round(m / 60)} hours ago` : `${Math.round(m / 1440)} days ago`;};

// ---- Tabs ----
function show(tab) {
  for (const b of document.querySelectorAll('.tabs button')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
  for (const s of document.querySelectorAll('.tab')) s.hidden = s.id !== tab;
  say('');
  if (tab === 'profile') renderProfile();
  if (tab === 'find') {renderFavourites(); renderMap();}
}
for (const b of document.querySelectorAll('.tabs button')) b.onclick = () => show(b.dataset.tab);
const setOffline = off => {$('offline').hidden = !off;};
addEventListener('online', () => {setOffline(false); client.flush().then(renderPending).catch(() => {});});
addEventListener('offline', () => setOffline(true));
setOffline(navigator.onLine === false);

// ---- Play ----
// The quiz is reachable if anything answers at its address (the quiz page has no cross-site headers, so the reply
// itself cannot be read; reaching it is enough).
async function reachable(url) {
  try {await fetch(url + '/health', {mode: 'no-cors', cache: 'no-store', signal: AbortSignal.timeout(4000)}); return true;} catch {return false;}
}
// Some phones block that check for local addresses while still opening the page, so the player can go ahead anyway.
async function openQuiz(url, title) {
  $('openAnyway').hidden = true;
  say(`Looking for the quiz at ${url.replace(/^https?:\/\//, '')}…`);
  const go = () => {store.set('beermat-recent', remember(store.get('beermat-recent', []), url, title)); location.href = url + '/';};
  if (await reachable(url)) return go();
  say('Can’t reach that quiz. Check you’re on the same Wi-Fi as the quiz (or the quiz Wi-Fi), and that the address matches the TV.', true);
  $('openAnyway').hidden = false; $('openAnyway').onclick = go;
}
function renderRecent() {
  const list = store.get('beermat-recent', []);
  $('recentBox').hidden = !list.length;
  $('recent').replaceChildren(...list.map(r => {
    const li = el('li'), button = el('button', `${r.title || r.url.replace(/^https?:\/\//, '')} · ${ago(r.at)}`);
    button.onclick = () => openQuiz(r.url, r.title); li.append(button); return li;
  }));
}
$('addressForm').onsubmit = e => {
  e.preventDefault();
  try {openQuiz(normaliseAddress($('address').value));} catch (error) {say(error.message, true);}
};
let wifiCandidates = [];
function handleScan(text) {
  const result = parseScan(text);
  if (result.type === 'invalid') return say(result.reason, true);
  if (result.type === 'quiz') return openQuiz(result.url);
  wifiCandidates = result.candidates;
  $('wifiStep').hidden = false;
  $('wifiText').textContent = result.open ? `Join the Wi-Fi “${result.ssid}”.` : `Join the Wi-Fi “${result.ssid}” — password: ${result.password}`;
  say('');
}
$('wifiContinue').onclick = async () => {
  for (const url of wifiCandidates) if (await reachable(url)) return openQuiz(url);
  say('The quiz isn’t answering yet. Make sure your phone has joined the quiz Wi-Fi (it may say “no internet” — that’s fine).', true);
};
const scanner = plugin('BarcodeScanner');
$('scan').hidden = !scanner;
$('scan').onclick = async () => {
  try {
    if (platform === 'android' && scanner.isGoogleBarcodeScannerModuleAvailable && !(await scanner.isGoogleBarcodeScannerModuleAvailable()).available) {
      say('Getting the code scanner ready (one-off download)…'); await scanner.installGoogleBarcodeScannerModule();
    }
    const {camera} = await scanner.requestPermissions();
    if (camera !== 'granted' && camera !== 'limited') return say('The camera is needed to scan. You can type the address instead.', true);
    const {barcodes} = await scanner.scan({formats: ['QR_CODE']});
    if (barcodes?.[0]) handleScan(barcodes[0].rawValue);
  } catch (e) {say(`Scanning didn’t work (${e.message}). Type the address shown on the TV instead.`, true);}
};

// ---- Results handed over by the quiz page ----
async function takeClaim() {
  const claim = readClaim(location.hash);
  if (!claim) return;
  history.replaceState(null, '', location.pathname);
  if (!client.baseUrl) {show('profile'); return say('BeerMat Online isn’t set up, so the result can’t be kept.', true);}
  const result = await client.saveResult(claim);
  show('profile');
  say(result.sent ? `Saved: ${claim.result.name}, ${claim.title}.` : client.signedIn() ? 'Kept on this phone. It will be saved when you’re back online.' : 'Kept on this phone. Sign in or create an account to save it.');
}

// ---- Profile ----
function renderPending() {
  const waiting = client.outbox().length;
  $('pending').hidden = !waiting;
  $('pending').textContent = waiting ? `${waiting} result${waiting === 1 ? '' : 's'} waiting to be saved${client.signedIn() ? ' — saved automatically when online' : ' — sign in to save'}.` : '';
}
async function renderProfile() {
  $('serviceUrl').value = client.baseUrl;
  $('onlineMissing').hidden = !!client.baseUrl;
  const signedIn = client.signedIn();
  $('signedOut').hidden = !client.baseUrl || signedIn; $('signedIn').hidden = !signedIn;
  renderPending();
  if (!signedIn) return;
  const me = client.profile();
  if (me) fillProfile(me);
  client.refreshProfile().then(fillProfile).catch(() => {});
  client.flush().then(renderPending).catch(() => {});
  try {
    const s = await client.stats();
    $('statsStale').hidden = !s.stale;
    $('statsStale').textContent = s.stale ? `Offline: these are your statistics from ${ago(s.fetchedAt)}.` : '';
    const st = s.stats;
    $('stats').replaceChildren(...[['Quizzes', st.quizzes], ['Wins', st.wins], ['Podiums', st.podiums], ['Correct', st.correct], ['Accuracy', st.accuracy + '%'], ['Fastest right answer', st.fastestMs === null ? '–' : (st.fastestMs / 1000).toFixed(1) + 's']]
      .map(([label, value]) => {const d = el('div'); d.append(el('strong', String(value)), el('span', label)); return d;}));
    const earned = new Map(s.achievements.map(a => [a.id, a]));
    $('badges').replaceChildren(...badges.map(b => el('li', `${earned.has(b.id) ? '🏅' : '🔒'} ${b.name} — ${b.description}${earned.has(b.id) ? ` (${new Date(earned.get(b.id).earnedAt).toLocaleDateString()})` : ''}`, earned.has(b.id) ? '' : 'locked')));
    if (s.waiting) $('badges').append(el('li', `${s.waiting} result${s.waiting === 1 ? ' is' : 's are'} from a venue that hasn’t registered its quiz laptop yet, so they don’t count yet.`, 'locked'));
  } catch (e) {say(e.message, true);}
}
function fillProfile(me) {
  $('meName').textContent = me.displayName; $('meTeam').textContent = me.preferredTeam ? `Usual team: ${me.preferredTeam}` : me.email;
  $('avatar').hidden = !me.avatar; if (me.avatar) $('avatar').src = me.avatar;
  if (document.activeElement !== $('editName')) $('editName').value = me.displayName;
  if (document.activeElement !== $('editTeam')) $('editTeam').value = me.preferredTeam;
  $('privLeaderboards').checked = me.privacy.leaderboards; $('privPhoto').checked = me.privacy.photo; $('privHistory').checked = me.privacy.history;
}
const guarded = fn => async e => {e?.preventDefault?.(); try {await fn(e);} catch (error) {say(error.message, true);}};
$('signInForm').onsubmit = guarded(async () => {await client.signIn($('signInEmail').value, $('signInPassword').value); $('signInPassword').value = ''; say('Signed in'); renderProfile();});
$('signUpForm').onsubmit = guarded(async () => {
  await client.signUp({email: $('signUpEmail').value, password: $('signUpPassword').value, displayName: $('signUpName').value});
  $('signUpPassword').value = ''; await client.flush(); say('Account created'); renderProfile();
});
$('signOut').onclick = guarded(async () => {await client.signOut(); say('Signed out'); renderProfile();});
$('editForm').onsubmit = guarded(async () => {fillProfile(await client.updateProfile({displayName: $('editName').value, preferredTeam: $('editTeam').value})); say('Profile saved');});
// Pictures are shrunk on the phone to 256 px before they are sent.
$('editPhoto').onchange = guarded(async () => {
  const file = $('editPhoto').files[0]; if (!file) return;
  const image = await createImageBitmap(file), size = 256, canvas = document.createElement('canvas'), scale = Math.max(size / image.width, size / image.height);
  canvas.width = canvas.height = size;
  canvas.getContext('2d').drawImage(image, (size - image.width * scale) / 2, (size - image.height * scale) / 2, image.width * scale, image.height * scale);
  fillProfile(await client.updateProfile({avatar: canvas.toDataURL('image/jpeg', 0.8)})); say('Picture saved');
});
$('removePhoto').onclick = guarded(async () => {fillProfile(await client.updateProfile({avatar: null})); say('Picture removed');});
for (const [id, key] of [['privLeaderboards', 'leaderboards'], ['privPhoto', 'photo'], ['privHistory', 'history']])
  $(id).onchange = guarded(async () => {fillProfile(await client.updateProfile({privacy: {[key]: $(id).checked}})); say('Privacy saved');});
$('exportData').onclick = guarded(async () => {
  const data = await client.exportData(), link = el('a');
  link.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'})); link.download = 'beermat-online-data.json'; link.click();
});
$('deleteAccount').onclick = guarded(async () => {
  if (!confirm('Delete your BeerMat Online account, profile and saved results? This cannot be undone.')) return;
  await client.deleteAccount(); say('Account deleted'); renderProfile();
});
$('saveService').onclick = guarded(async () => {
  const url = $('serviceUrl').value.trim();
  if (url && !/^https:\/\//.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(url)) throw Error('The address must start with https://');
  client.setBaseUrl(url); say('Saved'); renderProfile();
});

// ---- Find a quiz ----
let lastSearch = null;
async function search(params) {
  lastSearch = params;
  if (!client.baseUrl) return say('BeerMat Online isn’t set up, so quiz listings aren’t available. Ask your venue for its quiz nights.', true);
  say('Searching…');
  try {
    const found = await client.findEvents(params);
    $('findStale').hidden = !found.stale;
    $('findStale').textContent = found.stale ? `Offline: these listings are from ${ago(found.fetchedAt)} and may have changed.` : '';
    // One entry a venue: its next quiz (on the chosen day, if one is chosen). Listings come soonest (or nearest) first.
    const seen = new Set(), shown = found.events.filter(e => (!dayFilter || weekday(e.startsAt) === dayFilter) && !seen.has(e.venue.id) && seen.add(e.venue.id));
    const where = params.lat !== undefined ? `within ${params.radiusKm} km of you` : 'there';
    say(shown.length ? '' : found.events.length ? `No quizzes ${where} on a ${dayName(dayFilter)}.` : `No quizzes ${where} in the next week. The map shows every venue.`);
    if (params.lat !== undefined && map) map.setView([params.lat, params.lon], 10);
    renderEvents(shown);
  } catch (e) {say(e.message, true);}
}
// Google Maps directions (its app when the phone has it): the pub by name and address when it has a postcode, so Google
// shows the place itself, otherwise its pin.
function directions(v) {
  const place = [v.name, v.address, v.town, v.postcode].filter(Boolean).join(', ');
  return 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(v.postcode || v.lat === null || v.lat === undefined ? place : `${v.lat},${v.lon}`);
}
function renderEvents(events, list = $('events')) {
  const favourites = new Set(store.get('beermat-favourites', []).map(v => v.id));
  list.replaceChildren(...events.map(e => {
    const li = el('li');
    li.append(el('div', when(e.startsAt), 'when'), el('strong', e.regular ? `${e.title} · every ${dayName(weekday(e.startsAt))}` : e.title), el('div', `${e.venue.name}, ${e.venue.town}${e.distanceKm !== undefined ? ` · ${e.distanceKm} km` : ''}`, 'where'));
    if (e.format) li.append(el('div', e.format));
    if (e.entry) li.append(el('div', `Entry: ${e.entry}`));
    const go = el('a', 'Directions'); go.href = directions(e.venue); go.target = '_blank'; go.rel = 'noopener';
    const remind = el('button', '⏰ Remind me', 'subtle'); remind.type = 'button'; remind.onclick = guarded(() => reminder(e));
    const star = el('button', favourites.has(e.venue.id) ? '★ Your venue' : '☆ Save venue', 'subtle'); star.type = 'button';
    star.onclick = guarded(() => toggleFavourite(e.venue, !favourites.has(e.venue.id)));
    li.append(el('br'), go, el('br'), remind, star);
    return li;
  }));
}
async function reminder(event) {
  const notifications = plugin('LocalNotifications');
  if (notifications) {
    const {display} = await notifications.requestPermissions();
    if (display !== 'granted') return say('Notifications are switched off for BeerMat in your phone’s settings.', true);
    const at = new Date(Math.max(event.startsAt - 2 * 3600000, Date.now() + 60000));
    await notifications.schedule({notifications: [{id: Math.abs([...event.id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)), title: `${event.title} at ${event.venue.name}`, body: `Starts ${when(event.startsAt)}`, schedule: {at}}]});
    return say(`Reminder set for ${when(at)}`);
  }
  const link = el('a'); link.href = URL.createObjectURL(new Blob([calendarFile(event)], {type: 'text/calendar'})); link.download = 'beermat.ics'; link.click();
  say('Calendar entry downloaded');
}
// Favourite venues are kept on the phone, and in the profile when signed in.
async function toggleFavourite(venue, on) {
  const list = store.get('beermat-favourites', []).filter(v => v.id !== venue.id);
  store.set('beermat-favourites', on ? [...list, {id: venue.id, name: venue.name, town: venue.town}] : list);
  if (client.signedIn()) await client.favourite(venue.id, on).catch(() => {});
  say(on ? `${venue.name} saved` : `${venue.name} removed`);
  if (lastSearch) search(lastSearch); renderFavourites();
  if (!$('venueCard').hidden && shownVenue?.id === venue.id) showVenue(shownVenue);
}

// ---- Quiz days: venues list their regular nights (a day and a time); players filter the map and listings by day ----
const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const dayName = d => d[0].toUpperCase() + d.slice(1);
const weekday = t => days[(new Date(t).getDay() + 6) % 7];
const clock = time => {const [h, m] = time.split(':').map(Number); return `${h % 12 || 12}${m ? ':' + String(m).padStart(2, '0') : ''}${h < 12 ? 'am' : 'pm'}`;};
const nightsText = nights => nights.map(n => `${dayName(n.day)}s at ${clock(n.time)}`).join(', ');
let dayFilter = store.get('beermat-day', '');
if (!days.includes(dayFilter)) dayFilter = '';
function renderDays() {
  const today = weekday(Date.now());
  $('dayFilter').replaceChildren(...['', ...days].map(d => {
    const b = el('button', d ? dayName(d).slice(0, 3) : 'Any day', d === today ? 'today' : undefined); b.type = 'button';
    b.setAttribute('aria-pressed', String(d === dayFilter)); if (d) b.title = d === today ? `${dayName(d)} (today)` : dayName(d);
    b.onclick = () => {dayFilter = d; store.set('beermat-day', d); renderDays(); drawPins(); if (lastSearch) search(lastSearch);};
    return b;
  }));
}
const quizOn = (v, d) => v.quizNights?.some(n => n.day === d) || (v.next && weekday(v.next.startsAt) === d);

// ---- The map: every venue (BeerMat Online, or the venue list on GitHub when it can't be reached) ----
// OpenStreetMap's tiles, loaded only while this tab is open; the map never sends the player's location anywhere.
let map = null, markers = null, shownVenue = null, mapVenues = null;
// A map pin: gold with a question mark for venues with a quiz night, slate for the rest; bigger when chosen.
const pinIcon = (quiz, chosen) => L.divIcon({className: `pin${quiz ? ' quiz' : ''}${chosen ? ' chosen' : ''}`, iconSize: [34, 44], iconAnchor: [17, 43], tooltipAnchor: [0, -38],
  html: '<svg viewBox="0 0 34 44" aria-hidden="true"><path class="pin-body" d="M17 1.5C8.4 1.5 1.5 8.3 1.5 16.8 1.5 28.6 17 42.5 17 42.5S32.5 28.6 32.5 16.8C32.5 8.3 25.6 1.5 17 1.5z"/>'
    + '<circle class="pin-face" cx="17" cy="16.5" r="9.5"/><text class="pin-mark" x="17" y="21.6" text-anchor="middle">?</text></svg>'});
function drawPins() {
  if (!mapVenues || !markers) return;
  const placed = mapVenues.venues.filter(v => v.lat !== null && v.lon !== null), shown = placed.filter(v => !dayFilter || quizOn(v, dayFilter));
  markers.clearLayers();
  for (const v of shown) {
    const quiz = !!(v.quizNights?.length || v.next);
    const marker = L.marker([v.lat, v.lon], {icon: pinIcon(quiz, shownVenue?.id === v.id), title: v.name, riseOnHover: true});
    marker.bindTooltip(v.quizNights?.length ? `${v.name} · ${nightsText(v.quizNights)}` : v.name);
    marker.on('click', () => {showVenue(v); drawPins();}); marker.addTo(markers);
  }
  const unplaced = mapVenues.venues.length - placed.length;
  $('mapNote').textContent = !mapVenues.venues.length ? 'No venues yet.'
    : dayFilter ? `${shown.length} venue${shown.length === 1 ? '' : 's'} with a quiz on ${dayName(dayFilter)}s. Tap a pin for details.`
    : `${mapVenues.venues.length} venue${mapVenues.venues.length === 1 ? '' : 's'}${unplaced ? ` (${unplaced} not on the map yet)` : ''}. Tap a pin for details.`;
  if (mapVenues.stale) $('mapNote').textContent += ` Offline: from ${ago(mapVenues.fetchedAt)}.`;
  return shown;
}
async function renderMap() {
  if (!window.L || (!client.baseUrl && !venueListUrl)) return;
  $('mapBox').hidden = false; $('dayFilter').hidden = false; renderDays();
  if (!map) {
    map = L.map('map').setView([54.4, -3], 5);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom: 19, referrerPolicy: 'strict-origin-when-cross-origin',
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).addTo(map);
    markers = L.layerGroup().addTo(map);
  }
  map.invalidateSize();
  try {mapVenues = await client.venues();} catch {$('mapNote').textContent = 'The venue map needs an internet connection.'; return;}
  const placed = mapVenues.venues.filter(v => v.lat !== null && v.lon !== null);
  drawPins();
  if (placed.length) map.fitBounds(L.latLngBounds(placed.map(v => [v.lat, v.lon])).pad(0.3), {maxZoom: 14});
}
// A venue's page: its details and upcoming quiz nights.
async function showVenue(v) {
  shownVenue = v;
  const card = $('venueCard'), saved = store.get('beermat-favourites', []).some(f => f.id === v.id);
  const close = el('button', '✕', 'subtle close'); close.type = 'button'; close.setAttribute('aria-label', 'Close'); close.onclick = () => {card.hidden = true; shownVenue = null; drawPins();};
  card.replaceChildren(close, el('h3', v.name), el('p', [v.address, v.town, v.postcode].filter(Boolean).join(', '), 'where'));
  if (v.quizNights?.length) card.append(el('p', `🗓 Quiz night${v.quizNights.length > 1 ? 's' : ''}: ${nightsText(v.quizNights)}`, 'nights'));
  if (v.website) {const site = el('a', 'Website'); site.href = v.website; site.target = '_blank'; site.rel = 'noopener'; card.append(site, document.createTextNode(' · '));}
  const go = el('a', 'Directions'); go.href = directions(v);
  go.target = '_blank'; go.rel = 'noopener'; card.append(go);
  const star = el('button', saved ? '★ Your venue' : '☆ Save venue', 'subtle'); star.type = 'button'; star.onclick = guarded(() => toggleFavourite(v, !saved));
  const upcoming = el('ul', undefined, 'list events');
  card.append(el('br'), star, el('h4', 'Next quiz'), upcoming);
  card.hidden = false; card.scrollIntoView({behavior: 'smooth', block: 'nearest'});
  try {
    const page = await client.venue(v.id);
    if (shownVenue !== v) return;
    const next = page.events.find(e => !dayFilter || weekday(e.startsAt) === dayFilter);
    renderEvents(next ? [next] : [], upcoming);
    if (!next) upcoming.append(el('li', dayFilter && page.events.length ? `None on a ${dayName(dayFilter)} yet.` : 'None published yet.', 'hint'));
  } catch {upcoming.replaceChildren(el('li', 'The next quiz needs a connection to BeerMat Online.', 'hint'));}
}
async function renderFavourites() {
  let list = store.get('beermat-favourites', []);
  if (client.signedIn()) try {const remote = (await client.favourites()).venues; if (remote.length) {list = remote.map(v => ({id: v.id, name: v.name, town: v.town})); store.set('beermat-favourites', list);}} catch {}
  $('favouritesBox').hidden = !list.length;
  $('favourites').replaceChildren(...list.map(v => {const li = el('li'), b = el('button', `${v.name}, ${v.town} — upcoming quizzes`); b.onclick = () => search({q: v.town}); li.append(b); return li;}));
}
$('searchForm').onsubmit = e => {e.preventDefault(); const q = $('search').value.trim(); if (q) search({q});};
// Location is asked for once, only when the player taps the button, and only the rounded position is sent.
$('nearMe').onclick = () => {
  if (!navigator.geolocation) return say('This phone can’t share its location here. Search by town instead.', true);
  say('Finding your location…');
  navigator.geolocation.getCurrentPosition(p => search({lat: p.coords.latitude, lon: p.coords.longitude, radiusKm: 25}),
    () => say('Location not available. Search by town or postcode instead.', true), {enableHighAccuracy: false, timeout: 15000, maximumAge: 600000});
};

renderRecent();
takeClaim().catch(e => say(e.message, true));
if (client.signedIn()) client.flush().catch(() => {});
