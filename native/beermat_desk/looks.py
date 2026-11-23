"""The looks for the native TV: each theme's colours (its look.css custom properties under :root[data-look=<id>],
turned into Qt colours), and what the TV draws beyond colours, from its tv.json: background, title, eyebrow, the
panel behind the question, and its scenery (ThemeScene.qml). themes/README.md describes tv.json."""
import json
import re
from pathlib import Path

from .svgmotion import motion_of

# CSS variable -> the TV's palette key (the same names as Theme.qml).
NAMES = {'--bg': 'bg', '--bg-2': 'bg2', '--text': 'text', '--muted': 'muted', '--gold': 'gold', '--gold-hi': 'goldHi', '--pink': 'pink',
         '--cyan': 'teal', '--violet': 'violet', '--good': 'good', '--bad': 'bad', '--on-accent': 'onAccent', '--line': 'line',
         '--line-strong': 'lineStrong', '--surface-solid': 'panel'}


def qt_colour(value):
    """'#abc', '#aabbcc' or 'rgba(r, g, b, a)' as a Qt colour string ('#AARRGGBB'); None for anything else."""
    value = value.strip()
    if re.fullmatch(r'#[0-9a-fA-F]{3}', value):
        return '#' + ''.join(c * 2 for c in value[1:])
    if re.fullmatch(r'#[0-9a-fA-F]{6}', value):
        return value
    m = re.fullmatch(r'rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)', value)
    if m:
        r, g, b = (int(x) for x in m.groups()[:3])
        a = float(m[4]) if m[4] is not None else 1.0
        return f'#{round(a * 255):02x}{r:02x}{g:02x}{b:02x}'
    return None


def load(folder):
    """{look id: {palette key: colour}} for every theme folder with a look.css."""
    looks = {}
    for css in sorted(Path(folder).glob('*/look.css')):
        look = css.parent.name
        looks[look] = palettes_from_css(css.read_text(encoding='utf-8')).get(look, {})
    return looks


def palettes_from_css(text):
    """{look id: {palette key: colour}} for every :root[data-look=<id>] block in some CSS (one theme's look.css, or the
    quiz server's /themes.css with all of them, for a TV screen)."""
    text = re.sub(r'/\*.*?\*/', '', text, flags=re.S)
    looks = {}
    for look, block in re.findall(r':root\[data-look=([\w-]+)\]\s*\{([^}]*)\}', text):
        palette = looks.setdefault(look, {})
        for name, value in re.findall(r'(--[\w-]+)\s*:\s*([^;]+);', block):
            colour = qt_colour(value)
            if name in NAMES and colour:
                palette[NAMES[name]] = colour
    return looks


def scenes(folder):
    """{look id: its tv.json, plus 'base' (the folder, as a file URL for its pictures)} for every theme with one. A
    tv.json that isn't JSON (or isn't an object) is left out: the TV then shows the look's colours only."""
    out = {}
    for path in sorted(Path(folder).glob('*/tv.json')):
        try:
            data = json.loads(path.read_text(encoding='utf-8'))
        except (OSError, ValueError):
            continue
        if isinstance(data, dict):
            look = {**qt_colours(data), 'base': path.parent.resolve().as_uri() + '/'}
            if isinstance(look.get('scene'), list):
                look['scene'] = [with_shape_motion(layer, path.parent) for layer in look['scene']]
            out[path.parent.name] = look
    return out


def with_shape_motion(layer, folder):
    """A scene layer, plus 'shapeMotion' ({frames, duration}) when its picture is an SVG whose shape is animated (the
    bat's wingbeat), which Qt's SVG renderer doesn't run: ThemeScene.qml plays it from svgmotion's frames."""
    image = layer.get('image') if isinstance(layer, dict) else None
    if not isinstance(image, str) or not image.endswith('.svg') or '..' in Path(image).parts:
        return layer
    motion = motion_of(folder / image)
    return {**layer, 'shapeMotion': motion} if motion else layer


def qt_colours(value):
    """tv.json with its colours ('#abc', 'rgba(…)', as CSS writes them) as Qt reads them; everything else unchanged."""
    if isinstance(value, dict):
        return {k: qt_colours(v) for k, v in value.items()}
    if isinstance(value, list):
        return [qt_colours(v) for v in value]
    return (qt_colour(value) or value) if isinstance(value, str) else value
