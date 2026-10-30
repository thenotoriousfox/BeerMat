"""SVG shape animation on the native TV. Qt's SVG renderer draws an SVG's own shape but doesn't run an <animate> that
changes a path's d (Halloween's bat flapping its wings), so the TV showed one still wingbeat. Here that animation is
worked out as browsers do (values, keyTimes, calcMode spline with keySplines) and drawn as a strip of frames, which
ThemeScene.qml plays with an AnimatedSprite. Only the first path with a d animation moves; anything else stays as drawn.

    image://svgmotion/<frames>/<frame width>/<frame height>/<file URL of the SVG>

install(engine) adds it to a QML engine; looks.scenes() marks the layers it can move (motion_of)."""
import re
import xml.etree.ElementTree as ET
from pathlib import Path

from PySide6.QtCore import QByteArray, QRectF, QUrl, Qt
from PySide6.QtGui import QImage, QPainter
from PySide6.QtQuick import QQuickImageProvider
from PySide6.QtSvg import QSvgRenderer

SVG = '{http://www.w3.org/2000/svg}'
NUMBER = re.compile(r'[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?')
TOKEN = re.compile(r'[A-Za-z]|' + NUMBER.pattern)
FPS = 30          # frames drawn per second of the animation (AnimatedSprite blends between them)
MAX_FRAMES = 48


def seconds(text):
    """An SMIL clock value: '.42s', '420ms', '0.42'."""
    text = (text or '').strip()
    if text.endswith('ms'):
        return float(text[:-2]) / 1000
    return float(text.rstrip('s')) if text else 0.0


def bezier(x1, y1, x2, y2, x):
    """The y of a keySpline (a CSS cubic-bezier from 0,0 to 1,1) at x, by bisection on its t."""
    lo, hi = 0.0, 1.0
    for _ in range(30):
        t = (lo + hi) / 2
        bx = 3 * (1 - t) ** 2 * t * x1 + 3 * (1 - t) * t ** 2 * x2 + t ** 3
        lo, hi = (t, hi) if bx < x else (lo, t)
    t = (lo + hi) / 2
    return 3 * (1 - t) ** 2 * t * y1 + 3 * (1 - t) * t ** 2 * y2 + t ** 3


def parse(text):
    """(the SVG's tree, its animated path, the animate element, duration in s, values, keyTimes, keySplines or None),
    or None when it has no d animation this can run: as in browsers, every value has the same commands and numbers."""
    try:
        tree = ET.ElementTree(ET.fromstring(text))
    except ET.ParseError:
        return None
    for path in tree.iter(SVG + 'path'):
        for animate in path.findall(SVG + 'animate'):
            if animate.get('attributeName') != 'd' or not animate.get('values'):
                continue
            values = [v.strip() for v in animate.get('values').split(';') if v.strip()]
            try:
                dur = seconds(animate.get('dur'))
            except ValueError:
                return None
            shapes = [[t if t.isalpha() else '#' for t in TOKEN.findall(v)] for v in values]
            if len(values) < 2 or dur <= 0 or any(s != shapes[0] for s in shapes):
                return None
            times = [float(t) for t in animate.get('keyTimes').split(';')] if animate.get('keyTimes') else \
                [i / (len(values) - 1) for i in range(len(values))]
            splines = None
            if animate.get('calcMode') == 'spline' and animate.get('keySplines'):
                splines = [[float(n) for n in NUMBER.findall(s)] for s in animate.get('keySplines').split(';') if s.strip()]
            if len(times) != len(values) or (splines and (len(splines) != len(values) - 1 or any(len(s) != 4 for s in splines))):
                return None
            return tree, path, animate, dur, values, times, splines
    return None


def d_at(values, times, splines, t):
    """The path's d at t (0–1 through the animation), each number in a straight line between its values."""
    i = 0
    while i < len(values) - 2 and t > times[i + 1]:
        i += 1
    span = times[i + 1] - times[i]
    f = 0.0 if span <= 0 else min(1.0, max(0.0, (t - times[i]) / span))
    if splines:
        f = bezier(*splines[i], f)
    a, b = TOKEN.findall(values[i]), TOKEN.findall(values[i + 1])
    return ' '.join(x if x.isalpha() else f'{float(x) + (float(y) - float(x)) * f:.3f}' for x, y in zip(a, b))


def motion_of(file):
    """{'frames', 'duration' (ms)} for an SVG whose path's d is animated, else None."""
    try:
        parsed = parse(Path(file).read_text(encoding='utf-8'))
    except (OSError, UnicodeDecodeError):
        return None
    if not parsed:
        return None
    dur = parsed[3]
    return {'frames': max(2, min(MAX_FRAMES, round(dur * FPS))), 'duration': round(dur * 1000)}


def strip(text, frames, width, height):
    """The animation as `frames` pictures of width × height side by side, from its start to just before it loops."""
    image = QImage(width * frames, height, QImage.Format.Format_ARGB32_Premultiplied)
    image.fill(Qt.GlobalColor.transparent)
    parsed = parse(text)
    if not parsed:
        return image
    tree, path, animate, _, values, times, splines = parsed
    path.remove(animate)
    ET.register_namespace('', SVG[1:-1])
    painter = QPainter(image)
    painter.setRenderHint(QPainter.RenderHint.Antialiasing)
    for i in range(frames):
        path.set('d', d_at(values, times, splines, i / frames))
        renderer = QSvgRenderer(QByteArray(ET.tostring(tree.getroot())))
        renderer.setAspectRatioMode(Qt.AspectRatioMode.KeepAspectRatio)
        renderer.render(painter, QRectF(i * width, 0, width, height))
    painter.end()
    return image


class MotionProvider(QQuickImageProvider):
    def __init__(self):
        super().__init__(QQuickImageProvider.ImageType.Image)
        self._made = {}

    def requestImage(self, id, size, requested):
        if id not in self._made:
            frames, width, height, url = id.split('/', 3)
            try:
                text = Path(QUrl(url).toLocalFile()).read_text(encoding='utf-8')
            except (OSError, UnicodeDecodeError):
                text = ''
            if len(self._made) > 32:
                self._made.clear()
            self._made[id] = strip(text, int(frames), max(1, int(width)), max(1, int(height)))
        image = self._made[id]
        if size is not None:
            size.setWidth(image.width()); size.setHeight(image.height())
        return image


def install(engine):
    engine.addImageProvider('svgmotion', MotionProvider())
