// A QR code, drawn from the same generator as the web pages (web/qr.js through qr.mjs).
import QtQuick
import "qr.mjs" as QR

Canvas {
    id: code
    property string text: ""
    property color dark: "#140b2e"
    readonly property var matrix: text ? QR.qrMatrix(text) : []
    onMatrixChanged: requestPaint()
    onWidthChanged: requestPaint()
    Accessible.role: Accessible.Graphic
    Accessible.name: "QR code: " + text
    onPaint: {
        const ctx = getContext("2d"), n = matrix.length
        ctx.reset()
        if (!n) return
        const cell = Math.floor(Math.min(width, height) / n), left = Math.floor((width - cell * n) / 2), top = Math.floor((height - cell * n) / 2)
        ctx.fillStyle = dark
        for (let y = 0; y < n; y++)
            for (let x = 0; x < n; x++)
                if (matrix[y][x]) ctx.fillRect(left + x * cell, top + y * cell, cell, cell)
    }
}
