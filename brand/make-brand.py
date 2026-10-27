#!/usr/bin/env python3
# BeerMat's logos, drawn as SVG with the lettering as outlines (Fredoka, brand/fredoka.woff2, SIL OFL), so they look
# the same everywhere without the font. Writes brand/*.svg; then `node brand/render.mjs` makes every PNG and icon.
#   python3 brand/make-brand.py        (needs fontTools and brotli: pip install fonttools brotli)
#
#   mark.svg          the neon beer mat with its glowing question mark: the main logo, for screens and the app icon
#   mark-print.svg    the gold marquee beer mat: the pub and print version
#   logo.svg          neon mat + BeerMat + tagline, for dark backgrounds
#   logo-print.svg    marquee mat + BeerMat + tagline
#   logo-stacked.svg  neon mat above the name and tagline (splash screens)
#   wordmark.svg      BeerMat on its own
#   icon.svg          the app icon: the neon mat on a full night-coloured square
#   icon-foreground.svg  the mat alone, sized for Android's adaptive icon safe zone
import math, os
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen

HERE = os.path.dirname(os.path.abspath(__file__))
COLOURS = {'night': '#140b2e', 'ink': '#1c1036', 'amber': '#ffb21a', 'gold': '#ffd25e', 'pink': '#ff3d81', 'teal': '#1fd6c6', 'cream': '#fff3d6'}
TAGLINE = "gettin' quizzy with it"
_fonts = {}

def font(wght):
    if wght not in _fonts: _fonts[wght] = instantiateVariableFont(TTFont(os.path.join(HERE, 'fredoka.woff2')), {'wght': wght, 'wdth': 100})
    return _fonts[wght]

def text(s, size, wght=700):
    """Outline of `s` at `size` px, baseline at y=0: (path data, (x0, y0, x1, y1))."""
    f = font(wght); glyphs = f.getGlyphSet(); cmap = f.getBestCmap(); scale = size / f['head'].unitsPerEm
    pen, bounds, x = SVGPathPen(glyphs), BoundsPen(glyphs), 0
    for ch in s:
        g = glyphs[cmap[ord(ch)]]
        for p in (pen, bounds): g.draw(TransformPen(p, (scale, 0, 0, -scale, x, 0)))
        x += g.width * scale
    return pen.getCommands(), bounds.bounds

def centred(s, size, cx, cy, fill, wght=700, extra=''):
    d, (x0, y0, x1, y1) = text(s, size, wght)
    return f'<path fill="{fill}" {extra} transform="translate({cx - (x0 + x1) / 2:.1f} {cy - (y0 + y1) / 2:.1f})" d="{d}"/>'

C = COLOURS
GLOW = '<filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="9" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>'

def neon(cx=256, cy=256, r=240):
    """The neon mat: a night mat, a pink neon ring, a dotted teal ring and a glowing gold question mark."""
    k = r / 240
    return (f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{C["night"]}"/>'
            f'<circle cx="{cx}" cy="{cy}" r="{214 * k:.1f}" fill="none" stroke="{C["pink"]}" stroke-width="{10 * k:.1f}" filter="url(#glow)"/>'
            f'<circle cx="{cx}" cy="{cy}" r="{190 * k:.1f}" fill="none" stroke="{C["teal"]}" stroke-width="{5 * k:.1f}" stroke-dasharray="{2 * k:.1f} {14 * k:.1f}" stroke-linecap="round" filter="url(#glow)"/>'
            + centred('?', 300 * k, cx, cy, C['gold'], extra='filter="url(#glow)"'))

def marquee(cx=256, cy=256, r=236):
    """The print mat: a gold mat with a cut edge, a ring of light bulbs and a question mark with a pink shadow."""
    k, n, pts = r / 236, 36, []
    for i in range(n * 8 + 1):
        a = 2 * math.pi * i / (n * 8); rr = r - 10 * k * (0.5 - 0.5 * math.cos(n * a))
        pts.append(f'{cx + rr * math.cos(a):.1f},{cy + rr * math.sin(a):.1f}')
    bulbs = ''.join(f'<circle cx="{cx + 196 * k * math.cos(2 * math.pi * i / 24):.1f}" cy="{cy + 196 * k * math.sin(2 * math.pi * i / 24):.1f}" r="{9 * k:.1f}" fill="{C["cream"]}"/>' for i in range(24))
    return (f'<path fill="{C["amber"]}" d="M{" L".join(pts)}Z"/><circle cx="{cx}" cy="{cy}" r="{214 * k:.1f}" fill="none" stroke="{C["ink"]}" stroke-width="{6 * k:.1f}" opacity=".25"/>{bulbs}'
            + centred('?', 330 * k, cx + 12 * k, cy + 12 * k, C['pink']) + centred('?', 330 * k, cx, cy, C['ink']))

def wordmark(x, baseline, size, beer=C['cream'], mat=C['amber']):
    """BeerMat: "Beer" then "Mat", touching; returns (svg, width)."""
    d1, b1 = text('Beer', size); d2, b2 = text('Mat', size)
    gap = size * 0.02
    w = (b1[2] - b1[0]) + gap + (b2[2] - b2[0])
    return (f'<path fill="{beer}" transform="translate({x - b1[0]:.1f} {baseline})" d="{d1}"/>'
            f'<path fill="{mat}" transform="translate({x + b1[2] - b1[0] + gap - b2[0]:.1f} {baseline})" d="{d2}"/>'), w

def tagline(x, baseline, size, fill):
    d, b = text(TAGLINE, size, 500)
    return f'<path fill="{fill}" transform="translate({x - b[0]:.1f} {baseline})" d="{d}"/>', b[2] - b[0]

def svg(w, h, body, title):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w:.0f} {h:.0f}" role="img"><title>{title}</title><defs>{GLOW}</defs>{body}</svg>\n'

def lockup(mat, mat_r, word_colours, tag_colour):
    """Mat on the left, name and tagline to its right."""
    pad = 20; d = mat_r * 2; x = pad + d + 36
    word, ww = wordmark(x, pad + d * 0.62, d * 0.47, *word_colours)
    tag, tw = tagline(x + 6, pad + d * 0.86, d * 0.13, tag_colour)
    return mat(pad + mat_r, pad + mat_r, mat_r) + word + tag, x + max(ww, tw + 6) + pad, d + 2 * pad

files = {}
files['mark.svg'] = svg(512, 512, neon(), 'BeerMat')
files['mark-print.svg'] = svg(512, 512, marquee(), 'BeerMat')
body, w, h = lockup(neon, 120, (C['cream'], C['amber']), C['teal']); files['logo.svg'] = svg(w, h, body, "BeerMat — gettin' quizzy with it")
# Print goes on light backgrounds: dark Beer, a deeper amber Mat.
body, w, h = lockup(marquee, 120, (C['ink'], '#e08600'), C['pink']); files['logo-print.svg'] = svg(w, h, body, "BeerMat — gettin' quizzy with it")
word, ww = wordmark(0, 110, 140); files['wordmark.svg'] = svg(ww, 140, word, 'BeerMat')
# Stacked: mat on top, name and tagline centred below (for splash screens).
word, ww = wordmark(0, 0, 150); tag, tw = tagline(0, 0, 42, C['teal']); W = max(ww, tw, 400) + 40
files['logo-stacked.svg'] = svg(W, 690, neon(W / 2, 220, 200) + f'<g transform="translate({(W - ww) / 2:.1f} 580)">{word}</g><g transform="translate({(W - tw) / 2:.1f} 660)">{tag}</g>', "BeerMat — gettin' quizzy with it")
# App icon: a full square (iOS adds its own corners) with a soft glow behind the mat.
files['icon.svg'] = svg(1024, 1024, f'<defs><radialGradient id="bg" cx="50%" cy="45%" r="70%"><stop offset="0" stop-color="#2a1458"/><stop offset="1" stop-color="{C["night"]}"/></radialGradient></defs>'
                        f'<rect width="1024" height="1024" fill="url(#bg)"/>' + neon(512, 512, 420), 'BeerMat')
# Android adaptive icon: only the middle 66% is always visible, so the mat sits inside it on a transparent square.
files['icon-foreground.svg'] = svg(432, 432, neon(216, 216, 132), 'BeerMat')
for name, content in files.items():
    with open(os.path.join(HERE, name), 'w') as out: out.write(content)
print('wrote', ', '.join(files))
