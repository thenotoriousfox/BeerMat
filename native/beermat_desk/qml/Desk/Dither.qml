// Fine noise over a dark gradient, at a few percent: it breaks the gradient's colour steps up, which otherwise show as
// bands across the screen (brand/noise.png, made by brand/make-brand.py).
import QtQuick

Image {
    anchors.fill: parent
    source: brand + "noise.png"
    fillMode: Image.Tile
    smooth: false
    opacity: 0.035
}
