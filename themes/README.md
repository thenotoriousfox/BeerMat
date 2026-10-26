# Themes

Each folder here is one theme. PubQuiz finds them when it starts, so adding a theme means adding a folder; no code
changes. A theme gives the TV and phones a **look**, and with a `sounds/` folder it is also a **sound theme**.

```
themes/<id>/            id: lower-case letters, digits and hyphens
  theme.json            {"name": "Halloween", "order": 7, "seasonal": true}
  look.css              optional: the look, under :root[data-look=<id>]
  sounds/               optional: the sound theme
  art/ …                optional: pictures and fonts look.css uses
  CREDITS.md            where everything came from (its licence)
```

* **theme.json**: `name` is what the desk shows; `order` sorts the list (the default look, `stage`, is first);
  `seasonal: true` keeps the theme out of random picks and the by-type defaults, so it only appears when chosen.
* **look.css**: set the colour tokens from `style.css` (`--bg`, `--gold`, `--surface`…) under
  `:root[data-look=<id>]`, and anything else, scoped the same way. Without a `look.css` the default colours are used.
  For scenery, each page has a `.decor` layer behind it with fourteen empty `<i>` elements: show it with
  `:root[data-look=<id>] .decor { display: block; }` and style `.decor i:nth-child(n)`. Keep the answer colours
  (A red, B blue…) and leave text readable; respect `prefers-reduced-motion` for anything that moves.
* **Files**: refer to them as `/themes/<id>/…`. Only pictures, fonts, sounds and stylesheets are served (`.svg`,
  `.png`, `.webp`, `.jpg`, `.woff2`, `.mp3`, `.ogg`, `.wav`, `.css`). Everything loads from the quiz laptop: no web
  fonts or images from the internet (phones and the TV are offline).
* **sounds/**: files named like a sound pack's `general/` folder (`start_round`, `question_start`,
  `question_music`, `time_up`, `end_round`, `correct`, `incorrect`, `drum_roll`, `bingo_number`, `airhorn`,
  `your_applause`; see `soundnames.js`). Moments without a file keep the standard sounds.
* Only ship what you made or what is CC0, and say which in `CREDITS.md`.

`tests/themes.test.js` checks every theme here: its `theme.json` loads, its `look.css` styles only its own look and
every file it uses exists.
