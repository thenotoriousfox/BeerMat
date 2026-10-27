# BeerMat brand

**BeerMat — gettin' quizzy with it.** A pub quiz, run from one laptop, played on phones, shown on the TV.

## Logos

| File | Use |
|---|---|
| `mark.svg` | **The main logo**: the neon beer mat with a glowing question mark. App icon, desk, TV, phones, favicons. |
| `logo.svg` | Neon mat + BeerMat + tagline, for dark backgrounds (the TV, the desk, the web). |
| `logo-stacked.svg` | The same, stacked: splash screens and square spaces. |
| `wordmark.svg` | The name on its own. |
| `mark-print.svg`, `logo-print.svg` | **The pub and print version**: the gold marquee beer mat, for posters, real beer mats, flyers and merchandise on light backgrounds. |
| `icon.svg`, `icon-foreground.svg` | The app icon (full square) and Android's adaptive-icon foreground. |

Keep clear space around a logo of at least the height of the question mark's dot; don't stretch, recolour or add
effects to it. On light backgrounds use the print version.

## Colours

| Name | Hex | Use |
|---|---|---|
| Night | `#140b2e` | Backgrounds |
| Ink | `#1c1036` | Text on light colours |
| Amber | `#ffb21a` | "Mat", buttons, highlights |
| Gold | `#ffd25e` | The neon question mark, scores |
| Pink | `#ff3d81` | The neon ring, accents |
| Teal | `#1fd6c6` | The tagline, secondary accents |
| Cream | `#fff3d6` | "Beer", text on dark backgrounds |

## Type

**Fredoka** (bold for the name and headings, medium for the tagline), by the Fredoka Project Authors, under the SIL
Open Font License 1.1 (`Fredoka-OFL.txt`): free to use, embed and ship with the apps. `fredoka.woff2` is the variable
font (weights 300–700) that the pages load; the logos have their lettering as outlines, so they need no font.

## Making them

`python3 brand/make-brand.py` draws the SVGs (needs `pip install fonttools brotli`); `node brand/render.mjs` renders
every PNG and icon from them: the desktop app's `build/icon.png` and `build/icon.ico`, the Linux launcher icon, the
Android launcher icons and splash screens, and the iPhone icon and splash screens.
