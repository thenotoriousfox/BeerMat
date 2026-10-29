// The venue on BeerMat Online: sign in as the venue's operator, edit the venue and its regular quiz nights, publish or
// cancel quiz nights, register this laptop (its plan and shared results go with the venue), and the subscription.
// Everything goes through the quiz server, which passes on only the calls that run a venue.
import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts
import Desk

RowLayout {
    id: view
    readonly property var online: desk.online
    readonly property var account: online.account
    readonly property var v: online.venue
    property var nights: []
    spacing: Theme.gap
    onVisibleChanged: if (visible) online.load()
    Connections { target: view.online; function onChanged() { view.nights = (view.v.nights || []).map(n => Object.assign({}, n)) } }

    // ---- account ----
    Panel {
        Layout.preferredWidth: 560; Layout.maximumWidth: 560; Layout.fillHeight: true
        title: "BeerMat Online"
        ColumnLayout {
            anchors.fill: parent; spacing: 8
            Text { Layout.fillWidth: true; wrapMode: Text.WordWrap; color: Theme.muted; font.pixelSize: 13
                   text: "Optional, and only for the venue: its page and quiz nights in the app, its plan, and results it shares. Quizzes never need it." }
            ColumnLayout {
                visible: !view.account.signedIn
                Layout.fillWidth: true; spacing: 6
                Field { id: email; Layout.fillWidth: true; placeholderText: "Email" }
                Field { id: password; Layout.fillWidth: true; placeholderText: "Password"; echoMode: TextInput.Password }
                Field { id: name; Layout.fillWidth: true; placeholderText: "Your name (new account only)" }
                RowLayout {
                    DeskButton { text: "Sign in"; kind: "primary"; enabled: email.text && password.text; onClicked: { view.online.signIn(email.text, password.text); password.text = "" } }
                    DeskButton { text: "Create account"; enabled: email.text && password.text; onClicked: { view.online.signUp(email.text, password.text, name.text); password.text = "" } }
                }
            }
            ColumnLayout {
                visible: !!view.account.signedIn
                Layout.fillWidth: true; spacing: 6
                Text { text: `Signed in as ${view.account.name || ""} (${view.account.email || ""})`; color: Theme.text; font.pixelSize: 14; wrapMode: Text.WordWrap; Layout.fillWidth: true }
                ComboBox {
                    visible: view.online.venues.length > 1; Layout.fillWidth: true
                    textRole: "text"; valueRole: "value"
                    model: view.online.venues.map(x => ({value: x.id, text: `${x.name}, ${x.town}`}))
                    currentIndex: Math.max(0, indexOfValue(view.v.id || ""))
                    onActivated: view.online.choose(currentValue)
                }
                Text { visible: !view.v.id; Layout.fillWidth: true; wrapMode: Text.WordWrap; color: Theme.muted; font.pixelSize: 13
                       text: "No venue is linked to this account yet. BeerMat links your account to your venue once it has checked it's yours." }
                DeskButton { text: "Sign out"; onClicked: view.online.signOut() }
            }
            Item { Layout.fillHeight: true }
            // This laptop and the plan
            ColumnLayout {
                visible: !!view.v.id
                Layout.fillWidth: true; spacing: 6
                Text { text: view.v.plan === "pro" ? `BeerMat Pro${view.v.approved ? " · on the map" : " · on the map once BeerMat has checked it"}` : "BeerMat Free: not on the map"
                       color: view.v.plan === "pro" ? Theme.gold : Theme.muted; font.pixelSize: 14; font.weight: Font.Bold; wrapMode: Text.WordWrap; Layout.fillWidth: true }
                Text { text: view.v.registered ? "✓ This laptop is registered: its plan and shared results go with this venue." : "This laptop isn't registered to this venue yet."
                       color: view.v.registered ? Theme.good : Theme.muted; font.pixelSize: 13; wrapMode: Text.WordWrap; Layout.fillWidth: true }
                DeskButton { visible: !view.v.registered; text: "Register this laptop"; kind: "primary"; onClicked: view.online.register() }
                DeskButton { visible: !!view.v.billing || view.v.plan !== "pro"; text: view.v.billing ? "Manage the subscription…" : "Get BeerMat Pro…"; onClicked: view.online.billing() }
            }
        }
    }

    // ---- the venue ----
    Panel {
        Layout.fillWidth: true; Layout.fillHeight: true
        title: view.v.id ? view.v.name || "Venue" : "Venue"
        visible: !!view.v.id
        ScrollView {
            anchors.fill: parent; contentWidth: availableWidth
            ColumnLayout {
                width: parent.width; spacing: 8
                GridLayout {
                    Layout.fillWidth: true; columns: 4; columnSpacing: 10; rowSpacing: 6
                    Label { text: "Name"; color: Theme.muted } Field { id: vName; text: view.v.name || ""; Layout.fillWidth: true }
                    Label { text: "Town"; color: Theme.muted } Field { id: vTown; text: view.v.town || ""; Layout.fillWidth: true }
                    Label { text: "Postcode"; color: Theme.muted } Field { id: vPostcode; text: view.v.postcode || ""; Layout.fillWidth: true }
                    Label { text: "Website"; color: Theme.muted } Field { id: vWebsite; text: view.v.website || ""; Layout.fillWidth: true }
                    Label { text: "Address"; color: Theme.muted } Field { id: vAddress; text: view.v.address || ""; Layout.fillWidth: true; Layout.columnSpan: 3 }
                    Label { text: "Map position"; color: Theme.muted }
                    RowLayout {
                        Layout.columnSpan: 3
                        Field { id: vLat; text: view.v.lat !== undefined && view.v.lat !== null ? String(view.v.lat) : ""; placeholderText: "Latitude"; Layout.preferredWidth: 140 }
                        Field { id: vLon; text: view.v.lon !== undefined && view.v.lon !== null ? String(view.v.lon) : ""; placeholderText: "Longitude"; Layout.preferredWidth: 140 }
                        DeskButton { text: "Find from postcode"; implicitHeight: 34; onClicked: view.online.locate(vPostcode.text) }
                    }
                }
                Text { text: "Regular quiz nights (published four weeks ahead)"; color: Theme.text; font.pixelSize: 15; font.weight: Font.DemiBold; Layout.topMargin: 6 }
                Flow {
                    Layout.fillWidth: true; spacing: 10
                    Repeater {
                        model: view.nights
                        delegate: RowLayout {
                            required property var modelData
                            required property int index
                            CheckBox { text: modelData.day.slice(0, 3); checked: modelData.on; palette.windowText: Theme.text; onToggled: view.nights[index].on = checked }
                            Field { text: modelData.time; enabled: modelData.on; implicitWidth: 80; inputMask: "99:99"; onEditingFinished: view.nights[index].time = text }
                        }
                    }
                }
                DeskButton { text: "Save the venue"; kind: "primary"
                             onClicked: view.online.save({name: vName.text, town: vTown.text, postcode: vPostcode.text, address: vAddress.text, website: vWebsite.text, lat: vLat.text, lon: vLon.text, nights: view.nights}) }

                Text { text: "Quiz nights"; color: Theme.text; font.pixelSize: 15; font.weight: Font.DemiBold; Layout.topMargin: 10 }
                Repeater {
                    model: view.v.events || []
                    delegate: RowLayout {
                        required property var modelData
                        Layout.fillWidth: true
                        Text { text: `${new Date(modelData.startsAt).toLocaleString(Qt.locale(), "ddd d MMM, HH:mm")} — ${modelData.title}${modelData.regular ? " · every week" : ""}${modelData.entry ? " (" + modelData.entry + ")" : ""}`
                               color: Theme.text; font.pixelSize: 13; Layout.fillWidth: true; elide: Text.ElideRight }
                        DeskButton { text: modelData.regular ? "Cancel this week" : "Cancel"; kind: "danger"; implicitHeight: 30; onClicked: view.online.cancel(modelData.id) }
                    }
                }
                Text { visible: !(view.v.events || []).length; text: "No quiz nights published yet."; color: Theme.faint; font.pixelSize: 13 }
                RowLayout {
                    spacing: 6
                    Field { id: eTitle; placeholderText: "Title, e.g. Halloween special"; Layout.fillWidth: true }
                    Field { id: eStart; placeholderText: "YYYY-MM-DD HH:MM"; inputMask: "9999-99-99 99:99"; implicitWidth: 160 }
                    Field { id: eEntry; placeholderText: "Entry, e.g. £2 a head"; implicitWidth: 160 }
                }
                RowLayout {
                    spacing: 6
                    Field { id: eFormat; placeholderText: "Format, e.g. 6 rounds, teams of up to 6"; Layout.fillWidth: true }
                    Field { id: eDetails; placeholderText: "Details"; Layout.fillWidth: true }
                    DeskButton {
                        text: "Publish quiz night"; enabled: eTitle.text.trim() !== ""
                        onClicked: {
                            const at = Date.fromLocaleString(Qt.locale(), eStart.text, "yyyy-MM-dd HH:mm")
                            if (isNaN(at.getTime())) return
                            view.online.publish(eTitle.text, at.getTime(), eEntry.text, eFormat.text, eDetails.text)
                            eTitle.text = ""; eStart.text = ""; eEntry.text = ""; eFormat.text = ""; eDetails.text = ""
                        }
                    }
                }
            }
        }
    }
    Item { visible: !view.v.id; Layout.fillWidth: true }
}
