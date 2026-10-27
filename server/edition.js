// What each plan can do. Free BeerMat runs every round format, the TV and the phones, but a quiz stops at three
// questions and three teams, and Spotify is Pro only: enough to try it out. BeerMat Pro (a venue's subscription,
// proved by a signed licence: shared/licence.js) lifts the limits. Players never pay and never see a plan.
// Code that differs by plan asks has(feature) or reads limits instead of deciding for itself.

export const editions = {
  free: {name: 'BeerMat Free', limits: {questions: 3, teams: 3}, features: []},
  pro: {name: 'BeerMat Pro', limits: null, features: ['spotify']},
};

export function edition(plan = 'free') {
  const chosen = editions[plan] ? plan : 'free', {name, limits, features} = editions[chosen];
  return {plan: chosen, name, limits, has: feature => features.includes(feature)};
}
