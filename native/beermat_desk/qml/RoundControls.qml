// The controls a round format needs while it's live: the buzzer game's verdicts, bingo calls and shouts, the sound
// clips game, and the play button of an audio question (it plays through the TV's sound). Keys as the web desk:
// 1 correct / bingo yes, 2 wrong / bingo no, 3 pass, A agree, B call the next number.
import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts
import Desk

ColumnLayout {
    id: controls
    required property var view
    readonly property var q: view.raw || {}
    readonly property string type: view.typeCode || ""
    readonly property var buzz: q.buzz || null
    readonly property var bingo: q.bingo || null
    readonly property var pendingShouts: bingo ? (bingo.shouts || []).filter(x => x.status === "pending") : []
    readonly property bool isAudio: /\.(mp3|ogg|wav)$/i.test(q.media || "")
    visible: !!q.id && (type === "buzzer" || type === "bingo" || type === "musicbingo" || type === "clips" || isAudio)
    spacing: 8

    Shortcut { sequence: "1"; enabled: controls.visible && controls.pendingShouts.length > 0; onActivated: desk.live.bingoVerdict(controls.pendingShouts[0].id, true) }
    Shortcut { sequence: "2"; enabled: controls.visible && controls.pendingShouts.length > 0; onActivated: desk.live.bingoVerdict(controls.pendingShouts[0].id, false) }
    Shortcut { sequence: "1"; enabled: controls.visible && controls.type === "buzzer" && !!controls.buzz && !!controls.buzz.active; onActivated: desk.live.buzz("correct", announced.text) }
    Shortcut { sequence: "2"; enabled: controls.visible && controls.type === "buzzer" && !!controls.buzz && !!controls.buzz.active; onActivated: desk.live.buzz("wrong", announced.text) }
    Shortcut { sequence: "3"; enabled: controls.visible && controls.type === "buzzer" && !!controls.buzz && !!controls.buzz.active; onActivated: desk.live.buzz("pass", announced.text) }
    Shortcut { sequence: "A"; enabled: controls.visible && controls.type === "buzzer" && !!controls.buzz && !!controls.buzz.active; onActivated: desk.live.buzz("agree", announced.text) }
    Shortcut { sequence: "B"; enabled: controls.visible && (controls.type === "bingo" || controls.type === "musicbingo") && !!controls.q.live; onActivated: desk.live.callNumber() }

    // ---- buzzer game ----
    Rectangle {
        visible: controls.type === "buzzer"
        Layout.fillWidth: true; implicitHeight: buzzColumn.implicitHeight + 24; radius: 12
        color: Qt.rgba(Theme.pink.r, Theme.pink.g, Theme.pink.b, 0.1); border.color: Qt.rgba(Theme.pink.r, Theme.pink.g, Theme.pink.b, 0.45)
        ColumnLayout {
            id: buzzColumn
            anchors.fill: parent; anchors.margins: 12; spacing: 8
            Text {
                text: !controls.buzz ? "" : controls.buzz.active ? `🔔 ${controls.buzz.active.name} is answering` : controls.q.open ? "Buzzers open: waiting for a buzz" : "Buzzing closed"
                color: Theme.text; font.family: Theme.display; font.pixelSize: 22; font.weight: Font.Bold
            }
            Text {
                visible: !!controls.buzz && (controls.buzz.queue || []).some(x => x.status === "queued")
                text: controls.buzz ? "Next: " + controls.buzz.queue.filter(x => x.status === "queued").map(x => x.name).join(" · ") : ""
                color: Theme.muted; font.pixelSize: 13
            }
            RowLayout {
                visible: !!controls.buzz && !!controls.buzz.active
                spacing: 6
                Field { id: announced; placeholderText: "What they said (for the agree vote)"; Layout.fillWidth: true }
                DeskButton { text: "Correct"; shortcutHint: "1"; kind: "primary"; implicitHeight: 36; onClicked: desk.live.buzz("correct", announced.text) }
                DeskButton { text: "Wrong"; shortcutHint: "2"; kind: "danger"; implicitHeight: 36; onClicked: desk.live.buzz("wrong", announced.text) }
                DeskButton { text: "Pass"; shortcutHint: "3"; implicitHeight: 36; onClicked: desk.live.buzz("pass", announced.text) }
                DeskButton { text: "Agree vote"; shortcutHint: "A"; implicitHeight: 36; onClicked: desk.live.buzz("agree", announced.text) }
            }
            Text { visible: !!controls.buzz && controls.buzz.agreeOpen; text: controls.buzz ? `Agree vote open: ${controls.buzz.agreeCount || 0} agreed` : ""; color: Theme.teal; font.pixelSize: 14; font.weight: Font.Bold }
        }
    }

    // ---- bingo ----
    Rectangle {
        visible: controls.type === "bingo" || controls.type === "musicbingo"
        Layout.fillWidth: true; implicitHeight: bingoColumn.implicitHeight + 24; radius: 12
        color: Qt.rgba(Theme.gold.r, Theme.gold.g, Theme.gold.b, 0.08); border.color: Qt.rgba(Theme.gold.r, Theme.gold.g, Theme.gold.b, 0.4)
        ColumnLayout {
            id: bingoColumn
            anchors.fill: parent; anchors.margins: 12; spacing: 8
            RowLayout {
                spacing: 10
                DeskButton { text: controls.type === "musicbingo" ? "Play the next song" : "Call the next number"; shortcutHint: "B"; kind: "primary"
                             enabled: !!controls.q.live && !desk.busy && !(controls.bingo && controls.bingo.over); onClicked: desk.live.callNumber() }
                Text {
                    text: !controls.bingo ? "" : controls.type === "musicbingo" ? `${controls.bingo.played || 0} of ${(controls.q.songs || []).length} songs played`
                          : `${controls.bingo.count || 0} called${controls.bingo.last ? " · last " + controls.bingo.last : ""}`
                    color: Theme.text; font.pixelSize: 15; font.weight: Font.DemiBold
                }
                Text { visible: !!controls.bingo && !!controls.bingo.playingFor; text: controls.bingo ? `Playing for ${controls.bingo.playingFor}` : ""; color: Theme.muted; font.pixelSize: 13 }
            }
            Repeater {
                model: controls.pendingShouts
                delegate: RowLayout {
                    required property var modelData
                    required property int index
                    spacing: 8
                    Text { text: `📣 ${modelData.name} shouts bingo (${modelData.stage})`; color: Theme.goldHi; font.pixelSize: 15; font.weight: Font.Bold }
                    Pill { text: modelData.checks ? "TICKET CHECKS OUT" : "TICKET DOESN'T CHECK"; tone: modelData.checks ? Theme.good : Theme.bad }
                    DeskButton { text: "Yes, bingo"; shortcutHint: index === 0 ? "1" : ""; kind: "primary"; implicitHeight: 34; onClicked: desk.live.bingoVerdict(modelData.id, true) }
                    DeskButton { text: "No"; shortcutHint: index === 0 ? "2" : ""; kind: "danger"; implicitHeight: 34; onClicked: desk.live.bingoVerdict(modelData.id, false) }
                }
            }
            Text { visible: !!controls.bingo && (controls.bingo.winners || []).length > 0; text: controls.bingo ? `Winners${controls.bingo.lastStage ? " (" + controls.bingo.lastStage + ")" : ""}: ${(controls.bingo.winners || []).join(", ")}` : ""
                   color: Theme.good; font.pixelSize: 14 }
        }
    }

    // ---- sound clips ----
    Rectangle {
        visible: controls.type === "clips"
        Layout.fillWidth: true; implicitHeight: 64; radius: 12
        color: Qt.rgba(Theme.teal.r, Theme.teal.g, Theme.teal.b, 0.08); border.color: Qt.rgba(Theme.teal.r, Theme.teal.g, Theme.teal.b, 0.4)
        RowLayout {
            anchors.fill: parent; anchors.margins: 12; spacing: 10
            DeskButton { text: controls.view.clipsRunning >= 0 ? "Stop clips" : "Play clips"; kind: controls.view.clipsRunning >= 0 ? "danger" : "primary"; enabled: !!controls.q.live
                         onClicked: controls.view.clipsRunning >= 0 ? desk.live.stopClips() : desk.live.playClips() }
            Text {
                text: controls.view.clipsRunning >= 0 ? `🎵 Clip ${controls.view.clipsRunning + 1} of ${(controls.q.clips || []).length} playing on the TV` : `${(controls.q.clips || []).length} clips, played in order through the TV's sound`
                color: Theme.text; font.pixelSize: 15; Layout.fillWidth: true
            }
            Text { text: controls.q.clipGame ? `${controls.q.clipGame.taps || 0} taps` : ""; color: Theme.muted; font.pixelSize: 13 }
        }
    }

    // ---- an audio question ----
    RowLayout {
        visible: controls.isAudio && controls.type !== "clips"
        spacing: 10
        DeskButton { text: "▶ / ❚❚  Play the sound on the TV"; onClicked: desk.live.playAudio() }
        Text { text: "Plays through the TV's sound (Settings → Screens)."; color: Theme.faint; font.pixelSize: 12 }
    }
}
