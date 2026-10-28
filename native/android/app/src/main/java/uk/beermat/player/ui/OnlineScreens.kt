package uk.beermat.player.ui

import android.Manifest
import android.content.Intent
import android.location.LocationManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import kotlinx.coroutines.launch
import org.json.JSONObject
import org.osmdroid.config.Configuration
import org.osmdroid.tileprovider.tilesource.TileSourceFactory
import org.osmdroid.util.GeoPoint
import org.osmdroid.views.MapView
import org.osmdroid.views.overlay.Marker
import uk.beermat.player.BuildConfig
import uk.beermat.player.online.OnlineState
import uk.beermat.player.online.OnlineViewModel
import uk.beermat.player.online.Reminders
import java.text.DateFormat
import java.util.Date

private val DAYS = listOf("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")

@Composable
private fun OnlineMessage(ui: OnlineState) {
    if (ui.message.isNotEmpty()) Text(ui.message, color = if (ui.error) Brand.bad else Brand.goldHi, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(vertical = 8.dp))
}

private fun date(at: Long) = DateFormat.getDateTimeInstance(DateFormat.FULL, DateFormat.SHORT).format(Date(at))

// ---- Profile ----
@Composable
fun ProfileScreen(vm: OnlineViewModel, ui: OnlineState) {
    val me = ui.profile
    var email by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    var name by rememberSaveable { mutableStateOf("") }
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var confirmDelete by rememberSaveable { mutableStateOf(false) }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp)) {
        Text("Profile", style = MaterialTheme.typography.displaySmall)
        Text("Optional: keep your team's results, see your statistics and badges. Playing never needs an account.", color = Brand.muted, modifier = Modifier.padding(vertical = 8.dp))
        if (me == null) {
            OutlinedTextField(email, { email = it.trim() }, label = { Text("Email") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                modifier = Modifier.fillMaxWidth().testTag("email"))
            OutlinedTextField(password, { password = it }, label = { Text("Password") }, singleLine = true, visualTransformation = PasswordVisualTransformation(),
                modifier = Modifier.fillMaxWidth().testTag("password"))
            OutlinedTextField(name, { name = it }, label = { Text("Your name (new account only)") }, singleLine = true, modifier = Modifier.fillMaxWidth().testTag("displayName"))
            Spacer(Modifier.height(12.dp))
            BigButton("Sign in", enabled = email.isNotEmpty() && password.isNotEmpty() && !ui.busy) { vm.signIn(email, password); password = "" }
            OutlinedButton({ vm.signUp(email, password, name); password = "" }, enabled = email.isNotEmpty() && password.isNotEmpty() && name.isNotBlank() && !ui.busy,
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) { Text("Create account") }
            if (vm.client.resetUrl.isNotEmpty()) TextButton({ openInBrowser(context, vm.client.resetUrl) }) { Text("Forgotten your password?") }
            if (ui.outbox > 0) Text("${ui.outbox} result${if (ui.outbox == 1) "" else "s"} kept on this phone: sign in to add them.", color = Brand.goldHi)
        } else {
            Text("Signed in as ${me.optString("displayName")} (${me.optString("email")})", fontWeight = FontWeight.Bold)
            if (!me.optBoolean("emailVerified")) Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Confirm your email to count results.", color = Brand.goldHi, modifier = Modifier.weight(1f))
                TextButton(vm::resendVerify) { Text("Send again") }
            }
            if (ui.outbox > 0) Text("${ui.outbox} result${if (ui.outbox == 1) " is" else "s are"} waiting to be sent.", color = Brand.goldHi)
            Stats(vm, ui)
            Text("Privacy", style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(top = 20.dp))
            val privacy = me.optJSONObject("privacy") ?: JSONObject()
            for ((key, label) in listOf("leaderboards" to "Show me on leaderboards", "photo" to "Show my photo", "history" to "Show my quiz history")) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(label, modifier = Modifier.weight(1f)); Switch(privacy.optBoolean(key), { vm.privacy(key, it) })
                }
            }
            OutlinedButton({ scope.launch {
                val json = runCatching { vm.exportData() }.getOrNull() ?: return@launch vm.say("Couldn't fetch your data", true)
                context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("application/json").putExtra(Intent.EXTRA_TEXT, json), "Your BeerMat data"))
            } }, modifier = Modifier.fillMaxWidth().padding(top = 16.dp)) { Text("Download my data") }
            OutlinedButton(vm::signOut, modifier = Modifier.fillMaxWidth()) { Text("Sign out") }
            if (!confirmDelete) TextButton({ confirmDelete = true }) { Text("Delete my account", color = Brand.bad) }
            else Row { Text("Delete everything, for good?", color = Brand.bad, modifier = Modifier.weight(1f)); TextButton({ confirmDelete = false; vm.deleteAccount() }) { Text("Delete", color = Brand.bad) } }
        }
        OnlineMessage(ui)
        Advanced(vm, ui)
    }
}

@Composable
private fun Stats(vm: OnlineViewModel, ui: OnlineState) {
    val s = ui.stats ?: return
    val st = s.optJSONObject("stats") ?: JSONObject()
    Text("Your statistics", style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(top = 20.dp))
    if (s.optBoolean("stale")) Text("Offline: these are your statistics as last seen.", color = Brand.faint)
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(vertical = 8.dp)) {
        for ((label, value) in listOf("Quizzes" to st.optInt("quizzes"), "Wins" to st.optInt("wins"), "Podiums" to st.optInt("podiums"), "Correct" to st.optInt("correct"))) {
            Column(Modifier.weight(1f).clip(RoundedCornerShape(12.dp)).background(Brand.panel).padding(10.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Text("$value", fontFamily = Display, fontSize = 24.sp, fontWeight = FontWeight.Bold, color = Brand.goldHi); Text(label, color = Brand.muted, fontSize = 12.sp)
            }
        }
    }
    val earned = s.optJSONArray("achievements")?.let { a -> (0 until a.length()).associate { a.getJSONObject(it).getString("id") to a.getJSONObject(it).optLong("earnedAt") } } ?: emptyMap()
    Text("Badges", style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(top = 8.dp))
    for (b in vm.badges) Text("${if (b.id in earned) "🏅" else "🔒"} ${b.name} — ${b.description}", color = if (b.id in earned) Brand.text else Brand.faint, modifier = Modifier.padding(vertical = 2.dp))
    if (s.optInt("waiting") > 0) Text("${s.optInt("waiting")} result(s) are from a venue that hasn't registered its quiz laptop yet, so they don't count yet.", color = Brand.faint, fontSize = 12.sp)
}

@Composable
private fun Advanced(vm: OnlineViewModel, ui: OnlineState) {
    var open by rememberSaveable { mutableStateOf(false) }
    var address by rememberSaveable { mutableStateOf(ui.service) }
    TextButton({ open = !open }, modifier = Modifier.padding(top = 16.dp)) { Text(if (open) "Hide advanced" else "Advanced") }
    if (open) {
        OutlinedTextField(address, { address = it }, label = { Text("BeerMat Online address") }, singleLine = true, modifier = Modifier.fillMaxWidth().testTag("service"))
        OutlinedButton({ vm.setService(address); vm.say("Saved") }, modifier = Modifier.fillMaxWidth()) { Text("Use this address") }
        Text("Default: ${BuildConfig.ONLINE_SERVICE}", color = Brand.faint, fontSize = 12.sp)
    }
}

// ---- Find a quiz ----
@Composable
fun FindScreen(vm: OnlineViewModel, ui: OnlineState) {
    var q by rememberSaveable { mutableStateOf("") }
    val context = LocalContext.current
    // Location is asked for only when the player taps the button, once; only the position rounded to ~100 m is sent.
    val locate = { ->
        val lm = context.getSystemService(LocationManager::class.java)
        val fix = runCatching { lm.getLastKnownLocation(LocationManager.NETWORK_PROVIDER) ?: lm.getLastKnownLocation(LocationManager.GPS_PROVIDER) }.getOrNull()
        if (fix != null) vm.near(fix.latitude, fix.longitude) else vm.say("This phone doesn't know where it is yet. Search by town instead.", true)
    }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok -> if (ok) locate() else vm.say("Search by town or postcode instead.") }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp)) {
        Text("Find a quiz", style = MaterialTheme.typography.displaySmall)
        OutlinedTextField(q, { q = it }, label = { Text("Town or postcode") }, singleLine = true, modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp).testTag("search"))
        BigButton("Search", enabled = q.isNotBlank() && !ui.busy) { vm.search(q) }
        OutlinedButton({ permission.launch(Manifest.permission.ACCESS_COARSE_LOCATION) }, modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) { Text("Quizzes near me") }
        OnlineMessage(ui)
        ui.eventsStale?.let { Text("Offline: these are the results from ${date(it)}; they may be out of date.", color = Brand.faint) }
        if (ui.searched && ui.events.isEmpty()) Text("No quiz nights found there yet.", color = Brand.muted, modifier = Modifier.padding(top = 12.dp))
        ui.events.forEach { EventCard(vm, it) }
        if (ui.favourites.isNotEmpty()) {
            Text("Your venues", style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(top = 20.dp))
            ui.venues.filter { it.optString("id") in ui.favourites }.forEach { v ->
                Text("★ ${v.optString("name")}, ${v.optString("town")}", modifier = Modifier.fillMaxWidth().clickable { vm.openVenue(v.optString("id")) }.padding(vertical = 8.dp))
            }
        }
    }
    LaunchedEffect(Unit) { if (ui.venues.isEmpty()) vm.loadVenues() }
}

@Composable
fun EventCard(vm: OnlineViewModel, e: JSONObject) {
    val context = LocalContext.current
    val v = e.getJSONObject("venue")
    val notify = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        if (ok && Reminders.schedule(context, e.optString("id"), e.optString("title"), v.optString("name"), e.optLong("startsAt"))) vm.say("We'll remind you two hours before")
        else if (!ok) vm.say("Notifications are off: add it to your calendar instead.")
    }
    Column(Modifier.fillMaxWidth().padding(vertical = 6.dp).clip(RoundedCornerShape(14.dp)).background(Brand.panel).padding(16.dp)) {
        Text(e.optString("title"), fontWeight = FontWeight.Bold, fontSize = 17.sp)
        Text("${v.optString("name")}, ${v.optString("town")}" + (if (e.has("distanceKm")) " · ${e.optDouble("distanceKm")} km" else ""), color = Brand.muted,
            modifier = Modifier.clickable { vm.openVenue(v.optString("id")) })
        Text(date(e.optLong("startsAt")) + (if (e.optString("entry").isNotEmpty()) " · ${e.optString("entry")}" else ""), color = Brand.goldHi)
        if (e.optString("format").isNotEmpty()) Text(e.optString("format"), color = Brand.faint, fontSize = 13.sp)
        Row {
            TextButton({ if (Reminders.canNotify(context)) { if (Reminders.schedule(context, e.optString("id"), e.optString("title"), v.optString("name"), e.optLong("startsAt"))) vm.say("We'll remind you two hours before") else vm.say("It starts within two hours!") }
                         else notify.launch(Manifest.permission.POST_NOTIFICATIONS) }) { Text("⏰ Remind me") }
            TextButton({ context.startActivity(Reminders.calendarIntent(e.optString("title"), v.optString("name"), listOf(v.optString("address"), v.optString("town")).filter { it.isNotEmpty() }.joinToString(", "), e.optLong("startsAt"))) }) { Text("📅 Calendar") }
            TextButton({ openInBrowser(context, v.optString("directions")) }) { Text("Directions") }
        }
    }
}

// ---- Map ----
@Composable
fun MapScreen(vm: OnlineViewModel, ui: OnlineState) {
    var day by rememberSaveable { mutableStateOf("") }
    LaunchedEffect(Unit) { if (ui.venues.isEmpty()) vm.loadVenues() }
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(8.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            (listOf("" to "All") + DAYS.map { it to it.take(3).replaceFirstChar(Char::uppercase) }).forEach { (value, label) ->
                Text(label, fontWeight = FontWeight.Bold, fontSize = 13.sp, color = if (day == value) Brand.onAccent else Brand.text,
                    modifier = Modifier.clip(RoundedCornerShape(50)).background(if (day == value) Brand.gold else Brand.panel).clickable { day = value }.padding(horizontal = 10.dp, vertical = 6.dp))
            }
        }
        if (ui.venuesNote.isNotEmpty()) Text(ui.venuesNote, color = Brand.faint, modifier = Modifier.padding(horizontal = 12.dp))
        val shown = ui.venues.filter { !it.isNull("lat") && (day.isEmpty() || (it.optJSONArray("quizNights")?.let { n -> (0 until n.length()).any { i -> n.getJSONObject(i).optString("day") == day } } == true)) }
        Box(Modifier.fillMaxSize()) {
            // OpenStreetMap's tiles, loaded only while the map is open; the map never sends the player's location anywhere.
            AndroidView(factory = { ctx ->
                Configuration.getInstance().userAgentValue = "BeerMat/${BuildConfig.VERSION_NAME} (Android)"
                MapView(ctx).apply { setTileSource(TileSourceFactory.MAPNIK); setMultiTouchControls(true); controller.setZoom(6.0); controller.setCenter(GeoPoint(54.0, -2.5)) }
            }, update = { map ->
                map.overlays.clear()
                shown.forEach { v ->
                    map.overlays.add(Marker(map).apply {
                        position = GeoPoint(v.optDouble("lat"), v.optDouble("lon")); title = v.optString("name")
                        subDescription = v.optJSONObject("next")?.let { "Next: ${it.optString("title")}, ${date(it.optLong("startsAt"))}" } ?: v.optString("town")
                        setOnMarkerClickListener { _, _ -> vm.openVenue(v.optString("id")); true }
                    })
                }
                map.invalidate()
            }, modifier = Modifier.fillMaxSize().testTag("map"))
        }
    }
}

// ---- A venue's page ----
@Composable
fun VenueSheet(vm: OnlineViewModel, ui: OnlineState) {
    val v = ui.venue ?: return
    val context = LocalContext.current
    val id = v.optString("id")
    Box(Modifier.fillMaxSize().background(androidx.compose.ui.graphics.Color(0xCC000000)).clickable { vm.openVenue(null) }, contentAlignment = Alignment.BottomCenter) {
        Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp)).background(Brand.panel).clickable(enabled = false) {}
            .verticalScroll(rememberScrollState()).padding(24.dp)) {
            Text(v.optString("name"), style = MaterialTheme.typography.headlineMedium)
            Text(listOf(v.optString("address"), v.optString("town"), v.optString("postcode")).filter { it.isNotEmpty() }.joinToString(", "), color = Brand.muted)
            v.optJSONArray("quizNights")?.let { n -> if (n.length() > 0) Text("Quiz nights: " + (0 until n.length()).joinToString(", ") { i -> n.getJSONObject(i).let { "${it.optString("day").replaceFirstChar(Char::uppercase)} ${it.optString("time")}" } }, color = Brand.goldHi, modifier = Modifier.padding(top = 8.dp)) }
            Row {
                TextButton({ vm.favourite(id, id !in ui.favourites) }) { Text(if (id in ui.favourites) "★ Saved" else "☆ Save venue") }
                TextButton({ openInBrowser(context, v.optString("directions")) }) { Text("Directions") }
                if (v.optString("website").startsWith("https://")) TextButton({ openInBrowser(context, v.optString("website")) }) { Text("Website") }
            }
            val upcoming = v.optJSONArray("upcoming")
            if (upcoming != null && upcoming.length() > 0) for (i in 0 until upcoming.length()) EventCard(vm, upcoming.getJSONObject(i))
            else Text("No quiz nights published yet.", color = Brand.faint)
            TextButton({ vm.openVenue(null) }, modifier = Modifier.fillMaxWidth()) { Text("Close") }
        }
    }
}
