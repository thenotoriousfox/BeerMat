// The TV picture, drawn natively from the server's public state (the same /api/leaderboard the web TV reads): join
// screen with its QR code, the question and its reveal, buzzers, bingo, sound clips, the leaderboard with its stepped
// reveal, the winner, the wheel, the countdown and the rehearsal badge. It's laid out once at 1920×1080 and scaled to
// fit, so the desk's preview is exactly what the room sees.
import QtQuick
import QtQuick.Layouts
import Desk
import "i18n.mjs" as I18n

Item {
    id: root
    property var tv: ({})
    property string serverUrl: ""
    property bool blanked: false
    // The question's look (themes/<id>/look.css): its colours over BeerMat's own.
    property var palettes: desk.lookPalettes
    readonly property var pal: Object.assign({bg: Theme.bg, bg2: Theme.bg2, text: Theme.text, muted: Theme.muted, faint: Theme.faint, gold: Theme.gold,
        goldHi: Theme.goldHi, pink: Theme.pink, teal: Theme.teal, violet: Theme.violet, good: Theme.good, bad: Theme.bad, onAccent: Theme.onAccent,
        line: Theme.line, lineStrong: Theme.lineStrong, panel: Theme.panel}, palettes[tv.look || "stage"] || {})
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
    Timer { interval: 100; running: root.visible && (!!root.q || !!root.tv.timer); repeat: true; onTriggered: root.now = Date.now() }
    readonly property real serverNow: now + offset
    clip: true

    Rectangle { anchors.fill: parent; color: "black" }

    Item {
        id: stage
        width: 1920; height: 1080
        anchors.centerIn: parent
        scale: Math.min(root.width / width, root.height / height)
        visible: root.view !== "blank"

        Rectangle {
            anchors.fill: parent
            gradient: Gradient {
                GradientStop { position: 0; color: root.pal.panel }
                GradientStop { position: 0.55; color: root.pal.bg2 }
                GradientStop { position: 1; color: root.pal.bg }
            }
        }
        // Soft lights in the corners, as the web TV's decor.
        Repeater {
            model: [[160, 140, root.pal.gold], [1760, 220, root.pal.pink], [300, 960, root.pal.violet], [1650, 930, root.pal.teal]]
            delegate: Rectangle {
                required property var modelData
                x: modelData[0] - 260; y: modelData[1] - 260; width: 520; height: 520; radius: 260
                color: Qt.rgba(modelData[2].r, modelData[2].g, modelData[2].b, 0.07)
            }
        }

        // ---- header ----
        RowLayout {
            id: header
            x: 64; y: 40; width: parent.width - 128; height: 110
            spacing: 24
            Image { source: brand + "mark.svg"; sourceSize: Qt.size(88, 88); Layout.preferredWidth: 88; Layout.preferredHeight: 88 }
            ColumnLayout {
                spacing: 0; Layout.fillWidth: true
                Text { text: root.t("QUIZ NIGHT"); color: root.pal.gold; font.family: Theme.display; font.pixelSize: 22; font.weight: Font.Bold; font.letterSpacing: 6 }
                Text { text: root.settings.title || "BeerMat"; color: root.pal.text; font.family: Theme.display; font.pixelSize: 56; font.weight: Font.Bold; elide: Text.ElideRight; Layout.fillWidth: true }
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
                anchors.fill: parent
                opacity: root.view === "question" ? 1 : 0; visible: opacity > 0
                Behavior on opacity { NumberAnimation { duration: 300 } }
                readonly property var q: root.q
                readonly property real msLeft: !q ? 0 : q.paused ? q.remaining : Math.max(0, q.deadline - root.serverNow)
                readonly property bool bingo: !!q && (q.type === "bingo" || q.type === "musicbingo")
                readonly property var items: !q ? [] : ["choice", "vote", "multi"].includes(q.type) ? q.options
                                           : q.type === "sequence" && q.order ? q.order.map(i => q.items[i]) : q.type === "sheet" ? (q.items || [])
                                           : q.type === "tiles" ? [(q.wordLengths || []).map(n => "_".repeat(n)).join("  "), (q.pieces || []).join("  ·  ")] : []
                readonly property bool isImage: !!q && !!q.media && !/\.(mp3|ogg|wav)$/i.test(q.media)
                readonly property bool isAudio: !!q && !!q.media && /\.(mp3|ogg|wav)$/i.test(q.media)

                ColumnLayout {
                    anchors.fill: parent
                    spacing: 22
                    Text { text: questionView.q ? (questionView.q.round || "").toUpperCase() : ""; color: root.pal.gold; font.pixelSize: 30; font.weight: Font.Bold; font.letterSpacing: 4 }
                    Text {
                        Layout.fillWidth: true
                        text: questionView.q ? questionView.q.text : root.t("Waiting for the quizmaster")
                        color: root.pal.text; font.family: Theme.display; font.weight: Font.Bold; wrapMode: Text.WordWrap
                        font.pixelSize: text.length > 140 ? 54 : text.length > 80 ? 66 : 78
                    }
                    // Time left, from the server's deadline.
                    RowLayout {
                        visible: !!questionView.q
                        spacing: 24
                        Text {
                            text: !questionView.q ? "" : questionView.bingo ? (questionView.q.paused ? root.t("Paused") : questionView.q.live ? root.t("Eyes down — game in progress") : root.t("Game over"))
                                : questionView.q.paused ? root.t("Paused · {n}s remaining", {n: Math.ceil(questionView.q.remaining / 1000)})
                                : !questionView.q.open || questionView.msLeft <= 0 ? root.t("Answers closed") : root.t("{n}s remaining", {n: Math.ceil(questionView.msLeft / 1000)})
                            color: questionView.q && questionView.q.open ? root.pal.goldHi : root.pal.muted; font.family: Theme.display; font.pixelSize: 40; font.weight: Font.DemiBold
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
                    RowLayout {
                        Layout.fillWidth: true; Layout.fillHeight: true
                        spacing: 40
                        // Picture (or a sound playing on the desk)
                        Image {
                            visible: questionView.isImage
                            source: questionView.isImage ? (questionView.q.media.startsWith("http") ? questionView.q.media : root.serverUrl + questionView.q.media) : ""
                            Layout.fillHeight: true; Layout.preferredWidth: visible ? 760 : 0
                            fillMode: Image.PreserveAspectFit; asynchronous: true; smooth: true
                            // Pinpoint: the target appears on the picture once revealed.
                            Rectangle {
                                readonly property var target: questionView.q && questionView.q.revealed ? questionView.q.target : null
                                visible: !!target && parent.status === Image.Ready
                                width: 44; height: 44; radius: 22; color: "transparent"; border.color: root.pal.good; border.width: 6
                                x: !target ? 0 : (parent.width - parent.paintedWidth) / 2 + target.x * parent.paintedWidth - 22
                                y: !target ? 0 : (parent.height - parent.paintedHeight) / 2 + target.y * parent.paintedHeight - 22
                            }
                        }
                        Text { visible: questionView.isAudio; text: root.t("♪  Listen"); color: root.pal.teal; font.family: Theme.display; font.pixelSize: 64; font.weight: Font.Bold }
                        ColumnLayout {
                            Layout.fillWidth: true; Layout.fillHeight: true
                            spacing: 18
                            // Options as coloured tiles matching the phone keypad; items in a list.
                            GridLayout {
                                visible: questionView.items.length > 0
                                Layout.fillWidth: true
                                columns: questionView.isImage || questionView.items.length > 6 || !questionView.q || !["choice", "vote", "multi"].includes(questionView.q.type) ? 1 : 2
                                columnSpacing: 18; rowSpacing: 16
                                Repeater {
                                    model: questionView.items
                                    delegate: Rectangle {
                                        required property string modelData
                                        required property int index
                                        readonly property var tones: [root.pal.bad, "#3b82f6", root.pal.good, root.pal.gold, root.pal.violet, root.pal.teal]
                                        readonly property bool options: !!questionView.q && ["choice", "vote", "multi"].includes(questionView.q.type)
                                        readonly property color tone: options ? tones[index % 6] : root.pal.violet
                                        readonly property bool correct: !!questionView.q && questionView.q.revealed && (questionView.q.answer === modelData || (questionView.q.correct || []).includes(modelData))
                                        Layout.fillWidth: true; implicitHeight: 92; radius: 20
                                        color: Qt.rgba(tone.r, tone.g, tone.b, questionView.q && questionView.q.revealed && options && !correct ? 0.1 : 0.28)
                                        border.color: correct ? root.pal.good : Qt.rgba(tone.r, tone.g, tone.b, 0.7); border.width: correct ? 5 : 2
                                        Behavior on color { ColorAnimation { duration: 400 } }
                                        Text {
                                            anchors.fill: parent; anchors.leftMargin: 28; anchors.rightMargin: 28; verticalAlignment: Text.AlignVCenter
                                            text: `${parent.options ? String.fromCharCode(65 + index) + ".  " : questionView.q && questionView.q.type === "sheet" ? (index + 1) + ".  " : questionView.q && questionView.q.type === "tiles" ? "" : "•  "}${modelData}`
                                            color: root.pal.text; font.pixelSize: 42; font.weight: Font.Bold; elide: Text.ElideRight
                                            rightPadding: 90
                                        }
                                        // How many teams picked it, once revealed.
                                        Text {
                                            visible: parent.options && !!questionView.q && questionView.q.revealed && !!questionView.q.tally
                                            anchors.right: parent.right; anchors.rightMargin: 28; anchors.verticalCenter: parent.verticalCenter
                                            text: questionView.q && questionView.q.tally ? (questionView.q.tally[modelData] || 0) : ""
                                            color: root.pal.goldHi; font.family: Theme.display; font.pixelSize: 44; font.weight: Font.Bold
                                        }
                                    }
                                }
                            }
                            // Buzzers: who's on, who's queued, agreeing.
                            Column {
                                readonly property var b: questionView.q ? questionView.q.buzz : null
                                visible: !!b
                                spacing: 12
                                Image { visible: !!(parent.b && parent.b.active && parent.b.active.photo); source: visible ? root.serverUrl + parent.b.active.photo : ""; sourceSize.height: 160; height: 160; fillMode: Image.PreserveAspectFit }
                                Text { text: parent.b && parent.b.active ? `🔔 ${parent.b.active.name}` : questionView.q && questionView.q.open ? root.t("Buzzers open") : ""
                                       color: root.pal.goldHi; font.family: Theme.display; font.pixelSize: 96; font.weight: Font.Bold }
                                Text { text: !parent.b ? "" : parent.b.agreeOpen ? root.t("“{answer}” — agree now! {n} agreed", {answer: parent.b.announced, n: parent.b.agreeCount}) : (parent.b.queue || []).filter(x => x.status === "queued").map(x => x.name).join(" · ")
                                       color: root.pal.text; font.pixelSize: 40 }
                            }
                            // Word snake: the grid; once revealed, the answer's path lights up in order.
                            Grid {
                                readonly property var g: questionView.q ? questionView.q.grid : null
                                readonly property var path: questionView.q && questionView.q.revealed ? (questionView.q.snakePath || []) : []
                                visible: !!g && questionView.q.type === "wordsnake"
                                columns: g ? g.size : 1; spacing: 8
                                Repeater {
                                    model: parent.g ? parent.g.letters : []
                                    delegate: Rectangle {
                                        required property string modelData
                                        required property int index
                                        readonly property int step: parent.path.indexOf(index)
                                        width: 92; height: 92; radius: 16
                                        color: step >= 0 ? root.pal.gold : Qt.rgba(1, 1, 1, 0.07)
                                        border.color: root.pal.lineStrong
                                        Behavior on color { ColorAnimation { duration: 300 } }
                                        Text { anchors.centerIn: parent; text: modelData; color: parent.step >= 0 ? root.pal.onAccent : root.pal.text; font.family: Theme.display; font.pixelSize: 48; font.weight: Font.Bold }
                                        Text { visible: parent.step >= 0; anchors.right: parent.right; anchors.top: parent.top; anchors.margins: 6; text: parent.step + 1; color: root.pal.onAccent; font.pixelSize: 18; font.weight: Font.Bold }
                                    }
                                }
                            }
                            // Bingo: the last ball and the board.
                            Column {
                                readonly property var g: questionView.q ? questionView.q.bingo : null
                                visible: !!g
                                spacing: 16
                                Text { text: !parent.g ? "" : parent.g.music ? (parent.g.played ? "🎵 " + root.t("Song {n}", {n: parent.g.played}) : "🎵") : (parent.g.last !== null && parent.g.last !== undefined ? parent.g.last : "–")
                                       color: root.pal.goldHi; font.family: Theme.display; font.pixelSize: 160; font.weight: Font.Bold }
                                Text { text: !parent.g ? "" : parent.g.music ? (parent.g.titles && parent.g.titles.length ? root.t("Last revealed: {title}", {title: parent.g.titles[parent.g.titles.length - 1]}) : "") : (root.settings.bingoPhrases && parent.g.phrase ? parent.g.phrase : "")
                                       color: root.pal.text; font.pixelSize: 40 }
                                Text { text: parent.g && parent.g.winners && parent.g.winners.length ? root.t("Winner: {names}", {names: parent.g.winners.map(w => w.name || w).join(", ")}) : parent.g ? root.t("{n} called", {n: parent.g.count || 0}) : ""
                                       color: root.pal.muted; font.pixelSize: 34 }
                                Grid {
                                    visible: !!parent.g && !parent.g.music && !!parent.g.board
                                    columns: 15; spacing: 6
                                    Repeater {
                                        model: 90
                                        delegate: Rectangle {
                                            required property int index
                                            readonly property bool called: !!questionView.q && !!questionView.q.bingo && (questionView.q.bingo.called || []).includes(index + 1)
                                            width: 54; height: 42; radius: 8
                                            color: called ? root.pal.gold : Qt.rgba(1, 1, 1, 0.06)
                                            Text { anchors.centerIn: parent; text: index + 1; color: parent.called ? root.pal.onAccent : root.pal.faint; font.pixelSize: 20; font.weight: Font.Bold }
                                        }
                                    }
                                }
                            }
                            // Sound clips game
                            Column {
                                readonly property var c: questionView.q ? questionView.q.clipGame : null
                                visible: !!c
                                Text { text: !parent.c ? "" : parent.c.playing ? root.t("🎵 Clip {n} of {count}", {n: parent.c.playing, count: parent.c.count}) : questionView.q.live ? root.t("Listen carefully…") : root.t("Clips finished")
                                       color: root.pal.goldHi; font.family: Theme.display; font.pixelSize: 84; font.weight: Font.Bold }
                                Text { text: parent.c ? root.t("{n} teams have tapped", {n: parent.c.taps}) : ""; color: root.pal.text; font.pixelSize: 40 }
                            }
                            Item { Layout.fillHeight: true }
                        }
                    }
                }

                // The reveal slides up over the bottom of the question.
                Rectangle {
                    id: reveal
                    readonly property var q: questionView.q
                    readonly property bool shown: !!q && !!q.revealed
                    // Choices are marked on their tiles; the strip then only says who scored.
                    readonly property bool tiles: !!q && ["choice", "vote", "multi"].includes(q.type)
                    anchors.horizontalCenter: parent.horizontalCenter
                    width: parent.width; height: tiles ? 90 : 230; radius: 28
                    y: shown ? parent.height - height : parent.height + 40
                    opacity: shown ? 1 : 0
                    Behavior on y { NumberAnimation { duration: 500; easing.type: Easing.OutCubic } }
                    Behavior on opacity { NumberAnimation { duration: 300 } }
                    color: Qt.rgba(root.pal.good.r, root.pal.good.g, root.pal.good.b, 0.16); border.color: root.pal.good; border.width: 3
                    ColumnLayout {
                        anchors.fill: parent; anchors.margins: 30; spacing: 8
                        Text { visible: !reveal.tiles; text: root.t("ANSWER"); color: root.pal.good; font.pixelSize: 26; font.weight: Font.Bold; font.letterSpacing: 4 }
                        Text {
                            visible: !reveal.tiles
                            Layout.fillWidth: true; wrapMode: Text.WordWrap; maximumLineCount: 2; elide: Text.ElideRight
                            text: !reveal.q ? "" : reveal.q.type === "sheet" ? (reveal.q.itemAnswers || []).map((a, i) => `${i + 1}. ${a || root.t("Marked by quizmaster")}`).join("   ")
                                : reveal.q.type === "sequence" ? (reveal.q.items || []).join("  →  ") : (reveal.q.answer || root.t("Marked by quizmaster"))
                            color: root.pal.text; font.family: Theme.display; font.pixelSize: 58; font.weight: Font.Bold
                        }
                        Text { visible: !reveal.tiles && !!reveal.q && !!reveal.q.answerNote; text: reveal.q ? reveal.q.answerNote || "" : ""; color: root.pal.muted; font.pixelSize: 30; Layout.fillWidth: true; elide: Text.ElideRight }
                        Text {
                            readonly property var scorers: reveal.q ? reveal.q.scorers : null
                            visible: !!scorers && reveal.q.type !== "vote"
                            text: !scorers ? "" : !scorers.length ? root.t("Nobody scored this time") : scorers.length === 1 ? root.t("1 team scored: {name}", {name: scorers[0].name}) : root.t("{n} teams scored — {names}", {n: scorers.length, names: scorers.slice(0, 5).map(s => s.name).join(", ") + (scorers.length > 5 ? "…" : "")})
                            color: root.pal.goldHi; font.pixelSize: 30; font.weight: Font.DemiBold; Layout.fillWidth: true; elide: Text.ElideRight
                        }
                    }
                }
            }

            // Leaderboard, revealed from the bottom when the quizmaster steps through it.
            Item {
                anchors.fill: parent
                opacity: root.view === "leaderboard" ? 1 : 0; visible: opacity > 0
                Behavior on opacity { NumberAnimation { duration: 300 } }
                readonly property var reveal: root.tv.reveal || null
                readonly property int shownFromBottom: reveal && !reveal.done ? reveal.shown : 100000
                Text { id: boardTitle; text: root.t("Leaderboard"); color: root.pal.text; font.family: Theme.display; font.pixelSize: 72; font.weight: Font.Bold }
                Text {
                    anchors.left: boardTitle.right; anchors.leftMargin: 30; anchors.baseline: boardTitle.baseline
                    text: root.settings.secretRound ? root.t("Secret round: the scores stay hidden until the end of the quiz.") : !root.settings.leaderboardVisible ? root.t("The quizmaster has hidden scores for now.") : root.settings.ended ? root.t("Final standings") : ""
                    color: root.pal.muted; font.pixelSize: 32
                }
                GridView {
                    id: board
                    anchors.top: boardTitle.bottom; anchors.topMargin: 30; anchors.left: parent.left; anchors.right: parent.right; anchors.bottom: parent.bottom
                    readonly property bool twoColumns: root.teams.length > 10
                    cellWidth: twoColumns ? width / 2 : width; cellHeight: 84
                    flow: GridView.FlowTopToBottom
                    interactive: false
                    model: root.settings.leaderboardVisible === false ? [] : root.teams
                    delegate: Item {
                        required property var modelData
                        required property int index
                        readonly property bool shown: root.teams.length - index <= parent.parent.shownFromBottom
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
                    Text {
                        anchors.horizontalCenter: parent.horizontalCenter
                        text: root.settings.leaderboardVisible === false ? root.t("Scores are hidden for now") : parent.parent.leaders.map(t => t.name).join(" & ") || root.t("No teams yet")
                        color: root.pal.text; font.family: Theme.display; font.pixelSize: 130; font.weight: Font.Bold
                        scale: root.view === "winner" ? 1 : 0.6
                        Behavior on scale { NumberAnimation { duration: 900; easing.type: Easing.OutBack } }
                    }
                    Text {
                        anchors.horizontalCenter: parent.horizontalCenter
                        readonly property var leaders: parent.parent.leaders
                        text: leaders.length && root.settings.leaderboardVisible !== false && leaders[0].score !== null ? root.t(leaders.length > 1 ? "{n} points — a tie!" : "{n} points", {n: leaders[0].score}) : ""
                        color: root.pal.goldHi; font.family: Theme.display; font.pixelSize: 56; font.weight: Font.Bold
                    }
                    Row {
                        anchors.horizontalCenter: parent.horizontalCenter; spacing: 60
                        Repeater {
                            model: root.settings.leaderboardVisible === false ? [] : root.teams.filter(t => t.rank > 1 && t.rank <= 3)
                            delegate: Text { required property var modelData; text: `${modelData.rank === 2 ? "🥈" : "🥉"} ${modelData.name}${modelData.score === null ? "" : "  " + modelData.score}`; color: root.pal.text; font.pixelSize: 44 }
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
                property string shownId: ""
                property real turn: 0
                property bool done: false
                onWheelChanged: {
                    if (!wheel || wheel.id === shownId) return
                    const fresh = shownId !== "" && root.serverNow - wheel.spun < 3000, slice = 360 / wheel.items.length
                    const target = 360 - (wheel.result + 0.5) * slice
                    shownId = wheel.id; wheelCanvas.requestPaint()
                    spin.stop()
                    if (!fresh) { wheelCanvas.rotation = target; done = true; return }
                    done = false
                    spin.from = wheelCanvas.rotation; spin.to = wheelCanvas.rotation - (wheelCanvas.rotation % 360) + 360 * 6 + target
                    spin.start()
                }
                NumberAnimation { id: spin; target: wheelCanvas; property: "rotation"; duration: 6000; easing.type: Easing.OutCubic; onFinished: wheelView.done = true }
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
                Text {
                    anchors.horizontalCenter: parent.horizontalCenter; anchors.bottom: parent.bottom
                    text: wheelView.done && wheelView.wheel ? `🎉 ${wheelView.wheel.items[wheelView.wheel.result]}` : ""
                    color: root.pal.goldHi; font.family: Theme.display; font.pixelSize: 72; font.weight: Font.Bold
                }
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
                    const r = root.tv.reveal
                    const done = r && r.done ? String(r.question) : ""
                    if (done && done !== spotlight.boardDone && spotlight.boardDone !== "") {
                        const top = root.teams.filter(t => t.rank === 1).slice(0, 4)
                        spotlight.shownFor = null
                        if (top.length) spotlight.show({kind: top.length > 1 ? root.t("TIED FOR FIRST") : root.t("IN FIRST PLACE"), names: top.map(t => t.name).join(" & "),
                                                        photos: top.filter(t => t.photo).map(t => t.photo), initials: top.map(t => t.name.charAt(0).toUpperCase()),
                                                        detail: top[0].score === null ? "" : root.t("{n} points", {n: top[0].score})}, 5000 + (top.length - 1) * 2500)
                    }
                    spotlight.boardDone = done || (spotlight.boardDone === "" ? "-" : spotlight.boardDone)
                }
            }
            Rectangle { anchors.fill: parent; color: Qt.rgba(0, 0, 0, 0.72) }
            Column {
                anchors.centerIn: parent; spacing: 28
                scale: spotlight.shown ? 1 : 0.7
                Behavior on scale { NumberAnimation { duration: 600; easing.type: Easing.OutBack } }
                Text { anchors.horizontalCenter: parent.horizontalCenter; text: spotlight.shown ? spotlight.shown.kind : ""; color: root.pal.gold; font.pixelSize: 48; font.weight: Font.Bold; font.letterSpacing: 8 }
                Row {
                    anchors.horizontalCenter: parent.horizontalCenter; spacing: 30
                    Repeater {
                        model: spotlight.shown ? (spotlight.shown.photos.length ? spotlight.shown.photos : spotlight.shown.initials) : []
                        delegate: Rectangle {
                            required property string modelData
                            width: 260; height: 260; radius: 130; color: root.pal.violet; border.color: root.pal.gold; border.width: 8; clip: true
                            Image { anchors.fill: parent; anchors.margins: 8; visible: modelData.length > 1; source: visible ? root.serverUrl + modelData : ""; fillMode: Image.PreserveAspectCrop }
                            Text { anchors.centerIn: parent; visible: modelData.length === 1; text: modelData; color: root.pal.text; font.family: Theme.display; font.pixelSize: 140; font.weight: Font.Bold }
                        }
                    }
                }
                Text { anchors.horizontalCenter: parent.horizontalCenter; text: spotlight.shown ? spotlight.shown.names : ""; color: root.pal.text; font.family: Theme.display; font.pixelSize: 110; font.weight: Font.Bold }
                Text { anchors.horizontalCenter: parent.horizontalCenter; text: spotlight.shown ? spotlight.shown.detail : ""; color: root.pal.goldHi; font.family: Theme.display; font.pixelSize: 56; font.weight: Font.Bold }
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
