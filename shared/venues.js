// The venue list (venues.json in this repository): the venues BeerMat Online shows, added only by editing that file.
// BeerMat Online imports it; the player app reads it straight from GitHub when the service can't be reached.
//   {"venues": [{"id": "red-lion-bristol", "name": "The Red Lion", "town": "Bristol", "postcode": "BS1 4DJ",
//     "address": "1 King Street", "website": "https://…", "lat": 51.4545, "lon": -2.5879,
//     "quizNights": [{"day": "tuesday", "time": "20:00"}]}]}
// Only id, name and town are required. quizNights are its regular weekly quizzes (a day and a 24-hour start time), so
// players can filter by day. A venue's operator can later change everything but its id from their desk.
export const venueId = /^[a-z0-9][a-z0-9-]{1,59}$/;
export const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const limits = {name: 120, town: 80, postcode: 10, address: 200, website: 200};

// Regular quiz nights: at most one a day, in weekday order. Returns {nights} or {error}.
export function checkQuizNights(raw) {
  if (raw === undefined || raw === null) return {nights: []};
  if (!Array.isArray(raw) || raw.length > 7) return {error: 'quizNights must be a list of up to 7 nights'};
  const nights = [];
  for (const night of raw) {
    if (!night || !days.includes(night.day)) return {error: `quiz night day must be one of ${days.join(', ')}`};
    if (typeof night.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(night.time)) return {error: 'quiz night time must be HH:MM (24-hour), e.g. 20:00'};
    if (nights.some(n => n.day === night.day)) return {error: `quiz night on ${night.day} listed twice`};
    nights.push({day: night.day, time: night.time});
  }
  return {nights: nights.sort((a, b) => days.indexOf(a.day) - days.indexOf(b.day))};
}

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
  const {nights, error} = checkQuizNights(raw.quizNights);
  if (error) return {error: `${raw.id}: ${error}`};
  venue.quizNights = nights;
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
