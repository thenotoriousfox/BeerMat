// The theme library (Settings → Looks): themes other venues shared, with pictures of each on the TV, in the app and
// in a phone's browser; installing one makes it a look on this laptop. My themes: this laptop's own (made in its
// my-themes folder), shared from here with pictures the share dialog draws of it. desk.prefs talks to the quiz server,
// which talks to BeerMat Online.
import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts
import Desk

Dialog {
    id: dialog
    readonly property var lib: desk.prefs.themes
    property int tab: 0
    property string reporting: ""
    property string sharing: ""          // the id of one of My themes being shared
    parent: Overlay.overlay; anchors.centerIn: parent; modal: true
    width: Math.min(1100, parent.width - 60); height: Math.min(820, parent.height - 60)
    onOpened: desk.prefs.searchThemes("")
    background: Rectangle { color: Theme.panel; radius: Theme.radius; border.color: Theme.lineStrong }
    header: RowLayout {
        Text { text: "Theme library"; color: Theme.text; font.family: Theme.display; font.pixelSize: 22; font.weight: Font.Bold; Layout.margins: 20; Layout.fillWidth: true }
        Repeater {
            model: ["Library", "My themes"]
            delegate: DeskButton { required property int index; required property string modelData
                                   text: modelData; kind: dialog.tab === index ? "primary" : "quiet"; implicitHeight: 34; onClicked: dialog.tab = index }
        }
        Item { width: 12 }
    }
    footer: RowLayout {
        Text { Layout.leftMargin: 20; Layout.fillWidth: true; wrapMode: Text.WordWrap; color: Theme.faint; font.pixelSize: 12
               text: dialog.lib.pro ? "Every theme in the library has been looked at by BeerMat. Report anything that shouldn’t be there."
                                    : "Anyone can look; installing and sharing themes is part of BeerMat Pro." }
        DeskButton { text: "Close"; Layout.margins: 16; onClicked: dialog.close() }
    }

    // A preview from BeerMat Online (tv, app or browser), if the theme has one.
    component Preview: Rectangle {
        property string theme: ""
        property string kind: "tv"
        property var kinds: []
        color: Theme.bg2; radius: 6; clip: true; border.color: Theme.line
        Image {
            anchors.fill: parent; fillMode: Image.PreserveAspectFit; asynchronous: true; cache: true
            source: parent.kinds.includes(parent.kind) && dialog.lib.previews ? dialog.lib.previews + parent.theme + "/previews/" + parent.kind : ""
        }
        Text { anchors.centerIn: parent; visible: !parent.kinds.includes(parent.kind); text: "—"; color: Theme.faint }
    }

    StackLayout {
        anchors.fill: parent
        currentIndex: dialog.tab

        // ---- the library ----
        ColumnLayout {
            spacing: 10
            RowLayout {
                Field { id: search; placeholderText: "Search themes"; maximumLength: 60; Layout.fillWidth: true; onAccepted: desk.prefs.searchThemes(text) }
                DeskButton { text: "Search"; implicitHeight: 38; onClicked: desk.prefs.searchThemes(search.text) }
            }
            Text { visible: !!dialog.lib.onlineError || !!dialog.lib.error; text: dialog.lib.onlineError || dialog.lib.error || ""; color: Theme.bad; font.pixelSize: 13; wrapMode: Text.WordWrap; Layout.fillWidth: true }
            ListView {
                Layout.fillWidth: true; Layout.fillHeight: true; clip: true; spacing: 10
                ScrollBar.vertical: ScrollBar {}
                model: dialog.lib.themes || []
                delegate: Rectangle {
                    required property var modelData
                    readonly property bool installed: (dialog.lib.installed || []).some(t => t.id === modelData.id)
                    width: ListView.view.width - 12; height: 150 + (dialog.reporting === modelData.id ? 46 : 0); radius: 12
                    color: Theme.panelRaised; border.color: Theme.line
                    RowLayout {
                        x: 12; y: 12; width: parent.width - 24; height: 126; spacing: 12
                        Preview { theme: modelData.id; kind: "tv"; kinds: modelData.previews || []; Layout.preferredWidth: 224; Layout.preferredHeight: 126 }
                        Preview { theme: modelData.id; kind: "app"; kinds: modelData.previews || []; Layout.preferredWidth: 58; Layout.preferredHeight: 126 }
                        Preview { theme: modelData.id; kind: "browser"; kinds: modelData.previews || []; Layout.preferredWidth: 58; Layout.preferredHeight: 126 }
                        ColumnLayout {
                            Layout.fillWidth: true; spacing: 6
                            Text { text: modelData.name; color: Theme.text; font.family: Theme.display; font.pixelSize: 20; font.weight: Font.Bold; elide: Text.ElideRight; Layout.fillWidth: true }
                            Text { color: Theme.muted; font.pixelSize: 12
                                   text: [modelData.look ? "a look for the TV and phones" : "", modelData.tv ? "TV scenery" : "", modelData.sounds ? "a sound theme" : ""].filter(x => x).join(" · ") }
                            Text { color: Theme.faint; font.pixelSize: 11; text: "TV · app · browser" }
                            RowLayout {
                                spacing: 6
                                DeskButton { visible: !!dialog.lib.pro && !installed; text: "Install"; kind: "primary"; implicitHeight: 32; onClicked: desk.prefs.installTheme(modelData.id) }
                                Text { visible: installed; text: "✓ Installed"; color: Theme.good; font.pixelSize: 13; font.weight: Font.Bold }
                                DeskButton { visible: installed; text: "Remove"; implicitHeight: 32; onClicked: desk.prefs.uninstallTheme(modelData.id) }
                                DeskButton { visible: !!dialog.lib.pro; text: "Report"; implicitHeight: 32; onClicked: dialog.reporting = dialog.reporting === modelData.id ? "" : modelData.id }
                            }
                        }
                    }
                    RowLayout {
                        visible: dialog.reporting === modelData.id
                        x: 12; y: 144; width: parent.width - 24
                        Field { id: reason; Layout.fillWidth: true; maximumLength: 300; placeholderText: `What’s wrong with “${modelData.name}”?` }
                        DeskButton { text: "Send report"; implicitHeight: 34; enabled: reason.text.trim().length > 0
                                     onClicked: { desk.prefs.reportTheme(modelData.id, reason.text); dialog.reporting = ""; reason.text = "" } }
                    }
                }
                Text { visible: parent.count === 0; anchors.centerIn: parent; color: Theme.muted; font.pixelSize: 13
                       text: dialog.lib.loading ? "Looking…" : dialog.lib.query ? "Nothing matches." : "No themes shared yet." }
            }
        }

        // ---- my themes ----
        ColumnLayout {
            spacing: 10
            Text {
                Layout.fillWidth: true; wrapMode: Text.WordWrap; color: Theme.muted; font.pixelSize: 13
                text: "Your own themes live in the My themes folder: one folder each, as BeerMat’s own (themes/README.md tells you what goes in one; copying Halloween is a good start). They’re looks on this laptop straight away. Share one and, once BeerMat has looked at it, other venues can install it."
            }
            RowLayout {
                DeskButton { text: "Open My themes folder"; implicitHeight: 34; onClicked: desk.prefs.openMyThemes() }
                DeskButton { text: "Read them again"; implicitHeight: 34; onClicked: desk.prefs.reloadThemes() }
                Text { text: dialog.lib.folder || ""; color: Theme.faint; font.pixelSize: 11; elide: Text.ElideMiddle; Layout.fillWidth: true }
            }
            ListView {
                Layout.fillWidth: true; Layout.fillHeight: true; clip: true; spacing: 8
                ScrollBar.vertical: ScrollBar {}
                model: (dialog.lib.mine || []).map(t => Object.assign({}, t, {own: true})).concat((dialog.lib.installed || []).map(t => Object.assign({}, t, {own: false})))
                delegate: Rectangle {
                    required property var modelData
                    readonly property var shared: (dialog.lib.shared || []).find(s => s.local === modelData.id) || null
                    width: ListView.view.width - 12; height: 76; radius: 12; color: Theme.panelRaised; border.color: Theme.line
                    RowLayout {
                        anchors.fill: parent; anchors.margins: 12; spacing: 10
                        ColumnLayout {
                            Layout.fillWidth: true; spacing: 2
                            Text { text: modelData.name; color: Theme.text; font.pixelSize: 16; font.weight: Font.Bold }
                            Text {
                                color: shared && shared.status === "rejected" ? Theme.bad : Theme.muted; font.pixelSize: 12; wrapMode: Text.WordWrap; Layout.fillWidth: true
                                text: !modelData.own ? "Installed from the library"
                                    : modelData.builtIn ? `Same name as one of BeerMat’s own themes (${modelData.id}): rename its folder to use it`
                                    : !shared ? `Yours (${modelData.id}), on this laptop only`
                                    : shared.status === "pending" ? "Shared: waiting for BeerMat to look at it"
                                    : shared.status === "approved" ? "Shared: in the library"
                                    : shared.status === "rejected" ? `Shared, and turned down: ${shared.note || "no reason given"}`
                                    : `Shared (${shared.status})`
                            }
                        }
                        DeskButton { visible: modelData.own && !modelData.builtIn && !!dialog.lib.pro; text: shared ? "Share again" : "Share…"; implicitHeight: 32; onClicked: { dialog.sharing = modelData.id; shareDialog.open() } }
                        DeskButton { visible: !!shared; text: "Take out"; implicitHeight: 32; onClicked: desk.prefs.removeSharedTheme(shared.id) }
                        DeskButton { visible: !modelData.own; text: "Remove"; implicitHeight: 32; onClicked: desk.prefs.uninstallTheme(modelData.id) }
                    }
                }
                Text { visible: parent.count === 0; anchors.centerIn: parent; color: Theme.muted; font.pixelSize: 13; text: "No themes of your own yet." }
            }
        }
    }

    // Sharing: the theme on the TV and in the app, drawn here with the desk's own TV and the app's look, then sent with
    // the theme as its pictures in the library.
    Dialog {
        id: shareDialog
        objectName: "shareTheme"
        parent: Overlay.overlay; anchors.centerIn: parent; modal: true
        width: Math.min(1060, parent.width - 40); height: Math.min(640, parent.height - 40)
        background: Rectangle { color: Theme.panel; radius: Theme.radius; border.color: Theme.gold }
        header: Text { text: `Share “${((dialog.lib.mine || []).find(t => t.id === dialog.sharing) || {}).name || dialog.sharing}”`; color: Theme.text
                       font.family: Theme.display; font.pixelSize: 22; font.weight: Font.Bold; padding: 20 }
        ColumnLayout {
            anchors.fill: parent; spacing: 10
            RowLayout {
                spacing: 16; Layout.alignment: Qt.AlignHCenter
                // The TV at full size (1600×900), shown at 40%: the picture is taken at full size.
                Item {
                    Layout.preferredWidth: 640; Layout.preferredHeight: 360
                    TvStage {
                        id: tvPreview
                        width: 1600; height: 900; scale: 0.4; transformOrigin: Item.TopLeft
                        tv: ({settings: {title: ((dialog.lib.mine || []).find(t => t.id === dialog.sharing) || {}).name || "Quiz night", leaderboardVisible: true, registrationOpen: true, joinSsid: "BeerMat", joinUrl: "http://10.42.0.1"},
                              view: "question", look: dialog.sharing, offset: 0, serverTime: Date.now(), teams: [],
                              question: {id: 1, type: "choice", round: "Round 1", text: "Which planet is known as the Red Planet?", options: ["Venus", "Mars", "Jupiter", "Saturn"],
                                         open: true, live: true, paused: false, seconds: 60, deadline: Date.now() + 42000, points: 1, revealed: false, revealing: false}})
                    }
                }
                Item {
                    Layout.preferredWidth: 166; Layout.preferredHeight: 360
                    PhonePreview { id: appPreview; lookId: dialog.sharing; scale: 360 / 844; transformOrigin: Item.TopLeft }
                }
            }
            Text { Layout.fillWidth: true; wrapMode: Text.WordWrap; color: Theme.muted; font.pixelSize: 12
                   text: "These pictures go with your theme, and BeerMat Online adds one of a phone’s browser. BeerMat looks at every theme before it’s in the library." }
            CheckBox { id: rights; palette.windowText: Theme.text; text: "I have the right to share everything in this theme (pictures, fonts and sounds) with other BeerMat venues (beermatquiz.co.uk/terms)" }
            Item { Layout.fillHeight: true }
            RowLayout {
                Layout.alignment: Qt.AlignRight
                DeskButton { text: "Cancel"; implicitHeight: 38; onClicked: shareDialog.close() }
                DeskButton {
                    text: "Share"; kind: "primary"; implicitHeight: 38; enabled: rights.checked
                    onClicked: {
                        const tvFile = desk.prefs.previewFile("tv"), appFile = desk.prefs.previewFile("app")
                        tvPreview.grabToImage(tv => {
                            tv.saveToFile(tvFile)
                            appPreview.grabToImage(app => {
                                app.saveToFile(appFile)
                                desk.prefs.shareTheme(dialog.sharing, true, tvFile, appFile)
                                rights.checked = false; shareDialog.close()
                            }, Qt.size(780, 1688))
                        }, Qt.size(1600, 900))
                    }
                }
            }
        }
    }
}
