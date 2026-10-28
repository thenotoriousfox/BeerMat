"""The looks (themes/<id>/look.css) as colours for the native TV: each look's CSS custom properties under
:root[data-look=<id>], turned into Qt colours. The web TV's scenery (Halloween's moon and bats, for example) isn't
drawn natively; the colours are."""
import re
from pathlib import Path

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
        text = re.sub(r'/\*.*?\*/', '', css.read_text(encoding='utf-8'), flags=re.S)
        palette = {}
        for block in re.findall(r':root\[data-look=' + re.escape(look) + r'\]\s*\{([^}]*)\}', text):
            for name, value in re.findall(r'(--[\w-]+)\s*:\s*([^;]+);', block):
                colour = qt_colour(value)
                if name in NAMES and colour:
                    palette[NAMES[name]] = colour
        looks[look] = palette
    return looks
