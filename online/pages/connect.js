// BeerMat Online's connect page (/connect): a phone signed in to the account approves a TV (#tv=…, from the TV's QR
// code), or runs the quiz from the phone's browser: it picks one of the account's open laptops and opens that laptop's
// phone deck with a ticket.
import {$, say, api, store, stored, ticketParam, reachable, choices} from './link.js';

const SESSION = 'beermat-connect';
const pairing = new URLSearchParams(location.hash.slice(1)).get('tv');
if (pairing) history.replaceState(null, '', location.pathname);

function signIn() {
  $('signIn').hidden = false; $('tv').hidden = $('deck').hidden = true; $('signOut').hidden = true;
  $('signIn').onsubmit = async e => {
    e.preventDefault();
    try {
      const {token} = await api('POST', '/v1/sessions', {email: $('email').value, password: $('password').value});
      store(SESSION, token); $('password').value = ''; start();
    } catch (error) {say(error.message, true);}
  };
}

async function start() {
  const token = stored(SESSION);
  if (!token) return signIn();
  $('signIn').hidden = true; $('signOut').hidden = false; say('');
  if (pairing) {
    $('heading').textContent = 'Sign in a TV'; $('tv').hidden = false;
    $('approve').onclick = async () => {
      try {await api('POST', `/v1/tv-pairings/${pairing}/approve`, {}, token); $('tv').hidden = true; say('Done: the TV is opening the quiz. You can close this page.');}
      catch (e) {if (e.status === 401) {store(SESSION, null); return signIn();} say(e.message, true);}
    };
    return;
  }
  try {
    const laptops = (await api('GET', '/v1/me/desks', null, token)).desks.filter(d => d.role !== 'remote');
    $('deck').hidden = false;
    if (!laptops.length) return say('No quiz laptop is open on your account. Open BeerMat on the laptop, signed in to BeerMat Online.');
    choices($(‘laptops’), laptops, async laptop => {
      try {
        // Try the laptop directly first (quiz Wi-Fi or LAN); fall back to the relay through BeerMat Online.
        const base = await reachable(laptop);
        if (base) {
          const {ticket} = await api(‘POST’, ‘/v1/desk-tickets’, {venueKey: laptop.venueKey, role: ‘deck’}, token);
          return location.href = `${base}/deck#ticket=${ticketParam(ticket)}`;
        }
        // The laptop isn’t directly reachable: use the relay (commands and state go through BeerMat Online).
        const {keyId, token: relayToken} = await api(‘POST’, ‘/v1/relay/connect’, {venueKey: laptop.venueKey}, token);
        location.href = `/relay-deck#keyId=${encodeURIComponent(keyId)}&token=${encodeURIComponent(relayToken)}`;
      } catch (e) {say(e.message, true);}
    });
  } catch (e) {if (e.status === 401) {store(SESSION, null); return signIn();} say(e.message, true);}
}
$('signOut').onclick = () => {store(SESSION, null); signIn();};
start();
