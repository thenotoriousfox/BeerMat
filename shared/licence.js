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

// A deck ticket: BeerMat Online saying that this account runs the venue a laptop belongs to (or is a BeerMat admin), so
// its phone may host that laptop's quiz (the phone deck). Signed with the licence key, for one laptop, for minutes.
export function signDeckTicket(payload, privateKey) {
  const key = createPrivateKey({key: Buffer.from(privateKey, 'base64'), format: 'der', type: 'pkcs8'});
  const body = {v: 1, kind: 'beermat.deck-ticket', ...payload};
  return {...body, sig: sign(null, Buffer.from(canonical(body)), key).toString('base64')};
}

// The ticket's details when it is genuine, for this laptop and not expired; otherwise null.
export function readDeckTicket(ticket, {venueKey, now, publicKey = licencePublicKey}) {
  try {
    const {sig, ...body} = ticket;
    if (body.v !== 1 || body.kind !== 'beermat.deck-ticket' || body.venueKey !== venueKey || !(body.expires > now) || !(body.expires - now < 15 * 60000)) return null;
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
