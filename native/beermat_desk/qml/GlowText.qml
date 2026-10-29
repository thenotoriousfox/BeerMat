// A line of lettering in a look's style (tv.json's title and eyebrow): a colour or a top-to-bottom gradient, a soft
// glow behind it, and letter spacing. Drawn on a canvas, so it looks the same with or without a GPU (no shader effects).
import QtQuick

Canvas {
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

    function letters(ctx) {
        let width = 0
        for (const c of text) width += ctx.measureText(c).width + letterSpacing
        return width - letterSpacing
    }
    onTextChanged: requestPaint()
    onStopsChanged: requestPaint()
    onColorChanged: requestPaint()
    onGlowChanged: requestPaint()
    onWidthChanged: requestPaint()
    onPaint: {
        const ctx = getContext("2d")
        ctx.reset()
        ctx.font = `${weight} ${pixelSize}px "${family}"`
        measured = letterSpacing ? letters(ctx) : ctx.measureText(text).width
        const top = pixelSize * 0.12, bottom = top + pixelSize, baseline = top + pixelSize * 0.82
        if (stops && stops.length) {
            const g = ctx.createLinearGradient(0, top, 0, bottom)
            for (const [at, colour] of stops) g.addColorStop(at, colour)
            ctx.fillStyle = g
        } else ctx.fillStyle = color
        ctx.shadowColor = glow
        ctx.shadowBlur = glow.a > 0 ? pixelSize * 0.45 : 0
        if (!letterSpacing) ctx.fillText(text, pixelSize * 0.1, baseline)
        else {
            let x = pixelSize * 0.1
            for (const c of text) {ctx.fillText(c, x, baseline); x += ctx.measureText(c).width + letterSpacing}
        }
    }
}
