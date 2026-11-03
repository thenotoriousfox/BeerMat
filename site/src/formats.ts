// Every round format, as the desk names them (TYPE_NAMES in native/beermat_desk/desk.py), grouped for the website.
// Each has a phone screenshot (public/shots): scripts/site-screenshots-formats.mjs takes the phone-format-* ones,
// site-screenshots-android.mjs the rest.
export type Format = {id: string; name: string; teams: string; text: string; shot: string};
export const formatGroups: {title: string; intro: string; formats: Format[]}[] = [
	{title: 'Tap or type', intro: 'The everyday formats: a button or a box on every phone, marked as answers arrive.', formats: [
		{id: 'choice', name: 'Multiple choice', teams: 'Lettered buttons', text: 'Up to eight options, with a speed bonus if you like and an optional 50/50 per team. Switch it to True or false, or Before or after, for two big buttons.', shot: 'phone-choice'},
		{id: 'multi', name: 'Tick all that apply', teams: 'Lettered ticks', text: 'Each right tick earns a share of the points, each wrong one takes a share away.', shot: 'phone-format-multi'},
		{id: 'letter', name: 'Letter keypad', teams: 'An A–Z keypad', text: 'The first letter of the answer: quick to play, quick to mark.', shot: 'phone-format-letter'},
		{id: 'number', name: 'Number', teams: 'A number box', text: 'An exact answer, or within a margin you set: ± a number or ± a percentage.', shot: 'phone-format-number'},
		{id: 'text', name: 'Typed answer', teams: 'A text box', text: 'Marked as it arrives, with alternative spellings. You have the final say.', shot: 'phone-format-text'},
		{id: 'sheet', name: 'Answer sheet', teams: 'Several boxes', text: 'Artist and title, or ten capitals: a point an item, a share each, or all or nothing. Can carry a picture or a song.', shot: 'phone-format-sheet'},
		{id: 'vote', name: 'Vote', teams: 'Lettered buttons', text: 'No right answer: the room decides, and the TV shows the tally.', shot: 'phone-format-vote'},
	]},
	{title: 'Pictures, sound and video', intro: 'The TV does the showing; phones do the answering.', formats: [
		{id: 'picture', name: 'Picture', teams: 'A text box', text: 'A picture on the TV and phones. It can start blurred or under tiles and show itself as the clock runs down.', shot: 'phone-reveal'},
		{id: 'audio', name: 'Audio', teams: 'A text box', text: 'A sound or a song played through the laptop, or a Spotify track from a start time.', shot: 'phone-format-audio'},
		{id: 'video', name: 'Video', teams: 'A text box (“Watch the TV”)', text: 'A clip plays on the TV as the question opens. Play again or stop it from the desk or your phone.', shot: 'phone-format-video'},
		{id: 'clips', name: 'Sound clips', teams: 'One big THIS ONE! button', text: 'Several clips play in turn; teams tap during the right one. The quicker the tap, the bigger the bonus.', shot: 'phone-format-clips'},
		{id: 'pinpoint', name: 'Pinpoint', teams: 'The picture, to tap', text: 'Tap the spot on a map or picture, with an optional second guess, or find several places on one picture.', shot: 'phone-pinpoint'},
	]},
	{title: 'Puzzles', intro: 'Something to work out round the table.', formats: [
		{id: 'wordsnake', name: 'Word trail', teams: 'A grid of letters', text: 'The answer runs through touching letters; teams trace it. A fresh grid every time, and an optional hint.', shot: 'phone-wordsnake'},
		{id: 'tiles', name: 'Letter tiles', teams: 'Shuffled tiles', text: 'The answer cut into tiles, shuffled differently on every phone; teams put it back together.', shot: 'phone-tiles'},
		{id: 'sequence', name: 'Put in order', teams: 'Items to tap in order', text: 'Oldest to newest, smallest to biggest. Give each item a song and teams order the songs as they play.', shot: 'phone-sequence'},
		{id: 'pairs', name: 'Matching pairs', teams: 'A choice for each item', text: 'Match each capital to its country, each actor to their role. A point for every right pair.', shot: 'phone-format-pairs'},
		{id: 'sort', name: 'Sort into groups', teams: 'A group for each item', text: 'Two to five groups: fruit or vegetable, river or mountain. A point for every item in its group.', shot: 'phone-format-sort'},
		{id: 'links', name: 'Link groups', teams: 'Items to group, and the links to name', text: 'Items from several groups mixed together: find each group, then name what links it. Points for each.', shot: 'phone-format-links'},
	]},
	{title: 'Guesses and lists', intro: 'Formats where nearly right still counts.', formats: [
		{id: 'nearest', name: 'Nearest wins', teams: 'A number box', text: 'Closest scores most, on a sliding scale; switch on “closest without going over”. Also the tie-breaker.', shot: 'phone-format-nearest'},
		{id: 'list', name: 'List answers', teams: 'A box for each answer', text: '“Name as many as you can”: a point for every accepted answer, in any order.', shot: 'phone-format-list'},
		{id: 'survey', name: 'Survey', teams: 'A text box', text: '“We asked 100 people…”: an answer scores what it was worth on your list, and the reveal ranks them.', shot: 'phone-format-survey'},
		{id: 'clues', name: 'Progressive clues', teams: 'A text box, with the clues so far', text: 'Clues appear one by one, hardest first. Answer on the first clue for full points, each later one is worth less.', shot: 'phone-format-clues'},
	]},
	{title: 'Live in the room', intro: 'For when the whole pub should be shouting.', formats: [
		{id: 'buzzer', name: 'Buzz-in', teams: 'A big BUZZ button', text: 'First in answers out loud; a wrong answer passes to the next team. Every team has its own buzzer sound.', shot: 'phone-buzzer'},
		{id: 'bingo', name: 'Bingo', teams: 'Their own 90-ball ticket', text: 'You call the numbers; teams dab and claim. The desk checks every claim.', shot: 'phone-bingo'},
		{id: 'musicbingo', name: 'Music bingo', teams: 'A ticket of song titles', text: 'Songs play at random; teams dab what they hear, and the quickest go up on the TV.', shot: 'phone-reactions'},
	]},
];
export const formatCount = formatGroups.reduce((n, g) => n + g.formats.length, 0);

// Ways to play any round: options a question or the night can have, beyond its format. Each with a picture of it: a
// phone (phone-*, site-screenshots-formats.mjs and site-screenshots-android.mjs), the TV or desk (tv-*, desk-*,
// site-screenshots-native.py), or a clip (public/clips, site-videos-native.py).
export type Picture = {kind: 'phone' | 'tv' | 'desk' | 'clip'; name: string};
export const extras: [string, string, Picture][] = [
	['Picture reveals', 'A picture starts blurred, or under twelve tiles, and shows itself as the clock runs down. The quicker you guess, the less you saw.', {kind: 'clip', name: 'tv-reveal-tiles'}],
	['Wagers', 'Teams choose how many points to stake on their answer: won if right, lost if wrong.', {kind: 'phone', name: 'phone-extra-wager'}],
	['Risk It', 'A wrong answer loses the points it would have won.', {kind: 'phone', name: 'phone-extra-riskit'}],
	['VAR Check', 'A team that thinks it was marked wrong appeals from its phone; the TV plays the drum roll and shows your decision.', {kind: 'tv', name: 'tv-var'}],
	['Send Question', 'The TV tells the room to listen while you read the question out; phones get it, and the clock starts, when you send it.', {kind: 'tv', name: 'tv-sendquestion'}],
	['Six fixed buttons', 'Multiple choice always shows A–F on phones, so nobody can tell the last option before you read it.', {kind: 'phone', name: 'phone-extra-sixbuttons'}],
	['Questions on the fly', 'Ask one that isn’t in the quiz, and set its answer once answers close.', {kind: 'desk', name: 'desk-fly'}],
	['Fast Track and wheels', 'Put a team straight into first place, or spin for it; team wheels, random numbers and rollover jackpots that grow every week.', {kind: 'tv', name: 'tv-fasttrack'}],
	['Reaction table', 'In music bingo, teams dab the song as soon as they know it; the quickest go up on the TV.', {kind: 'tv', name: 'tv-reactions'}],
	['Secret rounds', 'Usually the last round: nobody sees how they did, and the leaderboard stays hidden, until you end the quiz and show the winner.', {kind: 'tv', name: 'tv-secret'}],
	['Wipeout', 'Tick all that apply, where any wrong tick scores nothing.', {kind: 'phone', name: 'phone-extra-wipeout'}],
	['Tie-breakers', 'A nearest-wins question outside the scores, played only when teams are level for first. The closest team fills the TV.', {kind: 'tv', name: 'tv-tiebreaker'}],
	['Team groups', 'Put teams in groups, such as departments, and each group’s average shows above the leaderboard.', {kind: 'tv', name: 'tv-groups'}],
	['Slides between rounds', 'Your own pictures on the TV between rounds: food, offers, next week’s quiz.', {kind: 'tv', name: 'tv-slides'}],
	['Speed bingo', 'Bingo that only calls numbers on someone’s ticket, so it’s over sooner.', {kind: 'phone', name: 'phone-bingo'}],
];
