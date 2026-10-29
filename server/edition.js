// What each plan can do. BeerMat Free makes and rehearses quizzes without limits: every round format, the TV, simulated
// teams, and real phones joining to test their connection. Hosting a live quiz with real teams is BeerMat Pro (a
// venue's subscription, proved by a signed licence: shared/licence.js), as are Spotify and adding from the shared
// buzzer and theme libraries. Players never pay and never see a plan. Code that differs by plan asks has(feature).

export const editions = {
  free: {name: 'BeerMat Free', features: []},
  pro: {name: 'BeerMat Pro', features: ['live', 'spotify', 'buzzerLibrary', 'themeLibrary']},
};

export function edition(plan = 'free') {
  const chosen = editions[plan] ? plan : 'free', {name, features} = editions[chosen];
  return {plan: chosen, name, live: features.includes('live'), has: feature => features.includes(feature)};
}
