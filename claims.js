// Signed quiz results. Each PubQuiz install has its own Ed25519 key (made on first use, kept in its database); a
// team's result is signed with it, so the online service can check a result came from a quiz laptop and was not
// typed in by a player. The service only trusts keys a venue has registered (docs/ONLINE.md).
import {generateKeyPairSync, createPrivateKey, createPublicKey, sign, verify, createHash} from 'node:crypto';

// One fixed byte form for signing: keys sorted at every level.
export const canonical = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : v);

export function newVenueKey() {
  const {privateKey, publicKey} = generateKeyPairSync('ed25519');
  return {privateKey: privateKey.export({type: 'pkcs8', format: 'der'}).toString('base64'), publicKey: publicKey.export({type: 'spki', format: 'der'}).toString('base64')};
}

export function signClaim(payload, key) {
  const privateKey = createPrivateKey({key: Buffer.from(key.privateKey, 'base64'), format: 'der', type: 'pkcs8'});
  const body = {...payload, venueKey: key.publicKey};
  return {...body, sig: sign(null, Buffer.from(canonical(body)), privateKey).toString('base64')};
}

export function verifyClaim(claim) {
  try {
    const {sig, ...body} = claim;
    if (typeof sig !== 'string' || typeof body.venueKey !== 'string') return false;
    const publicKey = createPublicKey({key: Buffer.from(body.venueKey, 'base64'), format: 'der', type: 'spki'});
    return publicKey.asymmetricKeyType === 'ed25519' && verify(null, Buffer.from(canonical(body)), publicKey, Buffer.from(sig, 'base64'));
  } catch {return false;}
}

// A short, stable name for a venue key (for display and lookups).
export const keyId = publicKey => createHash('sha256').update(publicKey).digest('hex').slice(0, 16);
