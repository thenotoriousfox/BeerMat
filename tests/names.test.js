import {test} from 'node:test';
import assert from 'node:assert/strict';
import {offensive} from '../names.js';

test('team-name filter blocks disguised swearing but not place names or ordinary words', () => {
  for (const name of ['Sh1t Hot', 'F u c k it', 'f.u.c.k', 'The W@nkers', 'Fück off', 'Quiz Arse', 'Twats United']) assert.equal(offensive(name), true, name);
  for (const name of ['Scunthorpe United', 'Arsenal Fans', 'Titanic Trivia', 'Cocktail Crew', 'Dickens Readers', 'Grape Escape', 'Penistone Pals', 'Café Crew', 'Spartans']) assert.equal(offensive(name), false, name);
  assert.equal(offensive('Team Bob'), false); assert.equal(offensive('Team Bob', ['bob']), true);
});
