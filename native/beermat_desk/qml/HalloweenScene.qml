// The Halloween look's scenery, as themes/halloween/look.css draws it on the web TV, with the same pictures: the moon
// rising behind the manor on its hill, bats crossing, ground fog drifting, a cobweb and its dangling spider, and
// embers rising from the jack-o'-lanterns. Laid out for the TV's 1920×1080 stage (the CSS's --scene is 520 px there).
import QtQuick

Item {
    id: scene
    anchors.fill: parent
    readonly property url art: brand + "../themes/halloween/art/"
    readonly property real h: 520            // --scene
    readonly property real vw: 19.2
    readonly property real vh: 10.8
    readonly property real vmin: 10.8

    // The moon, behind the manor's tower (71% across).
    Image {
        source: scene.art + "moon.svg"; width: scene.h * 0.9; height: width; sourceSize: Qt.size(width, height)
        x: 1920 * 0.71 - width / 2; y: 1080 - scene.h * 0.2 - height
        SequentialAnimation on opacity { loops: Animation.Infinite; NumberAnimation { to: 0.92; duration: 4500; easing.type: Easing.InOutSine } NumberAnimation { to: 1; duration: 4500; easing.type: Easing.InOutSine } }
    }
    // The hill and the manor.
    Image { source: scene.art + "scene.svg"; width: 1920; height: scene.h; y: 1080 - height; fillMode: Image.PreserveAspectCrop; verticalAlignment: Image.AlignBottom; sourceSize.width: 1920 }

    // Bats: two crossing low over the hill, two in the band above the quiz.
    component Bat: Image {
        id: bat
        property real size: 5 * scene.vmin
        property real baseY: 0
        property int duration: 19000
        property int offset: 0
        property bool back: false
        source: scene.art + "bat.svg"; width: size; height: size * 2 / 3; sourceSize: Qt.size(width * 2, height * 2); opacity: 0.95
        mirror: back
        property real t: 0
        NumberAnimation on t { from: 0; to: 1; duration: bat.duration; loops: Animation.Infinite; running: true }
        Component.onCompleted: t = (bat.offset / bat.duration) % 1
        // hw-fly: across in quarters, rising and dipping; hw-fly-back: the other way, one dip.
        readonly property real across: back ? 120 - 130 * t : 120 * t
        readonly property real lift: back ? -5 * Math.sin(Math.PI * t) : [0, -4, 2, -3, 1][Math.min(3, Math.floor(t * 4))] * (1 - (t * 4) % 1) + [0, -4, 2, -3, 1][Math.min(4, Math.floor(t * 4) + 1)] * ((t * 4) % 1)
        x: -8 * scene.vw + across * scene.vw
        y: baseY + lift * scene.vh
    }
    Bat { baseY: 1080 - scene.h * 0.95 - height; duration: 19000 }
    Bat { size: 3.4 * scene.vmin; baseY: 1080 - scene.h * 1.15 - height; duration: 27000; offset: 9000 }
    Bat { size: 3 * scene.vmin; baseY: 2 * scene.vh; duration: 34000; offset: 20000 }
    Bat { size: 4 * scene.vmin; baseY: 1080 - scene.h * 0.8 - height; duration: 23000; offset: 6000; back: true }

    // Ground fog: two layers of soft violet patches drifting at different speeds.
    component Fog: Canvas {
        id: fog
        property real drift: 30
        property int period: 60000
        width: 3840; height: scene.h * 0.45
        onPaint: {
            const ctx = getContext("2d"); ctx.reset()
            // radial-gradient(30% 60% at 20% 70%, …): ellipses as wide as a share of the layer and as tall as most of it.
            for (const [cx, cy, rx, ry, alpha] of [[0.2, 0.7, 0.3, 0.6, 0.32], [0.55, 0.8, 0.25, 0.5, 0.26], [0.85, 0.75, 0.3, 0.55, 0.3]]) {
                ctx.save()
                ctx.translate(cx * width, cy * height)
                ctx.scale(1, (ry * height) / (rx * width))
                const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx * width)
                g.addColorStop(0, Qt.rgba(220 / 255, 200 / 255, 1, alpha)); g.addColorStop(0.7, Qt.rgba(220 / 255, 200 / 255, 1, 0))
                ctx.fillStyle = g
                ctx.fillRect(-rx * width, -rx * width, 2 * rx * width, 2 * rx * width)
                ctx.restore()
            }
        }
        SequentialAnimation on x {
            loops: Animation.Infinite
            NumberAnimation { from: -960; to: -960 + fog.drift * scene.vw; duration: fog.period; easing.type: Easing.InOutSine }
            NumberAnimation { from: -960 + fog.drift * scene.vw; to: -960; duration: fog.period; easing.type: Easing.InOutSine }
        }
    }
    Fog { y: 1080 + 2 * scene.vh - height; opacity: 0.5 }
    Fog { y: 1080 + 5 * scene.vh - height; opacity: 0.35; drift: -25; period: 45000 }

    // A cobweb in the top-left corner, and its spider dangling on a thread.
    Image { source: scene.art + "web.svg"; width: 24 * scene.vmin; height: width; sourceSize: Qt.size(width, height); opacity: 0.8 }
    Image {
        source: scene.art + "spider.svg"; x: 0.6 * scene.vmin; width: 3.2 * scene.vmin; height: 60 * scene.vmin
        fillMode: Image.PreserveAspectFit; verticalAlignment: Image.AlignBottom; sourceSize.height: height
        SequentialAnimation on y {
            loops: Animation.Infinite
            NumberAnimation { from: -40 * scene.vmin; to: -34 * scene.vmin; duration: 3500; easing.type: Easing.InOutSine }
            NumberAnimation { from: -34 * scene.vmin; to: -40 * scene.vmin; duration: 3500; easing.type: Easing.InOutSine }
        }
    }

    // Embers rising from the lanterns.
    Repeater {
        model: [[0.075, 0], [0.12, 2000], [0.93, 4000], [0.88, 1000]]
        delegate: Rectangle {
            id: ember
            required property var modelData
            width: 0.6 * scene.vmin; height: width; radius: width / 2; color: "#ffb347"
            border.color: Qt.rgba(1, 0.48, 0.1, 0.6); border.width: 2
            property real t: 0
            NumberAnimation on t { from: 0; to: 1; duration: 6000; loops: Animation.Infinite; easing.type: Easing.OutQuad }
            Component.onCompleted: t = ember.modelData[1] / 6000
            x: 1920 * ember.modelData[0] + 2 * scene.vmin * t
            y: 1080 - scene.h * 0.1 - height - 22 * scene.vh * t
            opacity: t < 0.15 ? t / 0.15 * 0.9 : 0.9 * (1 - (t - 0.15) / 0.85)
        }
    }
}
