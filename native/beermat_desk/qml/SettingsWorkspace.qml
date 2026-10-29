// Settings: the plan, the quiz room, sounds and buzzers, bingo calls, Spotify, the quiz data on this laptop (backup,
// folders, logs), screens and the TV's sound, and the quizmaster key.
import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Dialogs
import QtQuick.Layouts
import Desk

ScrollView {
    id: settings
    required property var view
    readonly property var plan: view.plan || {}
    readonly property var room: view.settings || {}
    readonly property var pack: (desk.tv.sounds || {})
    readonly property var spotify: desk.prefs.spotify
    signal openWebDesk()
    signal swapScreens()
    contentWidth: availableWidth
    onVisibleChanged: if (visible) desk.prefs.loadSpotify()

    FileDialog { id: soundFile; property string slot: ""; title: "Choose a sound (MP3, Ogg or WAV)"; nameFilters: ["Sounds (*.mp3 *.ogg *.wav)"]
                 onAccepted: slot === "buzzer" ? desk.prefs.addBuzzer(buzzerName.text, selectedFile) : desk.prefs.setSound(slot, selectedFile) }
    FileDialog { id: callsFile; title: "Bingo calls: 90 lines, one per number"; nameFilters: ["Text or JSON (*.txt *.json)", "All files (*)"]; onAccepted: desk.prefs.importCalls(selectedFile) }

  ColumnLayout {
    width: settings.availableWidth
    spacing: Theme.gap

    FileDialog { id: restoreFile; title: "Restore a quiz backup"; nameFilters: ["BeerMat backup (*.sqlite)"]; currentFolder: "file://" + desk.dataFolder + "/backups"
                 onAccepted: { restoreConfirm.file = selectedFile; restoreConfirm.open() } }
    MessageDialog { id: restoreConfirm; property url file; title: "Replace the current quiz with this backup?"
                    text: "The current quiz is backed up first. The quiz server restarts; phones reconnect by themselves."
                    buttons: MessageDialog.Yes | MessageDialog.Cancel; onButtonClicked: (b) => { if (b === MessageDialog.Yes) desk.restore(file) } }
    FolderDialog { id: backupFolder; title: "Choose a folder for the backup"; onAccepted: desk.backup(selectedFolder) }

    RowLayout {
        Layout.fillWidth: true
        spacing: Theme.gap
        Panel {
            Layout.fillWidth: true; implicitHeight: 200
            title: "Plan"
            headerExtra: Pill { text: plan.name || "BeerMat Free"; tone: plan.live ? Theme.gold : Theme.muted; strong: !!plan.live }
            ColumnLayout {
                anchors.fill: parent; spacing: 8
                Text {
                    Layout.fillWidth: true; wrapMode: Text.WordWrap; color: Theme.muted; font.pixelSize: 14
                    text: plan.live
                        ? `BeerMat Pro${plan.venue ? " for " + plan.venue : ""}: host live quizzes with real teams.${plan.expires ? " Licence renews by " + new Date(plan.expires).toLocaleDateString() + "." : ""}`
                        : "BeerMat Free: create, edit and rehearse as many quizzes as you like, with simulated teams and real phones testing their connection. Hosting a live quiz with real teams is BeerMat Pro."
                }
                Text { Layout.fillWidth: true; wrapMode: Text.WordWrap; color: Theme.faint; font.pixelSize: 12
                       text: "Once your venue has Pro, register this laptop with it (Venue) and press Check my plan. That needs the internet once; the plan then holds offline." }
                Item { Layout.fillHeight: true }
                DeskButton { text: "Check my plan"; onClicked: desk.refreshPlan() }
            }
        }
        Panel {
            Layout.fillWidth: true; implicitHeight: 200
            title: "Quiz data"
            ColumnLayout {
                anchors.fill: parent; spacing: 8
                Text { Layout.fillWidth: true; wrapMode: Text.WordWrap; color: Theme.muted; font.pixelSize: 14
                       text: `Quizzes, teams and settings live in ${desk.dataFolder}. A checked copy is kept each time the desk starts (the last 10, in backups); take your own before a big night.` }
                Item { Layout.fillHeight: true }
                Flow {
                    Layout.fillWidth: true; spacing: 8
                    DeskButton { text: "Back up the quiz…"; onClicked: backupFolder.open() }
                    DeskButton { text: "Restore a backup…"; onClicked: restoreFile.open() }
                    DeskButton { text: "Open data folder"; onClicked: Qt.openUrlExternally("file://" + desk.dataFolder) }
                    DeskButton { text: "Open logs"; onClicked: Qt.openUrlExternally("file://" + desk.dataFolder + "/logs") }
                }
            }
        }
    }

    // ---- the quiz room ----
    Panel {
        Layout.fillWidth: true; implicitHeight: 170
        title: "Quiz room"
        GridLayout {
            anchors.fill: parent; columns: 4; columnSpacing: 14; rowSpacing: 8
            Label { text: "Quiz name"; color: Theme.muted }
            Field { text: settings.room.title || ""; Layout.fillWidth: true; maximumLength: 80; onEditingFinished: if (text !== settings.room.title) desk.prefs.set("title", text) }
            Label { text: "Team limit (0: none)"; color: Theme.muted }
            SpinBox { from: 0; to: 250; editable: true; value: settings.room.maxTeams || 0; onValueModified: desk.prefs.set("maxTeams", value) }
            Label { text: "Language (TV and phones)"; color: Theme.muted }
            ComboBox {
                textRole: "text"; valueRole: "value"; model: [{value: "en", text: "English"}, {value: "fr", text: "Français"}, {value: "es", text: "Español"}]
                currentIndex: Math.max(0, indexOfValue(settings.room.language || "en")); onActivated: desk.prefs.set("language", currentValue)
            }
            CheckBox { text: "Desk reachable on the online link"; checked: !!settings.room.deskOnline; palette.windowText: Theme.text; onToggled: desk.prefs.set("deskOnline", checked) }
            CheckBox { text: "Share results with BeerMat Online"; checked: !!settings.room.shareResults; palette.windowText: Theme.text; onToggled: desk.prefs.set("shareResults", checked) }
        }
    }

    // ---- sounds and buzzers ----
    Panel {
        Layout.fillWidth: true; implicitHeight: 470
        title: "Sounds & buzzers"
        RowLayout {
            anchors.fill: parent; spacing: 20
            ListView {
                // The file names sit next to their buttons rather than across the whole width.
                Layout.fillWidth: true; Layout.minimumWidth: 420; Layout.maximumWidth: 760; Layout.fillHeight: true; clip: true; spacing: 4
                ScrollBar.vertical: ScrollBar {}
                model: desk.prefs.slots
                delegate: RowLayout {
                    required property var modelData
                    readonly property string media: (settings.pack.slots || {})[modelData.slot] || ""
                    width: ListView.view.width; spacing: 6
                    Text { text: modelData.label; color: Theme.text; font.pixelSize: 13; Layout.preferredWidth: 200 }
                    Text { text: media ? media.split("/").pop() : "none"; color: media ? Theme.muted : Theme.faint; font.pixelSize: 12; elide: Text.ElideMiddle; Layout.fillWidth: true }
                    Tool { text: "▶"; enabled: media !== ""; onClicked: desk.prefs.preview(media) }
                    Tool { text: "Change…"; onClicked: { soundFile.slot = modelData.slot; soundFile.open() } }
                    Tool { text: "✕"; enabled: media !== ""; onClicked: desk.prefs.clearSound(modelData.slot) }
                }
            }
            ColumnLayout {
                Layout.preferredWidth: 420; Layout.fillWidth: true; Layout.fillHeight: true; spacing: 6; Layout.leftMargin: 24
                Text { text: "Extra buzzer sounds"; color: Theme.text; font.pixelSize: 14; font.weight: Font.DemiBold }
                Text { text: "Teams pick one for their buzz, after the eight built-in ones."; color: Theme.faint; font.pixelSize: 12; wrapMode: Text.WordWrap; Layout.fillWidth: true }
                ListView {
                    Layout.fillWidth: true; Layout.fillHeight: true; clip: true; spacing: 2
                    ScrollBar.vertical: ScrollBar {}
                    model: settings.pack.buzzers || []
                    delegate: RowLayout {
                        required property var modelData
                        required property int index
                        width: ListView.view.width
                        Text { text: modelData.name; color: Theme.text; font.pixelSize: 13; Layout.fillWidth: true; elide: Text.ElideRight }
                        Tool { text: "▶"; onClicked: desk.prefs.preview(modelData.media) }
                        Tool { text: "✕"; onClicked: desk.prefs.removeBuzzer(index) }
                    }
                }
                RowLayout {
                    Field { id: buzzerName; placeholderText: "Name"; Layout.fillWidth: true; maximumLength: 60 }
                    DeskButton { text: "Add…"; implicitHeight: 34; onClicked: { soundFile.slot = "buzzer"; soundFile.open() } }
                }
                Text { text: "Bingo calls"; color: Theme.text; font.pixelSize: 14; font.weight: Font.DemiBold; Layout.topMargin: 8 }
                RowLayout {
                    DeskButton { text: "Import 90 calls…"; implicitHeight: 34; onClicked: callsFile.open() }
                    DeskButton { text: "Built-in calls"; implicitHeight: 34; onClicked: desk.prefs.defaultCalls() }
                }
            }
        }
    }

    // ---- looks and sound themes ----
    Panel {
        Layout.fillWidth: true; implicitHeight: 420
        title: "Looks & sound themes"
        RowLayout {
            anchors.fill: parent; spacing: 20
            ColumnLayout {
                Layout.preferredWidth: 380; Layout.alignment: Qt.AlignTop; spacing: 8
                Text { Layout.fillWidth: true; wrapMode: Text.WordWrap; color: Theme.muted; font.pixelSize: 13
                       text: "A look colours the TV and phones; a sound theme sets the moments' sounds. Either can follow the question's format." }
                Label { text: "Look"; color: Theme.muted }
                ComboBox {
                    Layout.fillWidth: true; textRole: "text"; valueRole: "value"
                    model: [{value: "@type", text: "By format (below)"}, {value: "@random", text: "A different one each question"}].concat(settings.view.looks || [])
                    currentIndex: Math.max(0, indexOfValue(settings.room.look || "@type")); onActivated: desk.prefs.setLook(currentValue)
                }
                Label { text: "Sound theme"; color: Theme.muted }
                ComboBox {
                    Layout.fillWidth: true; textRole: "text"; valueRole: "value"
                    model: [{value: "", text: "The sound pack (Sounds, above)"}, {value: "@type", text: "By format (below)"}, {value: "@random", text: "A different one each question"}]
                           .concat((settings.view.soundThemes || []).map(t => ({value: t, text: t})))
                    currentIndex: Math.max(0, indexOfValue(settings.room.soundTheme || "")); onActivated: desk.prefs.setSoundTheme(currentValue)
                }
            }
            ListView {
                Layout.fillWidth: true; Layout.fillHeight: true; clip: true; spacing: 2
                model: settings.view.formats || []
                delegate: RowLayout {
                    required property var modelData
                    width: ListView.view.width; spacing: 8
                    Text { text: modelData.text; color: Theme.text; font.pixelSize: 13; Layout.preferredWidth: 170 }
                    ComboBox {
                        Layout.fillWidth: true; textRole: "text"; valueRole: "value"; model: settings.view.looks || []
                        currentIndex: Math.max(0, indexOfValue((settings.view.looksByType || {})[modelData.value] || "stage"))
                        onActivated: desk.prefs.setLookFor(modelData.value, currentValue)
                    }
                    ComboBox {
                        Layout.fillWidth: true; textRole: "text"; valueRole: "value"
                        model: [{value: "", text: "Pack sounds"}].concat((settings.view.soundThemes || []).map(t => ({value: t, text: t})))
                        currentIndex: Math.max(0, indexOfValue((settings.view.soundThemesByType || {})[modelData.value] || ""))
                        onActivated: desk.prefs.setThemeFor(modelData.value, currentValue)
                    }
                }
            }
        }
    }

    // ---- Spotify ----
    Panel {
        Layout.fillWidth: true; implicitHeight: 250
        title: "Spotify (optional)"
        ColumnLayout {
            anchors.fill: parent; spacing: 8
            Text {
                Layout.fillWidth: true; wrapMode: Text.WordWrap; color: Theme.gold; font.pixelSize: 13
                text: "For private quizzes only. Spotify's terms cover personal listening: connecting Spotify gives no right to play music to a pub audience. Use uploaded files and the venue's music licence there. Needs internet on this laptop and Spotify Premium; phones never use Spotify."
            }
            Text {
                visible: !!settings.spotify.locked; Layout.fillWidth: true; wrapMode: Text.WordWrap; color: Theme.muted; font.pixelSize: 13
                text: "Spotify music rounds come with BeerMat Pro (Plan, above)."
            }
            ColumnLayout {
                visible: !settings.spotify.locked && !settings.spotify.error
                Layout.fillWidth: true; spacing: 6
                Text { Layout.fillWidth: true; wrapMode: Text.WordWrap; color: Theme.muted; font.pixelSize: 12
                       text: `One-time setup: create an app at developer.spotify.com/dashboard (tick Web API), add the Redirect URI ${settings.spotify.redirectUri || ""}, and paste its Client ID here. The music plays in the Spotify app on this laptop (Spotify Connect): open it and play any song once so it appears below.` }
                RowLayout {
                    Field { id: clientId; text: settings.spotify.clientId || ""; placeholderText: "Client ID"; Layout.preferredWidth: 320; maximumLength: 32 }
                    DeskButton { text: "Connect Spotify"; implicitHeight: 34; enabled: clientId.text.trim().length > 0; onClicked: desk.prefs.connectSpotify(clientId.text) }
                    DeskButton { text: "Disconnect"; implicitHeight: 34; enabled: !!settings.spotify.connected; onClicked: desk.prefs.disconnectSpotify() }
                    Text { text: settings.spotify.connected ? `✓ Connected${settings.spotify.user ? " as " + settings.spotify.user : ""}` : "Not connected"
                           color: settings.spotify.connected ? Theme.good : Theme.muted; font.pixelSize: 13 }
                }
                RowLayout {
                    visible: !!settings.spotify.connected
                    Label { text: "Play on"; color: Theme.muted }
                    ComboBox {
                        Layout.preferredWidth: 380; textRole: "text"; valueRole: "value"
                        model: [{value: "", text: "Whichever Spotify player is active"}].concat((settings.spotify.devices || []).map(d => ({value: d.id, text: `${d.name} (${d.type})${d.active ? " — active" : ""}`})))
                        currentIndex: Math.max(0, indexOfValue(settings.spotify.device || ""))
                        onActivated: desk.prefs.chooseSpotifyDevice(currentValue)
                    }
                    DeskButton { text: "Refresh players"; implicitHeight: 34; onClicked: desk.prefs.loadSpotify() }
                }
            }
            Text { visible: !!settings.spotify.error; text: settings.spotify.error || ""; color: Theme.bad; font.pixelSize: 13 }
        }
    }

    Panel {
        Layout.fillWidth: true; implicitHeight: 230
        title: "Screens"
        ColumnLayout {
            anchors.fill: parent; spacing: 8
            RowLayout {
                spacing: 10
                Label { text: "TV screen"; color: Theme.muted }
                ComboBox {
                    id: tvScreen
                    Layout.preferredWidth: 380
                    textRole: "text"; valueRole: "value"
                    model: [{text: "Automatic (the screen that isn't the desk's)", value: ""}].concat(screens.displays.map(d => ({text: `${d.label} (${d.width}×${d.height})${d.primary ? " — main screen" : ""}`, value: d.name})))
                    Component.onCompleted: currentIndex = Math.max(0, indexOfValue(screens.chosenName))
                    onActivated: screens.choose(currentValue)
                }
                DeskButton { text: "Swap desk and TV screens"; implicitHeight: 34; enabled: screens.displays.length > 1 && screens.canPlace; onClicked: settings.swapScreens() }
                CheckBox { text: "Open the TV by itself when a screen is connected"; checked: screens.autoOpen; palette.windowText: Theme.text; onToggled: screens.setAutoOpen(checked) }
            }
            RowLayout {
                spacing: 10
                Label { text: "TV sound"; color: Theme.muted }
                ComboBox {
                    Layout.preferredWidth: 380
                    textRole: "name"; valueRole: "id"
                    model: [{id: "auto", name: "Automatic: the TV's own speakers (HDMI) when it's full screen"}, {id: "laptop", name: "This laptop (the system's default output)"}].concat(desk.sound.outputs)
                    currentIndex: Math.max(0, indexOfValue(desk.sound.output))
                    onActivated: desk.sound.chooseOutput(currentValue)
                }
                DeskButton { text: "Test sound"; implicitHeight: 34; onClicked: desk.sound.test() }
                Text { text: `Playing on: ${desk.sound.activeOutput}. Sound effects, music, clips and songs play here while the TV is open.`; color: Theme.faint; font.pixelSize: 12 }
            }
            Text {
                Layout.fillWidth: true; wrapMode: Text.WordWrap; color: Theme.faint; font.pixelSize: 12
                text: (screens.displays.length > 1 ? `${screens.displays.length} screens connected. ` : "One screen: the TV opens in a window you can drag to a projector. ")
                      + (screens.canPlace ? "F7 shows or closes the TV, F8 blanks it." : "This desktop (Wayland) doesn't let apps choose a screen: drag the TV window to the TV and press F11.")
            }
        }
    }

    Panel {
        Layout.fillWidth: true; implicitHeight: 170
        title: "Quizmaster key"
        ColumnLayout {
            anchors.fill: parent; spacing: 8
            Text { Layout.fillWidth: true; wrapMode: Text.WordWrap; color: Theme.muted; font.pixelSize: 14
                   text: "The key opens this quiz's desk in a browser, on this laptop or another device on the quiz network. Keep it to yourself. "
                         + (desk.keyStore === "keychain" ? "It's kept in this computer's keychain." : "It's kept in the data folder, readable only by you (no system keychain was available).") }
            RowLayout {
                spacing: 8
                Field { id: keyField; text: shown.checked ? desk.hostKey : "••••••••••••••••••••••••"; readOnly: true; Layout.preferredWidth: 300; font.family: "monospace" }
                CheckBox { id: shown; text: "Show"; palette.windowText: Theme.muted }
                DeskButton { text: "Copy"; onClicked: { keyField.text = desk.hostKey; keyField.selectAll(); keyField.copy(); keyField.deselect(); keyField.text = Qt.binding(() => shown.checked ? desk.hostKey : "••••••••••••••••••••••••") } }
                DeskButton { text: "Open the desk in a browser"; onClicked: settings.openWebDesk() }
            }
        }
    }

    Panel {
        Layout.fillWidth: true; implicitHeight: 200
        title: "Keyboard shortcuts"
        GridLayout {
            anchors.fill: parent; columns: 4; columnSpacing: 24; rowSpacing: 6
            Repeater {
                model: [["N", "Next (question, round, leaderboard step, finish)"], ["C", "Close answers"], ["P", "Pause / resume the timer"], ["R", "Reveal the answer"],
                        ["Ctrl+O", "Load a quiz file"], ["F7", "Show or close the TV"], ["F8", "Blank the TV"], ["Ctrl+1…6", "Switch workspace"]]
                delegate: RowLayout {
                    required property var modelData
                    Layout.fillWidth: true
                    Rectangle { width: 74; height: 24; radius: 6; color: Theme.panelRaised; border.color: Theme.line
                                Text { anchors.centerIn: parent; text: modelData[0]; color: Theme.text; font.pixelSize: 12; font.weight: Font.Bold } }
                    Text { text: modelData[1]; color: Theme.muted; font.pixelSize: 13; Layout.fillWidth: true; elide: Text.ElideRight }
                }
            }
        }
    }
}
}
