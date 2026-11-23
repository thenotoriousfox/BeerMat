// Which screen gets the quiz desk and which the TV (audience) display. Plain data in, plain data out, so it is
// tested without Electron. Displays: [{id, label, internal, bounds: {x, y, width, height}}]. Remembered choices are
// {id, label}: the id is stable while a screen stays plugged in; the label (the TV's name) finds it again after a
// reconnection gives it a new id.

const area = d => d.bounds.width * d.bounds.height;
export const describe = d => ({id: d.id, label: d.label || `Screen ${d.bounds.width}×${d.bounds.height}`});
const find = (displays, wanted) => wanted ? displays.find(d => d.id === wanted.id) || displays.find(d => wanted.label && d.label === wanted.label) || null : null;

export function plan(displays, primaryId, prefs = {}) {
  if (!displays.length) return {desk: null, audience: null, windowed: true};
  const primary = displays.find(d => d.id === primaryId) || displays[0];
  const desk = find(displays, prefs.desk) || primary;
  const others = displays.filter(d => d.id !== desk.id);
  // A remembered TV if it is connected; otherwise an external screen before a built-in one, then the biggest.
  const remembered = find(others, prefs.audience);
  const audience = remembered || [...others].sort((a, b) => (a.internal === true) - (b.internal === true) || area(b) - area(a))[0] || null;
  return {desk, audience, windowed: !audience};
}

// Swapping puts the desk on the TV's screen and the TV on the desk's.
export function swapped(current) {
  return current.audience ? {desk: describe(current.audience), audience: describe(current.desk)} : null;
}
