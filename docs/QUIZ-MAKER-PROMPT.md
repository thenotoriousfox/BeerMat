Output the quiz as a quiz file for **BeerMat**, an offline pub quiz system: the quizmaster loads it on the desk (**Build quiz → Load a quiz file**) and it runs on phones and a TV. The file is a single JSON document in the format below, which BeerMat checks when it loads. Return only the JSON, with no commentary and no Markdown fences, unless you are asked otherwise.

## File shape

```json
{
  "title": "Friday Night Quiz",
  "rounds": [
    {"id": "r1", "title": "Round 1 · General knowledge", "questions": [ … ]}
  ]
}
```

- `title`: 1–100 characters.
- `rounds`: up to 60. Each needs `id`, a `title` (1–100 characters) and `questions`.
- Every round `id` and question `id` must be unique across the whole file, and use only letters, digits, `-` and `_` (1–80 characters). For example: `r1`, `r1-q1`, `r1-q2`, `r2`, `r2-q1`.
- Up to 1,000 questions in total.
- The TV shows the leaderboard automatically after the last question of each round.
- A round may add `"secret": true` (usually the final round): teams don't see their marks or the answers for its questions, and the leaderboard stays hidden, until the quizmaster ends the quiz. For example: `{"id": "r6", "title": "Final round", "secret": true, "questions": [ … ]}`. Leave it out for normal rounds.
- A round may add an `intro` (up to 1,000 characters): how the round works, in a sentence or two, for the quizmaster to read out before starting it. The quizmaster's desk and phone show it as the round comes up; the TV and teams don't. For example: `{"id": "r2", "title": "Round 2 · Risk It", "intro": "Five questions, 4 points each. A wrong answer loses 4 points, but leaving it blank loses nothing.", "questions": [ … ]}`. Write one for any round that plays differently from the one before it.

## Fields every question has

| Field | Rule |
|---|---|
| `id` | Unique, as above |
| `type` | One of the types below |
| `text` | The question as shown on the TV and phones, 1–1,000 characters |
| `seconds` | Whole number, 5–7,200 |
| `points` | Whole number, 0–100 |

Optional on most types:

- `answerNote` (up to 300 characters): shown with the answer when it is revealed.
- `fastestFingers: true` with `speedBonus` (whole number, 0–100): extra points for answering quickly. **Without `fastestFingers: true` there is no speed bonus at all.** `speedBonus` is allowed on: text, choice, multi, letter, number, sequence, pinpoint, wordsnake, tiles, picture, audio, video, bingo, musicbingo, clips. Leave it out on every other type.
  - `bonusMode`: `"sliding"` (default; the bonus fades over the time allowed) or `"fixed"` (only the fastest correct answers get it).
  - `bonusPlaces` (1–50, default 1): how many of the fastest correct answers get a fixed bonus.
  - On fastest-fingers questions the TV shows the fastest correct team large at the reveal.
- `evil: true` (Risk It): a wrong answer *loses* the question's points.
- `wager` (1–100): a wager question. Each team stakes 0 to `wager` points with its answer: a right answer wins the stake, a wrong one loses it. `points` is set to `wager`. Only for formats with a correct answer set, and not with `evil`, `fastestFingers` or `fiftyFifty`.
- `hideText: true`: the TV and phones don't show the wording until the answer is revealed (they show "Listen to the
  quizmaster" and the quizmaster reads it out), while the clock runs as normal. **Only for the rare question whose
  wording would give the answer away when read** (e.g. a spelling question). Leave it out everywhere else. Not for
  bingo, music bingo or clips.
  - Reading every question out before teams see it is not `hideText`: that is the desk's **Send Question** switch, a
    setting on the night (not in the file). With it on, each question waits until the quizmaster presses Send, and its
    clock starts then.

`evil`, `wager` and `"bonusMode": "fixed"` only work on questions BeerMat can mark by itself. Those are:
- multi, sequence, pinpoint, wordsnake, tiles, list, pairs, sort, links and survey;
- text, choice, letter, number, picture, audio, clues and video, but only when they have an `answer`.

## Question types

**Keypad (answered with taps):**
- `choice`: multiple choice. `options`: 2–8 distinct strings (up to 200 characters each). `answer` must be **exactly** one of the options. The options show as A, B, C, D…
  - `pair: "trueFalse"` or `pair: "beforeAfter"` makes it two big buttons, True/False or Before/After, labelled in the quiz's language on phones and the TV. Then `options` can be left out (the loader sets them) and `answer` is `"True"` or `"False"` (`"Before"` or `"After"`). Use it for true-or-false statements and "did X happen before or after Y?" questions.
  - Optional 50/50: `fiftyFifty: true` plus `fiftyPoints` (0–100). A team can take away half the wrong options; a right
    answer after that scores `fiftyPoints` instead of `points`. It needs 3 or more options and the `answer` set.
- `multi`: tick every correct option. `options` as above, plus `correct`: 1 or more of the options, written exactly as in `options`. Score = right ticks minus wrong ticks, as a share of `points`.
  - Optional `wipeout: true`: a single wrong tick scores nothing for the question.
- `letter`: teams tap the first letter of the answer. `answer` is one letter A–Z. Put the full answer in `answerNote`.
- `number`: `answer` is a plain number such as `"6"`, `"1066"` or `"3.14"`. Use no commas, units or words. Marked as an exact match, unless `tolerance` (a number above 0) is set: answers within ± that much also count; with `tolerancePercent: true` the tolerance is a percentage of the answer (`"tolerance": 5, "tolerancePercent": true` accepts 5% either side). The reveal shows it, for example `1969 (± 2)`.
- `sequence`: put items in order. `items`: 2–8 distinct strings, **written in the correct order** (BeerMat shuffles them). Don't give an `answer`.
  - Ordering audio clips (songs by release year, say): `clips`, a clip for each item in the same order as `items` (each as in `clips` below: `{"media": …}` or `{"spotify": …, "start": …}`), and optional `clipSeconds` (3–60, default 15). The desk plays them in the order phones show the items, and phones and the TV show which item is playing.
- `vote`: an opinion poll with `options` (2–8) and no answer. Votes score nothing.

**Typed answers:**
- `text`: `answer` up to 300 characters. Marking ignores case, accents in letter case and extra spaces, but is otherwise an **exact** match. Other accepted answers go in `aliases` (up to 20, each up to 300 characters), e.g. `"answer": "The Beatles", "aliases": ["Beatles"]`. Leaving `answer` out means the quizmaster marks it by hand.
- `picture`: like `text`, plus `media` (a picture; see Media).
  - Optional `reveal`: `"blur"` (the picture starts blurred and sharpens) or `"tiles"` (it starts under twelve tiles that
    come off one by one) as the clock runs down: the quicker a team guesses, the less it saw.
  - Optional `revealSeconds` (3 up to `seconds`, with a `reveal`): the picture shows itself over its first
    `revealSeconds`, then stays whole for the rest of the time. With `fastestFingers: true` and `speedBonus`, the bonus
    counts only while the picture is still uncovering, in whole steps: with `"speedBonus": 3` a right answer in the
    first third of the reveal scores `points` + 3, then + 2, then + 1, and just `points` once the picture is whole. For
    example `"seconds": 30, "points": 3, "reveal": "tiles", "revealSeconds": 15, "fastestFingers": true, "speedBonus": 3`
    gives 6, 5 or 4 during the first 15 seconds and 3 after.
- `audio`: like `text`, plus the sound to play: either `media` (a sound file; see Media) or a Spotify `clip`, which the desk plays when the question opens:

  ```json
  "clip": {"spotify": "https://open.spotify.com/track/<id>", "start": 45, "seconds": 20}
  ```

  `spotify` is the track's link or `spotify:track:<id>`; `start` is the seconds into the track (0–3,600, default 0); `seconds` is how long it plays (3–600, default 30). Teams type their answer as for `text`.

**Puzzles:**
- `clues`: progressive clues ("Who am I?"). `clues`: 2–8 strings, hardest first; one more appears every `clueSeconds` (5–120, default 10). `answer` and `aliases` as for `text`. A right answer on the first clue scores `points`, each later clue a share less (5 clues for 5 points: 5, 4, 3, 2, 1; never below 1). `seconds` must leave time for every clue (`clueSeconds` × (clues − 1) + 5 at least).
- `list`: list answers ("name as many as you can"). `accepted`: 2–50 accepted answers; alternatives for one answer go in one string, separated by `|` (`"Wales | Cymru"`). `slots` (1–20, at most the number of accepted answers; default the smaller of that and 10) is how many boxes each team gets. Each box matching an accepted answer not already used scores `points`, in any order.
- `pairs`: matching pairs. `pairs`: 2–8 `[left, right]` pairs (each side up to 120 characters, all lefts different and all rights different). Phones show the left items in order and the right ones shuffled; teams match each, and every right pair scores `points`.
- `sort`: sort into groups. `sorting`: 2–16 `[item, group]` pairs (items different; 2–5 groups, named exactly the same each time, listed in the order they first appear). Phones show the items in the order given (so mix them up) with the groups to choose from; every item put in its own group scores `points`. Don't write `categories`: the loader works the groups out from `sorting`.
- `links`: link groups. `linkGroups`: 2–4 groups, each `{"link": "Planets | Planet names", "items": ["Mercury", "Mars", "Venus"]}` (2–5 items; alternatives for the link with `|`; every item different, 16 at most in all). Phones and the TV show all the items shuffled together; teams put each in Group 1, 2… and say what links each group. A group put together exactly scores `points`; naming its link scores `linkPoints` (0–100, default `points`).
- `survey`: a survey round ("we asked 100 people…"). `survey`: 2–12 `[answer, points]` pairs (points 0–100; alternatives for an answer with `|`, e.g. `["Fridge | Refrigerator", 3]`). Teams type one answer and score the points of the survey answer it matches; `points` is set to the top answer's. The reveal ranks them all.
- `video`: a video question. `media` is an MP4 (H.264) or WebM video (in a quiz file, a `data:video/mp4;base64,…` URL of up to 8 MB). It plays on the TV, with sound, as the question opens; phones say to watch the TV. Teams type the answer: `answer` and `aliases` as for `text`.
- `nearest`: closest number wins. `answer` is a plain number. `places` (1–20, default 1) is how many teams score, on a sliding scale: for example 3 places of 9 points gives 9, 6 and 3. Ties go to the earlier answer. At the reveal the closest team fills the TV, and the leaderboard shows what every team answered.
  - `notOver: true` makes it closest without going over: answers above `answer` score nothing (phones say so).
  - `tieBreaker: true` makes it a tie-breaker: it scores nothing (`points` is ignored) and only orders teams that are level on points, closest first and then the quicker answer. The reveal lists every team's answer, closest first, and the winner fills the TV.
- `wordsnake`: teams trace the answer through a letter grid. `answer` is one word of 3–20 letters (A–Z only; spaces and punctuation are dropped).
  - Optional **hint** (the field is still called `goWide`): `goWide: true` plus `goWidePoints` (0–100). Teams can hide the decoy letters, scoring `goWidePoints` instead of `points`.
- `tiles`: teams rebuild the answer from up to 7 shuffled tiles. `answer` is 4–40 letters; spaces are allowed between words, e.g. `"Big Ben"`.
- `pinpoint`: teams tap a spot on a picture. It needs `media` (a picture) and a `target`, `{"x": 0.72, "y": 0.35, "r": 0.05, "aspect": 0.625}`:
  - `x` and `y` are fractions (0–1) of the picture's width and height;
  - `r` (0.01–0.5) is the target radius as a fraction of the width;
  - `aspect` is the picture's height ÷ width.
  - Optional **second guess** (the field is still called `goWide`): `goWide: true` plus `goWidePoints` (0–100). If the first tap misses, a second tap scores `goWidePoints`.
  - **Several places to find:** `targets`, a list of 2–10 targets (each as `target` above), in place of `target`. Teams tap once per place, in any order, and score `points` for each place found (one tap finds one place). For example "Tap Paris, Rome and Berlin on the map" with three targets. Not with a second guess.

**Hosted games (the quizmaster runs them live):**
- `buzzer`: first to buzz answers out loud and the quizmaster rules. `answer` is for the quizmaster's reference.
  - `variation`: `"classic"` (default) or `"advanced"` (the room agrees or disagrees).
  - Optional `penalty` and `passPenalty` (0–100).
  - For advanced only: `agreePoints` (0–100) and `agreeSeconds` (5–60, default 10).
- `bingo`: 90-ball bingo with a ticket on each phone. Use `"mode": "progressive"` (one line, then two lines, then full house) with `stagePoints: [line, twoLines, fullHouse]`, e.g. `[2, 3, 5]`. Leave out `points`, or set it to the full-house value.
  - Single-prize modes are `"line"`, `"twoLines"` and `"fullHouse"`; these use `points`.
  - Optional `perCall` (1–3, default 1): numbers called each time the quizmaster calls, for a shorter game.
  - Optional `speed: true` (speed bingo): only numbers that are on a team's ticket are called, so lines come sooner.
  - Teams call BINGO themselves and the quizmaster checks the call. The number calls ("Kelly's eye", "Two fat ladies") are built in and are not part of the file.
- `musicbingo`: like bingo, but each ticket holds song titles, and the desk plays the songs. `songs`: 15–300 songs (a ticket holds 15, so with fewer than about 30 every team holds nearly the same ones). Each song is a Spotify track or an uploaded sound file:

  ```json
  {"title": "Mr Brightside – The Killers", "spotify": "https://open.spotify.com/track/<id>", "start": 45, "seconds": 20}
  {"title": "Our own jingle", "media": "data:audio/mpeg;base64,…"}
  ```

  - `title`: what appears on the tickets, up to 100 characters. Every title must be different.
  - `spotify`: the song's Spotify link (`https://open.spotify.com/track/<id>`, as Share → Copy song link gives) or `spotify:track:<id>`. The id is 22 letters and digits. Or `media`: a sound file (see Media). Not both.
  - `start` (0–3,600) and `seconds` (3–600), optional: where this song starts and how long it plays, instead of the game's.
  - The game's own, on the question: `startAt` (0–600, default 0) is where every song starts (e.g. at the chorus), and `songSeconds` (3–600, or 0 for the whole song; default 0) is how long each plays.
  - `"autoNext": true` plays each song for its time and then the next by itself; it needs `songSeconds`, or `seconds` on every song.
  - `"revealNow": true` shows each title on screen as soon as it plays (otherwise the song playing stays hidden).
  - The reaction table: `"reactions": true` with `reactionPoints` (0–10). Teams dab the song playing on their ticket; the TV lists the quickest, and the quickest team on each song scores `reactionPoints`.
  - Use `mode` and `stagePoints` as for bingo (`perCall` stays 1: one song at a time).
- `clips`: the desk plays 2–30 clips and teams tap during the right one. Each clip is a Spotify track, `{"spotify": "https://open.spotify.com/track/<id>", "start": 30, "seconds": 15, "label": "Song – Artist"}`, or a sound file, `{"media": "data:audio/mpeg;base64,…", "label": "…"}`:
  - `start`: seconds into the track (0–3,600).
  - `seconds` (optional): how long this clip plays (3–60).
  - `clipSeconds` on the question (3–60, default 15): how long each clip plays when it doesn't say.
  - `label` (optional, up to 100 characters): the clip's name on the desk.
  - `targetClip` is the index of the correct clip, counting from 0; `text` says what to tap for.

**Paper:**
- `sheet`: several answer boxes in one question, each marked separately. `items`: 1–50 box labels or questions; `itemAnswers`: the answers, in the same order and the same number; optional `itemAliases`: a list per item of other accepted answers (up to 20 each), e.g. `[["William Shakespeare"], []]`.
  - `partScoring`: `"each"` (default: 1 point per right item; `points` is ignored), `"split"` (the question's `points` shared equally between the items, e.g. ½ each for two items worth 1), or `"all"` (the question's `points` only when every item is right).
  - A sheet can carry `media` (a picture or sound) or a Spotify `clip` like an `audio` question. One song with the artist and the title marked separately is a sheet:

    ```json
    {"id": "r5-q1", "type": "sheet", "text": "Name the artist and the song", "seconds": 30, "points": 1, "partScoring": "split",
     "clip": {"spotify": "https://open.spotify.com/track/<id>", "start": 50, "seconds": 20},
     "items": ["Artist", "Title"], "itemAnswers": ["Queen", "Bohemian Rhapsody"], "itemAliases": [[], []]}
    ```

## Media

`picture`, `audio` (unless it has a Spotify `clip`), `pinpoint` and `sheet` questions, `clips` and music-bingo songs can carry a file as a **data URL** in `media`, e.g. `"data:image/png;base64,…"`.
- Allowed types are PNG, JPEG, WebP, MP3, Ogg and WAV, each up to 20 MB.
- BeerMat uploads them when the file is loaded.
- Media must be real files; a `picture` or `pinpoint` question without one, or an `audio` question with neither a file nor a `clip`, won't load.

Spotify links must be real tracks: BeerMat plays whatever track the id points to.

## Example

```json
{
  "title": "Example Quiz",
  "rounds": [
    {"id": "r1", "title": "Round 1 · Warm-up", "questions": [
      {"id": "r1-q1", "type": "choice", "text": "Which planet is known as the Red Planet?", "seconds": 20, "points": 1, "options": ["Venus", "Mars", "Jupiter", "Saturn"], "answer": "Mars", "answerNote": "Iron oxide in its soil makes it red.", "fiftyFifty": true, "fiftyPoints": 1},
      {"id": "r1-q2", "type": "multi", "text": "Tick every prime number", "seconds": 25, "points": 3, "options": ["2", "4", "7", "9", "11"], "correct": ["2", "7", "11"], "wipeout": true},
      {"id": "r1-q3", "type": "letter", "text": "Tap the first letter of the capital of Italy", "seconds": 15, "points": 1, "answer": "R", "answerNote": "Rome"},
      {"id": "r1-q4", "type": "sequence", "text": "Put these in order, nearest the Sun first", "seconds": 30, "points": 2, "items": ["Mercury", "Venus", "Earth", "Mars"]}
    ]},
    {"id": "r2", "title": "Round 2 · Brain teasers", "intro": "Six questions in different styles. The fastest right answer to question 3 gets 3 bonus points, and a wrong answer to question 4 loses 2 points.", "questions": [
      {"id": "r2-q1", "type": "text", "text": "Which band released the album Abbey Road?", "seconds": 30, "points": 1, "answer": "The Beatles", "aliases": ["Beatles"]},
      {"id": "r2-q2", "type": "nearest", "text": "In what year did the Titanic sink?", "seconds": 30, "points": 3, "answer": "1912", "places": 3},
      {"id": "r2-q3", "type": "choice", "text": "FASTEST FINGERS: Which is the largest ocean?", "seconds": 20, "points": 1, "options": ["Atlantic", "Indian", "Pacific", "Arctic"], "answer": "Pacific", "fastestFingers": true, "speedBonus": 3},
      {"id": "r2-q4", "type": "text", "text": "RISK IT: What is the chemical symbol for gold? A wrong answer loses 2 points.", "seconds": 30, "points": 2, "answer": "Au", "evil": true},
      {"id": "r2-q5", "type": "wordsnake", "text": "Trace the capital of Scotland", "seconds": 45, "points": 2, "answer": "EDINBURGH", "goWide": true, "goWidePoints": 1},
      {"id": "r2-q6", "type": "tiles", "text": "Rebuild the answer: a famous London clock", "seconds": 45, "points": 2, "answer": "Big Ben"}
    ]},
    {"id": "r3", "title": "Round 3 · Buzzers and bingo", "questions": [
      {"id": "r3-q1", "type": "buzzer", "text": "Which band sang “Wonderwall”?", "seconds": 20, "points": 2, "answer": "Oasis", "variation": "classic", "penalty": 1},
      {"id": "r3-q2", "type": "bingo", "text": "Eyes down for a full game: one line, two lines, then full house!", "seconds": 1800, "mode": "progressive", "stagePoints": [2, 3, 5], "perCall": 2},
      {"id": "r3-q3", "type": "sheet", "text": "Three quick ones — fill in the sheet", "seconds": 180, "points": 3, "items": ["Capital of France", "Who wrote Hamlet?", "How many continents are there?"], "itemAnswers": ["Paris", "Shakespeare", "7"], "itemAliases": [[], ["William Shakespeare"], ["Seven"]]}
    ]},
    {"id": "tb", "title": "Tie-breaker", "questions": [
      {"id": "tb-q1", "type": "nearest", "text": "Tie-breaker: how tall is the Eiffel Tower, in metres?", "seconds": 30, "points": 0, "answer": "330", "tieBreaker": true}
    ]}
  ]
}
```

## Before you answer, check the file

- [ ] The file is valid JSON (no comments, no trailing commas), with `title` and `rounds`.
- [ ] Every round and question `id` is unique and uses only letters, digits, `-` and `_`.
- [ ] Every question has `type`, `text`, `seconds` (5–7,200) and `points` (0–100). Progressive bingo may leave out `points`.
- [ ] Every `choice` answer matches an option exactly; every `multi` `correct` entry matches an option exactly.
- [ ] `number` and `nearest` answers are plain numbers; `letter` answers are one letter.
- [ ] `sequence` items are listed in the correct order.
- [ ] `speedBonus` only appears with `fastestFingers: true`, and only on the types listed.
- [ ] `evil` and `"bonusMode": "fixed"` only appear on questions BeerMat marks itself.
- [ ] Music bingo has 15–300 songs with different titles, each with a `title` and either `spotify` or real `media`; with `autoNext`, `songSeconds` or every song's `seconds` is set.
- [ ] Every clip has `spotify` with `start` (or real `media`); every `audio` question has a `clip` or real `media`.
- [ ] `fiftyFifty` only on `choice` with 3+ options and an `answer`; `wipeout` only on `multi`; `reveal` only on `picture`; `perCall` above 1 and `speed` only on number `bingo`.
- [ ] Any `itemAliases` has one list per sheet item; `partScoring` is `each`, `split` or `all`.
