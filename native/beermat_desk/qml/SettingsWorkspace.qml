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
    // Back from the browser (Spotify's sign-in) or the Spotify app: check again, as the web desk does on focus.
    Connections { target: Qt.application; function onStateChanged() { if (settings.visible && Qt.application.state === Qt.ApplicationActive) desk.prefs.loadSpotify() } }

    FileDialog { id: soundFile; property string slot: ""; title: "Choose a sound (MP3, Ogg or WAV)"; nameFilters: ["Sounds (*.mp3 *.ogg *.wav)"]
                 onAccepted: slot === "buzzer" ? desk.prefs.addBuzzer(buzzerName.text, selectedFile) : desk.prefs.setSound(slot, selectedFile) }
    // ---- the shared buzzer library (BeerMat Online), as the web desk's ----
    FileDialog { id: shareFile; title: "Choose a buzzer clip to share (MP3, Ogg or WAV)"; nameFilters: ["Sounds (*.mp3 *.ogg *.wav)"]
                 onAccepted: if (!shareName.text) shareName.text = String(selectedFile).split("/").pop().replace(/\.[^.]+$/, "").replace(/_+/g, " ").slice(0, 60) }
    Dialog {
        id: libraryDialog
        readonly property var lib: desk.prefs.library
        property string reporting: ""
        parent: Overlay.overlay; anchors.centerIn: parent; modal: true
        width: Math.min(760, parent.width - 80); height: Math.min(720, parent.height - 80)
        title: "Shared buzzer library"
        background: Rectangle { color: Theme.panel; radius: Theme.radius; border.color: Theme.lineStrong }
        header: Text { text: libraryDialog.title; color: Theme.text; font.family: Theme.display; font.pixelSize: 22; font.weight: Font.Bold; padding: 20 }
        footer: RowLayout {
            Item { Layout.fillWidth: true }
            DeskButton { text: "Close"; Layout.margins: 16; onClicked: libraryDialog.close() }
        }
        ColumnLayout {
            anchors.fill: parent; spacing: 10
            Text {
                Layout.fillWidth: true; wrapMode: Text.WordWrap; color: Theme.muted; font.pixelSize: 13
                text: libraryDialog.lib.pro ? "Buzzers other BeerMat venues have shared. Play one, then add it to this laptop’s buzzer sounds. Report anything that shouldn’t be here."
                    : "Buzzers BeerMat venues have shared. Playing, adding and sharing them is part of BeerMat Pro."
            }
            RowLayout {
                Field { id: librarySearch; placeholderText: "Name of a buzzer"; maximumLength: 60; Layout.fillWidth: true; onAccepted: desk.prefs.searchLibrary(text) }
                DeskButton { text: "Search"; implicitHeight: 38; onClicked: desk.prefs.searchLibrary(librarySearch.text) }
            }
            Text { visible: !!libraryDialog.lib.error; text: libraryDialog.lib.error || ""; color: Theme.bad; font.pixelSize: 13; wrapMode: Text.WordWrap; Layout.fillWidth: true }
            ListView {
                Layout.fillWidth: true; Layout.fillHeight: true; clip: true; spacing: 4
                ScrollBar.vertical: ScrollBar {}
                model: libraryDialog.lib.buzzers || []
                delegate: ColumnLayout {
                    required property var modelData
                    width: ListView.view.width; spacing: 4
                    RowLayout {
                        Layout.fillWidth: true
                        Text { text: `${modelData.name} · ${modelData.seconds}s`; color: Theme.text; font.pixelSize: 14; elide: Text.ElideRight; Layout.fillWidth: true }
                        DeskButton { visible: !!libraryDialog.lib.pro; text: "▶ Play"; implicitHeight: 32; onClicked: desk.prefs.playLibraryBuzzer(modelData.id) }
                        DeskButton { visible: !!libraryDialog.lib.pro; text: "Add"; implicitHeight: 32; onClicked: desk.prefs.addLibraryBuzzer(modelData.id) }
                        DeskButton { text: "Report"; implicitHeight: 32; onClicked: libraryDialog.reporting = libraryDialog.reporting === modelData.id ? "" : modelData.id }
                        DeskButton { visible: (libraryDialog.lib.shared || []).includes(modelData.id); text: "Take it out"; kind: "danger"; implicitHeight: 32
                                     onClicked: desk.prefs.removeLibraryBuzzer(modelData.id) }
                    }
                    RowLayout {
                        visible: libraryDialog.reporting === modelData.id; Layout.fillWidth: true
                        Field { id: reason; Layout.fillWidth: true; maximumLength: 300
                                placeholderText: `What’s wrong with “${modelData.name}”? (offensive, copied without permission…)` }
                        DeskButton { text: "Send report"; implicitHeight: 34; enabled: reason.text.trim().length > 0
                                     onClicked: { desk.prefs.reportLibraryBuzzer(modelData.id, reason.text); libraryDialog.reporting = ""; reason.text = "" } }
                    }
                }
                Text { visible: parent.count === 0; anchors.centerIn: parent; color: Theme.muted; font.pixelSize: 13
                       text: libraryDialog.lib.loading ? "Looking…" : libraryDialog.lib.query ? "Nothing matches." : "Nothing shared yet." }
            }
            // Pro: share a clip of this laptop's with other venues (BeerMat Online keeps 10 seconds at most).
            ColumnLayout {
                visible: !!libraryDialog.lib.pro; Layout.fillWidth: true; spacing: 6
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
    }
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
                    DeskButton { text: "Shared buzzer library…"; implicitHeight: 34; onClicked: { libraryDialog.open(); desk.prefs.searchLibrary("") } }
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
    ThemeLibraryDialog { id: themeLibrary }
    Panel {
        Layout.fillWidth: true; implicitHeight: 420
        title: "Looks & sound themes"
        headerExtra: DeskButton { text: "Theme library…"; implicitHeight: 32; onClicked: themeLibrary.open() }
        RowLayout {
            anchors.fill: parent; spacing: 20
            ColumnLayout {
                // A fixed column: its long description would otherwise take the whole width from the format list.
                Layout.preferredWidth: 380; Layout.maximumWidth: 380; Layout.fillWidth: false; Layout.alignment: Qt.AlignTop; spacing: 8
                Text { Layout.fillWidth: true; Layout.maximumWidth: 380; wrapMode: Text.WordWrap; color: Theme.muted; font.pixelSize: 13
                       text: "A look colours the TV and phones; a sound theme sets the moments' sounds. Either can follow the question's format: choose “By format”, then pick for each format on the right." }
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
                Layout.fillWidth: true; Layout.minimumWidth: 520; Layout.fillHeight: true; clip: true; spacing: 2
                ScrollBar.vertical: ScrollBar {}
                header: RowLayout {
                    width: ListView.view.width; spacing: 8
                    Text { text: "Format"; color: Theme.faint; font.pixelSize: 12; Layout.preferredWidth: 170 }
                    Text { text: "Look"; color: Theme.faint; font.pixelSize: 12; Layout.fillWidth: true; Layout.preferredWidth: 1 }
                    Text { text: "Sound theme"; color: Theme.faint; font.pixelSize: 12; Layout.fillWidth: true; Layout.preferredWidth: 1 }
                }
                model: settings.view.formats || []
                delegate: RowLayout {
                    required property var modelData
                    width: ListView.view.width; spacing: 8
                    Text { text: modelData.text; color: Theme.text; font.pixelSize: 13; Layout.preferredWidth: 170 }
                    // Equal columns, under their headings.
                    ComboBox {
                        Layout.fillWidth: true; Layout.preferredWidth: 1; textRole: "text"; valueRole: "value"; model: settings.view.looks || []
                        currentIndex: Math.max(0, indexOfValue((settings.view.looksByType || {})[modelData.value] || "stage"))
                        onActivated: desk.prefs.setLookFor(modelData.value, currentValue)
                    }
                    ComboBox {
                        Layout.fillWidth: true; Layout.preferredWidth: 1; textRole: "text"; valueRole: "value"
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
        // As tall as what it shows (much less while Spotify is locked).
        Layout.fillWidth: true; implicitHeight: spotifyBody.implicitHeight + 72
        title: "Spotify (optional)"
        ColumnLayout {
            id: spotifyBody
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
                visible: !settings.spotify.locked
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
            RowLayout {
                visible: !!settings.spotify.error
                Text { text: settings.spotify.error || ""; color: Theme.bad; font.pixelSize: 13; wrapMode: Text.WordWrap; Layout.fillWidth: true }
                DeskButton { text: "Check again"; implicitHeight: 34; onClicked: desk.prefs.loadSpotify() }
            }
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
                    Layout.preferredWidth: 480
                    textRole: "name"; valueRole: "id"
                    model: [{id: "auto", name: "Automatic: the TV's speakers when it's full screen"}, {id: "laptop", name: "This laptop (the system's default output)"}].concat(desk.sound.outputs)
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
                model: [["N", "Next (question, round, leaderboard step, finish)"], ["⌫ Backspace", "Back one step"], ["C", "Close answers"], ["P", "Pause / resume the timer"],
                        ["R", "Reveal the answer"], ["Ctrl+O", "Load a quiz file"], ["F7", "Show or close the TV"], ["F8", "Blank the TV"], ["Ctrl+1…6", "Switch workspace"]]
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
