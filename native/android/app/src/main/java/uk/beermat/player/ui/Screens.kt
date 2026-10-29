package uk.beermat.player.ui

import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.requiredSize
import androidx.compose.foundation.layout.wrapContentSize
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import uk.beermat.player.R
import uk.beermat.player.game.PlayerViewModel
import uk.beermat.player.game.Stage
import uk.beermat.player.game.UiState

@Composable
fun BeerMatApp(vm: PlayerViewModel, ui: UiState, online: uk.beermat.player.online.OnlineViewModel, scan: () -> Unit) {
    val o = online.ui.collectAsStateWithLifecycle().value
    var tab by rememberSaveable { mutableStateOf(0) }
    // In a quiz, the quiz's language (the quizmaster chooses it, as for the TV and browsers); elsewhere the phone's.
    I18n.lang = ui.game?.settings?.language ?: I18n.phone
    // The quiz's look dresses the whole screen (its background and scenery, behind everything); otherwise BeerMat's own.
    val look = if (ui.stage == Stage.Play) ui.look else null
    val backdrop = look?.background?.takeIf { it.isNotEmpty() } ?: listOf(0f to Color(0xFF241046), 0.5f to Brand.bg, 1f to Brand.bg2)
    Box(Modifier.fillMaxSize().smoothGradient(backdrop)) {
        if (look != null) LookScene(look)
    Box(Modifier.fillMaxSize().safeDrawingPadding().imePadding()) {
        Column(Modifier.fillMaxSize()) {
            Box(Modifier.weight(1f)) {
                AnimatedContent(ui.stage to tab, transitionSpec = { fadeIn() togetherWith fadeOut() }, label = "stage") { (stage, shown) ->
                    when (stage) {
                        Stage.Connect -> when (shown) {
                            1 -> FindScreen(online, o)
                            2 -> MapScreen(online, o)
                            3 -> ProfileScreen(online, o)
                            else -> ConnectScreen(vm, ui, scan)
                        }
                        Stage.Join -> JoinScreen(vm, ui)
                        Stage.Play -> if (ui.game?.testDevice == true) RehearsalScreen(vm, ui) else PlayScreen(vm, ui, online)
                    }
                }
            }
            // The app's own screens around the quiz; a quiz in play has the whole screen (Team → Other quizzes leads back).
            if (ui.stage == Stage.Connect) Row(Modifier.fillMaxWidth().background(Brand.panel).padding(vertical = 6.dp)) {
                listOf("🍺" to t("Play"), "🔎" to t("Find a quiz"), "🗺" to t("Map"), "👤" to t("Profile")).forEachIndexed { i, (icon, label) ->
                    Column(Modifier.weight(1f).clickable { tab = i }.padding(vertical = 4.dp).testTag("tab-$label"), horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(icon, fontSize = 20.sp)
                        Text(label, fontSize = 12.sp, color = if (tab == i) Brand.gold else Brand.muted, fontWeight = if (tab == i) FontWeight.Bold else FontWeight.Normal)
                    }
                }
            }
        }
        if (ui.stage == Stage.Connect) VenueSheet(online, o)
        ui.wifi?.let { WifiSheet(it.ssid, it.password, onDone = vm::dismissWifi) }
    }
    }
}

/** A top-to-bottom gradient without bands: Android dithers it (its Paint's dither flag, which Compose's brushes leave
 *  off), so dark colours a few steps apart change smoothly instead of in stripes. */
fun Modifier.smoothGradient(stops: List<Pair<Float, Color>>) = drawBehind {
    val paint = android.graphics.Paint().apply {
        isDither = true
        shader = android.graphics.LinearGradient(0f, 0f, 0f, size.height, stops.map { it.second.toArgb() }.toIntArray(), stops.map { it.first }.toFloatArray(), android.graphics.Shader.TileMode.CLAMP)
    }
    drawIntoCanvas { it.nativeCanvas.drawRect(0f, 0f, size.width, size.height, paint) }
}

/** A look's phone scenery (tv.json's phone): pictures on a stage 390 wide, scaled to the screen's width and placed
 *  from its bottom, behind the quiz. Pictures load from the quiz server once each. */
@Composable
fun LookScene(look: PhoneLook) {
    androidx.compose.foundation.layout.BoxWithConstraints(Modifier.fillMaxSize()) {
        val scale = maxWidth.value / 390f
        for (layer in look.scene) {
            val picture by androidx.compose.runtime.produceState<android.graphics.Bitmap?>(null, layer.image) {
                value = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
                    try { java.net.URL(layer.image).openStream().use { android.graphics.BitmapFactory.decodeStream(it) } } catch (_: Exception) { null }
                }
            }
            picture?.let {
                androidx.compose.foundation.Image(it.asImageBitmap(), null, contentScale = androidx.compose.ui.layout.ContentScale.FillBounds,
                    modifier = Modifier.align(Alignment.BottomStart)
                        .offset(x = (layer.x * scale).dp, y = (-layer.bottom * scale).dp)
                        .wrapContentSize(Alignment.BottomStart, unbounded = true)
                        .requiredSize((layer.width * scale).dp, (layer.height * scale).dp)
                        .graphicsLayer { alpha = layer.opacity }
                        .testTag("look-scene"))
            }
        }
    }
}

@Composable
fun Message(ui: UiState) {
    if (ui.message.isNotEmpty()) Text(
        t(ui.message), color = if (ui.error) Brand.bad else Brand.goldHi, fontWeight = FontWeight.SemiBold,
        modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp).semantics { liveRegion = LiveRegionMode.Polite },
    )
}

@Composable
fun BigButton(text: String, enabled: Boolean = true, colour: Color = Brand.gold, onClick: () -> Unit) {
    // Acting on what was typed puts the keyboard away.
    val focus = androidx.compose.ui.platform.LocalFocusManager.current
    Button(
        { focus.clearFocus(); onClick() }, enabled = enabled, shape = RoundedCornerShape(18.dp),
        colors = ButtonDefaults.buttonColors(containerColor = colour, contentColor = Brand.onAccent, disabledContainerColor = Brand.raised),
        modifier = Modifier.fillMaxWidth().height(60.dp),
    ) { Text(text, style = MaterialTheme.typography.titleLarge) }
}

@Composable
private fun Header(title: String, subtitle: String = "") {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(bottom = 20.dp)) {
        Image(painterResource(R.mipmap.ic_launcher_foreground), null, Modifier.size(64.dp))
        Column(Modifier.padding(start = 4.dp)) {
            Text(title, style = MaterialTheme.typography.headlineMedium)
            if (subtitle.isNotEmpty()) Text(subtitle, color = Brand.muted)
        }
    }
}

@Composable
fun ConnectScreen(vm: PlayerViewModel, ui: UiState, scan: () -> Unit) {
    var address by rememberSaveable { mutableStateOf("") }
    val focus = androidx.compose.ui.platform.LocalFocusManager.current
    val connect = { focus.clearFocus(); vm.connect(address) }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp)) {
        Header("BeerMat", t("Play the quiz"))
        UpdateBanner()
        Text(t("Scan the code on the TV"), style = MaterialTheme.typography.displaySmall)
        Text(t("No account, no internet: the quiz runs on the quizmaster’s laptop."), color = Brand.muted, modifier = Modifier.padding(top = 6.dp, bottom = 20.dp))
        BigButton(t("Scan the TV’s code"), enabled = !ui.busy, onClick = scan)
        Spacer(Modifier.height(24.dp))
        Text(t("Or type the address on the TV"), color = Brand.muted)
        OutlinedTextField(
            address, { address = it }, singleLine = true, placeholder = { Text("10.42.0.1") },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Go),
            keyboardActions = KeyboardActions(onGo = { connect() }),
            modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp).testTag("address"),
        )
        OutlinedButton({ connect() }, enabled = address.isNotBlank() && !ui.busy, modifier = Modifier.fillMaxWidth()) { Text(t("Connect")) }
        Message(ui)
        if (ui.recent.isNotEmpty()) {
            Text(t("Recent quizzes"), style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(top = 24.dp, bottom = 8.dp))
            ui.recent.forEach { r ->
                Row(
                    Modifier.fillMaxWidth().padding(vertical = 4.dp).clip(RoundedCornerShape(14.dp)).background(Brand.panel)
                        .clickable(enabled = !ui.busy) { vm.connect(r.server) }.padding(16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(r.title.ifEmpty { t("Quiz") }, fontWeight = FontWeight.Bold)
                        Text(r.server.removePrefix("http://"), color = Brand.faint, fontSize = 13.sp)
                    }
                    Text("›", color = Brand.gold, fontSize = 28.sp)
                }
            }
        }
    }
}

@Composable
fun JoinScreen(vm: PlayerViewModel, ui: UiState) {
    var name by rememberSaveable { mutableStateOf("") }
    val keyboard = androidx.compose.ui.platform.LocalSoftwareKeyboardController.current
    val focus = androidx.compose.ui.platform.LocalFocusManager.current
    val join = { focus.clearFocus(); keyboard?.hide(); vm.join(name) }
    var code by rememberSaveable { mutableStateOf("") }
    val hello = ui.hello
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp)) {
        Header(hello?.title ?: "BeerMat", ui.server.removePrefix("http://"))
        if (hello?.rehearsal == true) Pill(t("REHEARSAL"), Brand.teal)
        Text(t("Pick a team name"), style = MaterialTheme.typography.displaySmall, modifier = Modifier.padding(top = 12.dp))
        OutlinedTextField(
            name, { if (it.length <= 40) name = it }, singleLine = true, label = { Text(t("Team name")) },
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done), keyboardActions = KeyboardActions(onDone = { if (name.trim().length >= 2) join() }),
            modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp).testTag("teamName"),
        )
        BigButton(t("Join the quiz"), enabled = name.trim().length >= 2 && !ui.busy && hello?.registrationOpen != false) { join() }
        if (hello?.registrationOpen == false) Text(t("Registration is closed. Ask the quizmaster."), color = Brand.muted, modifier = Modifier.padding(top = 8.dp))
        Message(ui)
        Text(t("Already playing?"), style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(top = 28.dp))
        Text(t("Type your recovery code, or the 4-digit code the quizmaster gives you to move your team to this phone."), color = Brand.muted)
        OutlinedTextField(code, { code = it.trim() }, singleLine = true, label = { Text(t("Recovery code")) }, modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp))
        OutlinedButton({ vm.recover(code) }, enabled = code.isNotEmpty() && !ui.busy, modifier = Modifier.fillMaxWidth()) { Text(t("Continue as my team")) }
        TextButton(vm::leave, modifier = Modifier.padding(top = 16.dp)) { Text(t("‹ Other quizzes")) }
    }
}

/** A real phone in a rehearsal: the connection works, and playing is off (the server enforces it). */
@Composable
fun RehearsalScreen(vm: PlayerViewModel, ui: UiState) {
    Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        Box(Modifier.size(120.dp).clip(CircleShape).background(Brand.good.copy(alpha = .18f)).border(3.dp, Brand.good, CircleShape), contentAlignment = Alignment.Center) {
            Text("✓", color = Brand.good, fontSize = 64.sp, fontWeight = FontWeight.Bold)
        }
        Text(if (ui.connected) t("You’re connected") else t("Reconnecting…"), style = MaterialTheme.typography.displaySmall, modifier = Modifier.padding(top = 24.dp))
        Text(ui.game?.settings?.title ?: "", color = Brand.goldHi, style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(top = 4.dp))
        Text(
            t("This is a rehearsal. Your phone reached the quiz, so it’ll work on the night, but playing is switched off: the quizmaster is testing with simulated teams."),
            color = Brand.muted, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 16.dp),
        )
        Pill(if (ui.connected) t("● CONNECTED") else t("○ RECONNECTING…"), if (ui.connected) Brand.good else Brand.bad, Modifier.padding(top = 24.dp))
        TextButton(vm::leave, modifier = Modifier.padding(top = 24.dp)) { Text(t("‹ Other quizzes")) }
    }
}

@Composable
fun Pill(text: String, colour: Color, modifier: Modifier = Modifier) {
    Text(
        text, color = colour, fontWeight = FontWeight.Bold, fontSize = 13.sp, letterSpacing = 1.sp,
        modifier = modifier.clip(RoundedCornerShape(50)).background(colour.copy(alpha = .15f)).border(1.dp, colour.copy(alpha = .5f), RoundedCornerShape(50)).padding(horizontal = 12.dp, vertical = 5.dp),
    )
}

/** The TV's code was the quiz Wi-Fi: join it in settings, then scan the quiz code. */
@Composable
fun WifiSheet(ssid: String, password: String, onDone: () -> Unit) {
    val context = LocalContext.current
    Box(Modifier.fillMaxSize().background(Color(0xCC000000)).clickable(onClick = onDone), contentAlignment = Alignment.BottomCenter) {
        Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp)).background(Brand.panel).clickable(enabled = false) {}.padding(24.dp)) {
            Text(t("Join the quiz Wi-Fi"), style = MaterialTheme.typography.headlineMedium)
            Text(t("Network: {ssid}", "ssid" to ssid), fontSize = 20.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 12.dp))
            if (password.isNotEmpty()) Text(t("Password: {password}", "password" to password), fontSize = 20.sp, fontWeight = FontWeight.Bold)
            Text(t("If your phone warns about “no internet”, choose “Use network as is” or “Stay connected”. Then scan the quiz code."), color = Brand.muted, modifier = Modifier.padding(vertical = 12.dp))
            BigButton(t("Open Wi-Fi settings")) {
                context.startActivity(Intent(Settings.Panel.ACTION_WIFI).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            }
            TextButton(onDone, modifier = Modifier.fillMaxWidth()) { Text(t("Done")) }
        }
    }
}

fun openInBrowser(context: android.content.Context, url: String) {
    context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
}

@Composable
fun HapticsSwitch(vm: PlayerViewModel) {
    var on by remember { mutableStateOf(vm.haptics) }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(t("Vibrate for new questions"), color = Brand.muted, modifier = Modifier.weight(1f))
        Spacer(Modifier.width(8.dp))
        Switch(on, { on = it; vm.setHaptics(it) })
    }
}
