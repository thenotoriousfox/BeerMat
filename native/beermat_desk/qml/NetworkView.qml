// Venue & network → Network: how phones reach the quiz (the quiz Wi-Fi this laptop hosts, the venue's own network, or the online
// link), the joining code the TV shows, and a connection check. The quiz server and scripts/hotspot.py (Linux) or
// Windows' Mobile Hotspot do the work; this shows their state and sends the quizmaster's choices.
import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts
import Desk

RowLayout {
    id: venue
    readonly property var net: desk.network
    readonly property var laptop: net.laptop || {}
    readonly property var wifi: laptop.wifi || {}
    // Running, with its name known (Windows can report a hotspot that's on before it has one).
    readonly property var running: wifi.running && wifi.running.ssid ? wifi.running : null
    readonly property bool working: !!(laptop.jobs && laptop.jobs.wifi && laptop.jobs.wifi.running)
    spacing: Theme.gap
    onVisibleChanged: if (visible) desk.loadNetwork()

    ColumnLayout {
        Layout.fillWidth: true; Layout.fillHeight: true
        spacing: Theme.gap

        // ---- the quiz Wi-Fi ----
        Panel {
            Layout.fillWidth: true; implicitHeight: 230
            title: "Quiz Wi-Fi"
            headerExtra: Pill {
                text: !wifi.available ? "UNAVAILABLE" : working ? "WORKING…" : running ? `ON · ${running.ssid}` : "OFF"
                tone: running ? Theme.good : working ? Theme.gold : Theme.muted; strong: !!running
            }
            ColumnLayout {
                anchors.fill: parent; spacing: 8
                Text {
                    Layout.fillWidth: true; wrapMode: Text.WordWrap; color: Theme.muted; font.pixelSize: 14
                    text: laptop.unavailable ? "This desk doesn't control the laptop's Wi-Fi (started with --no-laptop, or not Windows or Linux). Use the venue's network below."
                        : !laptop.wifi ? "Checking this laptop's Wi-Fi…"
                        : !wifi.available ? "This laptop can't host a quiz Wi-Fi. Use the venue's network below."
                        : running ? `Phones join “${running.ssid}” and open ${(wifi.address || "10.42.0.1") + (wifi.platform === "windows" ? ":" + (net.port || 3000) : "")}. Hosted on ${running.interface === "bm0" ? "the Wi-Fi card beside your home Wi-Fi" : running.interface}.`
                        : !wifi.wifiOn ? "Wi-Fi is switched off on this laptop."
                        : (wifi.cards || []).length ? "Wi-Fi cards: " + wifi.cards.map(c => `${c.name} (${c.ap ? (c.connected ? "on " + c.network + ", shares it" : c.hosting ? "hosting" : "free") : "can't host"})`).join(" · ")
                        : "No Wi-Fi card found."
                }
                RowLayout {
                    visible: !!wifi.available && !running
                    spacing: 8
                    ComboBox {
                        id: card; Layout.preferredWidth: 260
                        textRole: "text"; valueRole: "value"
                        model: [{text: `Automatic — ${wifi.pick ? wifi.pick.interface + (wifi.pick.keepWifi ? ", beside your home Wi-Fi" : "") : "no card can host"}`, value: "auto"}]
                               .concat((wifi.cards || []).filter(c => c.ap).map(c => ({text: c.name, value: c.name})))
                    }
                    Field { id: ssid; placeholderText: "Wi-Fi name"; text: net.joinSsid || "BeerMat"; maximumLength: 32; Layout.preferredWidth: 180 }
                    Field { id: password; visible: !!wifi.needsPassword; placeholderText: "Password (8–63)"; text: net.joinPassword || ""; Layout.preferredWidth: 180 }
                }
                Item { Layout.fillHeight: true }
                RowLayout {
                    spacing: 8
                    DeskButton { visible: !!wifi.available && !wifi.wifiOn; text: "Switch Wi-Fi on"; onClicked: desk.wifiOn() }
                    DeskButton { visible: !running; text: "Start the quiz Wi-Fi"; kind: "primary"; enabled: !!wifi.available && !!wifi.wifiOn && !!wifi.pick && !working && ssid.text.trim() !== ""
                                 onClicked: desk.startWifi(card.currentValue, ssid.text, password.text) }
                    DeskButton { visible: !!running; text: "Stop the quiz Wi-Fi"; kind: "danger"; enabled: !working; onClicked: desk.stopWifi() }
                    DeskButton { visible: net.joinMode !== "hotspot" || net.online; text: "Players join on the quiz Wi-Fi"; onClicked: desk.useHotspot() }
                    Text { visible: working; text: "Answer the password prompt on this laptop…"; color: Theme.gold; font.pixelSize: 13 }
                }
            }
        }

        // ---- the venue's own network ----
        Panel {
            Layout.fillWidth: true; implicitHeight: 210
            title: "Venue network"
            headerExtra: Pill { visible: net.joinMode === "lan" && !net.online; text: "IN USE"; tone: Theme.good; strong: true }
            ColumnLayout {
                anchors.fill: parent; spacing: 8
                Text { Layout.fillWidth: true; wrapMode: Text.WordWrap; color: Theme.muted; font.pixelSize: 14
                       text: "Phones on the venue's Wi-Fi open this laptop's address there. No quiz Wi-Fi needed, but some guest networks keep devices apart: check below." }
                RowLayout {
                    spacing: 8
                    ComboBox {
                        id: address; Layout.preferredWidth: 360
                        readonly property var usable: (net.addresses || []).filter(a => a.kind !== "hotspot")
                        textRole: "text"; valueRole: "value"
                        model: usable.length ? usable.map(a => ({text: `${a.address} — ${a.name}${a.kind === "virtual" ? " (virtual: phones can't reach it)" : ""}`, value: a.address}))
                                             : [{text: "Not on a network", value: ""}]
                    }
                    Field { id: lanSsid; placeholderText: "Venue Wi-Fi name (for the TV)"; Layout.preferredWidth: 220 }
                }
                Item { Layout.fillHeight: true }
                RowLayout {
                    spacing: 8
                    DeskButton { text: "Use this address"; kind: "primary"; enabled: address.currentValue !== ""; onClicked: desk.useLan(address.currentValue, lanSsid.text) }
                    DeskButton { text: "Check the connection"; onClicked: desk.checkNetwork() }
                }
            }
        }

        // ---- checks ----
        Panel {
            Layout.fillWidth: true; Layout.fillHeight: true
            title: "Connection check"
            ListView {
                anchors.fill: parent; clip: true; spacing: 6
                model: net.checks || []
                delegate: Text {
                    required property var modelData
                    width: ListView.view.width; wrapMode: Text.WordWrap; font.pixelSize: 13
                    text: `${modelData.status === "ok" ? "✓" : modelData.status === "warn" ? "⚠" : "ℹ"}  ${modelData.text}`
                    color: modelData.status === "ok" ? Theme.good : modelData.status === "warn" ? Theme.gold : Theme.muted
                }
                Text { visible: parent.count === 0; width: parent.width; wrapMode: Text.WordWrap; color: Theme.faint; font.pixelSize: 13
                       text: "Checks whether phones on the venue network can reach this laptop: its addresses, the firewall, and what to try if they can't." }
            }
        }
    }

    ColumnLayout {
        Layout.preferredWidth: 380; Layout.maximumWidth: 380; Layout.fillHeight: true
        spacing: Theme.gap

        // ---- what the TV shows phones ----
        Panel {
            Layout.fillWidth: true; implicitHeight: 470
            title: "Joining code"
            ColumnLayout {
                anchors.fill: parent; spacing: 10
                Rectangle {
                    Layout.alignment: Qt.AlignHCenter; width: 260; height: 260; radius: 16; color: "white"
                    QrCode { anchors.fill: parent; anchors.margins: 14; text: net.joinUrl || "" }
                }
                Text { Layout.fillWidth: true; horizontalAlignment: Text.AlignHCenter; color: Theme.text; font.pixelSize: 18; font.weight: Font.Bold
                       text: (net.joinUrl || "").replace(/^https?:\/\//, "") }
                Text {
                    Layout.fillWidth: true; horizontalAlignment: Text.AlignHCenter; wrapMode: Text.WordWrap; color: Theme.muted; font.pixelSize: 13
                    text: net.online ? "Online link: phones need internet, not the quiz Wi-Fi."
                        : net.joinMode === "lan" ? `On the venue network${net.joinSsid ? " “" + net.joinSsid + "”" : ""}.`
                        : `On the quiz Wi-Fi “${net.joinSsid}”${net.joinPassword ? " (password " + net.joinPassword + ")" : ""}.`
                }
                Item { Layout.fillHeight: true }
                Text { Layout.fillWidth: true; wrapMode: Text.WordWrap; color: Theme.faint; font.pixelSize: 12
                       text: "The same code is on the TV's join screen. Phones never need an app: the browser plays every round." }
            }
        }

        // ---- online link ----
        Panel {
            Layout.fillWidth: true; Layout.fillHeight: true
            title: "Online link"
            headerExtra: Pill { text: laptop.online ? "ON" : "OFF"; tone: laptop.online ? Theme.good : Theme.muted; strong: !!laptop.online }
            ColumnLayout {
                anchors.fill: parent; spacing: 8
                Text {
                    Layout.fillWidth: true; wrapMode: Text.WordWrap; color: Theme.muted; font.pixelSize: 13
                    text: !laptop.cloudflared ? "Playing over the internet needs cloudflared installed on this laptop, and internet access."
                        : laptop.onlineError ? laptop.onlineError
                        : laptop.online ? laptop.online.ready ? `Teams anywhere join at ${laptop.online.url}.` : "Starting the online link…" : "A public link for teams who aren't in the room (needs internet on this laptop)."
                }
                Item { Layout.fillHeight: true }
                DeskButton { text: laptop.online ? "Stop the online link" : "Start the online link"; enabled: !!laptop.cloudflared; onClicked: desk.setOnline(!laptop.online) }
            }
        }
    }
}
