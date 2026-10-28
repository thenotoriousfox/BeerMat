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
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
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
fun BeerMatApp(vm: PlayerViewModel, ui: UiState, scan: () -> Unit) {
    Box(
        Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color(0xFF241046), Brand.bg, Brand.bg2)))
            .safeDrawingPadding().imePadding()
    ) {
        AnimatedContent(ui.stage, transitionSpec = { fadeIn() togetherWith fadeOut() }, label = "stage") { stage ->
            when (stage) {
                Stage.Connect -> ConnectScreen(vm, ui, scan)
                Stage.Join -> JoinScreen(vm, ui)
                Stage.Play -> if (ui.game?.testDevice == true) RehearsalScreen(vm, ui) else PlayScreen(vm, ui)
            }
        }
        ui.wifi?.let { WifiSheet(it.ssid, it.password, onDone = vm::dismissWifi) }
    }
}

@Composable
fun Message(ui: UiState) {
    if (ui.message.isNotEmpty()) Text(
        ui.message, color = if (ui.error) Brand.bad else Brand.goldHi, fontWeight = FontWeight.SemiBold,
        modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp).semantics { liveRegion = LiveRegionMode.Polite },
    )
}

@Composable
fun BigButton(text: String, enabled: Boolean = true, colour: Color = Brand.gold, onClick: () -> Unit) {
    Button(
        onClick, enabled = enabled, shape = RoundedCornerShape(18.dp),
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
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp)) {
        Header("BeerMat", "Play the quiz")
        Text("Scan the code on the TV", style = MaterialTheme.typography.displaySmall)
        Text("No account, no internet: the quiz runs on the quizmaster's laptop.", color = Brand.muted, modifier = Modifier.padding(top = 6.dp, bottom = 20.dp))
        BigButton("Scan the TV's code", enabled = !ui.busy, onClick = scan)
        Spacer(Modifier.height(24.dp))
        Text("Or type the address on the TV", color = Brand.muted)
        OutlinedTextField(
            address, { address = it }, singleLine = true, placeholder = { Text("10.42.0.1") },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Go),
            keyboardActions = KeyboardActions(onGo = { vm.connect(address) }),
            modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
        )
        OutlinedButton({ vm.connect(address) }, enabled = address.isNotBlank() && !ui.busy, modifier = Modifier.fillMaxWidth()) { Text("Connect") }
        Message(ui)
        if (ui.recent.isNotEmpty()) {
            Text("Recent quizzes", style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(top = 24.dp, bottom = 8.dp))
            ui.recent.forEach { r ->
                Row(
                    Modifier.fillMaxWidth().padding(vertical = 4.dp).clip(RoundedCornerShape(14.dp)).background(Brand.panel)
                        .clickable(enabled = !ui.busy) { vm.connect(r.server) }.padding(16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(r.title.ifEmpty { "Quiz" }, fontWeight = FontWeight.Bold)
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
    var code by rememberSaveable { mutableStateOf("") }
    val hello = ui.hello
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp)) {
        Header(hello?.title ?: "BeerMat", ui.server.removePrefix("http://"))
        if (hello?.rehearsal == true) Pill("REHEARSAL", Brand.teal)
        Text("Pick a team name", style = MaterialTheme.typography.displaySmall, modifier = Modifier.padding(top = 12.dp))
        OutlinedTextField(
            name, { if (it.length <= 40) name = it }, singleLine = true, label = { Text("Team name") },
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done), keyboardActions = KeyboardActions(onDone = { if (name.trim().length >= 2) vm.join(name) }),
            modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp),
        )
        BigButton("Join the quiz", enabled = name.trim().length >= 2 && !ui.busy && hello?.registrationOpen != false) { vm.join(name) }
        if (hello?.registrationOpen == false) Text("Registration is closed. Ask the quizmaster.", color = Brand.muted, modifier = Modifier.padding(top = 8.dp))
        Message(ui)
        Text("Already playing?", style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(top = 28.dp))
        Text("Type your recovery code, or the 4-digit code the quizmaster gives you to move your team to this phone.", color = Brand.muted)
        OutlinedTextField(code, { code = it.trim() }, singleLine = true, label = { Text("Recovery code") }, modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp))
        OutlinedButton({ vm.recover(code) }, enabled = code.isNotEmpty() && !ui.busy, modifier = Modifier.fillMaxWidth()) { Text("Continue as my team") }
        TextButton(vm::leave, modifier = Modifier.padding(top = 16.dp)) { Text("‹ Other quizzes") }
    }
}

/** A real phone in a rehearsal: the connection works, and playing is off (the server enforces it). */
@Composable
fun RehearsalScreen(vm: PlayerViewModel, ui: UiState) {
    Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        Box(Modifier.size(120.dp).clip(CircleShape).background(Brand.good.copy(alpha = .18f)).border(3.dp, Brand.good, CircleShape), contentAlignment = Alignment.Center) {
            Text("✓", color = Brand.good, fontSize = 64.sp, fontWeight = FontWeight.Bold)
        }
        Text("You're connected", style = MaterialTheme.typography.displaySmall, modifier = Modifier.padding(top = 24.dp))
        Text(ui.game?.settings?.title ?: "", color = Brand.goldHi, style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(top = 4.dp))
        Text(
            "This is a rehearsal. Your phone reached the quiz, so it'll work on the night, but playing is switched off: the quizmaster is testing with simulated teams.",
            color = Brand.muted, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 16.dp),
        )
        Pill(if (ui.connected) "● CONNECTED" else "○ RECONNECTING…", if (ui.connected) Brand.good else Brand.bad, Modifier.padding(top = 24.dp))
        TextButton(vm::leave, modifier = Modifier.padding(top = 24.dp)) { Text("‹ Other quizzes") }
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
            Text("Join the quiz Wi-Fi", style = MaterialTheme.typography.headlineMedium)
            Text("Network: $ssid", fontSize = 20.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 12.dp))
            if (password.isNotEmpty()) Text("Password: $password", fontSize = 20.sp, fontWeight = FontWeight.Bold)
            Text("If your phone warns about “no internet”, choose “Use network as is” or “Stay connected”. Then scan the quiz code.", color = Brand.muted, modifier = Modifier.padding(vertical = 12.dp))
            BigButton("Open Wi-Fi settings") {
                context.startActivity(Intent(Settings.Panel.ACTION_WIFI).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            }
            TextButton(onDone, modifier = Modifier.fillMaxWidth()) { Text("Done") }
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
        Text("Vibrate for new questions", color = Brand.muted, modifier = Modifier.weight(1f))
        Spacer(Modifier.width(8.dp))
        Switch(on, { on = it; vm.setHaptics(it) })
    }
}
