// What the TV page and the connect page share: BeerMat Online's API, and handing a ticket to a quiz laptop.
export const $ = id => document.getElementById(id);
export const say = (text, error = false) => {$('status').textContent = text; $('status').classList.toggle('error', error);};
export async function api(method, route, body, token) {
  const response = await fetch(route, {method, headers: {'Content-Type': 'application/json', ...(token && {Authorization: 'Bearer ' + token})}, ...(body && {body: JSON.stringify(body)})});
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(Error(data.error || 'Something went wrong. Try again in a moment.'), {status: response.status});
  return data;
}
export function store(key, value) {try {value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value);} catch {}}
export function stored(key) {try {return localStorage.getItem(key) || '';} catch {return '';}}
// The ticket travels in the address's #fragment, which never reaches a server: the laptop's page reads it and removes it.
export const ticketParam = ticket => btoa(JSON.stringify(ticket)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
// The laptop's own address on this network answers, where the venue's Wi-Fi lets devices reach each other: faster, and
// it keeps going if the internet drops. A browser on this https page can't ask an http address (BeerMat TV's web view
// can), so otherwise it's the laptop's quizmaster link, through the internet.
export async function reachable(laptop) {
  for (const address of laptop.addresses || []) {
    try {await fetch(address + '/api/hello', {mode: 'no-cors', signal: AbortSignal.timeout(1500)}); return address;} catch {}
  }
  return laptop.link || '';
}
export function choices(list, laptops, pick) {
  list.replaceChildren(...laptops.map(l => {
    const button = document.createElement('button'); button.type = 'button';
    button.textContent = `${l.title || 'Quiz'} — ${l.name}`; button.onclick = () => pick(l);
    return button;
  }));
  list.querySelector('button')?.focus();
}
