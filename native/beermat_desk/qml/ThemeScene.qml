// A look's scenery on the native TV, from its theme's tv.json (themes/README.md): pictures, glowing dots and drifting
// fog, laid out on the TV's 1920×1080 stage and moved along keyframes. One file draws any theme's scene, so a theme
// (a shipped one or one from the theme library) brings its own without code.
//   layer: {image | dot | fog, x, y, width, height, opacity, mirror, fit, align, color, glow, blobs,
//           motion: {duration, offset, alternate, easing, keys: [[at, dx, dy, opacity?], …]}}
import QtQuick

Item {
    id: scene
    property var layers: []
    property url base: ""      // the theme's folder, for its pictures
    anchors.fill: parent

    Repeater {
        model: scene.layers
        delegate: Item {
            id: layer
            required property var modelData
            readonly property var m: modelData.motion || null
            readonly property var keys: m && m.keys && m.keys.length ? m.keys : [[0, 0, 0], [1, 0, 0]]
            // Where along its motion (0–1): looping, or there and back, from its offset in.
            property real t: 0
            NumberAnimation on t {
                running: !!layer.m; loops: Animation.Infinite
                from: 0; to: 1; duration: layer.m ? layer.m.duration : 1000
                easing.type: layer.m && layer.m.easing === "sine" ? Easing.InOutSine : layer.m && layer.m.easing === "out" ? Easing.OutQuad : Easing.Linear
            }
            Component.onCompleted: if (m) t = ((m.offset || 0) / m.duration) % 1
            readonly property real phase: m && m.alternate ? (t < 0.5 ? t * 2 : 2 - t * 2) : t
            // The keyframe values at this phase, straight lines between keys.
            function at(index) {
                const k = keys
                let i = 0
                while (i < k.length - 2 && phase > k[i + 1][0]) i++
                const a = k[i], b = k[i + 1], span = Math.max(1e-6, b[0] - a[0]), f = Math.max(0, Math.min(1, (phase - a[0]) / span))
                const va = a[index] ?? (index === 3 ? 1 : 0), vb = b[index] ?? (index === 3 ? 1 : 0)
                return va + (vb - va) * f
            }
            x: (modelData.x || 0) + at(1)
            y: (modelData.y || 0) + at(2)
            width: modelData.width || 0; height: modelData.height || 0
            opacity: (modelData.opacity ?? 1) * at(3)

            Image {
                visible: !!layer.modelData.image
                anchors.fill: parent
                source: layer.modelData.image ? scene.base + layer.modelData.image : ""
                sourceSize: Qt.size(Math.ceil(parent.width * 2), Math.ceil(parent.height * 2))
                fillMode: layer.modelData.fit === "crop" ? Image.PreserveAspectCrop : layer.modelData.fit === "stretch" ? Image.Stretch : Image.PreserveAspectFit
                verticalAlignment: layer.modelData.align === "bottom" ? Image.AlignBottom : layer.modelData.align === "top" ? Image.AlignTop : Image.AlignVCenter
                mirror: !!layer.modelData.mirror
                smooth: true
            }
            // A glowing dot (an ember, a star): a soft halo, then the dot.
            Rectangle {
                visible: layer.modelData.dot === true
                anchors.centerIn: parent; width: parent.width * 3; height: width; radius: width / 2
                color: layer.modelData.glow || "transparent"; opacity: 0.35
            }
            Rectangle {
                visible: layer.modelData.dot === true
                anchors.fill: parent; radius: width / 2; color: layer.modelData.color || "white"
            }
            // Fog: soft elliptical patches across the layer, [x, y, width, height, opacity] as shares of it.
            Canvas {
                visible: !!layer.modelData.blobs
                anchors.fill: parent
                transform: Scale { origin.x: layer.width / 2; xScale: layer.modelData.mirror ? -1 : 1 }
                onPaint: {
                    const ctx = getContext("2d"), c = Qt.color(layer.modelData.color || "#ffffff")
                    ctx.reset()
                    for (const [cx, cy, rx, ry, alpha] of layer.modelData.blobs || []) {
                        ctx.save()
                        ctx.translate(cx * width, cy * height)
                        ctx.scale(1, (ry * height) / (rx * width))
                        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx * width)
                        g.addColorStop(0, Qt.rgba(c.r, c.g, c.b, alpha)); g.addColorStop(0.7, Qt.rgba(c.r, c.g, c.b, 0))
                        ctx.fillStyle = g
                        ctx.fillRect(-rx * width, -rx * width, 2 * rx * width, 2 * rx * width)
                        ctx.restore()
                    }
                }
            }
        }
    }
}
