# Themes

Each folder here is one theme BeerMat ships. Themes offered only in the theme library (Halloween) are in `library/`, laid out the same way. BeerMat finds them when it starts, so adding a theme means adding a folder; no code
changes. A theme gives the TV and phones a **look**, and with a `sounds/` folder it is also a **sound theme**.

```
themes/<id>/            id: lower-case letters, digits and hyphens
  theme.json            {"name": "Halloween", "order": 7, "seasonal": true}
  look.css              optional: the look, under :root[data-look=<id>] (web TV, phones, the previous desk)
  tv.json               optional: what BeerMat Desk's TV draws beyond the look's colours (below)
  sounds/               optional: the sound theme
  art/ …                optional: pictures and fonts look.css uses
  CREDITS.md            where everything came from (its licence)
```

* **theme.json**: `name` is what the desk shows; `order` sorts the list (the default look, `stage`, is first);
  `seasonal: true` keeps the theme out of random picks and the by-type defaults, so it only appears when chosen.
* **look.css**: set the colour tokens from `web/style.css` (`--bg`, `--gold`, `--surface`…) under
  `:root[data-look=<id>]`, and anything else, scoped the same way. Without a `look.css` the default colours are used.
  For scenery, each page has a `.decor` layer behind it with fourteen empty `<i>` elements: show it with
  `:root[data-look=<id>] .decor { display: block; }` and style `.decor i:nth-child(n)`. Keep the answer colours
  (A red, B blue…) and leave text readable; respect `prefers-reduced-motion` for anything that moves.
* **Files**: refer to them as `/themes/<id>/…`. Only pictures, fonts, sounds and stylesheets are served (`.svg`,
  `.png`, `.webp`, `.jpg`, `.woff2`, `.mp3`, `.ogg`, `.wav`, `.css`). Everything loads from the quiz laptop: no web
  fonts or images from the internet (phones and the TV are offline).
* **sounds/**: files named like a sound pack's `general/` folder (`start_round`, `question_start`,
  `question_music`, `time_up`, `end_round`, `correct`, `incorrect`, `drum_roll`, `bingo_number`, `airhorn`,
  `your_applause`; see `web/soundnames.js`). Moments without a file keep the standard sounds.
* Only ship what you made or what is CC0, and say which in `CREDITS.md`.

## tv.json: the native TV

BeerMat Desk's TV takes the look's colours from `look.css` (its `--bg`, `--gold`… tokens) but not the rest of the
CSS. Anything else it draws comes from `tv.json`, laid out on the TV's 1920×1080 stage (pixels; the TV scales it).
Colours are `#rgb`, `#rrggbb` or `rgba(r, g, b, a)`; every key is optional. `library/halloween/tv.json` uses all of it.

```
{"background": {"gradient": [[0, "#0c0618"], [1, "#5a2140"]],          top to bottom: [position 0–1, colour]
                "glows": [[x, y, width, height, "rgba(255,122,40,.22)"]]}, soft coloured light, centred on x, y
 "title":   {"gradient": [[0, "#ffe7c2"], [1, "#b8360a"]], "glow": "#ff6e14",
             "flicker": {"duration": 6000, "keys": [[0, 1], [0.42, 0.82], [1, 1]]}},   [at 0–1, opacity]
 "eyebrow": {"color": "#9dff5a", "glow": "rgba(157,255,90,.45)"},      the QUIZ NIGHT line
 "panel":   {"gradient": [[0, "rgba(44,20,68,.9)"], [1, "rgba(16,7,28,.93)"]], "border": "#ff8c3c"},
 "scene": [                                                             back to front, up to 40 layers
   {"image": "art/moon.svg", "x": 1129, "y": 508, "width": 468, "height": 468, "fit": "fit", "align": "bottom",
    "opacity": 1, "mirror": false,
    "motion": {"duration": 18000, "offset": 0, "alternate": true, "easing": "sine",   linear | sine | out
               "keys": [[0, 0, 0, 1], [1, 0, 0, 0.92]]}},              [at 0–1, dx, dy, opacity]
   {"dot": true, "x": 144, "y": 1021, "width": 6.5, "height": 6.5, "color": "#ffb347", "glow": "#ff7a1a"},
   {"blobs": [[0.2, 0.7, 0.3, 0.6, 0.32]], "x": -960, "y": 868, "width": 3840, "height": 234, "color": "#dcc8ff"}
 ]}
```

A layer is a picture of the theme's (`image`), a glowing dot, or fog (`blobs`: soft ellipses, `[x, y, width,
height, opacity]` as shares of the layer). `motion` moves it along its keys and loops (`alternate` goes there and
back); `offset` starts it part-way, so copies of a layer don't move together.

## Sharing a theme (the theme library)

Quizmasters on BeerMat Pro can share a theme with other venues, and install theirs (Settings → Looks → Theme
library). Your own themes go in the **My themes** folder in BeerMat's data folder (the desk shows where), laid out as
above; copy one of these to start. A shared theme is checked (`shared/theme-bundle.js`) when it's uploaded and
again when it's installed:

* files: `theme.json`, `look.css`, `tv.json`, `CREDITS.md`, and pictures, fonts and sounds (`.png .webp .jpg .svg
  .woff2 .mp3 .ogg .wav`), each really what its name says; 5 MB each, 15 MB and 80 files in all;
* `look.css`: every rule under `:root[data-look=<id>]` (also inside `@media` and `@supports`), plus `@font-face` and
  `@keyframes`; `url()` only to its own files at `/themes/<id>/…`; no `@import`, other at-rules, `\` escapes or
  scripts. Its fonts and animations are renamed when it's shared, so they can't clash with anyone else's;
* `.svg` pictures: no scripts, event handlers, foreign objects, entities or links out;
* `tv.json`: only the keys above, real colours and sensible numbers, and pictures from the theme itself.

Nothing appears in the library until BeerMat has looked at it, and three venues reporting a theme hide it again.

`tests/themes.test.js` checks every theme here: its `theme.json` loads, its `look.css` styles only its own look and
every file it uses exists.
