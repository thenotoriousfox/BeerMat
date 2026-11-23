// A line of lettering in a look's style (tv.json's title and eyebrow): a colour or a top-to-bottom gradient, a soft
// glow behind it, and letter spacing. Drawn on a canvas, so it looks the same with or without a GPU (no shader effects).
// The canvas reaches a margin beyond the lettering on every side, so the glow fades out instead of stopping at a box.
import QtQuick

Item {
    id: line
    property string text: ""
    property string family: "Fredoka"
    property int pixelSize: 56
    property string weight: "bold"
    property color color: "white"
    property var stops: null          // [[at, colour], …]
    property color glow: "transparent"
    property real letterSpacing: 0
    implicitHeight: Math.ceil(pixelSize * 1.35)
    implicitWidth: measured + pixelSize
    property real measured: 0
    readonly property real margin: Math.ceil(pixelSize * 0.9)

    function letters(ctx) {
        let width = 0
        for (const c of text) width += ctx.measureText(c).width + letterSpacing
        return width - letterSpacing
    }
    onTextChanged: canvas.requestPaint()
    onStopsChanged: canvas.requestPaint()
    onColorChanged: canvas.requestPaint()
    onGlowChanged: canvas.requestPaint()

    Canvas {
        id: canvas
        x: -line.margin; y: -line.margin
        width: line.width + 2 * line.margin; height: line.height + 2 * line.margin
        onWidthChanged: requestPaint()
        onHeightChanged: requestPaint()
        onPaint: {
            const ctx = getContext("2d"), size = line.pixelSize, m = line.margin
            ctx.reset()
            ctx.font = `${line.weight} ${size}px "${line.family}"`
            line.measured = line.letterSpacing ? line.letters(ctx) : ctx.measureText(line.text).width
            const top = m + size * 0.12, bottom = top + size, baseline = top + size * 0.82
            if (line.stops && line.stops.length) {
                const g = ctx.createLinearGradient(0, top, 0, bottom)
                for (const [at, colour] of line.stops) g.addColorStop(at, colour)
                ctx.fillStyle = g
            } else ctx.fillStyle = line.color
            ctx.shadowColor = line.glow
            ctx.shadowBlur = line.glow.a > 0 ? size * 0.45 : 0
            if (!line.letterSpacing) ctx.fillText(line.text, m + size * 0.1, baseline)
            else {
                let x = m + size * 0.1
                for (const c of line.text) {ctx.fillText(c, x, baseline); x += ctx.measureText(c).width + line.letterSpacing}
            }
        }
    }
}
