// The venue list (venues.json in this repository): the venues PubQuiz Online shows, added only by editing that file.
// PubQuiz Online imports it; the player app reads it straight from GitHub when the service can't be reached.
//   {"venues": [{"id": "red-lion-bristol", "name": "The Red Lion", "town": "Bristol", "postcode": "BS1 4DJ",
//     "address": "1 King Street", "website": "https://…", "lat": 51.4545, "lon": -2.5879, "quizNight": "Tuesdays, 8pm"}]}
// Only id, name and town are required. A venue's operator can later change everything but its id from their desk.
export const venueId = /^[a-z0-9][a-z0-9-]{1,59}$/;
const limits = {name: 120, town: 80, postcode: 10, address: 200, website: 200, quizNight: 120};

// Checks one venue; returns {venue} with tidied fields, or {error}.
export function checkVenue(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {error: 'not an object'};
  if (typeof raw.id !== 'string' || !venueId.test(raw.id)) return {error: 'id must be 2–60 lower-case letters, digits or dashes'};
  const venue = {id: raw.id};
  for (const [key, max] of Object.entries(limits)) {
    const value = raw[key] ?? '';
    if (typeof value !== 'string' || value.trim().length > max || /[\u0000-\u001f]/.test(value)) return {error: `${raw.id}: ${key} must be text up to ${max} characters`};
    venue[key] = value.trim();
  }
  if (!venue.name || !venue.town) return {error: `${raw.id}: name and town are required`};
  if (venue.website && !/^https:\/\/[^\s]+$/.test(venue.website)) return {error: `${raw.id}: website must start with https://`};
  venue.postcode = venue.postcode.toUpperCase();
  const located = raw.lat !== undefined && raw.lat !== null;
  if (located !== (raw.lon !== undefined && raw.lon !== null)) return {error: `${raw.id}: give both lat and lon, or neither`};
  if (located && !(typeof raw.lat === 'number' && raw.lat >= -90 && raw.lat <= 90 && typeof raw.lon === 'number' && raw.lon >= -180 && raw.lon <= 180)) return {error: `${raw.id}: lat/lon out of range`};
  venue.lat = located ? raw.lat : null; venue.lon = located ? raw.lon : null;
  return {venue};
}

// The whole file: every valid venue, and what is wrong with the rest (a bad entry never hides the good ones).
export function parseVenueList(json) {
  const venues = [], errors = [], seen = new Set();
  const list = json && Array.isArray(json.venues) ? json.venues : null;
  if (!list) return {venues, errors: ['venues.json must be {"venues": [...]}']};
  for (const raw of list) {
    const {venue, error} = checkVenue(raw);
    if (error) errors.push(error);
    else if (seen.has(venue.id)) errors.push(`${venue.id}: listed twice`);
    else {seen.add(venue.id); venues.push(venue);}
  }
  return {venues, errors};
}
