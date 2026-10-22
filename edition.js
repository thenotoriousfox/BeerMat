// Where a future Free/Pro split would plug in. Nothing is enforced and nothing is for sale: every edition has every
// feature, and there is no licence check, payment or account involved. Code that might one day differ by edition
// asks has(feature) instead of deciding for itself, so a later change stays in this one file.
// Gameplay, guest play, offline play and a player's own data will always be in every edition (docs/ARCHITECTURE.md).

export const features = ['quiz', 'allFormats', 'desktopApp', 'hotspot', 'venueNetwork', 'onlineMode', 'tvScreens', 'soundPacks', 'spotify', 'resultsHistory', 'onlineProfiles', 'eventListings'];
export const editions = {free: {name: 'PubQuiz', features}, pro: {name: 'PubQuiz Pro', features}};

export function edition(name = process.env.PUBQUIZ_EDITION || 'free') {
  const chosen = editions[name] || editions.free;
  return {name: chosen.name, has: feature => chosen.features.includes(feature)};
}
