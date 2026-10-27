// The player side of PubQuiz Online, for the phone app and the web app: signing in, the profile, saving quiz results
// and finding quizzes. Works offline: results wait in an outbox until the service can be reached (sending one twice
// never counts it twice), and quiz listings come from the last search, marked as possibly out of date.
// No Node or browser-only APIs beyond fetch and a storage object with getItem/setItem/removeItem (localStorage).

// venueListUrl: the venue list on GitHub (venues.json), shown on the map when the service can't be reached.
export function createOnlineClient({baseUrl, venueListUrl = '', fetch = globalThis.fetch.bind(globalThis), storage, now = Date.now, timeout = 10000}) {
  const read = (name, fallback) => {try {return JSON.parse(storage.getItem('pq-online:' + name)) ?? fallback;} catch {return fallback;}};
  const write = (name, value) => value === null ? storage.removeItem('pq-online:' + name) : storage.setItem('pq-online:' + name, JSON.stringify(value));
  const base = () => (read('baseUrl', null) || baseUrl || '').replace(/\/$/, '');

  async function api(method, route, body, {headers = {}} = {}) {
    if (!base()) throw Object.assign(Error('PubQuiz Online is not set up in this app'), {offline: true});
    let response;
    try {
      response = await fetch(base() + route, {method, headers: {'Content-Type': 'application/json', ...(read('token', null) ? {Authorization: 'Bearer ' + read('token', null)} : {}), ...headers},
        ...(body === undefined ? {} : {body: JSON.stringify(body)}), signal: AbortSignal.timeout(timeout)});
    } catch {throw Object.assign(Error('No connection to PubQuiz Online'), {offline: true});}
    const data = await response.json().catch(() => ({}));
    if (response.status === 401 && route !== '/v1/sessions') write('token', null);
    if (!response.ok) throw Object.assign(Error(data.error || `PubQuiz Online said ${response.status}`), {status: response.status});
    return data;
  }
  const signedIn = () => !!read('token', null);
  const keep = data => {write('token', data.token); write('profile', data.account); return data.account;};

  // Results: an outbox of signed claims, sent in order whenever possible.
  const outbox = () => read('outbox', []);
  async function flush() {
    const waiting = outbox(), left = [];
    let sent = 0, problem = null;
    for (const item of waiting) {
      if (!signedIn()) {left.push(item); continue;}
      try {await api('POST', '/v1/me/results', {claim: item.claim}, {headers: {'Idempotency-Key': item.key}}); sent++;}
      catch (e) {
        // A result the service will never accept (changed or not from a quiz laptop) is dropped, with the reason kept.
        if (e.status === 422 || e.status === 400) {problem = e.message; write('rejected', [...read('rejected', []), {...item, reason: e.message}].slice(-20));}
        else {left.push(item); problem ||= e.message;}
      }
    }
    write('outbox', left);
    return {sent, waiting: left.length, problem};
  }

  return {
    get baseUrl() {return base();},
    setBaseUrl(url) {write('baseUrl', url || null);},
    signedIn,
    profile: () => read('profile', null),
    async signUp(details) {return keep(await api('POST', '/v1/accounts', details));},
    async signIn(email, password) {const account = keep(await api('POST', '/v1/sessions', {email, password})); await flush().catch(() => {}); return account;},
    async signOut() {try {await api('DELETE', '/v1/sessions');} catch {} write('token', null); write('profile', null);},
    async refreshProfile() {const p = await api('GET', '/v1/me'); write('profile', p); return p;},
    async updateProfile(changes) {const p = await api('PATCH', '/v1/me', changes); write('profile', p); return p;},
    exportData: () => api('GET', '/v1/me/export'),
    async deleteAccount() {const r = await api('DELETE', '/v1/me'); for (const name of ['token', 'profile', 'outbox', 'stats']) write(name, null); return r;},

    // Keeps a team's signed result (from the quiz's "Keep this result") and sends it when it can.
    async saveResult(claim) {
      const key = `${claim.event}:${claim.team}`;
      if (!outbox().some(i => i.key === key)) write('outbox', [...outbox(), {key, claim, added: now()}]);
      return flush();
    },
    outbox,
    rejected: () => read('rejected', []),
    flush,
    results: () => api('GET', '/v1/me/results'),
    async stats() {
      try {const s = await api('GET', '/v1/me/stats'); write('stats', {...s, fetchedAt: now()}); return {...s, stale: false};}
      catch (e) {const cached = read('stats', null); if (e.offline && cached) return {...cached, stale: true}; throw e;}
    },
    forgetResult: (event, team) => api('DELETE', `/v1/me/results/${encodeURIComponent(event)}/${encodeURIComponent(team)}`),

    // Finding quizzes. Offline, the last results for the same search (or the last search of all) come back marked stale.
    async findEvents({q = '', lat, lon, radiusKm} = {}) {
      const params = new URLSearchParams(q ? {q} : {}), cacheKey = q ? 'q:' + q.toLowerCase() : 'near';
      if (lat !== undefined) {params.set('lat', lat.toFixed(3)); params.set('lon', lon.toFixed(3)); if (radiusKm) params.set('radiusKm', radiusKm);}
      const cache = read('events', {});
      try {
        const result = await api('GET', '/v1/events?' + params);
        // Locations are rounded to about 100 m before they leave the phone, and only the results are cached.
        write('events', {...Object.fromEntries(Object.entries(cache).sort((a, b) => b[1].fetchedAt - a[1].fetchedAt).slice(0, 9)), [cacheKey]: {events: result.events, fetchedAt: now()}});
        return {events: result.events, fetchedAt: now(), stale: false};
      } catch (e) {
        const cached = cache[cacheKey];
        if (e.offline && cached) return {...cached, stale: true};
        throw e;
      }
    },
    // Every venue, for the map. Offline: the last list seen (marked stale), else the venue list from GitHub.
    async venues() {
      try {
        const result = await api('GET', '/v1/venues');
        write('venues', {venues: result.venues, fetchedAt: now()});
        return {venues: result.venues, fetchedAt: now(), stale: false, source: 'service'};
      } catch (e) {
        const cached = read('venues', null);
        if (cached) return {...cached, stale: true, source: 'cache'};
        if (!venueListUrl) throw e;
        let list;
        try {list = await (await fetch(venueListUrl, {signal: AbortSignal.timeout(timeout)})).json();} catch {throw e;}
        const venues = (Array.isArray(list?.venues) ? list.venues : []).filter(v => v && typeof v.id === 'string' && typeof v.name === 'string' && typeof v.town === 'string')
          .map(v => ({id: v.id, name: v.name, town: v.town, postcode: v.postcode || '', address: v.address || '', website: /^https:\/\//.test(v.website || '') ? v.website : '',
            lat: typeof v.lat === 'number' ? v.lat : null, lon: typeof v.lon === 'number' ? v.lon : null, quizNights: Array.isArray(v.quizNights) ? v.quizNights.filter(n => n && typeof n.day === 'string' && typeof n.time === 'string') : [], next: null}));
        return {venues, fetchedAt: now(), stale: true, source: 'list'};
      }
    },
    venue: venueId => api('GET', '/v1/venues/' + encodeURIComponent(venueId)),
    favourites: () => api('GET', '/v1/me/favourites'),
    favourite: (venueId, on) => api(on ? 'PUT' : 'DELETE', '/v1/me/favourites/' + encodeURIComponent(venueId)),
    leaderboard: venueId => api('GET', '/v1/leaderboards' + (venueId ? '?venue=' + encodeURIComponent(venueId) : '')),

    // Venue operators.
    myVenues: () => api('GET', '/v1/me/venues'),
    createVenue: details => api('POST', '/v1/venues', details),
    updateVenue: (venueId, details) => api('PATCH', '/v1/venues/' + encodeURIComponent(venueId), details),
    registerLaptop: (venueId, publicKey) => api('POST', `/v1/venues/${encodeURIComponent(venueId)}/keys`, {publicKey}),
    publishEvent: (venueId, details) => api('POST', `/v1/venues/${encodeURIComponent(venueId)}/events`, details),
    updateEvent: (eventId, details) => api('PATCH', '/v1/events/' + encodeURIComponent(eventId), details),
    cancelEvent: eventId => api('DELETE', '/v1/events/' + encodeURIComponent(eventId)),
  };
}
