// Team-name filter. Words are matched at the start of each word in the name, after undoing common
// letter swaps (sh1t, @rse) and joining spaced-out letters (f u c k), so place names such as
// Scunthorpe or Penistone are not caught. The quizmaster can add more words.
const BUILT_IN = ['arse', 'bastard', 'bellend', 'bitch', 'bollock', 'bugger', 'cock', 'cunt', 'dick', 'dildo', 'fanny', 'fuck', 'knob',
  'minge', 'motherfuck', 'nazi', 'nonce', 'piss', 'prick', 'pussy', 'rape', 'shag', 'shit', 'slag', 'slut', 'spunk', 'tit', 'twat', 'wank', 'whore'];
// Short words that are only blocked as whole words, so "title", "cocktail" or "Dickens" stay allowed.
const WHOLE_WORD = new Set(['arse', 'cock', 'dick', 'knob', 'piss', 'rape', 'shag', 'slag', 'tit', 'tits', 'nazi']);
const swaps = {0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', $: 's', '!': 'i', '|': 'i', '+': 't'};

export function words(name) {
  const plain = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[0134578@$!|+]/g, c => swaps[c] ?? c);
  const tokens = plain.split(/[^a-z]+/).filter(Boolean);
  // "f u c k" or "f.u.c.k" → "fuck"
  const joined = []; let run = '';
  for (const t of tokens) {if (t.length === 1) run += t; else {if (run) joined.push(run); run = ''; joined.push(t);}}
  if (run) joined.push(run);
  return joined;
}

export function offensive(name, extra = []) {
  const list = [...BUILT_IN, ...extra.map(w => w.trim().toLowerCase()).filter(Boolean)];
  return words(name).some(token => list.some(word => WHOLE_WORD.has(word) ? token === word || token === word + 's' : token.startsWith(word)));
}
