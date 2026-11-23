// The TV picture, drawn natively from the server's public state (the same /api/leaderboard the web TV reads): join
// screen with its QR code, the question and its reveal, buzzers, bingo, sound clips, the leaderboard with its stepped
// reveal, the winner, the wheel, the countdown and the rehearsal badge. It's laid out once at 1920×1080 and scaled to
// fit, so the desk's preview is exactly what the room sees.
import QtQuick
import QtQuick.Layouts
import QtMultimedia
import Desk
import "i18n.mjs" as I18n

Item {
    id: root
    property var tv: ({})
    property string serverUrl: ""
    property bool blanked: false
    // A preview of the TV (the desk's, a theme's): a video question's video plays without its sound.
    property bool silent: false
    // The question's look (themes/<id>/look.css): its colours over BeerMat's own. Keyed on the look's id, a string, so the
    // TV's many updates leave the look alone and its background, lettering and scenery aren't redrawn or restarted.
    readonly property string lookId: tv.look || "stage"
    property var palettes: desk.lookPalettes
    readonly property var pal: Object.assign({bg: Theme.bg, bg2: Theme.bg2, text: Theme.text, muted: Theme.muted, faint: Theme.faint, gold: Theme.gold,
        goldHi: Theme.goldHi, pink: Theme.pink, teal: Theme.teal, violet: Theme.violet, good: Theme.good, bad: Theme.bad, onAccent: Theme.onAccent,
        line: Theme.line, lineStrong: Theme.lineStrong, panel: Theme.panel}, palettes[lookId] || {})
    // What the look draws beyond colours (themes/<id>/tv.json): background, title, eyebrow, panel and scenery.
    readonly property var look: (desk.lookScenes || {})[lookId] || null
    readonly property var lookTitle: look && look.title && look.title.gradient ? look.title : null
    // A gradient's colour at stop i (repeating the last stop when it has fewer).
    function stop(stops, i) { return stops[Math.min(i, stops.length - 1)] }
    // Answer A–H's colours, light to dark: the same blocks as the phones' keypads and the web TV (style.css .opt.o0…o7).
    readonly property var optionFills: [["#ff6b5f", "#d6293d"], ["#4f9dff", "#2459d8"], ["#3be08c", "#129a55"], ["#ffd34d", "#e09a12"],
                                        ["#b17bff", "#7a3fe0"], ["#3fe0e0", "#138f9c"], ["#ff9f43", "#e0621f"], ["#ff6fb0", "#d0306f"]]
    readonly property var settings: tv.settings || {}
    // The quiz's language (the quizmaster chooses it); English if it's one the dictionary doesn't have.
    readonly property int langIndex: ({fr: 0, es: 1})[settings.language] ?? -1
    function t(text, values) {
        const row = langIndex >= 0 ? I18n.translations[text] : null
        let out = row ? row[langIndex] : text
        for (const k in (values || {})) out = out.split("{" + k + "}").join(String(values[k]))
        return out
    }
    readonly property var q: tv.question || null
    readonly property var teams: tv.teams || []
    readonly property string view: blanked ? "blank" : (tv.view || "")
    readonly property real offset: tv.offset || 0
    property real now: Date.now()
    Timer { interval: 100; running: root.visible && (!!root.q || !!root.tv.timer || root.view === "slides"); repeat: true; onTriggered: root.now = Date.now() }
    // The same shuffle as the web pages' (web/app.js seededOrder), so a picture's tiles go in the same order everywhere.
    function seededOrder(length, seed) {
        let h = 2166136261; for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
        const order = Array.from({length: length}, (_, i) => i)
        for (let i = length - 1; i > 0; i--) { h = Math.imul(h ^ (h >>> 15), 2246822507) ^ i; const j = (h >>> 0) % (i + 1); const x = order[i]; order[i] = order[j]; order[j] = x }
        return order
    }
    readonly property real serverNow: now + offset
    clip: true

    Rectangle { anchors.fill: parent; color: "black" }

    Item {
        id: stage
        width: 1920; height: 1080
        anchors.centerIn: parent
        scale: Math.min(root.width / width, root.height / height)
        visible: root.view !== "blank"

        // The background, without bands: BeerMat's, or the look's own gradient (tv.json's background).
        SmoothGradient {
            anchors.fill: parent; scaleHint: stage.scale
            readonly property var own: root.look && root.look.background && root.look.background.gradient ? root.look.background.gradient : null
            stops: own && own.length ? own : [[0, root.pal.panel], [0.55, root.pal.bg2], [1, root.pal.bg]]
        }
        // The look's soft coloured glows ([x, y, width, height, colour]), over its gradient.
        Canvas {
            id: lookBackground
            objectName: "lookBackground"
            anchors.fill: parent
            visible: !!(root.look && root.look.background)
            readonly property var background: root.look ? root.look.background || null : null
            onBackgroundChanged: requestPaint()
            onPaint: {
                const ctx = getContext("2d"), b = background
                ctx.reset()
                if (!b) return
                // The gradient is the SmoothGradient underneath; this adds the glows.
                for (const [cx, cy, w, h, colour] of b.glows || []) {
                    ctx.save(); ctx.translate(cx, cy); ctx.scale(1, h / w)
                    const r = ctx.createRadialGradient(0, 0, 0, 0, 0, w / 2), c = Qt.color(colour)
                    r.addColorStop(0, colour); r.addColorStop(0.6, Qt.rgba(c.r, c.g, c.b, 0))
                    ctx.fillStyle = r; ctx.fillRect(-w / 2, -w / 2, w, w); ctx.restore()
                }
            }
        }
        // Soft lights in the corners, as the web TV's decor.
        Repeater {
            model: root.look && root.look.background ? [] : [[160, 140, root.pal.gold], [1760, 220, root.pal.pink], [300, 960, root.pal.violet], [1650, 930, root.pal.teal]]
            delegate: Rectangle {
                required property var modelData
                x: modelData[0] - 260; y: modelData[1] - 260; width: 520; height: 520; radius: 260
                color: Qt.rgba(modelData[2].r, modelData[2].g, modelData[2].b, 0.07)
            }
        }

        // The look's scenery (tv.json's scene), behind everything.
        Loader {
            anchors.fill: parent
            active: !!(root.look && root.look.scene && root.look.scene.length)
            sourceComponent: ThemeScene { layers: root.look.scene; base: root.look.base }
        }

        // ---- header ----
        RowLayout {
            id: header
            x: 64; y: 40; width: parent.width - 128; height: 110
            spacing: 24
            Image { source: brand + "mark.svg"; sourceSize: Qt.size(88, 88); Layout.preferredWidth: 88; Layout.preferredHeight: 88 }
            ColumnLayout {
                spacing: 0; Layout.fillWidth: true
                // "QUIZ NIGHT" and the quiz's name: plain, or in the look's style (tv.json's eyebrow and title).
                readonly property var eyebrowStyle: root.look && root.look.eyebrow ? root.look.eyebrow : null
                Text {
                    visible: !parent.eyebrowStyle
                    text: root.t("QUIZ NIGHT"); color: root.pal.gold; font.family: Theme.display; font.pixelSize: 22; font.weight: Font.Bold; font.letterSpacing: 6
                }
                GlowText {
                    visible: !!parent.eyebrowStyle; Layout.preferredHeight: 30; Layout.fillWidth: true
                    text: root.t("QUIZ NIGHT"); family: Theme.display; pixelSize: 22; letterSpacing: 6
                    color: parent.eyebrowStyle && parent.eyebrowStyle.color ? parent.eyebrowStyle.color : root.pal.gold
                    glow: parent.eyebrowStyle && parent.eyebrowStyle.glow ? parent.eyebrowStyle.glow : "transparent"
                }
                Text {
                    visible: !root.lookTitle
                    text: root.settings.title || "BeerMat"; color: root.pal.text; font.family: Theme.display; font.pixelSize: 56; font.weight: Font.Bold; elide: Text.ElideRight; Layout.fillWidth: true
                }
                GlowText {
                    id: fancyTitle
                    visible: !!root.lookTitle; Layout.fillWidth: true; Layout.preferredHeight: implicitHeight
                    text: root.settings.title || "BeerMat"; family: Theme.display; pixelSize: 56
                    stops: root.lookTitle ? root.lookTitle.gradient : null
                    glow: root.lookTitle && root.lookTitle.glow ? root.lookTitle.glow : "transparent"
                    // A flicker ([at, opacity] keys over its duration), as the web TV's.
                    property real flick: 0
                    readonly property var flicker: root.lookTitle && root.lookTitle.flicker ? root.lookTitle.flicker : null
                    NumberAnimation on flick { running: !!fancyTitle.flicker && fancyTitle.visible; from: 0; to: 1; loops: Animation.Infinite; duration: fancyTitle.flicker ? fancyTitle.flicker.duration : 1000 }
                    opacity: {
                        const k = flicker ? flicker.keys : null
                        if (!k || k.length < 2) return 1
                        let i = 0
                        while (i < k.length - 2 && flick > k[i + 1][0]) i++
                        const f = Math.max(0, Math.min(1, (flick - k[i][0]) / Math.max(1e-6, k[i + 1][0] - k[i][0])))
                        return k[i][1] + (k[i + 1][1] - k[i][1]) * f
                    }
                }
            }
            // The TV countdown the quizmaster set (Tools).
            Rectangle {
                readonly property var timer: root.tv.timer || null
                readonly property real msLeft: !timer ? 0 : timer.endsAt === null ? timer.remaining : Math.max(0, timer.endsAt - root.serverNow)
                visible: !!timer
                Layout.preferredWidth: 300; Layout.preferredHeight: 110; radius: 22
                color: msLeft <= 10000 && msLeft > 0 ? Qt.rgba(root.pal.bad.r, root.pal.bad.g, root.pal.bad.b, 0.25) : Qt.rgba(1, 1, 1, 0.06)
                border.color: msLeft <= 0 ? root.pal.gold : root.pal.lineStrong
                Column {
                    anchors.centerIn: parent
                    Text { anchors.horizontalCenter: parent.horizontalCenter; text: parent.parent.timer ? parent.parent.timer.label : ""; color: root.pal.muted; font.pixelSize: 22 }
                    Text {
                        anchors.horizontalCenter: parent.horizontalCenter
                        readonly property int secs: Math.ceil(parent.parent.msLeft / 1000)
                        text: parent.parent.msLeft > 0 ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}` : root.t("Time’s up!")
                        color: root.pal.text; font.family: Theme.display; font.pixelSize: 52; font.weight: Font.Bold
                    }
                }
            }
        }

        // ---- the views; each fades in and out ----
        Item {
            id: body
            x: 64; y: 180; width: parent.width - 128; height: parent.height - 240

            // Join screen
            Item {
                id: joinView
                anchors.fill: parent
                opacity: root.view === "join" ? 1 : 0; visible: opacity > 0
                Behavior on opacity { NumberAnimation { duration: 300 } }
                readonly property string url: root.settings.joinUrl || ""
                readonly property bool online: !!root.settings.online
                readonly property bool lan: !online && root.settings.joinMode === "lan"
                readonly property bool locked: !online && !lan && !!root.settings.joinPassword
                readonly property bool joining: !!root.settings.registrationOpen && !root.settings.ended
                Text { id: joinTitle; anchors.horizontalCenter: parent.horizontalCenter; text: root.t("Join the quiz on your phone"); color: root.pal.text; font.family: Theme.display; font.pixelSize: 72; font.weight: Font.Bold }
                RowLayout {
                    anchors.top: joinTitle.bottom; anchors.topMargin: 50; anchors.horizontalCenter: parent.horizontalCenter
                    spacing: 80
                    Rectangle {
                        Layout.preferredWidth: 520; Layout.preferredHeight: 520; radius: 28; color: "white"
                        QrCode { anchors.fill: parent; anchors.margins: 26; text: joinView.url }
                    }
                    ColumnLayout {
                        spacing: 28; Layout.maximumWidth: 900
                        Repeater {
                            model: [
                                joinView.online ? "" : joinView.locked ? root.t("Join the “{ssid}” Wi-Fi (password: {password})", {ssid: root.settings.joinSsid, password: root.settings.joinPassword}) : root.t("Join the “{ssid}” Wi-Fi first", {ssid: root.settings.joinSsid}),
                                root.t("Scan with your phone camera"),
                                root.t("Or go to {url}", {url: joinView.url.replace(/^https?:\/\//, "")}),
                                root.t("Pick a team name and keep the page open")].filter(s => s)
                            delegate: RowLayout {
                                required property string modelData
                                required property int index
                                spacing: 22
                                Rectangle { width: 64; height: 64; radius: 32; color: root.pal.gold
                                            Text { anchors.centerIn: parent; text: index + 1; color: root.pal.onAccent; font.family: Theme.display; font.pixelSize: 34; font.weight: Font.Bold } }
                                Text { text: modelData; color: root.pal.text; font.pixelSize: 40; font.weight: Font.DemiBold; wrapMode: Text.WordWrap; Layout.maximumWidth: 800 }
                            }
                        }
                        Text { visible: !joinView.online && !joinView.lan; text: root.t("If your phone warns about “no internet”, choose “Use network as is” or “Stay connected”.")
                               color: root.pal.muted; font.pixelSize: 26; wrapMode: Text.WordWrap; Layout.maximumWidth: 860 }
                        Text {
                            text: !joinView.joining ? root.t("Registration is closed — ask the quizmaster to join") : root.teams.length === 1 ? root.t("1 team has joined") : root.teams.length ? root.t("{n} teams have joined", {n: root.teams.length}) : root.t("Be the first team to join!")
                            color: root.pal.goldHi; font.family: Theme.display; font.pixelSize: 40; font.weight: Font.Bold
                        }
                    }
                }
            }

            // Question
            Item {
                id: questionView
                objectName: "questionView"
                anchors.fill: parent
                // The look's panel behind the question (tv.json's panel), as the web TV's card.
                Rectangle {
                    id: lookPanel
                    readonly property var style: root.look && root.look.panel ? root.look.panel : null
                    // Without one of the look's own, BeerMat's: a faint glass card, as the web TV's (style.css #stage > section).
                    x: -36; y: -28; width: parent.width + 72; height: parent.height + 28
                    radius: 28; border.width: 2; border.color: style && style.border ? style.border : Qt.rgba(1, 1, 1, 0.16)
                    gradient: Gradient {
                        GradientStop { position: 0; color: lookPanel.style ? root.stop(lookPanel.style.gradient, 0)[1] : Qt.rgba(1, 1, 1, 0.07) }
                        GradientStop { position: 1; color: lookPanel.style ? root.stop(lookPanel.style.gradient, 9)[1] : Qt.rgba(1, 1, 1, 0.03) }
                    }
                }
                opacity: root.view === "question" ? 1 : 0; visible: opacity > 0
                Behavior on opacity { NumberAnimation { duration: 300 } }
                readonly property var q: root.q
                readonly property real msLeft: !q ? 0 : q.paused ? q.remaining : Math.max(0, q.deadline - root.serverNow)
                readonly property bool bingo: !!q && (q.type === "bingo" || q.type === "musicbingo")
                readonly property var items: !q ? [] : ["choice", "vote", "multi"].includes(q.type) ? q.options
                                           : q.type === "sheet" ? (q.items || [])
                                           : q.type === "clues" ? (q.clues || [])
                                           // Link groups: the items in rows (three or four a row), so a dozen fit the screen.
                                           : q.type === "links" ? (q.linkItems || []).reduce((rows, item, i, all) => { const per = all.length % 4 === 0 || all.length > 12 ? 4 : 3; if (i % per === 0) rows.push(item); else rows[rows.length - 1] += "   ·   " + item; return rows }, [])
                                           : q.type === "sort" ? [(q.categories || []).join("  ·  "), ...(q.sortItems || [])]
                                           : q.type === "pairs" ? [...(q.left || []).map((l, i) => `${String.fromCharCode(65 + i)}. ${l}`), ...(q.right || []).map((r, i) => `${i + 1}. ${r}`)]
                                           : q.type === "tiles" ? [(q.wordLengths || []).map(n => "_".repeat(n)).join("  "), (q.pieces || []).join("  ·  ")] : []
                readonly property bool isImage: !!q && !!q.media && !/\.(mp3|ogg|wav|mp4|webm)$/i.test(q.media)
                readonly property bool isVideo: !!q && !!q.media && /\.(mp4|webm)$/i.test(q.media)
                readonly property bool isAudio: !!q && !!q.media && /\.(mp3|ogg|wav)$/i.test(q.media)
                // A picture with nothing beside it (no options or list) takes the whole width.
                readonly property bool pictureAlone: !!q && isImage && items.length === 0 && q.type !== "sequence"

                ColumnLayout {
                    id: questionColumn
                    // Once the answer box is up, what's on screen shrinks to fit above it rather than hide behind it.
                    anchors.fill: parent; anchors.bottomMargin: reveal.shown ? reveal.height + 24 : 0
                    // Only as the box comes up: when it goes (the next question opening) the space is back at once, so the
                    // new question's tiles and lists don't grow into place in front of the room.
                    Behavior on anchors.bottomMargin { enabled: reveal.shown; NumberAnimation { duration: 500; easing.type: Easing.OutCubic } }
                    spacing: 22
                    Text { text: questionView.q ? (questionView.q.round || "").toUpperCase() : ""; color: root.pal.gold; font.pixelSize: 30; font.weight: Font.Bold; font.letterSpacing: 4 }
                    Text {
                        Layout.fillWidth: true
                        // Wording that would give the answer away (hideText) comes to no screen but the desk until the
                        // reveal: the room listens to the quizmaster instead, as the phones say.
                        readonly property bool hidden: !!questionView.q && !questionView.q.text
                        objectName: "questionText"
                        text: !questionView.q ? root.t("Waiting for the quizmaster") : hidden ? "🎙  " + root.t("Listen to the quizmaster") : questionView.q.text
                        color: hidden ? root.pal.goldHi : root.pal.text; font.family: Theme.display; font.weight: Font.Bold; wrapMode: Text.WordWrap
                        // As big as the web TV's when answers or a short line follow; a round with a lot under the question
                        // (a board, a picture, a list, a grid) keeps it smaller so all of it fits.
                        readonly property bool roomy: !questionView.q || ["choice", "vote", "multi", "text", "letter", "number", "nearest", "buzzer"].includes(questionView.q.type) && !questionView.isImage
                        // At the reveal the answer is the star (as the web TV): the question steps back to make room for it
                        // and for who scored.
                        readonly property bool revealed: !!questionView.q && (questionView.q.revealed || questionView.q.revealing)
                        font.pixelSize: revealed ? (text.length > 140 ? 40 : text.length > 80 ? 48 : 60)
                                      : roomy ? (text.length > 140 ? 66 : text.length > 80 ? 84 : 104) : (text.length > 140 ? 54 : text.length > 80 ? 66 : 78)
                    }
                    // Time left, from the server's deadline (gone at the reveal, as on the web TV: the answer needs the room).
                    RowLayout {
                        visible: !!questionView.q && !questionView.q.revealed
                        spacing: 24
                        Text {
                            text: !questionView.q ? "" : questionView.bingo ? (questionView.q.paused ? root.t("Paused") : questionView.q.live ? root.t("Eyes down — game in progress") : root.t("Game over"))
                                : questionView.q.held ? root.t("Get ready: the question is on its way")
                                : questionView.q.paused ? root.t("Paused · {n}s remaining", {n: Math.ceil(questionView.q.remaining / 1000)})
                                : (!questionView.q.open || questionView.msLeft <= 0 ? root.t("Answers closed") : root.t("{n}s remaining", {n: Math.ceil(questionView.msLeft / 1000)}))
                                  + (questionView.q.wager ? "  ·  " + root.t("Wager: up to {n} points", {n: questionView.q.wager}) : "")
                                  + (questionView.q.nowPlaying && questionView.q.live ? "  ·  ♪ " + questionView.q.nowPlaying : "")
                                  + (questionView.q.type === "clues" && questionView.q.open && questionView.msLeft > 0 && !questionView.q.wager ? "  ·  " + root.t("Clue {n} of {total}: {p} points now", {n: questionView.q.cluesShown, total: questionView.q.clueCount, p: questionView.q.cluePoints}) : "")
                            color: questionView.q && questionView.q.open ? root.pal.gold : root.pal.muted; font.family: Theme.display; font.pixelSize: 60; font.weight: Font.Bold
                        }
                        Rectangle {
                            visible: !!questionView.q && questionView.q.open && !questionView.bingo && questionView.q.seconds > 0
                            Layout.fillWidth: true; Layout.preferredHeight: 14; radius: 7; color: Qt.rgba(1, 1, 1, 0.1)
                            Rectangle {
                                height: parent.height; radius: 7
                                width: parent.width * (questionView.q && questionView.q.seconds ? Math.min(1, questionView.msLeft / (questionView.q.seconds * 1000)) : 0)
                                gradient: Gradient { orientation: Gradient.Horizontal; GradientStop { position: 0; color: root.pal.gold } GradientStop { position: 1; color: root.pal.pink } }
                            }
                        }
                    }
                    // What a wrong answer costs (Risk It, Wipeout), told while the question is up (as the web TV's riskNote).
                    Text {
                        objectName: "riskNote"
                        readonly property string note: !questionView.q || questionView.q.revealed ? "" : questionView.q.evil ? root.t("🎲 Risk It: a wrong answer loses the points")
                            : questionView.q.type === "multi" && questionView.q.wipeout ? root.t("💥 Wipeout: one wrong tick and you score nothing") : ""
                        visible: note !== ""; text: note
                        color: root.pal.bad; font.family: Theme.display; font.pixelSize: 44; font.weight: Font.Bold
                    }
                    RowLayout {
                        Layout.fillWidth: true; Layout.fillHeight: true
                        spacing: 40
                        // A video question's video: plays as it opens (once sent), and again or stops when the desk says.
                        Video {
                            id: tvVideo
                            objectName: "tvVideo"
                            visible: questionView.isVideo
                            source: visible ? root.serverUrl + questionView.q.media : ""
                            Layout.fillHeight: true; Layout.fillWidth: true
                            fillMode: VideoOutput.PreserveAspectFit
                            muted: root.silent
                            property string cueKey: ""
                            function follow() {
                                const q = questionView.q, cue = q && q.videoCue
                                if (!visible || !cue) return
                                const key = `${q.id}:${cue.seq}:${cue.action}:${q.live && !q.held}`
                                if (key === cueKey) return
                                const was = cueKey
                                cueKey = key
                                if (cue.action === "stop") return pause()
                                if (!q.live || q.held) return
                                // A cue newer than the one this TV saw, or the question just sent: from the start.
                                if (was !== "" || cue.seq === 0) { seek(0); play() }
                            }
                            onSourceChanged: { cueKey = ""; Qt.callLater(follow) }
                            Connections { target: root; function onTvChanged() { tvVideo.follow() } }
                        }
                        // Picture (or a sound playing on the desk)
                        Image {
                            visible: questionView.isImage
                            source: questionView.isImage ? (questionView.q.media.startsWith("http") ? questionView.q.media : root.serverUrl + questionView.q.media) : ""
                            Layout.fillHeight: true; Layout.fillWidth: questionView.pictureAlone; Layout.preferredWidth: visible ? 760 : 0
                            fillMode: Image.PreserveAspectFit; asynchronous: true; smooth: true
                            // A picture revealed over the question's time (reveal: blur or tiles): how much shows, 0–1.
                            readonly property string revealMode: questionView.q && questionView.q.reveal ? questionView.q.reveal : ""
                            readonly property real shownShare: !revealMode || !questionView.q.live || questionView.q.revealed ? 1 : questionView.q.held ? 0
                                // Over the first revealSeconds when set (then whole for the rest of the time), else the whole time.
                                : Math.min(1, Math.max(0, (questionView.q.seconds * 1000 - questionView.msLeft) / ((questionView.q.revealSeconds || questionView.q.seconds) * 1000)))
                            // Blur: the picture loaded tiny and stretched (soft), sharper as it goes: twenty sizes from 6 to 240
                            // pixels wide, the next one fading in over this one so it sharpens smoothly rather than in jumps
                            // (no shader, so it works on any graphics). 0 is its own size.
                            readonly property real blurLevel: revealMode === "blur" && shownShare < 1 ? shownShare * 20 : -1
                            readonly property var blurWidths: [...Array(21).keys()].map(k => Math.round(6 * Math.pow(40, k / 20)))
                            sourceSize.width: blurLevel >= 0 ? blurWidths[Math.floor(blurLevel)] : 0
                            retainWhileLoading: true
                            Image {
                                objectName: "blurNext"
                                anchors.fill: parent; fillMode: parent.fillMode; asynchronous: true; smooth: true; retainWhileLoading: true
                                visible: parent.blurLevel >= 0
                                source: visible ? parent.source : ""
                                sourceSize.width: visible ? parent.blurWidths[Math.min(20, Math.floor(parent.blurLevel) + 1)] : 1
                                opacity: visible ? parent.blurLevel - Math.floor(parent.blurLevel) : 0
                            }
                            Grid {
                                id: revealTiles
                                visible: parent.revealMode === "tiles" && parent.status === Image.Ready
                                readonly property var order: questionView.q ? root.seededOrder(20, `tiles:${questionView.q.id}`) : []
                                x: (parent.width - parent.paintedWidth) / 2; y: (parent.height - parent.paintedHeight) / 2
                                width: parent.paintedWidth; height: parent.paintedHeight; columns: 4; spacing: 0
                                Repeater {
                                    model: 20
                                    delegate: Rectangle {
                                        id: revealTile
                                        required property int index
                                        objectName: "revealTile"
                                        width: revealTiles.width / 4; height: revealTiles.height / 5
                                        color: root.pal.violet
                                        opacity: revealTiles.order[index] < Math.floor(revealTiles.parent.shownShare * 20) ? 0 : 1
                                        // A tile fades as it comes off, but goes back on at once: a new picture starts covered,
                                        // not showing through tiles still fading in from the last one.
                                        Behavior on opacity { enabled: revealTile.opacity > 0.5; NumberAnimation { duration: 500 } }
                                    }
                                }
                            }
                            // Pinpoint: the target (or every place to find) appears on the picture once revealed.
                            Repeater {
                                id: pinTargets
                                readonly property var picture: parent
                                model: questionView.q && questionView.q.revealed && questionView.q.type === "pinpoint" ? (questionView.q.targets || (questionView.q.target ? [questionView.q.target] : [])) : []
                                delegate: Rectangle {
                                    required property var modelData
                                    visible: pinTargets.picture.status === Image.Ready
                                    width: 44; height: 44; radius: 22; color: "transparent"; border.color: root.pal.good; border.width: 6
                                    x: (pinTargets.picture.width - pinTargets.picture.paintedWidth) / 2 + modelData.x * pinTargets.picture.paintedWidth - 22
                                    y: (pinTargets.picture.height - pinTargets.picture.paintedHeight) / 2 + modelData.y * pinTargets.picture.paintedHeight - 22
                                }
                            }
                        }
                        Text { visible: questionView.isAudio; text: root.t("♪  Listen"); color: root.pal.teal; font.family: Theme.display; font.pixelSize: 110; font.weight: Font.Bold }
                        ColumnLayout {
                            id: answers
                            visible: !questionView.pictureAlone
                            Layout.fillWidth: true; Layout.fillHeight: true
                            spacing: 18
                            // Options as coloured tiles matching the phone keypad; items in a list.
                            GridLayout {
                                id: optionTiles
                                visible: questionView.items.length > 0
                                Layout.fillWidth: true; Layout.fillHeight: true; Layout.verticalStretchFactor: 1000
                                // Tiles grow into the space, up to a comfortable size.
                                Layout.maximumHeight: Math.ceil(questionView.items.length / columns) * (240 + rowSpacing)
                                columns: questionView.isImage || questionView.items.length > 6 || !questionView.q || !["choice", "vote", "multi"].includes(questionView.q.type) ? 1 : 2
                                columnSpacing: 18; rowSpacing: 16
                                Repeater {
                                    model: questionView.items
                                    delegate: Rectangle {
                                        id: tile
                                        required property string modelData
                                        required property int index
                                        objectName: "optionTile"
                                        // Options are solid colour blocks, the same as on every phone and the web TV
                                        // (style.css .options li): white letters, dark on the yellow one. Lists stay glass.
                                        readonly property bool options: !!questionView.q && ["choice", "vote", "multi"].includes(questionView.q.type)
                                        readonly property var fill: root.optionFills[index % 8]
                                        readonly property bool correct: !!questionView.q && questionView.q.revealed && (questionView.q.answer === modelData || (questionView.q.correct || []).includes(modelData))
                                        readonly property bool dimmed: options && !!questionView.q && questionView.q.revealed && !correct
                                        Layout.fillWidth: true; Layout.fillHeight: true; Layout.minimumHeight: 64; implicitHeight: 92; radius: 20
                                        readonly property real textSize: Math.max(32, Math.min(68, height * 0.42))
                                        // The darker edge along the bottom (the web TV's inset shadow) is this; the face sits on it.
                                        color: options ? Qt.darker(fill[1], 1.35) : root.pal.violet
                                        opacity: dimmed ? 0.3 : 1
                                        Behavior on opacity { NumberAnimation { duration: 400 } }
                                        border.color: correct ? root.pal.good : "transparent"; border.width: correct ? 6 : 0
                                        Rectangle {
                                            anchors.fill: parent; anchors.bottomMargin: tile.options ? 6 : 0; anchors.margins: tile.correct ? 6 : 0
                                            radius: tile.radius - (tile.correct ? 4 : 0)
                                            visible: tile.options
                                            gradient: Gradient {
                                                GradientStop { position: 0; color: tile.fill[0] }
                                                GradientStop { position: 1; color: tile.fill[1] }
                                            }
                                        }
                                        Rectangle {
                                            anchors.fill: parent; radius: tile.radius; visible: !tile.options
                                            color: Qt.rgba(1, 1, 1, 0.06); border.color: Qt.rgba(1, 1, 1, 0.16); border.width: 2
                                        }
                                        Text {
                                            anchors.fill: parent; anchors.leftMargin: 28; anchors.rightMargin: 28; anchors.bottomMargin: tile.options ? 6 : 0; verticalAlignment: Text.AlignVCenter
                                            text: tile.options && questionView.q && questionView.q.pair ? root.t(tile.modelData) : `${tile.options ? String.fromCharCode(65 + tile.index) + ".  " : questionView.q && ["sheet", "clues"].includes(questionView.q.type) ? (tile.index + 1) + ".  " : questionView.q && questionView.q.type === "pairs" ? "" : questionView.q && questionView.q.type === "tiles" ? "" : "•  "}${tile.modelData}`
                                            color: tile.options && tile.index % 8 === 3 ? "#241500" : root.pal.text
                                            style: tile.options && tile.index % 8 !== 3 ? Text.Raised : Text.Normal; styleColor: Qt.rgba(0, 0, 0, 0.35)
                                            // A long line (a progressive clue, a sheet's item) wraps and shrinks to fit its tile rather than
                                            // being cut off; "…" only if it still can't fit.
                                            font.pixelSize: tile.textSize; font.weight: Font.Black; elide: Text.ElideRight
                                            wrapMode: Text.WordWrap; maximumLineCount: 3; fontSizeMode: Text.Fit; minimumPixelSize: 20; lineHeight: 0.95
                                            objectName: "optionText"
                                            rightPadding: 90
                                        }
                                        // How many teams picked it, once revealed.
                                        Text {
                                            visible: tile.options && !!questionView.q && questionView.q.revealed && !!questionView.q.tally
                                            anchors.right: parent.right; anchors.rightMargin: 28; anchors.verticalCenter: parent.verticalCenter; anchors.verticalCenterOffset: -3
                                            text: questionView.q && questionView.q.tally ? (questionView.q.tally[tile.modelData] || 0) : ""
                                            color: tile.index % 8 === 3 ? "#241500" : root.pal.text; font.family: Theme.display; font.pixelSize: tile.textSize + 4; font.weight: Font.Bold
                                        }
                                    }
                                }
                            }
                            // Put in order: the items as shown on phones; once revealed, each slides to its right place,
                            // numbered (q.items is the right order, q.order the shuffled one).
                            Item {
                                id: sequenceList
                                objectName: "sequenceList"
                                readonly property var q: questionView.q
                                readonly property bool sorted: !!q && !!q.revealed
                                // The rows only slide for the answer's reveal; any other change (the screen settling as the
                                // question appears, the answer box coming up) puts them straight in place.
                                property bool sliding: false
                                onSortedChanged: if (sorted && order.length) { sliding = true; slideEnd.restart() }
                                Timer { id: slideEnd; interval: 800 + 90 * sequenceList.order.length; onTriggered: sequenceList.sliding = false }
                                // Rows grow into the space, up to a comfortable size, and shrink (closer together) when eight of
                                // them share it with who scored: the whole answer stays on the screen.
                                readonly property real gap: order.length > 5 ? 8 : 16
                                readonly property real rowHeight: Math.max(40, Math.min(170, order.length ? (height + gap) / order.length - gap : 92))
                                readonly property real row: rowHeight + gap
                                // Kept per question: every state update brings a new q.order, which would rebuild the rows
                                // (and skip the slide) just as the reveal arrives.
                                property var order: []
                                property int question: 0
                                onQChanged: if (!q || q.type !== "sequence" || !q.order) { order = []; question = 0 }
                                            else if (q.id !== question) { question = q.id; order = q.order }
                                visible: order.length > 0
                                Layout.fillWidth: true; Layout.fillHeight: visible; Layout.verticalStretchFactor: 1000; Layout.maximumHeight: order.length * (170 + 16)
                                implicitHeight: visible ? order.length * (92 + 16) - 16 : 0
                                Repeater {
                                    model: sequenceList.order
                                    delegate: Rectangle {
                                        required property int modelData     // the item, which is also its right place
                                        required property int index         // where it's shown before the reveal
                                        objectName: "sequenceItem"
                                        width: sequenceList.width; height: sequenceList.rowHeight; radius: 20
                                        y: (sequenceList.sorted ? modelData : index) * sequenceList.row
                                        Behavior on y { enabled: sequenceList.sliding
                                            NumberAnimation { duration: 700 + modelData * 90; easing.type: Easing.OutCubic } }
                                        color: Qt.rgba(root.pal.violet.r, root.pal.violet.g, root.pal.violet.b, 0.28)
                                        border.color: sequenceList.sorted ? root.pal.good : Qt.rgba(root.pal.violet.r, root.pal.violet.g, root.pal.violet.b, 0.7)
                                        border.width: sequenceList.sorted ? 5 : 2
                                        Text {
                                            anchors.fill: parent; anchors.leftMargin: 28; anchors.rightMargin: 28; verticalAlignment: Text.AlignVCenter
                                            text: `${sequenceList.sorted ? (modelData + 1) + "." : "•"}  ${sequenceList.q.items[modelData]}`
                                            color: root.pal.text; font.pixelSize: Math.max(26, Math.min(64, sequenceList.rowHeight * 0.5)); font.weight: Font.Bold; elide: Text.ElideRight
                                        }
                                    }
                                }
                            }
                            // A buzzer or a clip sits in the middle of the space.
                            Item { Layout.fillHeight: buzzerBox.visible || clipsBox.visible }
                            // Buzzers: who's on, who's queued, agreeing.
                            Column {
                                id: buzzerBox
                                readonly property var b: questionView.q ? questionView.q.buzz : null
                                visible: !!b
                                Layout.alignment: Qt.AlignHCenter
                                spacing: 12
                                Image { visible: !!(parent.b && parent.b.active && parent.b.active.photo); source: visible ? root.serverUrl + parent.b.active.photo : ""; sourceSize.height: 160; height: 160; fillMode: Image.PreserveAspectFit }
                                Text { text: parent.b && parent.b.active ? `🔔 ${parent.b.active.name}` : questionView.q && questionView.q.open ? root.t("Buzzers open") : ""
                                       color: root.pal.goldHi; font.family: Theme.display; font.pixelSize: 150; font.weight: Font.Bold }
                                Text { text: !parent.b ? "" : parent.b.agreeOpen ? root.t("“{answer}” — agree now! {n} agreed", {answer: parent.b.announced, n: parent.b.agreeCount}) : questionView.q && questionView.q.open ? (parent.b.queue || []).filter(x => x.status === "queued").map(x => x.name).join(" · ") : ""
                                       color: root.pal.text; font.pixelSize: 56 }
                            }
                            // Word trail: the grid; once revealed, the answer's path lights up in order.
                            Item {
                                id: snakeBox
                                visible: !!questionView.q && questionView.q.type === "wordsnake" && !!questionView.q.grid
                                Layout.fillWidth: true; Layout.fillHeight: true; Layout.preferredHeight: 300; Layout.verticalStretchFactor: 1000
                                // Letters as big as the space allows.
                                readonly property int size: visible ? questionView.q.grid.size : 1
                                readonly property real cell: Math.max(56, Math.min(170, (height - (size - 1) * 8) / size, (width - (size - 1) * 8) / size))
                            Grid {
                                readonly property var g: questionView.q ? questionView.q.grid : null
                                readonly property var path: questionView.q && questionView.q.revealed ? (questionView.q.snakePath || []) : []
                                visible: snakeBox.visible
                                columns: g ? g.size : 1; spacing: 8
                                Repeater {
                                    model: parent.g ? parent.g.letters : []
                                    delegate: Rectangle {
                                        required property string modelData
                                        required property int index
                                        readonly property int step: parent.path.indexOf(index)
                                        width: snakeBox.cell; height: snakeBox.cell; radius: snakeBox.cell / 6
                                        color: step >= 0 ? root.pal.gold : Qt.rgba(1, 1, 1, 0.07)
                                        border.color: root.pal.lineStrong
                                        Behavior on color { ColorAnimation { duration: 300 } }
                                        Text { anchors.centerIn: parent; text: modelData; color: parent.step >= 0 ? root.pal.onAccent : root.pal.text; font.family: Theme.display; font.pixelSize: snakeBox.cell * 0.52; font.weight: Font.Bold }
                                        Text { visible: parent.step >= 0; anchors.right: parent.right; anchors.top: parent.top; anchors.margins: 6; text: parent.step + 1; color: root.pal.onAccent; font.pixelSize: Math.max(18, snakeBox.cell * 0.2); font.weight: Font.Bold }
                                    }
                                }
                            }
                            }
                            // The ball (or song) and, for music bingo, the reaction table beside it rather than under it.
                            RowLayout {
                                visible: !!questionView.q && !!questionView.q.bingo
                                Layout.fillWidth: true; Layout.fillHeight: visible; Layout.preferredHeight: 300; Layout.verticalStretchFactor: 1000
                                spacing: 60
                                // Bingo: the last ball and the board.
                                Column {
                                    id: bingoBox
                                    readonly property var g: questionView.q ? questionView.q.bingo : null
                                    visible: !!g
                                    spacing: 16
                                    Layout.fillWidth: true; Layout.fillHeight: visible; Layout.alignment: Qt.AlignTop
                                    // Never squeezed below the ball and its lines.
                                    Layout.minimumHeight: visible ? ball.height + phrase.height + called.height + 2 * spacing : 0
                                    // The board across the width, its numbers as tall as the space under the ball allows.
                                    readonly property real cellWidth: Math.max(54, Math.min(140, (width - 14 * 6) / 15))
                                    readonly property real cellHeight: Math.max(42, Math.min(cellWidth * 0.75, (height - ball.height - phrase.height - called.height - 4 * spacing - 5 * 6) / 6))
                                    Text { id: ball; text: !parent.g ? "" : parent.g.music ? (parent.g.played ? "🎵 " + root.t("Song {n}", {n: parent.g.played}) : "🎵") : (parent.g.last !== null && parent.g.last !== undefined ? parent.g.last : "–")
                                           color: root.pal.goldHi; font.family: Theme.display; font.pixelSize: 160; font.weight: Font.Bold }
                                    Text { id: phrase; text: !parent.g ? "" : parent.g.music ? (parent.g.titles && parent.g.titles.length ? root.t("Last revealed: {title}", {title: parent.g.titles[parent.g.titles.length - 1]}) : "") : (root.settings.bingoPhrases && parent.g.phrase ? parent.g.phrase : "")
                                           color: root.pal.text; font.pixelSize: 40 }
                                    Text { id: called; text: parent.g && parent.g.winners && parent.g.winners.length ? root.t("Winner: {names}", {names: parent.g.winners.map(w => w.name || w).join(", ")}) : parent.g && !parent.g.music ? root.t("{n} called", {n: parent.g.count || 0}) : ""
                                           color: root.pal.muted; font.pixelSize: 34 }
                                    Grid {
                                        visible: !!parent.g && !parent.g.music && !!parent.g.board
                                        columns: 15; spacing: 6
                                        Repeater {
                                            model: 90
                                            delegate: Rectangle {
                                                required property int index
                                                readonly property bool called: !!questionView.q && !!questionView.q.bingo && (questionView.q.bingo.called || []).includes(index + 1)
                                                width: bingoBox.cellWidth; height: bingoBox.cellHeight; radius: 8
                                                color: called ? root.pal.gold : Qt.rgba(1, 1, 1, 0.06)
                                                Text { anchors.centerIn: parent; text: index + 1; color: parent.called ? root.pal.onAccent : root.pal.faint; font.pixelSize: Math.max(20, bingoBox.cellHeight * 0.48); font.weight: Font.Bold }
                                            }
                                        }
                                    }
                                }
                                // Music bingo's reaction table: who dabbed the song playing, quickest first.
                                Column {
                                    readonly property var r: questionView.q ? questionView.q.reactionTable : null
                                    visible: !!r
                                    Layout.alignment: Qt.AlignTop; Layout.preferredWidth: 760
                                    spacing: 8
                                    Text { text: parent.r ? root.t("Reactions · song {n}", {n: parent.r.song}) : ""; color: root.pal.teal; font.pixelSize: 34; font.weight: Font.Bold }
                                    Repeater {
                                        model: parent.r ? parent.r.now.slice(0, 5) : []
                                        delegate: Text { required property var modelData; required property int index
                                                         text: `${index + 1}. ${modelData.name}  ${(modelData.ms / 1000).toFixed(1)}s`; color: index === 0 ? root.pal.goldHi : root.pal.text; font.pixelSize: 36; font.weight: Font.DemiBold }
                                    }
                                    Text { visible: !!parent.r && parent.r.leaders.length > 0; color: root.pal.muted; font.pixelSize: 28
                                           text: parent.r ? root.t("Quickest on most songs") + ": " + parent.r.leaders.map(l => `${l.name} (${l.songs})`).join(" · ") : "" }
                                }
                            }
                            // Sound clips game
                            Column {
                                id: clipsBox
                                readonly property var c: questionView.q ? questionView.q.clipGame : null
                                visible: !!c
                                Layout.alignment: Qt.AlignHCenter
                                Text { text: !parent.c ? "" : parent.c.playing ? root.t("🎵 Clip {n} of {count}", {n: parent.c.playing, count: parent.c.count}) : questionView.q.live ? root.t("Listen carefully…") : root.t("Clips finished")
                                       color: root.pal.goldHi; font.family: Theme.display; font.pixelSize: 130; font.weight: Font.Bold }
                                Text { text: parent.c ? root.t("{n} teams have tapped", {n: parent.c.taps}) : ""; color: root.pal.text; font.pixelSize: 56 }
                                // Every clip as a numbered disc: the one playing lit, those already heard dimmed.
                                Row {
                                    spacing: 14; topPadding: 18
                                    Repeater {
                                        model: clipsBox.c ? clipsBox.c.count : 0
                                        delegate: Rectangle {
                                            required property int index
                                            readonly property bool playing: !!clipsBox.c && clipsBox.c.playing === index + 1
                                            readonly property bool played: !!clipsBox.c && (clipsBox.c.played || []).includes(index + 1)
                                            objectName: "clipDisc"
                                            width: 84; height: 84; radius: 42
                                            color: playing ? root.pal.gold : played ? Qt.rgba(1, 1, 1, 0.12) : Qt.rgba(1, 1, 1, 0.05)
                                            border.color: playing ? root.pal.goldHi : root.pal.lineStrong; border.width: playing ? 4 : 2
                                            scale: playing ? 1.15 : 1
                                            Behavior on scale { NumberAnimation { duration: 250 } }
                                            Behavior on color { ColorAnimation { duration: 250 } }
                                            Text { anchors.centerIn: parent; text: index + 1; font.family: Theme.display; font.pixelSize: 40; font.weight: Font.Bold
                                                   color: parent.playing ? root.pal.onAccent : parent.played ? root.pal.muted : root.pal.text }
                                        }
                                    }
                                }
                            }
                            // What's left once the tiles and lists have grown: below them, or below a centred buzzer or clip.
                            Item { Layout.fillHeight: true; Layout.verticalStretchFactor: 1 }
                        }
                    }
                }

                // The reveal slides up over the bottom of the question.
                Rectangle {
                    id: reveal
                    objectName: "reveal"
                    readonly property var q: questionView.q
                    readonly property bool shown: !!q && !!q.revealed
                    // Choices are marked on their tiles, and a put-in-order list sorts itself: the box then only says who scored.
                    readonly property bool tiles: !!q && ["choice", "vote", "multi", "sequence"].includes(q.type)
                    readonly property string answer: !q ? "" : q.type === "sheet" ? (q.items || []).map((item, i) => `${i + 1}. ${(q.itemAnswers || [])[i] || root.t("Marked by quizmaster")}`).join("   ")
                        : q.type === "survey" ? (q.survey || []).map((s, i) => `${i + 1}. ${s[0].split("|")[0].trim()} (${s[1]})`).join("   ")
                        : q.type === "links" ? (q.linkGroups || []).map(g => `${g.link.split("|")[0].trim()}: ${g.items.join(", ")}`).join("   ")
                        : q.type === "sort" ? (q.categories || []).map(c => `${c}: ${(q.sorting || []).filter(p => p[1] === c).map(p => p[0]).join(", ")}`).join("   ")
                        : q.type === "pairs" ? (q.pairs || []).map(p => `${p[0]} — ${p[1]}`).join("   ")
                        : q.type === "list" ? (q.accepted || []).map((a, i) => `${i + 1}. ${a.split("|").map(x => x.trim()).filter(x => x).join(" / ")}`).join("   ")
                        : q.type === "pinpoint" && !q.answer ? root.t("Circled on the picture")
                        : q.answer && q.tolerance ? `${q.answer} (± ${q.tolerance}${q.tolerancePercent ? "%" : ""})` : (q.answer || root.t("Marked by quizmaster"))
                    // Who scored, fastest first (closest first for nearest wins), each with its time or answer and points,
                    // as the web TV (renderSolution in web/app.js).
                    readonly property var scorers: q && q.type !== "vote" && q.scorers ? q.scorers : null
                    readonly property bool nearest: !!q && q.type === "nearest"
                    readonly property int most: 12
                    // Many scorers: smaller chips, so the whole list fits.
                    readonly property bool crowded: !!scorers && scorers.length > 6
                    anchors.horizontalCenter: parent.horizontalCenter
                    // As tall as what it says, up to most of the screen; the question stays readable above it.
                    width: parent.width; height: Math.min(parent.height * 0.66 - 16, content.implicitHeight + 56); radius: 28
                    y: shown ? parent.height - height - 16 : parent.height + 40
                    opacity: shown ? 1 : 0
                    clip: true
                    Behavior on y { NumberAnimation { duration: 500; easing.type: Easing.OutCubic } }
                    Behavior on opacity { NumberAnimation { duration: 300 } }
                    color: Qt.rgba(root.pal.panel.r, root.pal.panel.g, root.pal.panel.b, 0.94); border.color: root.pal.good; border.width: 3
                    Rectangle { anchors.fill: parent; radius: parent.radius; color: Qt.rgba(root.pal.good.r, root.pal.good.g, root.pal.good.b, 0.12) }
                    ColumnLayout {
                        id: content
                        objectName: "revealContent"
                        anchors.left: parent.left; anchors.right: parent.right; anchors.top: parent.top; anchors.margins: 28; spacing: 10
                        Text { visible: !reveal.tiles; text: root.t("ANSWER"); color: root.pal.good; font.pixelSize: 24; font.weight: Font.Bold; font.letterSpacing: 4 }
                        Text {
                            visible: !reveal.tiles
                            Layout.fillWidth: true; wrapMode: Text.WordWrap; maximumLineCount: 3; elide: Text.ElideRight
                            text: reveal.answer
                            color: root.pal.text; font.family: Theme.display; font.weight: Font.Bold; lineHeight: 0.95
                            // Long answers get smaller rather than spilling out of the box.
                            font.pixelSize: reveal.answer.length > 90 ? 38 : reveal.answer.length > 45 ? 46 : 58
                        }
                        Text { visible: !reveal.tiles && !!reveal.q && !!reveal.q.answerNote; text: reveal.q ? reveal.q.answerNote || "" : ""; color: root.pal.muted; font.pixelSize: 26
                               Layout.fillWidth: true; wrapMode: Text.WordWrap; maximumLineCount: 2; elide: Text.ElideRight }
                        Text {
                            visible: !!reveal.scorers
                            Layout.topMargin: reveal.tiles ? 0 : 4
                            text: !reveal.scorers ? "" : reveal.q.tieBreaker ? root.t("Tie-breaker — closest first") : !reveal.scorers.length ? root.t("Nobody scored this time")
                                : reveal.scorers.length === 1 ? root.t("1 team scored") : reveal.nearest ? root.t("{n} teams scored — closest first", {n: reveal.scorers.length})
                                : root.t("{n} teams scored — fastest first", {n: reveal.scorers.length})
                            color: root.pal.goldHi; font.pixelSize: 26; font.weight: Font.Bold
                        }
                        Flow {
                            visible: !!reveal.scorers && reveal.scorers.length > 0
                            Layout.fillWidth: true; spacing: reveal.crowded ? 8 : 10
                            Repeater {
                                model: reveal.scorers ? reveal.scorers.slice(0, reveal.most) : []
                                delegate: Rectangle {
                                    required property var modelData
                                    required property int index
                                    readonly property string detail: [reveal.nearest ? (modelData.answer || "") : modelData.ms === null || modelData.ms === undefined ? "" : root.t("{s}s", {s: (modelData.ms / 1000).toFixed(1)}),
                                                                      modelData.points === null || modelData.points === undefined ? "" : `+${modelData.points}`].filter(x => x).join(" · ")
                                    width: chip.implicitWidth + 28; height: reveal.crowded ? 42 : 50; radius: height / 2
                                    color: index === 0 ? Qt.rgba(root.pal.gold.r, root.pal.gold.g, root.pal.gold.b, 0.22) : Qt.rgba(1, 1, 1, 0.07)
                                    border.color: index === 0 ? root.pal.gold : Qt.rgba(1, 1, 1, 0.14)
                                    Row {
                                        id: chip; anchors.centerIn: parent; spacing: 12
                                        Text { text: `${index + 1}. ${modelData.name}`; color: root.pal.text; font.pixelSize: reveal.crowded ? 20 : 24; font.weight: Font.DemiBold }
                                        Text { visible: parent.parent.detail !== ""; text: parent.parent.detail; color: root.pal.goldHi; font.pixelSize: reveal.crowded ? 20 : 24; font.weight: Font.Bold }
                                    }
                                }
                            }
                            Text { visible: !!reveal.scorers && reveal.scorers.length > reveal.most; height: 50; verticalAlignment: Text.AlignVCenter
                                   text: reveal.scorers ? `+${reveal.scorers.length - reveal.most}` : ""; color: root.pal.muted; font.pixelSize: 24 }
                        }
                    }
                }
            }

            // Leaderboard, revealed from the bottom when the quizmaster steps through it.
            Item {
                id: boardView
                objectName: "boardView"
                anchors.fill: parent
                opacity: root.view === "leaderboard" ? 1 : 0; visible: opacity > 0
                Behavior on opacity { NumberAnimation { duration: 300 } }
                // Not "reveal": that name is the answer box's id, which wins. The server names the rows still hidden:
                // from the bottom up to third place, then the leader, then second place (boardReveal in server.js).
                readonly property var steps: root.tv.reveal || null
                readonly property var hidden: steps && !steps.done ? steps.hidden || [] : []
                Text { id: boardTitle; text: root.t("Leaderboard"); color: root.pal.text; font.family: Theme.display; font.pixelSize: 72; font.weight: Font.Bold }
                Text {
                    anchors.left: boardTitle.right; anchors.leftMargin: 30; anchors.baseline: boardTitle.baseline
                    text: root.settings.secretRound ? root.t("Secret round: the scores stay hidden until the end of the quiz.") : !root.settings.leaderboardVisible ? root.t("The quizmaster has hidden scores for now.") : root.settings.ended ? root.t("Final standings") : ""
                    color: root.pal.muted; font.pixelSize: 32
                }
                // Team groups (groupBoard): each group's average, best first.
                Row {
                    id: groupRow
                    readonly property var groups: root.tv.groups || []
                    visible: groups.length > 0
                    anchors.top: boardTitle.bottom; anchors.topMargin: 20; spacing: 18
                    Text { text: root.t("Groups"); color: root.pal.gold; font.pixelSize: 30; font.weight: Font.Bold; anchors.verticalCenter: parent.verticalCenter }
                    Repeater {
                        model: groupRow.groups
                        delegate: Rectangle {
                            required property var modelData
                            width: groupText.implicitWidth + 36; height: 64; radius: 16
                            color: modelData.rank === 1 ? Qt.rgba(root.pal.gold.r, root.pal.gold.g, root.pal.gold.b, 0.24) : Qt.rgba(1, 1, 1, 0.06)
                            border.color: modelData.rank === 1 ? root.pal.gold : root.pal.line
                            Text { id: groupText; anchors.centerIn: parent; color: root.pal.text; font.pixelSize: 30; font.weight: Font.DemiBold
                                   text: `${modelData.name}  ` + (modelData.average === null ? "" : modelData.teams === 1 ? root.t("1 team · average {score}", {score: modelData.average}) : root.t("{n} teams · average {score}", {n: modelData.teams, score: modelData.average})) }
                        }
                    }
                }
                GridView {
                    id: board
                    anchors.top: groupRow.visible ? groupRow.bottom : boardTitle.bottom; anchors.topMargin: 30; anchors.left: parent.left; anchors.right: parent.right; anchors.bottom: parent.bottom
                    readonly property bool twoColumns: root.teams.length > 10
                    cellWidth: twoColumns ? width / 2 : width; cellHeight: 84
                    flow: GridView.FlowTopToBottom
                    interactive: false
                    model: root.settings.leaderboardVisible === false ? [] : root.teams
                    delegate: Item {
                        required property var modelData
                        required property int index
                        // By id: a delegate's parent is the grid's content item, not the board.
                        readonly property bool shown: !boardView.hidden.includes(modelData.name)
                        width: board.cellWidth; height: board.cellHeight
                        Rectangle {
                            anchors.fill: parent; anchors.margins: 6; anchors.rightMargin: board.twoColumns ? 18 : 6
                            radius: 18
                            opacity: parent.shown ? 1 : 0
                            Behavior on opacity { NumberAnimation { duration: 450 } }
                            color: modelData.rank === 1 ? Qt.rgba(root.pal.gold.r, root.pal.gold.g, root.pal.gold.b, 0.24) : Qt.rgba(1, 1, 1, 0.06)
                            border.color: modelData.rank === 1 ? root.pal.gold : root.pal.line
                            RowLayout {
                                anchors.fill: parent; anchors.leftMargin: 26; anchors.rightMargin: 26; spacing: 22
                                Text { text: modelData.rank; color: modelData.rank === 1 ? root.pal.gold : root.pal.muted; font.family: Theme.display; font.pixelSize: 40; font.weight: Font.Bold; Layout.preferredWidth: 60 }
                                Text { text: modelData.name; color: root.pal.text; font.pixelSize: 40; font.weight: Font.DemiBold; elide: Text.ElideRight; Layout.fillWidth: true }
                                Text { text: modelData.score === null || modelData.score === undefined ? "" : modelData.score; color: root.pal.goldHi; font.family: Theme.display; font.pixelSize: 44; font.weight: Font.Bold }
                            }
                        }
                    }
                }
            }

            // Winner
            Item {
                anchors.fill: parent
                opacity: root.view === "winner" ? 1 : 0; visible: opacity > 0
                Behavior on opacity { NumberAnimation { duration: 500 } }
                readonly property var leaders: root.teams.filter(t => t.rank === 1)
                Column {
                    anchors.centerIn: parent; spacing: 26
                    Text { anchors.horizontalCenter: parent.horizontalCenter; text: root.t("AND THE WINNER IS…"); color: root.pal.gold; font.pixelSize: 44; font.weight: Font.Bold; font.letterSpacing: 8 }
                    // Joint winners share the line, and wrap and shrink to fit the screen however many there are.
                    Text {
                        objectName: "winnerNames"
                        anchors.horizontalCenter: parent.horizontalCenter
                        width: 1700; height: Math.min(implicitHeight, 520)
                        horizontalAlignment: Text.AlignHCenter; verticalAlignment: Text.AlignVCenter
                        wrapMode: Text.WordWrap; fontSizeMode: Text.Fit; minimumPixelSize: 44; maximumLineCount: 4; elide: Text.ElideRight
                        text: root.settings.leaderboardVisible === false ? root.t("Scores are hidden for now") : parent.parent.leaders.map(t => t.name).join(" & ") || root.t("No teams yet")
                        color: root.pal.text; font.family: Theme.display; font.pixelSize: parent.parent.leaders.length > 2 ? 96 : 130; font.weight: Font.Bold; lineHeight: 0.95
                        scale: root.view === "winner" ? 1 : 0.6
                        Behavior on scale { NumberAnimation { duration: 900; easing.type: Easing.OutBack } }
                    }
                    Text {
                        anchors.horizontalCenter: parent.horizontalCenter
                        readonly property var leaders: parent.parent.leaders
                        text: leaders.length && root.settings.leaderboardVisible !== false && leaders[0].score !== null ? root.t(leaders.length > 1 ? "{n} points — a tie!" : "{n} points", {n: leaders[0].score}) : ""
                        color: root.pal.goldHi; font.family: Theme.display; font.pixelSize: 56; font.weight: Font.Bold
                    }
                    // Second and third place (ties included), wrapping onto more lines rather than off the screen.
                    Text {
                        objectName: "winnerPodium"
                        anchors.horizontalCenter: parent.horizontalCenter; width: 1700
                        horizontalAlignment: Text.AlignHCenter; wrapMode: Text.WordWrap; maximumLineCount: 3; elide: Text.ElideRight
                        color: root.pal.text; font.pixelSize: 44; lineHeight: 1.2
                        text: (root.settings.leaderboardVisible === false ? [] : root.teams.filter(t => t.rank > 1 && t.rank <= 3))
                              .map(t => `${t.rank === 2 ? "🥈" : "🥉"}\u00a0${t.name.replace(/ /g, "\u00a0")}${t.score === null ? "" : "\u00a0\u00a0" + t.score}`).join("      ")
                    }
                }
            }

            // A secret round's recap (recapState in server.js): back through its questions with their answers and how
            // every team did, then the round's results.
            Item {
                id: recapView
                objectName: "recapView"
                anchors.fill: parent
                opacity: root.view === "recap" ? 1 : 0; visible: opacity > 0
                Behavior on opacity { NumberAnimation { duration: 300 } }
                readonly property var r: root.tv.recap || null
                readonly property var q: r && r.question ? r.question : null
                Column {
                    width: parent.width; spacing: 22
                    Text { text: recapView.r ? root.t("SECRET ROUND") + " · " + recapView.r.round.toUpperCase() : ""; color: root.pal.gold; font.pixelSize: 30; font.weight: Font.Bold; font.letterSpacing: 4 }
                    // A question: its text, its answer, and every team that answered.
                    Column {
                        visible: !!recapView.q; width: parent.width; spacing: 22
                        Row {
                            spacing: 24
                            Text { text: recapView.r && recapView.q ? root.t("Question {n} of {count}", {n: recapView.r.shown + 1, count: recapView.r.count}) : ""; color: root.pal.muted; font.pixelSize: 30 }
                            Text { visible: !!recapView.q && recapView.q.evil; text: root.t("🎲 Risk It: a wrong answer loses the points"); color: root.pal.bad; font.pixelSize: 30; font.weight: Font.Bold }
                        }
                        Text { width: parent.width; text: recapView.q ? recapView.q.text : ""; wrapMode: Text.WordWrap; maximumLineCount: 3; elide: Text.ElideRight
                               color: root.pal.text; font.family: Theme.display; font.pixelSize: 60; font.weight: Font.Bold }
                        Rectangle {
                            width: parent.width; height: answerColumn.implicitHeight + 44; radius: 22
                            color: Qt.rgba(root.pal.good.r, root.pal.good.g, root.pal.good.b, 0.12); border.color: root.pal.good; border.width: 2
                            Column {
                                id: answerColumn; x: 30; y: 22; width: parent.width - 60; spacing: 6
                                Text { width: parent.width; wrapMode: Text.WordWrap; color: root.pal.goldHi; font.family: Theme.display; font.pixelSize: 52; font.weight: Font.Bold
                                       text: recapView.q ? root.t("Answer: {answer}", {answer: recapView.q.answer ?? (recapView.q.itemAnswers || []).join(", ")}) : "" }
                                Text { visible: text !== ""; width: parent.width; wrapMode: Text.WordWrap; maximumLineCount: 2; elide: Text.ElideRight; color: root.pal.muted; font.pixelSize: 28
                                       text: recapView.q ? recapView.q.answerNote : "" }
                            }
                        }
                        Text { visible: !!recapView.q && !recapView.q.teams.length; text: root.t("No team answered this one."); color: root.pal.muted; font.pixelSize: 34 }
                        Flow {
                            objectName: "recapTeams"
                            width: parent.width; spacing: 14
                            Repeater {
                                model: recapView.q ? recapView.q.teams : []
                                delegate: Rectangle {
                                    required property var modelData
                                    readonly property color tone: modelData.outcome === "right" ? root.pal.good : modelData.outcome === "lost" ? root.pal.bad : root.pal.muted
                                    width: chip.implicitWidth + 44; height: 66; radius: 33
                                    color: Qt.rgba(tone.r, tone.g, tone.b, modelData.outcome === "wrong" ? 0.10 : 0.20); border.color: tone; border.width: 2
                                    Text {
                                        id: chip; anchors.centerIn: parent; color: modelData.outcome === "wrong" ? root.pal.text : parent.tone; font.pixelSize: 32; font.weight: Font.Bold
                                        text: (modelData.outcome === "right" ? "✓ " : "✗ ") + modelData.name
                                              + (modelData.points === null || modelData.points === 0 ? "" : "  " + (modelData.points > 0 ? "+" : "−") + Math.abs(modelData.points))
                                    }
                                }
                            }
                        }
                    }
                    // The round's results: every team's points for it, best first.
                    Column {
                        objectName: "recapResults"
                        visible: !!recapView.r && !!recapView.r.results; width: parent.width; spacing: 12
                        Text { text: root.t("Round results"); color: root.pal.text; font.family: Theme.display; font.pixelSize: 72; font.weight: Font.Bold }
                        Grid {
                            readonly property var list: recapView.r && recapView.r.results ? recapView.r.results : []
                            columns: list.length > 8 ? 2 : 1; columnSpacing: 40; rowSpacing: 10
                            Repeater {
                                model: parent.list
                                delegate: Rectangle {
                                    required property var modelData
                                    required property int index
                                    width: parent.columns > 1 ? 880 : 1800; height: parent.columns > 1 ? 70 : Math.min(84, 700 / Math.max(1, parent.list.length) - 10); radius: 16
                                    color: index === 0 ? Qt.rgba(root.pal.gold.r, root.pal.gold.g, root.pal.gold.b, 0.18) : Qt.rgba(1, 1, 1, 0.06)
                                    Text { x: 26; anchors.verticalCenter: parent.verticalCenter; text: modelData.name; color: root.pal.text; font.pixelSize: Math.min(38, parent.height * 0.5); font.weight: Font.DemiBold
                                           width: parent.width - 220; elide: Text.ElideRight }
                                    Text { anchors.right: parent.right; anchors.rightMargin: 26; anchors.verticalCenter: parent.verticalCenter
                                           text: modelData.points === null ? "" : root.t("{n} points", {n: modelData.points}); color: index === 0 ? root.pal.goldHi : root.pal.muted; font.pixelSize: Math.min(36, parent.height * 0.48); font.weight: Font.Bold }
                                }
                            }
                        }
                    }
                }
            }

            // Review: a past question shown with its answers and scores.
            Item {
                objectName: "reviewView"
                anchors.fill: parent
                opacity: root.view === "review" ? 1 : 0; visible: opacity > 0
                Behavior on opacity { NumberAnimation { duration: 300 } }
                readonly property var r: root.tv.review || null
                readonly property var q: r ? r.question : null
                Column {
                    width: parent.width; spacing: 22
                    Text { text: reviewView.q ? (reviewView.q.round || "").toUpperCase() : ""; color: root.pal.gold; font.pixelSize: 30; font.weight: Font.Bold; font.letterSpacing: 4 }
                    Text { width: parent.width; text: reviewView.q ? reviewView.q.text : ""; wrapMode: Text.WordWrap; maximumLineCount: 3; elide: Text.ElideRight
                           color: root.pal.text; font.family: Theme.display; font.pixelSize: 60; font.weight: Font.Bold }
                    Rectangle {
                        width: parent.width; height: revAnswerCol.implicitHeight + 44; radius: 22
                        color: Qt.rgba(root.pal.good.r, root.pal.good.g, root.pal.good.b, 0.12); border.color: root.pal.good; border.width: 2
                        Column {
                            id: revAnswerCol; x: 30; y: 22; width: parent.width - 60; spacing: 6
                            Text { width: parent.width; wrapMode: Text.WordWrap; color: root.pal.goldHi; font.family: Theme.display; font.pixelSize: 52; font.weight: Font.Bold
                                   text: reviewView.q ? root.t("Answer: {answer}", {answer: reviewView.q.answer ?? (reviewView.q.itemAnswers || []).join(", ")}) : "" }
                            Text { visible: text !== ""; width: parent.width; wrapMode: Text.WordWrap; maximumLineCount: 2; elide: Text.ElideRight; color: root.pal.muted; font.pixelSize: 28
                                   text: reviewView.q ? reviewView.q.answerNote : "" }
                        }
                    }
                    Grid {
                        readonly property var list: reviewView.r ? (reviewView.r.answers || []).slice().sort((a, b) => (b.points || 0) - (a.points || 0)) : []
                        columns: list.length > 8 ? 2 : 1; columnSpacing: 40; rowSpacing: 10; width: parent.width
                        Repeater {
                            model: parent.list
                            delegate: Rectangle {
                                required property var modelData
                                required property int index
                                readonly property bool correct: (modelData.points || 0) > 0
                                width: parent.columns > 1 ? 880 : 1800; height: parent.columns > 1 ? 70 : Math.min(84, 700 / Math.max(1, parent.list.length) - 10); radius: 16
                                color: correct ? Qt.rgba(root.pal.good.r, root.pal.good.g, root.pal.good.b, 0.18) : Qt.rgba(1, 1, 1, 0.06)
                                Text { x: 26; anchors.verticalCenter: parent.verticalCenter; text: modelData.name; color: root.pal.text; font.pixelSize: Math.min(38, parent.height * 0.5); font.weight: Font.DemiBold
                                       width: parent.width * 0.4; elide: Text.ElideRight }
                                Text { x: parent.width * 0.45; anchors.verticalCenter: parent.verticalCenter; text: String(modelData.value || "–"); color: root.pal.muted; font.pixelSize: Math.min(32, parent.height * 0.42)
                                       width: parent.width * 0.3; elide: Text.ElideRight }
                                Text { anchors.right: parent.right; anchors.rightMargin: 26; anchors.verticalCenter: parent.verticalCenter
                                       text: (modelData.points || 0) > 0 ? "+" + modelData.points : String(modelData.points || 0); color: correct ? root.pal.good : root.pal.muted; font.pixelSize: Math.min(36, parent.height * 0.48); font.weight: Font.Bold }
                            }
                        }
                    }
                }
            }

            // Wheel: turns forwards and stops with the server's chosen segment under the pointer.
            Item {
                id: wheelView
                anchors.fill: parent
                opacity: root.view === "wheel" ? 1 : 0; visible: opacity > 0
                Behavior on opacity { NumberAnimation { duration: 300 } }
                readonly property var wheel: root.tv.wheel || null
                // The wheel on show (its id as text), and whether a state has been seen at all: a spin seen happening
                // turns, one already there when the TV opens is shown at rest. Every TV refresh brings a new wheel
                // object, so only a new id counts.
                property string shownId: ""
                property bool primed: false
                property real turn: 0
                property bool done: false
                Connections { target: root; function onTvChanged() { wheelView.follow() } }
                Component.onCompleted: follow()
                function follow() {
                    if (!root.tv || !root.tv.settings) return
                    const first = !primed
                    primed = true
                    if (!wheel || String(wheel.id) === shownId) return
                    const fresh = !first && root.serverNow - wheel.spun < 3000, slice = 360 / wheel.items.length
                    const target = 360 - (wheel.result + 0.5) * slice
                    shownId = String(wheel.id); wheelCanvas.requestPaint()
                    spin.stop()
                    if (!fresh) { wheelCanvas.rotation = target; done = true; return }
                    done = false
                    spin.from = wheelCanvas.rotation; spin.to = wheelCanvas.rotation - (wheelCanvas.rotation % 360) + 360 * 6 + target
                    spin.start()
                }
                // The web TV's curve (cubic-bezier(.12,.6,.15,1)), which the tick sounds follow (tvsound.py).
                NumberAnimation { id: spin; objectName: "wheelSpin"; target: wheelCanvas; property: "rotation"; duration: 6000; easing.type: Easing.BezierSpline
                                  easing.bezierCurve: [0.12, 0.6, 0.15, 1, 1, 1]; onFinished: wheelView.done = true }
                Canvas {
                    id: wheelCanvas
                    width: 760; height: 760; anchors.centerIn: parent; anchors.verticalCenterOffset: -30
                    onPaint: {
                        const ctx = getContext("2d"), w = wheelView.wheel; ctx.reset()
                        if (!w) return
                        const n = w.items.length, r = width / 2, colours = [root.pal.pink, root.pal.gold, root.pal.teal, root.pal.violet, "#3b82f6", root.pal.good]
                        ctx.translate(r, r)
                        for (let i = 0; i < n; i++) {
                            const a = (i * 360 / n - 90) * Math.PI / 180, b = ((i + 1) * 360 / n - 90) * Math.PI / 180
                            ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, r - 4, a, b); ctx.closePath()
                            ctx.fillStyle = colours[i % 6]; ctx.fill(); ctx.strokeStyle = "#140b2e"; ctx.lineWidth = 4; ctx.stroke()
                            ctx.save(); ctx.rotate((a + b) / 2); ctx.fillStyle = "#140b2e"; ctx.font = "bold 30px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"
                            const label = w.items[i].length > 14 ? w.items[i].slice(0, 13) + "…" : w.items[i]
                            ctx.fillText(label, r * 0.58, 0); ctx.restore()
                        }
                    }
                }
                Canvas {
                    width: 56; height: 50; anchors.horizontalCenter: wheelCanvas.horizontalCenter; anchors.top: wheelCanvas.top; anchors.topMargin: -12
                    onPaint: { const c = getContext("2d"); c.fillStyle = "#fff8ec"; c.beginPath(); c.moveTo(0, 0); c.lineTo(56, 0); c.lineTo(28, 50); c.closePath(); c.fill() }
                }
                // The wheel's name (a saved wheel, Fast Track), and once it stops a rollover jackpot's new amount or what a
                // Fast Track spin won: beside the wheel, clear of the pointer.
                Column {
                    anchors.left: parent.left; anchors.top: parent.top; anchors.topMargin: 40; width: wheelCanvas.x - 40; spacing: 16
                    Text { width: parent.width; wrapMode: Text.WordWrap; text: wheelView.wheel && wheelView.wheel.title ? wheelView.wheel.title : ""
                           color: root.pal.text; font.family: Theme.display; font.pixelSize: 56; font.weight: Font.Bold }
                    Text { width: parent.width; wrapMode: Text.WordWrap; text: wheelView.done && wheelView.wheel && wheelView.wheel.note ? wheelView.wheel.note : ""
                           color: root.pal.goldHi; font.pixelSize: 44; font.weight: Font.DemiBold }
                }
                Text {
                    anchors.horizontalCenter: parent.horizontalCenter; anchors.bottom: parent.bottom
                    text: wheelView.done && wheelView.wheel ? `🎉 ${wheelView.wheel.items[wheelView.wheel.result]}` : ""
                    color: root.pal.goldHi; font.family: Theme.display; font.pixelSize: 72; font.weight: Font.Bold
                }
            }

            // Slides between rounds: each picture for its own time, round and round.
            Item {
                id: slidesView
                anchors.fill: parent
                opacity: root.view === "slides" ? 1 : 0; visible: opacity > 0
                Behavior on opacity { NumberAnimation { duration: 300 } }
                readonly property var slides: root.tv.slides || []
                readonly property string media: {
                    if (!slides.length) return ""
                    const total = slides.reduce((n, x) => n + x.seconds, 0) * 1000
                    let at = ((root.serverNow % total) + total) % total
                    for (const x of slides) { at -= x.seconds * 1000; if (at < 0) return x.media }
                    return slides[0].media
                }
                Rectangle { anchors.fill: parent; color: "black"; visible: slidesView.media !== "" }
                Image { anchors.fill: parent; fillMode: Image.PreserveAspectFit; asynchronous: true; smooth: true
                        source: slidesView.media ? root.serverUrl + slidesView.media : "" }
            }
        }

        // ---- the first-place spotlight: the fastest (or closest) team at a reveal, for 7 s; first place when the
        // leaderboard reveal reaches it, for 5 s. Only a reveal seen happening, never one already shown at load. ----
        Item {
            id: spotlight
            objectName: "spotlight"
            anchors.fill: parent
            property var shown: null      // {kind, names, photos, detail}
            property var armedFor: null
            property var shownFor: null
            property string boardDone: ""
            property int fastTrackSeen: -1
            property int varSeen: -1
            property var shameShown: ({})  // team names already shamed this reveal
            // VAR Check: "VAR CHECK" over a drum roll, then the decision.
            Timer {
                id: varDecision; interval: 3000
                property var check: null
                onTriggered: { const v = check; if (v) spotlight.show({kind: v.status === "overturned" ? root.t("OVERTURNED") : root.t("DECISION STANDS"), names: v.team, photos: [], initials: ["📺"],
                                                                     detail: v.status === "overturned" ? root.t("+{n} points", {n: v.points}) : root.t("No change to the score")}, 5000) }
            }
            opacity: shown ? 1 : 0; visible: opacity > 0
            Behavior on opacity { NumberAnimation { duration: 350 } }
            Timer { id: spotlightTimer; onTriggered: spotlight.shown = null }
            function show(s, ms) { shown = s; spotlightTimer.interval = ms; spotlightTimer.restart() }
            Connections {
                target: root
                function onTvChanged() {
                    const q = root.q
                    // A new question, or the TV showing something else, ends a spotlight (the board's stays over the board).
                    if (spotlight.shown && ((spotlight.shownFor !== null && (!q || q.id !== spotlight.shownFor)) || !["question", "leaderboard"].includes(root.view)))
                        spotlight.shown = null
                    if (q && !q.revealed) spotlight.armedFor = q.id
                    if (q && q.revealed && spotlight.armedFor === q.id && q.first) {
                        spotlight.armedFor = null
                        spotlight.shownFor = q.id
                        const f = q.first
                        spotlight.show({kind: f.kind === "tieBreaker" ? root.t("TIE-BREAKER WINNER") : f.kind === "nearest" ? root.t("CLOSEST ANSWER") : root.t("FASTEST FINGERS"), names: f.name,
                                        photos: f.photo ? [f.photo] : [], initials: [f.name.charAt(0).toUpperCase()],
                                        detail: f.kind !== "fastest" ? root.t("Answered {answer}", {answer: f.answer}) : root.t("{s}s", {s: (f.ms / 1000).toFixed(1)})}, 7000)
                    }
                    // First place's turn in the reveal (the leader, before second place): its spotlight.
                    const r = root.tv.reveal
                    const done = r && r.leader ? String(r.question) : ""
                    if (done && done !== spotlight.boardDone && spotlight.boardDone !== "") {
                        const top = root.teams.filter(t => t.rank === 1).slice(0, 4)
                        spotlight.shownFor = null
                        if (top.length) spotlight.show({kind: top.length > 1 ? root.t("TIED FOR FIRST") : root.t("IN FIRST PLACE"), names: top.map(t => t.name).join(" & "),
                                                        photos: top.filter(t => t.photo).map(t => t.photo), initials: top.map(t => t.name.charAt(0).toUpperCase()),
                                                        detail: top[0].score === null ? "" : root.t("{n} points", {n: top[0].score})}, 5000 + (top.length - 1) * 2500)
                    }
                    spotlight.boardDone = done || (spotlight.boardDone === "" ? "-" : spotlight.boardDone)
                    // A team revealed with minus points gets a moment of shame.
                    if (r && !r.done) {
                        const hidden = new Set(r.hidden || [])
                        for (const team of root.teams) {
                            if (!hidden.has(team.name) && !spotlight.shameShown[team.name] && (team.score ?? 0) < 0) {
                                const s = Object.assign({}, spotlight.shameShown); s[team.name] = true; spotlight.shameShown = s
                                spotlight.shownFor = null
                                spotlight.show({kind: "😬 " + root.t("MINUS POINTS"), names: team.name, photos: team.photo ? [team.photo] : [], initials: [team.name.charAt(0).toUpperCase()],
                                                detail: root.t("{n} points", {n: team.score})}, 5000)
                            }
                        }
                    }
                    if (!r) spotlight.shameShown = ({})
                    // VAR Check: a ruling on a team's appeal, seen happening.
                    const v = root.tv.varCheck
                    if (v && v.id !== spotlight.varSeen) {
                        const fresh = spotlight.varSeen !== -1 || root.serverNow - v.decided < 3000
                        spotlight.varSeen = v.id
                        if (fresh) {
                            spotlight.shownFor = null
                            spotlight.show({kind: root.t("📺 VAR CHECK"), names: v.team, photos: [], initials: ["📺"], detail: root.t("Checking the replay…")}, 3500)
                            varDecision.check = v; varDecision.restart()
                        }
                    }
                    // Fast Track: a team jumping into first place, seen happening.
                    const f = root.tv.fastTrack
                    if (f && f.id !== spotlight.fastTrackSeen) {
                        const fresh = spotlight.fastTrackSeen !== -1 || root.serverNow - f.at < 3000
                        spotlight.fastTrackSeen = f.id
                        if (fresh) {
                            spotlight.shownFor = null
                            spotlight.show({kind: root.t("🚀 FAST TRACK"), names: f.name, photos: f.photo ? [f.photo] : [], initials: [f.name.charAt(0).toUpperCase()], detail: root.t("Straight to first place!")}, 6000)
                        }
                    }
                }
            }
            Rectangle { anchors.fill: parent; color: Qt.rgba(0, 0, 0, 0.72) }
            Column {
                id: spotColumn
                anchors.centerIn: parent; spacing: 28
                scale: spotlight.shown ? 1 : 0.7
                // The photos get the height the words leave (with a margin), and joint leaders share the width.
                readonly property int count: spotlight.shown ? Math.max(1, spotlight.shown.initials.length) : 1
                readonly property int discSize: Math.max(240, Math.min(spotlight.height - spotKind.height - spotNames.height - spotDetail.height - 3 * spacing - 60,
                                                                       (spotlight.width - 160 - (count - 1) * 30) / count))
                Behavior on scale { NumberAnimation { duration: 600; easing.type: Easing.OutBack } }
                Text { id: spotKind; anchors.horizontalCenter: parent.horizontalCenter; text: spotlight.shown ? spotlight.shown.kind : ""; color: root.pal.gold; font.pixelSize: 48; font.weight: Font.Bold; font.letterSpacing: 8 }
                Row {
                    anchors.horizontalCenter: parent.horizontalCenter; spacing: 30
                    Repeater {
                        model: spotlight.shown ? (spotlight.shown.photos.length ? spotlight.shown.photos : spotlight.shown.initials) : []
                        delegate: Rectangle {
                            id: disc
                            objectName: "spotlightDisc"
                            required property string modelData
                            readonly property bool isPhoto: /^(\/|https?:)/.test(modelData)
                            // Big: the team's moment (one photo most of the screen's height; joint leaders share the width).
                            readonly property int size: spotColumn.discSize
                            width: size; height: size; radius: size / 2; color: root.pal.violet; border.color: root.pal.gold; border.width: 10
                            // The photo is cut to a circle inside the ring (clip only cuts to the square: its corners covered the
                            // ring), filled from its middle. A Canvas, not a shader: it draws with software rendering too.
                            // Its size, for the crop (not drawn itself).
                            Image { id: discPhoto; visible: false; source: disc.isPhoto ? root.serverUrl + disc.modelData : ""; onStatusChanged: discCircle.requestPaint() }
                            Canvas {
                                id: discCircle
                                anchors.fill: parent; anchors.margins: disc.border.width; visible: disc.isPhoto; antialiasing: true
                                property string url: discPhoto.source.toString()
                                onUrlChanged: if (url) loadImage(url)
                                onImageLoaded: requestPaint()
                                onPaint: {
                                    const ctx = getContext("2d"), w = discPhoto.sourceSize.width, h = discPhoto.sourceSize.height
                                    ctx.reset()
                                    if (!url || !isImageLoaded(url) || !w || !h) return
                                    const side = Math.min(w, h)
                                    ctx.beginPath(); ctx.arc(width / 2, height / 2, width / 2, 0, 2 * Math.PI); ctx.closePath(); ctx.clip()
                                    ctx.drawImage(url, (w - side) / 2, (h - side) / 2, side, side, 0, 0, width, height)
                                }
                            }
                            Text { objectName: "spotlightInitial"; anchors.centerIn: parent; visible: !disc.isPhoto; text: disc.modelData; color: root.pal.text; font.family: Theme.display; font.pixelSize: disc.size * 0.55; font.weight: Font.Bold }
                        }
                    }
                }
                // Joint leaders' names wrap within the screen, smaller the more there are.
                Text {
                    id: spotNames
                    objectName: "spotlightNames"
                    anchors.horizontalCenter: parent.horizontalCenter; width: Math.min(implicitWidth, spotlight.width - 160)
                    text: spotlight.shown ? spotlight.shown.names : ""; color: root.pal.text; font.family: Theme.display; font.weight: Font.Bold
                    font.pixelSize: text.length <= 24 ? 110 : text.length <= 48 ? 84 : 64
                    wrapMode: Text.WordWrap; horizontalAlignment: Text.AlignHCenter; maximumLineCount: 3; elide: Text.ElideRight
                }
                Text { id: spotDetail; anchors.horizontalCenter: parent.horizontalCenter; text: spotlight.shown ? spotlight.shown.detail : ""; color: root.pal.goldHi; font.family: Theme.display; font.pixelSize: 56; font.weight: Font.Bold }
            }
        }

        // ---- confetti for the winner: falls once (still for anyone who prefers less motion, via the OS setting) ----
        Item {
            anchors.fill: parent
            visible: root.view === "winner"
            Repeater {
                model: root.view === "winner" ? 80 : 0
                delegate: Rectangle {
                    required property int index
                    readonly property var colours: [root.pal.gold, root.pal.pink, root.pal.teal, root.pal.violet, root.pal.goldHi]
                    width: 14 + (index % 3) * 6; height: width * 0.5; radius: 2
                    color: colours[index % colours.length]
                    x: (index * 397) % 1920
                    rotation: (index * 53) % 360
                    NumberAnimation on y { from: -40 - (index % 10) * 60; to: 1120; duration: 3500 + (index % 7) * 400; running: true; easing.type: Easing.InQuad }
                    NumberAnimation on rotation { from: 0; to: 720; duration: 4000; running: true }
                }
            }
        }

        // A rehearsal says so, small and out of the way of what's being tested.
        Rectangle {
            visible: !!root.tv.rehearsal
            anchors.right: parent.right; anchors.bottom: parent.bottom; anchors.margins: 28
            width: rehearsalLabel.implicitWidth + 40; height: 52; radius: 26
            color: Qt.rgba(root.pal.teal.r, root.pal.teal.g, root.pal.teal.b, 0.2); border.color: root.pal.teal; border.width: 2
            Text { id: rehearsalLabel; anchors.centerIn: parent; text: root.t("REHEARSAL"); color: root.pal.teal; font.pixelSize: 26; font.weight: Font.Bold; font.letterSpacing: 4 }
        }
        // Joining, under the leaderboard and the question.
        Text {
            visible: (root.view === "leaderboard") && !!root.settings.registrationOpen && !root.settings.ended
            anchors.left: parent.left; anchors.bottom: parent.bottom; anchors.margins: 36
            text: root.settings.online ? root.t("Join: {url}", {url: (root.settings.joinUrl || "").replace(/^https?:\/\//, "")}) : root.t("Join: Wi-Fi “{ssid}” → {url}", {ssid: root.settings.joinSsid, url: (root.settings.joinUrl || "").replace(/^https?:\/\//, "")})
            color: root.pal.muted; font.pixelSize: 28
        }
        // Nothing yet from the server
        Text {
            visible: !root.tv.settings
            anchors.centerIn: parent
            text: root.t("Connecting to the quiz…"); color: root.pal.muted; font.family: Theme.display; font.pixelSize: 56
        }
    }
}
