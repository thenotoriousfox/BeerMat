// Each team's result for one quiz, worked out from what the server recorded (answers it marked, points it awarded),
// never from anything a phone says about itself. Kept on the laptop after every quiz, and the basis for player
// statistics and achievements (achievements.js) if a player later links a result to an online profile.
// Plain functions with no Node imports, so the desktop app, the online service and the player app can share them.

// Inputs: teams [{id, name, score, rank}] in leaderboard order; questions [{id, opened, data}] with parsed question
// data; answers [{team, question, points, submitted}]; roundOf(question data) → the round's title, or ''.
export function teamResults({teams, questions, answers, roundOf = data => data.round || ''}) {
  const byId = new Map(questions.map(q => [q.id, q]));
  const category = q => roundOf(q.data) || q.data.round || 'General';
  // Questions per round, to spot a perfect round.
  const rounds = new Map();
  for (const q of questions) rounds.set(category(q), (rounds.get(category(q)) || 0) + 1);
  return teams.map(team => {
    const mine = answers.filter(a => a.team === team.id && byId.has(a.question));
    const right = mine.filter(a => a.points > 0);
    const categories = {};
    for (const a of mine) {
      const c = categories[category(byId.get(a.question))] ||= {answered: 0, correct: 0};
      c.answered++; if (a.points > 0) c.correct++;
    }
    const times = right.filter(a => a.submitted && byId.get(a.question).opened).map(a => a.submitted - byId.get(a.question).opened).filter(ms => ms >= 0);
    const perfectRounds = [...rounds].filter(([name, count]) => count >= 3 && categories[name]?.correct === count).length;
    return {team: team.id, name: team.name, rank: team.rank, teams: teams.length, points: team.score, answered: mine.length, correct: right.length,
      fastestMs: times.length ? Math.min(...times) : null, perfectRounds, categories};
  });
}
