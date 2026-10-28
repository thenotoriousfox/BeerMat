// Settings: the plan, the quiz data on this laptop (backup, folders, logs) and the quizmaster key. More settings move
// here from the web desk as they are built natively; until then the web desk (Open the desk in a browser) has them.
import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Dialogs
import QtQuick.Layouts
import Desk

ColumnLayout {
    id: settings
    required property var view
    readonly property var plan: view.plan || {}
    signal openWebDesk()
    spacing: Theme.gap

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
                    DeskButton { text: "Open data folder"; onClicked: Qt.openUrlExternally("file://" + desk.dataFolder) }
                    DeskButton { text: "Open logs"; onClicked: Qt.openUrlExternally("file://" + desk.dataFolder + "/logs") }
                }
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
                CheckBox { text: "Open the TV by itself when a screen is connected"; checked: screens.autoOpen; palette.windowText: Theme.text; onToggled: screens.setAutoOpen(checked) }
            }
            RowLayout {
                spacing: 10
                Label { text: "TV sound"; color: Theme.muted }
                ComboBox {
                    Layout.preferredWidth: 380
                    textRole: "name"; valueRole: "id"
                    model: [{id: "", name: "The system's default output"}].concat(desk.sound.outputs)
                    currentIndex: Math.max(0, indexOfValue(desk.sound.output))
                    onActivated: desk.sound.chooseOutput(currentValue)
                }
                Text { text: "Sound effects, music, clips and songs play here while the TV is open."; color: Theme.faint; font.pixelSize: 12 }
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
                   text: "The key opens this quiz's desk in a browser, on this laptop or another device on the quiz network. Keep it to yourself." }
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
        Layout.fillWidth: true; Layout.fillHeight: true
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
