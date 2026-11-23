// The shared buzzer library (Library → Buzzers; BeerMat Online), as the web desk's: everyone sees what's in it; with
// BeerMat Pro, play a buzzer, add it to this laptop's buzzer sounds, and share clips of your own.
import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Dialogs
import QtQuick.Layouts
import Desk

ColumnLayout {
    id: buzzers
    readonly property var lib: desk.prefs.library
    property string reporting: ""
    spacing: 10
    FileDialog { id: shareFile; title: "Choose a buzzer clip to share (MP3, Ogg or WAV)"; nameFilters: ["Sounds (*.mp3 *.ogg *.wav)"]
                 onAccepted: if (!shareName.text) shareName.text = String(selectedFile).split("/").pop().replace(/\.[^.]+$/, "").replace(/_+/g, " ").slice(0, 60) }
    Text {
        Layout.fillWidth: true; wrapMode: Text.WordWrap; color: Theme.muted; font.pixelSize: 13
        text: buzzers.lib.pro ? "Buzzers other BeerMat venues have shared. Play one, then add it to this laptop’s buzzer sounds. Report anything that shouldn’t be here."
            : "Buzzers BeerMat venues have shared. Playing, adding and sharing them is part of BeerMat Pro."
    }
    RowLayout {
        Field { id: librarySearch; placeholderText: "Name of a buzzer"; maximumLength: 60; Layout.fillWidth: true; onAccepted: desk.prefs.searchLibrary(text) }
        DeskButton { text: "Search"; implicitHeight: 38; onClicked: desk.prefs.searchLibrary(librarySearch.text) }
    }
    Text { visible: !!buzzers.lib.error; text: buzzers.lib.error || ""; color: Theme.bad; font.pixelSize: 13; wrapMode: Text.WordWrap; Layout.fillWidth: true }
    ListView {
        Layout.fillWidth: true; Layout.fillHeight: true; clip: true; spacing: 4
        ScrollBar.vertical: ScrollBar {}
        model: buzzers.lib.buzzers || []
        delegate: ColumnLayout {
            required property var modelData
            width: ListView.view.width; spacing: 4
            RowLayout {
                Layout.fillWidth: true
                Text { text: `${modelData.name} · ${modelData.seconds}s`; color: Theme.text; font.pixelSize: 14; elide: Text.ElideRight; Layout.fillWidth: true }
                DeskButton { visible: !!buzzers.lib.pro || !!buzzers.lib.admin; text: "▶ Play"; implicitHeight: 32; onClicked: desk.prefs.playLibraryBuzzer(modelData.id) }
                // Each clip is added once: then it's in this laptop's buzzer sounds (Settings).
                Text { visible: (buzzers.lib.added || []).includes(modelData.id); text: "✓ Added"; color: Theme.good; font.pixelSize: 13; font.weight: Font.Bold }
                DeskButton { visible: (!!buzzers.lib.pro || !!buzzers.lib.admin) && !(buzzers.lib.added || []).includes(modelData.id); text: "Add"; implicitHeight: 32
                             onClicked: desk.prefs.addLibraryBuzzer(modelData.id) }
                DeskButton { text: "Report"; implicitHeight: 32; onClicked: buzzers.reporting = buzzers.reporting === modelData.id ? "" : modelData.id }
                DeskButton { visible: (buzzers.lib.shared || []).includes(modelData.id); text: "Take it out"; kind: "danger"; implicitHeight: 32
                             onClicked: desk.prefs.removeLibraryBuzzer(modelData.id) }
            }
            RowLayout {
                visible: buzzers.reporting === modelData.id; Layout.fillWidth: true
                Field { id: reason; Layout.fillWidth: true; maximumLength: 300
                        placeholderText: `What’s wrong with “${modelData.name}”? (offensive, copied without permission…)` }
                DeskButton { text: "Send report"; implicitHeight: 34; enabled: reason.text.trim().length > 0
                             onClicked: { desk.prefs.reportLibraryBuzzer(modelData.id, reason.text); buzzers.reporting = ""; reason.text = "" } }
            }
        }
        Text { visible: parent.count === 0; anchors.centerIn: parent; color: Theme.muted; font.pixelSize: 13
               text: buzzers.lib.loading ? "Looking…" : buzzers.lib.query ? "Nothing matches." : "Nothing shared yet." }
    }
    // Pro: share a clip of this laptop's with other venues (BeerMat Online keeps 10 seconds at most).
    ColumnLayout {
        visible: !!buzzers.lib.pro; Layout.fillWidth: true; spacing: 6
        Text { text: "Share a clip with other venues (10 seconds at most is kept)"; color: Theme.text; font.pixelSize: 14; font.weight: Font.DemiBold }
        RowLayout {
            Layout.fillWidth: true
            DeskButton { text: shareFile.selectedFile.toString() ? String(shareFile.selectedFile).split("/").pop() : "Choose a clip…"; implicitHeight: 34; onClicked: shareFile.open() }
            Field { id: shareName; placeholderText: "Buzzer name"; maximumLength: 60; Layout.fillWidth: true }
        }
        RowLayout {
            Layout.fillWidth: true
            CheckBox { id: shareRights; palette.windowText: Theme.text
                       text: "I have the right to share this clip with other BeerMat venues (beermatquiz.co.uk/terms)" }
            Item { Layout.fillWidth: true }
            DeskButton { text: "Share"; kind: "primary"; implicitHeight: 34; enabled: !!shareFile.selectedFile.toString() && shareName.text.trim() !== "" && shareRights.checked
                         onClicked: { desk.prefs.shareLibraryBuzzer(shareFile.selectedFile, shareName.text, shareRights.checked); shareName.text = ""; shareRights.checked = false } }
        }
    }
}
