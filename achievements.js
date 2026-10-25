// Player statistics and achievements from a history of quiz results (results.js), oldest first. Each history entry:
// {event, venue, venueName, date, result: {rank, teams, points, answered, correct, fastestMs, perfectRounds, categories}}.
// The online service only feeds this results signed by a quiz laptop (claims.js), so a phone cannot award itself
// anything. A team is not one person: everyone who links the same team result shares it.

export const badges = [
  {id: 'first-quiz', name: 'First Quiz', description: 'Played a quiz', test: s => s.quizzes >= 1},
  {id: 'first-win', name: 'First Win', description: 'Won a quiz', test: s => s.wins >= 1},
  {id: 'podium', name: 'On the Podium', description: 'Finished in the top three', test: s => s.podiums >= 1},
  {id: 'perfect-round', name: 'Perfect Round', description: 'Every answer right in a round of three or more', test: s => s.perfectRounds >= 1},
  {id: 'fastest-finger', name: 'Fastest Finger', description: 'A right answer within 3 seconds', test: s => s.fastestMs !== null && s.fastestMs <= 3000},
  {id: 'ten-quizzes', name: 'Ten Quizzes Played', description: 'Played ten quizzes', test: s => s.quizzes >= 10},
  {id: 'fifty-correct', name: 'Fifty Correct Answers', description: 'Fifty right answers in total', test: s => s.correct >= 50},
  {id: 'quiz-regular', name: 'Quiz Regular', description: 'Four quizzes at the same venue', test: s => Object.values(s.venues).some(v => v.quizzes >= 4)},
];

export function summarize(history) {
  const s = {quizzes: 0, wins: 0, podiums: 0, answered: 0, correct: 0, accuracy: 0, points: 0, fastestMs: null, perfectRounds: 0, categories: {}, venues: {}, timeline: []};
  for (const h of history) {
    const r = h.result;
    s.quizzes++; s.answered += r.answered; s.correct += r.correct; s.points += r.points; s.perfectRounds += r.perfectRounds || 0;
    if (r.rank === 1) s.wins++;
    if (r.rank <= 3) s.podiums++;
    if (r.fastestMs !== null && r.fastestMs !== undefined && (s.fastestMs === null || r.fastestMs < s.fastestMs)) s.fastestMs = r.fastestMs;
    for (const [name, c] of Object.entries(r.categories || {})) {
      const total = s.categories[name] ||= {answered: 0, correct: 0};
      total.answered += c.answered; total.correct += c.correct;
    }
    const venue = s.venues[h.venue] ||= {name: h.venueName || '', quizzes: 0, wins: 0, points: 0};
    venue.quizzes++; venue.points += r.points; if (r.rank === 1) venue.wins++;
    s.timeline.push({event: h.event, date: h.date, rank: r.rank, teams: r.teams, points: r.points});
  }
  s.accuracy = s.answered ? Math.round(s.correct / s.answered * 1000) / 10 : 0;
  return s;
}

// Each badge with the date of the result that earned it (replaying the history in order).
export function achievements(history) {
  const sorted = [...history].sort((a, b) => a.date - b.date), earned = new Map();
  for (let i = 1; i <= sorted.length; i++) {
    const stats = summarize(sorted.slice(0, i));
    for (const b of badges) if (!earned.has(b.id) && b.test(stats)) earned.set(b.id, sorted[i - 1].date);
  }
  return badges.filter(b => earned.has(b.id)).map(({id, name, description}) => ({id, name, description, earnedAt: earned.get(id)}));
}
