Output the quiz as a quiz file for **PubQuiz**, an offline pub quiz system: the quizmaster loads it on the desk (**Build quiz → Load a quiz file**) and it runs on phones and a TV. The file is a single JSON document in the format below, which PubQuiz checks when it loads. Return only the JSON, with no commentary and no Markdown fences, unless you are asked otherwise.

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
- `fastestFingers: true` with `speedBonus` (whole number, 0–100): extra points for answering quickly. **Without `fastestFingers: true` there is no speed bonus at all.** `speedBonus` is allowed on: text, choice, multi, letter, number, sequence, pinpoint, wordsnake, tiles, picture, audio, bingo, musicbingo, clips. Leave it out on every other type.
  - `bonusMode`: `"sliding"` (default; the bonus fades over the time allowed) or `"fixed"` (only the fastest correct answers get it).
  - `bonusPlaces` (1–50, default 1): how many of the fastest correct answers get a fixed bonus.
  - On fastest-fingers questions the TV shows the fastest correct team large at the reveal.
- `evil: true` (Evil Mode): a wrong answer *loses* the question's points.

`evil` and `"bonusMode": "fixed"` only work on questions PubQuiz can mark by itself. Those are:
- multi, sequence, pinpoint, wordsnake and tiles;
- text, choice, letter, number, picture and audio, but only when they have an `answer`.

## Question types

**Keypad (answered with taps):**
- `choice`: multiple choice. `options`: 2–8 distinct strings (up to 200 characters each). `answer` must be **exactly** one of the options. The options show as A, B, C, D…
- `multi`: tick every correct option. `options` as above, plus `correct`: 1 or more of the options, written exactly as in `options`. Score = right ticks minus wrong ticks, as a share of `points`.
- `letter`: teams tap the first letter of the answer. `answer` is one letter A–Z. Put the full answer in `answerNote`.
- `number`: `answer` is a plain number such as `"6"`, `"1066"` or `"3.14"`. Use no commas, units or words. Marked as an exact match.
- `sequence`: put items in order. `items`: 2–8 distinct strings, **written in the correct order** (PubQuiz shuffles them). Don't give an `answer`.
- `vote`: an opinion poll with `options` (2–8) and no answer. Votes score nothing.

**Typed answers:**
- `text`: `answer` up to 300 characters. Marking ignores case, accents in letter case and extra spaces, but is otherwise an **exact** match. Other accepted answers go in `aliases` (up to 20, each up to 300 characters), e.g. `"answer": "The Beatles", "aliases": ["Beatles"]`. Leaving `answer` out means the quizmaster marks it by hand.
- `picture`: like `text`, plus `media` (a picture; see Media).
- `audio`: like `text`, plus the sound to play: either `media` (a sound file; see Media) or a Spotify `clip`, which the desk plays when the question opens:

  ```json
  "clip": {"spotify": "https://open.spotify.com/track/<id>", "start": 45, "seconds": 20}
  ```

  `spotify` is the track's link or `spotify:track:<id>`; `start` is the seconds into the track (0–3,600, default 0); `seconds` is how long it plays (3–600, default 30). Teams type their answer as for `text`.

**Puzzles:**
- `nearest`: closest number wins. `answer` is a plain number. `places` (1–20, default 1) is how many teams score, on a sliding scale: for example 3 places of 9 points gives 9, 6 and 3. Ties go to the earlier answer. At the reveal the closest team fills the TV, and the leaderboard shows what every team answered.
  - `tieBreaker: true` makes it a tie-breaker: it scores nothing (`points` is ignored) and only orders teams that are level on points, closest first and then the quicker answer. The reveal lists every team's answer, closest first, and the winner fills the TV.
- `wordsnake`: teams trace the answer through a letter grid. `answer` is one word of 3–20 letters (A–Z only; spaces and punctuation are dropped).
  - Optional go wide: `goWide: true` plus `goWidePoints` (0–100). Teams can remove the decoy letters, scoring `goWidePoints` instead of `points`.
- `tiles`: teams rebuild the answer from up to 7 shuffled tiles. `answer` is 4–40 letters; spaces are allowed between words, e.g. `"Big Ben"`.
- `pinpoint`: teams tap a spot on a picture. It needs `media` (a picture) and a `target`, `{"x": 0.72, "y": 0.35, "r": 0.05, "aspect": 0.625}`:
  - `x` and `y` are fractions (0–1) of the picture's width and height;
  - `r` (0.01–0.5) is the target radius as a fraction of the width;
  - `aspect` is the picture's height ÷ width.
  - Optional go wide: `goWide: true` plus `goWidePoints`, which allows a second tap.

**Hosted games (the quizmaster runs them live):**
- `buzzer`: first to buzz answers out loud and the quizmaster rules. `answer` is for the quizmaster's reference.
  - `variation`: `"classic"` (default) or `"advanced"` (the room agrees or disagrees).
  - Optional `penalty` and `passPenalty` (0–100).
  - For advanced only: `agreePoints` (0–100) and `agreeSeconds` (5–60, default 10).
- `bingo`: 90-ball bingo with a ticket on each phone. Use `"mode": "progressive"` (one line, then two lines, then full house) with `stagePoints: [line, twoLines, fullHouse]`, e.g. `[2, 3, 5]`. Leave out `points`, or set it to the full-house value.
  - Single-prize modes are `"line"`, `"twoLines"` and `"fullHouse"`; these use `points`.
  - Teams call BINGO themselves and the quizmaster checks the call. The number calls ("Kelly's eye", "Two fat ladies") are built in and are not part of the file.
- `musicbingo`: like bingo, but each ticket holds song titles, and the desk plays the songs on Spotify. `songs`: 15–300 songs (a ticket holds 15, so with fewer than about 30 every team holds nearly the same ones). **Every song has all four fields:**

  ```json
  {"title": "Mr Brightside – The Killers", "spotify": "https://open.spotify.com/track/<id>", "start": 45, "seconds": 20}
  ```

  - `title`: what appears on the tickets, up to 100 characters. Every title must be different.
  - `spotify`: the song's Spotify link (`https://open.spotify.com/track/<id>`, as Share → Copy song link gives) or `spotify:track:<id>`. The id is 22 letters and digits.
  - `start`: the seconds into the track where it starts playing (0–3,600).
  - `seconds`: how long it plays (3–600).
  - Optional on the question: `"autoNext": true` plays each song for its `seconds` and then the next by itself; `"revealNow": true` shows each title on screen as soon as it plays (otherwise the song playing stays hidden).
  - Use `mode` and `stagePoints` as for bingo.
- `clips`: the desk plays 2–30 clips and teams tap during the right one. Each clip is `{"spotify": "https://open.spotify.com/track/<id>", "start": 30, "seconds": 15, "label": "Song – Artist"}`:
  - `start`: seconds into the track (0–3,600).
  - `seconds`: how long it plays (3–60).
  - `targetClip` is the index of the correct clip, counting from 0; `text` says what to tap for.

**Paper:**
- `sheet`: an answer sheet. `items`: 1–50 questions; `itemAnswers`: the answers, in the same order and the same number; optional `itemAliases`: a list per item of other accepted answers (up to 20 each), e.g. `[["William Shakespeare"], []]`. Each item is worth 1 point, whatever `points` says. No `media`.

## Media

`picture`, `audio` (unless it has a Spotify `clip`) and `pinpoint` questions, `clips` and music-bingo songs can carry a file as a **data URL** in `media`, e.g. `"data:image/png;base64,…"`.
- Allowed types are PNG, JPEG, WebP, MP3, Ogg and WAV, each up to 20 MB.
- PubQuiz uploads them when the file is loaded.
- Media must be real files; a `picture` or `pinpoint` question without one, or an `audio` question with neither a file nor a `clip`, won't load.

Spotify links must be real tracks: PubQuiz plays whatever track the id points to.

## Example

```json
{
  "title": "Example Quiz",
  "rounds": [
    {"id": "r1", "title": "Round 1 · Warm-up", "questions": [
      {"id": "r1-q1", "type": "choice", "text": "Which planet is known as the Red Planet?", "seconds": 20, "points": 1, "options": ["Venus", "Mars", "Jupiter", "Saturn"], "answer": "Mars", "answerNote": "Iron oxide in its soil makes it red."},
      {"id": "r1-q2", "type": "multi", "text": "Tick every prime number", "seconds": 25, "points": 3, "options": ["2", "4", "7", "9", "11"], "correct": ["2", "7", "11"]},
      {"id": "r1-q3", "type": "letter", "text": "Tap the first letter of the capital of Italy", "seconds": 15, "points": 1, "answer": "R", "answerNote": "Rome"},
      {"id": "r1-q4", "type": "sequence", "text": "Put these in order, nearest the Sun first", "seconds": 30, "points": 2, "items": ["Mercury", "Venus", "Earth", "Mars"]}
    ]},
    {"id": "r2", "title": "Round 2 · Brain teasers", "questions": [
      {"id": "r2-q1", "type": "text", "text": "Which band released the album Abbey Road?", "seconds": 30, "points": 1, "answer": "The Beatles", "aliases": ["Beatles"]},
      {"id": "r2-q2", "type": "nearest", "text": "In what year did the Titanic sink?", "seconds": 30, "points": 3, "answer": "1912", "places": 3},
      {"id": "r2-q3", "type": "choice", "text": "FASTEST FINGERS: Which is the largest ocean?", "seconds": 20, "points": 1, "options": ["Atlantic", "Indian", "Pacific", "Arctic"], "answer": "Pacific", "fastestFingers": true, "speedBonus": 3},
      {"id": "r2-q4", "type": "text", "text": "EVIL MODE: What is the chemical symbol for gold? A wrong answer loses 2 points.", "seconds": 30, "points": 2, "answer": "Au", "evil": true},
      {"id": "r2-q5", "type": "wordsnake", "text": "Trace the capital of Scotland", "seconds": 45, "points": 2, "answer": "EDINBURGH", "goWide": true, "goWidePoints": 1},
      {"id": "r2-q6", "type": "tiles", "text": "Rebuild the answer: a famous London clock", "seconds": 45, "points": 2, "answer": "Big Ben"}
    ]},
    {"id": "r3", "title": "Round 3 · Buzzers and bingo", "questions": [
      {"id": "r3-q1", "type": "buzzer", "text": "Which band sang “Wonderwall”?", "seconds": 20, "points": 2, "answer": "Oasis", "variation": "classic", "penalty": 1},
      {"id": "r3-q2", "type": "bingo", "text": "Eyes down for a full game: one line, two lines, then full house!", "seconds": 1800, "mode": "progressive", "stagePoints": [2, 3, 5]},
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
- [ ] `evil` and `"bonusMode": "fixed"` only appear on questions PubQuiz marks itself.
- [ ] Music bingo has 15–300 songs with different titles, each with `title`, `spotify`, `start` and `seconds`.
- [ ] Every clip has `spotify`, `start` and `seconds` (or real `media`); every `audio` question has a `clip` or real `media`.
- [ ] Any `itemAliases` has one list per sheet item.
