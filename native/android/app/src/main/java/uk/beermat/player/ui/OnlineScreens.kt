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
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
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
    if (ui.message.isNotEmpty()) Text(t(ui.message), color = if (ui.error) Brand.bad else Brand.goldHi, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(vertical = 8.dp))
}

private fun date(at: Long) = DateFormat.getDateTimeInstance(DateFormat.FULL, DateFormat.SHORT).format(Date(at))

// ---- Profile ----
@Composable
fun ProfileScreen(vm: OnlineViewModel, ui: OnlineState, runTheNight: (() -> Unit)? = null) {
    val me = ui.profile
    var email by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    var name by rememberSaveable { mutableStateOf("") }
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var confirmDelete by rememberSaveable { mutableStateOf(false) }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp)) {
        Text(t("Profile"), style = MaterialTheme.typography.displaySmall)
        Text(t("Optional: keep your team’s results, see your statistics and badges. Playing never needs an account."), color = Brand.muted, modifier = Modifier.padding(vertical = 8.dp))
        if (me == null) {
            OutlinedTextField(email, { email = it.trim() }, label = { Text(t("Email")) }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                modifier = Modifier.fillMaxWidth().testTag("email"))
            OutlinedTextField(password, { password = it }, label = { Text(t("Password")) }, singleLine = true, visualTransformation = PasswordVisualTransformation(),
                modifier = Modifier.fillMaxWidth().testTag("password"))
            OutlinedTextField(name, { name = it }, label = { Text(t("Your name (new account only)")) }, singleLine = true, modifier = Modifier.fillMaxWidth().testTag("displayName"))
            Spacer(Modifier.height(12.dp))
            BigButton(t("Sign in"), enabled = email.isNotEmpty() && password.isNotEmpty() && !ui.busy) { vm.signIn(email, password); password = "" }
            OutlinedButton({ vm.signUp(email, password, name); password = "" }, enabled = email.isNotEmpty() && password.isNotEmpty() && name.isNotBlank() && !ui.busy,
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) { Text(t("Create account")) }
            if (vm.client.resetUrl.isNotEmpty()) TextButton({ openInBrowser(context, vm.client.resetUrl) }) { Text(t("Forgotten your password?")) }
            if (ui.outbox > 0) Text(t("{n} result(s) kept on this phone: sign in to add them.", "n" to ui.outbox), color = Brand.goldHi)
        } else {
            Text(t("Signed in as {name} ({email})", "name" to me.optString("displayName"), "email" to me.optString("email")), fontWeight = FontWeight.Bold)
            if (!me.optBoolean("emailVerified")) Row(verticalAlignment = Alignment.CenterVertically) {
                Text(t("Confirm your email to count results."), color = Brand.goldHi, modifier = Modifier.weight(1f))
                TextButton(vm::resendVerify) { Text(t("Send again")) }
            }
            if (ui.outbox > 0) Text(t("{n} result(s) waiting to be sent.", "n" to ui.outbox), color = Brand.goldHi)
            Stats(vm, ui)
            Text(t("Privacy"), style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(top = 20.dp))
            val privacy = me.optJSONObject("privacy") ?: JSONObject()
            for ((key, label) in listOf("leaderboards" to t("Show me on leaderboards"), "photo" to t("Show my photo"), "history" to t("Show my quiz history"))) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(label, modifier = Modifier.weight(1f)); Switch(privacy.optBoolean(key), { vm.privacy(key, it) })
                }
            }
            OutlinedButton({ scope.launch {
                val json = runCatching { vm.exportData() }.getOrNull() ?: return@launch vm.say(t("Couldn’t fetch your data"), true)
                context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("application/json").putExtra(Intent.EXTRA_TEXT, json), t("Your BeerMat data")))
            } }, modifier = Modifier.fillMaxWidth().padding(top = 16.dp)) { Text(t("Download my data")) }
            OutlinedButton(vm::signOut, modifier = Modifier.fillMaxWidth()) { Text(t("Sign out")) }
            if (!confirmDelete) TextButton({ confirmDelete = true }) { Text(t("Delete my account"), color = Brand.bad) }
            else Row { Text(t("Delete everything, for good?"), color = Brand.bad, modifier = Modifier.weight(1f)); TextButton({ confirmDelete = false; vm.deleteAccount() }) { Text(t("Delete"), color = Brand.bad) } }
        }
        OnlineMessage(ui)
        // The quizmaster's own phone: hosting needs the venue's account, or a code from the desk.
        if (runTheNight != null && !ui.hosts) TextButton(runTheNight, modifier = Modifier.padding(top = 12.dp).testTag("runTheNight")) { Text(t("Quizmaster? Run the night from this phone")) }
    }
}

@Composable
private fun Stats(vm: OnlineViewModel, ui: OnlineState) {
    val s = ui.stats ?: return
    val st = s.optJSONObject("stats") ?: JSONObject()
    Text(t("Your statistics"), style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(top = 20.dp))
    if (s.optBoolean("stale")) Text(t("Offline: these are your statistics as last seen."), color = Brand.faint)
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(vertical = 8.dp)) {
        for ((label, value) in listOf(t("Quizzes") to st.optInt("quizzes"), t("Wins") to st.optInt("wins"), t("Podiums") to st.optInt("podiums"), t("Correct") to st.optInt("correct"))) {
            Column(Modifier.weight(1f).clip(RoundedCornerShape(12.dp)).background(Brand.panel).padding(10.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Text("$value", fontFamily = Display, fontSize = 24.sp, fontWeight = FontWeight.Bold, color = Brand.goldHi); Text(label, color = Brand.muted, fontSize = 12.sp)
            }
        }
    }
    val earned = s.optJSONArray("achievements")?.let { a -> (0 until a.length()).associate { a.getJSONObject(it).getString("id") to a.getJSONObject(it).optLong("earnedAt") } } ?: emptyMap()
    Text(t("Badges"), style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(top = 8.dp))
    for (b in vm.badges) Text("${if (b.id in earned) "🏅" else "🔒"} ${b.name} — ${b.description}", color = if (b.id in earned) Brand.text else Brand.faint, modifier = Modifier.padding(vertical = 2.dp))
    if (s.optInt("waiting") > 0) Text(t("{n} result(s) are from a venue that hasn’t registered its quiz laptop yet, so they don’t count yet.", "n" to s.optInt("waiting")), color = Brand.faint, fontSize = 12.sp)
}

// ---- Find a quiz ----
@Composable
fun FindScreen(vm: OnlineViewModel, ui: OnlineState) {
    var q by rememberSaveable { mutableStateOf("") }
    val context = LocalContext.current
    // Location is asked for only when the player taps the button, once; only the position rounded to ~100 m is sent.
    val locate = { ->
        vm.say(t("Finding where you are…"))
        currentFix(context) { fix ->
            if (fix != null) vm.near(fix.latitude, fix.longitude) else vm.say(t("This phone doesn’t know where it is yet. Search by town instead."), true)
        }
    }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { granted -> if (granted.values.any { it }) locate() else vm.say(t("Search by town or postcode instead.")) }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp)) {
        Text(t("Find a quiz"), style = MaterialTheme.typography.displaySmall)
        OutlinedTextField(q, { q = it }, label = { Text(t("Town or postcode")) }, singleLine = true, modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp).testTag("search"))
        BigButton(t("Search"), enabled = q.isNotBlank() && !ui.busy) { vm.search(q) }
        OutlinedButton({ if (precise(context)) locate() else permission.launch(LOCATION) }, modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) { Text(t("Quizzes near me")) }
        OnlineMessage(ui)
        ui.eventsStale?.let { Text(t("Offline: these are the results from {date}; they may be out of date.", "date" to date(it)), color = Brand.faint) }
        if (ui.searched && ui.events.isEmpty()) Text(t("No quiz nights found there yet."), color = Brand.muted, modifier = Modifier.padding(top = 12.dp))
        ui.events.forEach { EventCard(vm, it) }
        if (ui.favourites.isNotEmpty()) {
            Text(t("Your venues"), style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(top = 20.dp))
            ui.venues.filter { it.optString("id") in ui.favourites }.forEach { v ->
                Text("★ ${v.optString("name")}, ${v.optString("town")}", modifier = Modifier.fillMaxWidth().clickable { vm.openVenue(v.optString("id")) }.padding(vertical = 8.dp))
            }
        }
    }
    LaunchedEffect(Unit) { if (ui.venues.isEmpty()) vm.loadVenues() }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun EventCard(vm: OnlineViewModel, e: JSONObject) {
    val context = LocalContext.current
    val v = e.getJSONObject("venue")
    val notify = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        if (ok && Reminders.schedule(context, e.optString("id"), e.optString("title"), v.optString("name"), e.optLong("startsAt"))) vm.say(t("We’ll remind you two hours before"))
        else if (!ok) vm.say(t("Notifications are off: add it to your calendar instead."))
    }
    Column(Modifier.fillMaxWidth().padding(vertical = 6.dp).clip(RoundedCornerShape(14.dp)).background(Brand.panel).padding(16.dp)) {
        Text(e.optString("title"), fontWeight = FontWeight.Bold, fontSize = 17.sp)
        Text("${v.optString("name")}, ${v.optString("town")}" + (if (e.has("distanceKm")) " · ${e.optDouble("distanceKm")} km" else ""), color = Brand.muted,
            modifier = Modifier.clickable { vm.openVenue(v.optString("id")) })
        Text(date(e.optLong("startsAt")) + (if (e.optString("entry").isNotEmpty()) " · ${e.optString("entry")}" else ""), color = Brand.goldHi)
        if (e.optString("format").isNotEmpty()) Text(e.optString("format"), color = Brand.faint, fontSize = 13.sp)
        // Wraps onto a second line on a narrow phone, rather than squeezing the last button.
        FlowRow {
            TextButton({ if (Reminders.canNotify(context)) { if (Reminders.schedule(context, e.optString("id"), e.optString("title"), v.optString("name"), e.optLong("startsAt"))) vm.say(t("We’ll remind you two hours before")) else vm.say(t("It starts within two hours!")) }
                         else notify.launch(Manifest.permission.POST_NOTIFICATIONS) }) { Text(t("⏰ Remind me")) }
            TextButton({ context.startActivity(Reminders.calendarIntent(e.optString("title"), v.optString("name"), listOf(v.optString("address"), v.optString("town")).filter { it.isNotEmpty() }.joinToString(", "), e.optLong("startsAt"))) }) { Text(t("📅 Calendar")) }
            TextButton({ openInBrowser(context, v.optString("directions")) }) { Text(t("Directions")) }
        }
    }
}

// Precise location is asked for with approximate (Android lets the player choose either).
private val LOCATION = arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)

private fun granted(context: android.content.Context, permission: String) =
    androidx.core.content.ContextCompat.checkSelfPermission(context, permission) == android.content.pm.PackageManager.PERMISSION_GRANTED

// Asked again until it's precise (Android offers the upgrade from approximate); the player can keep approximate.
private fun precise(context: android.content.Context) = granted(context, Manifest.permission.ACCESS_FINE_LOCATION)

/** The phone's newest stored position (network, GPS or fused), without waiting for a new one: it can be old, and a
 *  phone mast's position miles out, so only good for a first guess. */
@android.annotation.SuppressLint("MissingPermission")
private fun lastFix(context: android.content.Context): android.location.Location? {
    val lm = context.getSystemService(LocationManager::class.java)
    return listOf(LocationManager.NETWORK_PROVIDER, LocationManager.GPS_PROVIDER, "fused")
        .mapNotNull { runCatching { lm.getLastKnownLocation(it) }.getOrNull() }.maxByOrNull { it.time }
}

/** Where the phone is now: a fresh fix from the best source it may use (fused at high accuracy, else GPS with precise
 *  location, else the network), then done(fix) on the main thread; the stored one if no fresh fix comes within 20 s.
 *  High accuracy matters: the balanced default answers from phone masts and Wi-Fi, which can be miles out. */
@android.annotation.SuppressLint("MissingPermission")
private fun currentFix(context: android.content.Context, done: (android.location.Location?) -> Unit) {
    val lm = context.getSystemService(LocationManager::class.java)
    val precise = precise(context)
    val provider = listOfNotNull(
        if (android.os.Build.VERSION.SDK_INT >= 31) LocationManager.FUSED_PROVIDER else null,
        if (precise) LocationManager.GPS_PROVIDER else null,
        LocationManager.NETWORK_PROVIDER,
    ).firstOrNull { runCatching { lm.isProviderEnabled(it) }.getOrDefault(false) }
        ?: return done(lastFix(context))
    val main = android.os.Handler(android.os.Looper.getMainLooper())
    var answered = false
    val answer = { fix: android.location.Location? -> if (!answered) { answered = true; done(fix ?: lastFix(context)) } }
    val cancel = android.os.CancellationSignal()
    main.postDelayed({ cancel.cancel(); answer(null) }, 20_000)
    runCatching {
        if (android.os.Build.VERSION.SDK_INT >= 31) {
            val request = android.location.LocationRequest.Builder(0).setDurationMillis(20_000)
                .setQuality(if (precise) android.location.LocationRequest.QUALITY_HIGH_ACCURACY else android.location.LocationRequest.QUALITY_BALANCED_POWER_ACCURACY).build()
            lm.getCurrentLocation(provider, request, cancel, context.mainExecutor) { main.post { answer(it) } }
        } else if (android.os.Build.VERSION.SDK_INT >= 30) lm.getCurrentLocation(provider, cancel, context.mainExecutor) { main.post { answer(it) } }
        else @Suppress("DEPRECATION") lm.requestSingleUpdate(provider, { fix: android.location.Location -> answer(fix) }, android.os.Looper.getMainLooper())
    }.onFailure { answer(null) }
}

// ---- Map ----
@Composable
fun MapScreen(vm: OnlineViewModel, ui: OnlineState) {
    var day by rememberSaveable { mutableStateOf("") }
    LaunchedEffect(Unit) { if (ui.venues.isEmpty()) vm.loadVenues() }
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(8.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            (listOf("" to t("All")) + DAYS.map { it to it.take(3).replaceFirstChar(Char::uppercase) }).forEach { (value, label) ->
                Text(label, fontWeight = FontWeight.Bold, fontSize = 13.sp, color = if (day == value) Brand.onAccent else Brand.text,
                    modifier = Modifier.clip(RoundedCornerShape(50)).background(if (day == value) Brand.gold else Brand.panel).clickable { day = value }.padding(horizontal = 10.dp, vertical = 6.dp))
            }
        }
        if (ui.venuesNote.isNotEmpty()) Text(ui.venuesNote, color = Brand.faint, modifier = Modifier.padding(horizontal = 12.dp))
        val shown = ui.venues.filter { !it.isNull("lat") && (day.isEmpty() || (it.optJSONArray("quizNights")?.let { n -> (0 until n.length()).any { i -> n.getJSONObject(i).optString("day") == day } } == true)) }
        val context = LocalContext.current
        var map by remember { mutableStateOf<MapView?>(null) }
        var me by remember { mutableStateOf<GeoPoint?>(null) }
        // The pin tapped: a small popup with the venue and its next quiz (the map's own venue data, nothing to fetch).
        var picked by remember { mutableStateOf<JSONObject?>(null) }
        // My location: asked for only when the player taps it; the position stays on the phone (the map is centred on it).
        // The stored position straight away if there is one, then the fresh one when it comes.
        val locate = { ->
            lastFix(context)?.let { GeoPoint(it.latitude, it.longitude).let { here -> me = here; map?.controller?.animateTo(here, 12.0, 800L) } }
            currentFix(context) { fix ->
                if (fix == null) { if (me == null) vm.say(t("This phone doesn’t know where it is yet. Search by town instead."), true) }
                else GeoPoint(fix.latitude, fix.longitude).let { me = it; map?.controller?.animateTo(it, 14.0, 800L) }
            }
        }
        val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { granted -> if (granted.values.any { it }) locate() else vm.say(t("Search by town or postcode instead.")) }
        // The map is a classic Android view: kept inside its own space (it would otherwise draw over the day filters and
        // the status bar while it's dragged), and let go of when the screen closes.
        Box(Modifier.fillMaxSize().clipToBounds()) {
            // OpenStreetMap's tiles, loaded only while the map is open; the map never sends the player's location anywhere.
            AndroidView(factory = { ctx ->
                Configuration.getInstance().userAgentValue = "BeerMat/${BuildConfig.VERSION_NAME} (Android)"
                Configuration.getInstance().osmdroidBasePath = java.io.File(ctx.cacheDir, "osmdroid")
                Configuration.getInstance().osmdroidTileCache = java.io.File(ctx.cacheDir, "osmdroid/tiles")
                MapView(ctx).apply {
                    setTileSource(TileSourceFactory.MAPNIK); setMultiTouchControls(true); controller.setZoom(6.0); controller.setCenter(GeoPoint(54.0, -2.5))
                    isTilesScaledToDpi = true; minZoomLevel = 4.0; maxZoomLevel = 18.0
                    map = this
                }
            }, update = { view ->
                view.overlays.clear()
                shown.forEach { v ->
                    view.overlays.add(Marker(view).apply {
                        position = GeoPoint(v.optDouble("lat"), v.optDouble("lon")); title = v.optString("name")
                        subDescription = v.optJSONObject("next")?.let { t("Next: {title}, {date}", "title" to it.optString("title"), "date" to date(it.optLong("startsAt"))) } ?: v.optString("town")
                        setOnMarkerClickListener { _, _ -> picked = v; true }
                    })
                }
                me?.let { here -> view.overlays.add(Marker(view).apply {
                    position = here; title = t("You are here"); setAnchor(Marker.ANCHOR_CENTER, Marker.ANCHOR_CENTER)
                    icon = android.graphics.drawable.GradientDrawable().apply { shape = android.graphics.drawable.GradientDrawable.OVAL; setColor(0xFF3B82F6.toInt()); setStroke(6, android.graphics.Color.WHITE); setSize(48, 48) }
                    setOnMarkerClickListener { _, _ -> true }
                }) }
                view.invalidate()
            }, modifier = Modifier.fillMaxSize().clipToBounds().testTag("map"))
            Text("◎  " + t("My location"), fontWeight = FontWeight.Bold, color = Brand.onAccent,
                modifier = Modifier.align(Alignment.TopEnd).padding(12.dp).clip(RoundedCornerShape(50)).background(Brand.gold)
                    .clickable {
                        if (precise(context)) locate() else permission.launch(LOCATION)
                    }.padding(horizontal = 18.dp, vertical = 12.dp).testTag("my-location"))
            picked?.let { MapVenuePopup(vm, ui, it) { picked = null } }
        }
        DisposableEffect(Unit) { onDispose { map?.onDetach(); map = null } }
    }
}

/** A map pin's popup: the venue's details and when its next quiz is (not the venue page's list of quizzes). */
@Composable
private fun MapVenuePopup(vm: OnlineViewModel, ui: OnlineState, v: JSONObject, close: () -> Unit) {
    val context = LocalContext.current
    val id = v.optString("id")
    Box(Modifier.fillMaxSize().background(androidx.compose.ui.graphics.Color(0x99000000)).clickable(onClick = close), contentAlignment = Alignment.Center) {
        Column(Modifier.padding(24.dp).fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(Brand.panel).clickable(enabled = false) {}.padding(20.dp).testTag("venue-popup")) {
            Text(v.optString("name"), style = MaterialTheme.typography.headlineSmall)
            Text(listOf(v.optString("address"), v.optString("town"), v.optString("postcode")).filter { it.isNotEmpty() }.joinToString(", "), color = Brand.muted)
            v.optJSONArray("quizNights")?.let { n -> if (n.length() > 0) Text(t("Quiz nights: {nights}", "nights" to (0 until n.length()).joinToString(", ") { i -> n.getJSONObject(i).let { "${it.optString("day").replaceFirstChar(Char::uppercase)} ${it.optString("time")}" } }), color = Brand.muted, modifier = Modifier.padding(top = 6.dp)) }
            Text(v.optJSONObject("next")?.let { t("Next: {title}, {date}", "title" to it.optString("title"), "date" to date(it.optLong("startsAt"))) } ?: t("No quiz nights published yet."),
                color = Brand.goldHi, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 10.dp))
            Row(Modifier.padding(top = 8.dp)) {
                TextButton({ vm.favourite(id, id !in ui.favourites) }) { Text(if (id in ui.favourites) t("★ Saved") else t("☆ Save venue")) }
                TextButton({ openInBrowser(context, v.optString("directions")) }) { Text(t("Directions")) }
                if (v.optString("website").startsWith("https://")) TextButton({ openInBrowser(context, v.optString("website")) }) { Text(t("Website")) }
            }
            TextButton(close, modifier = Modifier.fillMaxWidth()) { Text(t("Close")) }
        }
    }
}

// ---- A venue's page ----
@OptIn(ExperimentalLayoutApi::class)
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
            v.optJSONArray("quizNights")?.let { n -> if (n.length() > 0) Text(t("Quiz nights: {nights}", "nights" to (0 until n.length()).joinToString(", ") { i -> n.getJSONObject(i).let { "${it.optString("day").replaceFirstChar(Char::uppercase)} ${it.optString("time")}" } }), color = Brand.goldHi, modifier = Modifier.padding(top = 8.dp)) }
            FlowRow {
                TextButton({ vm.favourite(id, id !in ui.favourites) }) { Text(if (id in ui.favourites) t("★ Saved") else t("☆ Save venue")) }
                TextButton({ openInBrowser(context, v.optString("directions")) }) { Text(t("Directions")) }
                if (v.optString("website").startsWith("https://")) TextButton({ openInBrowser(context, v.optString("website")) }) { Text(t("Website")) }
            }
            val upcoming = v.optJSONArray("upcoming")
            if (upcoming != null && upcoming.length() > 0) for (i in 0 until upcoming.length()) EventCard(vm, upcoming.getJSONObject(i))
            else Text(t("No quiz nights published yet."), color = Brand.faint)
            TextButton({ vm.openVenue(null) }, modifier = Modifier.fillMaxWidth()) { Text(t("Close")) }
        }
    }
}
