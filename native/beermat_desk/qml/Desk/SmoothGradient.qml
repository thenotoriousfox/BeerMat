// A top-to-bottom gradient without bands (gradients.py): made at the screen's own pixels and ordered-dithered, so
// dark colours a few steps apart change smoothly instead of in stripes. Inside a scaled item (the TV's stage), give
// its scale as `scaleHint` so the gradient is still made at screen pixels.
import QtQuick
import QtQuick.Window

Image {
    property var stops: []          // [[position, colour], …]
    property real scaleHint: 1
    readonly property real ratio: (Screen.devicePixelRatio || 1) * scaleHint
    readonly property int pixels: Math.max(1, Math.round(height * ratio))
    source: height > 0 && stops.length
        ? `image://gradient/${pixels}/${ratio}/${stops.map(s => `${Qt.color(s[1]).toString().slice(1)}@${s[0]}`).join(",")}` : ""
    fillMode: Image.TileHorizontally
    smooth: false
    asynchronous: false
}
