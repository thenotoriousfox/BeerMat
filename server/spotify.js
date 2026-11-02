import os from 'node:os';
// Optional Spotify control for music rounds. The laptop's own Spotify app does the playing; this only tells it what
// to play, over D-Bus when it's on this laptop (Linux), else through Spotify's Web API. Sign-in uses PKCE (no app secret). Tokens stay in the quiz database on this laptop.
// Needs internet on the laptop (e.g. hotspot.py --keep-wifi) and Spotify Premium for playback control.
import {randomBytes, createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {QuizError, requireValue} from './model.js';

// streaming, user-read-email and user-read-private let the quiz desk itself be a Spotify player (Web Playback SDK).
const SCOPES = 'user-read-playback-state user-modify-playback-state playlist-read-private playlist-read-collaborative streaming user-read-email user-read-private';
const base64url = buffer => buffer.toString('base64url');
export const trackId = link => /(?:spotify:track:|open\.spotify\.com\/(?:intl-[a-z-]+\/)?track\/)([A-Za-z0-9]{22})/.exec(link || '')?.[1] || null;
export const playlistId = link => /(?:spotify:playlist:|open\.spotify\.com\/(?:intl-[a-z-]+\/)?playlist\/)([A-Za-z0-9]{22})/.exec(link || '')?.[1] || null;
const songTitle = track => `${track.name}${track.artists?.length ? ' — ' + track.artists.map(a => a.name).join(', ') : ''}`.slice(0, 100);

// The Spotify app on this laptop, told what to play over D-Bus (MPRIS, Linux). Its Spotify Connect link can stop
// answering: Spotify then accepts a play and the app does nothing, while D-Bus still reaches it.
const mpris = (...args) => new Promise((resolve, reject) => execFile('gdbus', ['call', '--session', '--dest', 'org.mpris.MediaPlayer2.spotify', '--object-path', '/org/mpris/MediaPlayer2', '--method', ...args], {timeout: 3000}, e => e ? reject(e) : resolve()));
export const appOnThisLaptop = process.platform !== 'linux' ? null : {
  async play(uri, startSeconds) {
    await mpris('org.mpris.MediaPlayer2.Player.OpenUri', uri);
    if (startSeconds) {await new Promise(r => setTimeout(r, 600)); await mpris('org.mpris.MediaPlayer2.Player.Seek', String(startSeconds * 1e6));}
  },
  pause: () => mpris('org.mpris.MediaPlayer2.Player.Pause')
};

export function createSpotify({getMeta, setMeta, now, accountsUrl = 'https://accounts.spotify.com', apiUrl = 'https://api.spotify.com/v1', localApp = apiUrl === 'https://api.spotify.com/v1' ? appOnThisLaptop : null}) {
  const saved = () => getMeta('spotify', {});
  const save = changes => setMeta('spotify', {...saved(), ...changes});
  let pending = null;

  function authorizeUrl(clientId, redirectUri) {
    requireValue(typeof clientId === 'string' && /^[0-9a-f]{32}$/i.test(clientId.trim()), 'Paste the 32-character Client ID from your Spotify app');
    const verifier = base64url(randomBytes(64)), state = base64url(randomBytes(16));
    pending = {state, verifier, clientId: clientId.trim(), redirectUri, expires: now() + 10 * 60 * 1000};
    save({clientId: pending.clientId});
    const params = new URLSearchParams({client_id: pending.clientId, response_type: 'code', redirect_uri: redirectUri, scope: SCOPES, state,
      code_challenge_method: 'S256', code_challenge: base64url(createHash('sha256').update(verifier).digest())});
    return `${accountsUrl}/authorize?${params}`;
  }
  async function tokenRequest(form) {
    let response;
    try {response = await fetch(`${accountsUrl}/api/token`, {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'}, body: new URLSearchParams(form)});}
    catch {throw new QuizError('Could not reach Spotify. Is this laptop online?', 502);}
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new QuizError(`Spotify sign-in failed: ${body.error_description || body.error || response.status}`, 502);
    // Refresh responses may or may not rotate the refresh token.
    save({accessToken: body.access_token, expiresAt: now() + body.expires_in * 1000, ...(body.refresh_token ? {refreshToken: body.refresh_token} : {}), ...(body.scope ? {scope: body.scope} : {})});
  }
  async function callback(code, state) {
    requireValue(pending && state === pending.state && now() < pending.expires, 'This Spotify sign-in link has expired. Press Connect Spotify again.', 400);
    const {verifier, clientId, redirectUri} = pending; pending = null;
    requireValue(typeof code === 'string' && code, 'Spotify did not send a sign-in code', 400);
    await tokenRequest({grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: clientId, code_verifier: verifier});
    const me = await api('GET', '/me').catch(() => null);
    save({user: me?.display_name || me?.id || ''});
  }
  async function token() {
    const s = saved();
    requireValue(s.refreshToken, 'Connect Spotify first (Build quiz → Spotify)', 409);
    if (!s.accessToken || s.expiresAt - 60000 < now()) await tokenRequest({grant_type: 'refresh_token', refresh_token: s.refreshToken, client_id: s.clientId});
    return saved().accessToken;
  }
  async function api(method, path, body, retry = true) {
    let response;
    try {response = await fetch(apiUrl + path, {method, headers: {Authorization: 'Bearer ' + await token(), ...(body ? {'Content-Type': 'application/json'} : {})}, body: body ? JSON.stringify(body) : undefined});}
    catch (e) {if (e instanceof QuizError) throw e; throw new QuizError('Could not reach Spotify. Is this laptop online?', 502);}
    if (response.status === 401 && retry) {save({accessToken: null}); return api(method, path, body, false);}
    const text = await response.text(), data = text ? JSON.parse(text) : null;
    if (response.ok) return data;
    const reason = data?.error?.reason, detail = data?.error?.message || response.status;
    if (reason === 'NO_ACTIVE_DEVICE' || (response.status === 404 && path.startsWith('/me/player'))) throw Object.assign(new QuizError('No Spotify player found. Open the Spotify app on this laptop and play any song once (or press “Start Spotify player” on the browser desk), then try again.', 409), {noPlayer: true});
    if (reason === 'PREMIUM_REQUIRED') throw new QuizError('Playing songs from the quiz needs Spotify Premium.', 409);
    throw new QuizError(`Spotify: ${detail}`, response.status === 404 ? 404 : 502);
  }
  async function status() {
    const s = saved(), connected = !!s.refreshToken;
    let devices = [];
    if (connected) try {devices = ((await api('GET', '/me/player/devices'))?.devices || []).map(d => ({id: d.id, name: d.name, type: d.type, active: d.is_active}));} catch {}
    // Connections made before the desk player existed lack the streaming permission and must reconnect to use it.
    return {connected, clientId: s.clientId || '', user: s.user || '', device: s.device || '', devices, deskPlayer: connected && (s.scope || '').split(' ').includes('streaming')};
  }
  // Playlist items: newer apps read /items, older ones /tracks; each entry holds the song as `item` or `track`.
  async function playlist(link) {
    const id = playlistId(link); requireValue(id, 'Paste a Spotify playlist link (open.spotify.com/playlist/…)');
    let next = `/playlists/${id}/items?limit=100`, songs = [];
    try {await api('GET', next);} catch (e) {if (e.status !== 404) throw e; next = `/playlists/${id}/tracks?limit=100`;}
    while (next && songs.length < 300) {
      let page;
      try {page = await api('GET', next);}
      catch (e) {if (e.status === 404) throw new QuizError('Spotify could not open that playlist. Playlists made by Spotify itself cannot be read by personal apps — copy the songs into a playlist of your own.', 404); throw e;}
      for (const entry of page.items || []) {const t = entry.track || entry.item; if (t?.type === 'track' && trackId(t.uri)) songs.push({title: songTitle(t), spotify: t.uri});}
      next = page.next ? page.next.slice(page.next.indexOf('/playlists/')) : null;
    }
    return songs.slice(0, 300);
  }
  async function tracks(links) {
    requireValue(Array.isArray(links) && links.length && links.length <= 30, 'Paste 1–30 Spotify track or playlist links');
    const songs = [];
    for (const link of links) {
      if (playlistId(link)) {songs.push(...await playlist(link)); continue;}
      const id = trackId(link); requireValue(id, `Not a Spotify track link: ${String(link).slice(0, 80)}`);
      songs.push({title: songTitle(await api('GET', `/tracks/${id}`)), spotify: `spotify:track:${id}`});
    }
    return songs.slice(0, 300);
  }
  async function accessToken() {const value = await token(); return {accessToken: value, expiresAt: saved().expiresAt};}
  // The Spotify app on this laptop plays it when it's open and no other player is chosen. Otherwise, with no player
  // chosen, Spotify plays on the one in use; when none is (the app open but idle), or the chosen one has gone (the app
  // closed, or Spotify gave it a new id), BeerMat picks one itself rather than refuse: the Spotify app on this laptop,
  // else another computer, else any player there is.
  let playedHere = false;
  async function play(uri, startSeconds = 0) {
    const body = {uris: [uri], position_ms: startSeconds * 1000}, chosen = saved().device, here = os.hostname().toLowerCase();
    playedHere = false;
    const devices = async () => (await api('GET', '/me/player/devices').catch(() => null))?.devices?.filter(d => !d.is_restricted) || [];
    if (localApp && (!chosen || (await devices()).some(d => d.id === chosen && d.name.toLowerCase() === here))) {
      await token();
      playedHere = await localApp.play(uri, startSeconds).then(() => true, () => false);
      if (playedHere) return null;
    }
    try {return await api('PUT', `/me/player/play${chosen ? '?device_id=' + encodeURIComponent(chosen) : ''}`, body);}
    catch (e) {
      if (!e.noPlayer) throw e;
      const players = await devices();
      if (chosen && players.some(d => d.id === chosen)) throw e;
      const computers = players.filter(d => d.type === 'Computer');
      const pick = computers.find(d => d.name.toLowerCase() === here) || computers[0] || players[0];
      if (!pick) throw e;
      return api('PUT', `/me/player/play?device_id=${encodeURIComponent(pick.id)}`, body);
    }
  }
  // The chosen player, or (once it has gone) whichever is playing; the app on this laptop when it was told directly.
  async function pause() {
    if (playedHere && await localApp.pause().then(() => true, () => false)) return;
    return api('PUT', `/me/player/pause${saved().device ? '?device_id=' + encodeURIComponent(saved().device) : ''}`)
      .catch(e => e.noPlayer && saved().device ? api('PUT', '/me/player/pause').catch(() => {}) : undefined);
  }
  function device(id) {requireValue(typeof id === 'string' && id.length <= 200, 'Unknown Spotify player'); save({device: id});}
  function disconnect() {setMeta('spotify', {clientId: saved().clientId || ''});}
  return {authorizeUrl, callback, status, accessToken, playlist, tracks, play, pause, device, disconnect, connected: () => !!saved().refreshToken};
}
