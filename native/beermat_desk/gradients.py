"""Smooth vertical gradients for the desk, the TV and the app preview. The backgrounds go between dark colours only a
few steps apart (the desk's #0d0720 to #140b2e is 7 to 14 levels over the whole window), and Qt draws each step as a
flat stripe, so they show as bands. Here the gradient is worked out exactly and each pixel rounded up or down by a
4×4 ordered (Bayer) pattern, so neighbouring pixels average to the true colour: no pixel is more than one level off,
and there are no stripes. Only the 4-pixel-wide pattern is made; QML tiles it across (Image.TileHorizontally).

    image://gradient/<height in device pixels>/<device pixel ratio (only to make the id unique)>/<rrggbb@position>,<rrggbb@position>,…

install(engine) adds it to a QML engine; Desk/SmoothGradient.qml uses it."""
from PySide6.QtGui import QColor, QImage
from PySide6.QtQuick import QQuickImageProvider

BAYER = ((0, 8, 2, 10), (12, 4, 14, 6), (3, 11, 1, 9), (15, 7, 13, 5))
WIDTH = 4


def stops_of(text):
    stops = []
    for part in text.split(','):
        colour, _, at = part.partition('@')
        c = QColor('#' + colour)
        stops.append((float(at), (c.red(), c.green(), c.blue())))
    return sorted(stops)


def colour_at(stops, t):
    if t <= stops[0][0]:
        return stops[0][1]
    for (a, ca), (b, cb) in zip(stops, stops[1:]):
        if t <= b:
            f = 0 if b == a else (t - a) / (b - a)
            return tuple(x + (y - x) * f for x, y in zip(ca, cb))
    return stops[-1][1]


def strip(height, stops):
    """The gradient, WIDTH pixels wide and `height` tall, ordered-dithered to 8 bits."""
    height = max(1, height)
    rows = bytearray()
    for y in range(height):
        exact = colour_at(stops, y / max(1, height - 1))
        for x in range(WIDTH):
            nudge = (BAYER[y % 4][x] + 0.5) / 16
            r, g, b = (min(255, int(v + nudge)) for v in exact)
            rows += bytes((b, g, r, 255))
    return QImage(bytes(rows), WIDTH, height, WIDTH * 4, QImage.Format.Format_RGB32).copy()


class GradientProvider(QQuickImageProvider):
    def __init__(self):
        super().__init__(QQuickImageProvider.ImageType.Image)
        self._made = {}

    def requestImage(self, id, size, requested):
        if id not in self._made:
            height, ratio, stops = id.split('/', 2)
            # Made at screen pixels, but no device pixel ratio of its own: Image already stretches it to its height
            # (TileHorizontally) and applies the screen's ratio itself, so setting one here counted it twice and, at
            # 125%, 150% or 200% scaling, cut the gradient short in a hard line part-way down the window.
            image = strip(int(height), stops_of(stops))
            if len(self._made) > 32:
                self._made.clear()
            self._made[id] = image
        image = self._made[id]
        if size is not None:
            size.setWidth(image.width()); size.setHeight(image.height())
        return image


def install(engine):
    engine.addImageProvider('gradient', GradientProvider())
