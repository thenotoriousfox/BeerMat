// BeerMat Pro licences. BeerMat Online signs one for a venue's quiz laptop (named by its venue key, shared/claims.js),
// saying which plan the venue has and until when. The laptop checks it with the public key below, without the internet,
// so a quiz never depends on reaching the service. The private key is kept off the repository, on the server only
// (online/deploy.sh: LICENCE_KEY_FILE).
import {createPrivateKey, createPublicKey, sign, verify} from 'node:crypto';
import {canonical} from './claims.js';

export const licencePublicKey = 'MCowBQYDK2VwAyEAajFdMySbs9cbom1ZfbFHvDls7+bBuTQ8by/8cJ28Gnw=';
export const plans = ['free', 'pro'];

export function signLicence(payload, privateKey) {
  const key = createPrivateKey({key: Buffer.from(privateKey, 'base64'), format: 'der', type: 'pkcs8'});
  const body = {v: 1, kind: 'beermat.licence', ...payload};
  return {...body, sig: sign(null, Buffer.from(canonical(body)), key).toString('base64')};
}

// A deck ticket: BeerMat Online saying that this account may use a laptop (it runs the laptop's venue, the laptop is
// signed in to it, or it's a BeerMat admin), as a phone deck, another desk or a TV. Signed with the licence key, for
// one laptop, for minutes.
export function signDeckTicket(payload, privateKey) {
  const key = createPrivateKey({key: Buffer.from(privateKey, 'base64'), format: 'der', type: 'pkcs8'});
  const body = {v: 1, kind: 'beermat.deck-ticket', ...payload};
  return {...body, sig: sign(null, Buffer.from(canonical(body)), key).toString('base64')};
}

// The ticket's details when it is genuine, for this laptop, for one of `roles` and not expired; otherwise null. Its
// role: 'deck' (a phone hosting; tickets from before roles have none), 'desk' (another BeerMat desk running this
// laptop's quiz) or 'tv' (a TV showing it). The laptop also keeps each ticket's nonce until it expires: once only.
export function readDeckTicket(ticket, {venueKey, now, publicKey = licencePublicKey, roles = ['deck', 'desk']}) {
  try {
    const {sig, ...body} = ticket;
    if (body.v !== 1 || body.kind !== 'beermat.deck-ticket' || body.venueKey !== venueKey || !(body.expires > now) || !(body.expires - now < 15 * 60000)) return null;
    if (!roles.includes(body.role || 'deck')) return null;
    const key = createPublicKey({key: Buffer.from(publicKey, 'base64'), format: 'der', type: 'spki'});
    return verify(null, Buffer.from(canonical(body)), key, Buffer.from(sig, 'base64')) ? body : null;
  } catch {return null;}
}

// The licence's details when it is genuine, for this laptop and not expired; otherwise null.
export function readLicence(licence, {venueKey, now, publicKey = licencePublicKey}) {
  try {
    const {sig, ...body} = licence;
    if (body.v !== 1 || body.kind !== 'beermat.licence' || body.venueKey !== venueKey || !plans.includes(body.plan) || !(body.expires > now)) return null;
    const key = createPublicKey({key: Buffer.from(publicKey, 'base64'), format: 'der', type: 'spki'});
    return verify(null, Buffer.from(canonical(body)), key, Buffer.from(sig, 'base64')) ? body : null;
  } catch {return null;}
}
