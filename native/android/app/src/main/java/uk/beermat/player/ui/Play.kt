package uk.beermat.player.ui

import android.graphics.BitmapFactory
import android.media.AudioAttributes
import android.media.MediaPlayer
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import org.json.JSONArray
import uk.beermat.player.game.NATIVE_TYPES
import uk.beermat.player.game.PlayerViewModel
import uk.beermat.player.game.UiState
import uk.beermat.player.game.seededOrder
import uk.beermat.player.net.Question
import java.net.URL

private const val LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"

@Composable
fun PlayScreen(vm: PlayerViewModel, ui: UiState) {
    val game = ui.game ?: return
    val q = game.question
    val haptics = LocalHapticFeedback.current
    LaunchedEffect(Unit) { vm.nudges.collect { if (vm.haptics) haptics.performHapticFeedback(HapticFeedbackType.LongPress) } }
    var menu by remember { mutableStateOf(false) }

    Column(Modifier.fillMaxSize()) {
        // Team bar: name, score, connection.
        Row(Modifier.fillMaxWidth().background(Brand.panel).padding(horizontal = 18.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(10.dp).clip(CircleShape).background(if (ui.connected) Brand.good else Brand.bad).semantics { contentDescription = if (ui.connected) "Connected" else "Reconnecting" })
            Text(game.team?.name ?: "", fontWeight = FontWeight.Bold, fontSize = 17.sp, maxLines = 1, modifier = Modifier.padding(start = 10.dp).weight(1f))
            val mine = game.teams.firstOrNull { it.name == game.team?.name }
            if (mine?.score != null && game.settings.leaderboardVisible) Text("${fmt(mine.score)} pts · #${mine.rank}", color = Brand.goldHi, fontWeight = FontWeight.Bold)
            TextButton({ menu = !menu }) { Text(if (menu) "Close" else "Team", color = Brand.muted) }
        }
        if (!ui.connected) Text("Connection lost — reconnecting…", color = Brand.onAccent, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth().background(Brand.bad).padding(6.dp))
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp)) {
            if (menu) TeamMenu(vm, ui)
            else when {
                game.team?.waiting == true -> Lobby("You're in the waiting room", "The quizmaster will let you in shortly.")
                game.settings.ended -> Lobby("That's the quiz!", "Thanks for playing. Final scores are on the TV.")
                q == null -> Lobby("You're in!", "Waiting for the quiz to start. Keep this app open.")
                q.type !in NATIVE_TYPES -> BrowserRound(vm, q)
                else -> Question(vm, ui, q)
            }
            Message(ui)
        }
    }
}

@Composable
private fun Lobby(title: String, text: String) {
    Column(Modifier.fillMaxWidth().padding(top = 60.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Text("🍺", fontSize = 64.sp)
        Text(title, style = MaterialTheme.typography.displaySmall, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 12.dp))
        Text(text, color = Brand.muted, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 8.dp))
    }
}

@Composable
private fun TeamMenu(vm: PlayerViewModel, ui: UiState) {
    Text("Your team", style = MaterialTheme.typography.headlineMedium)
    Text("Recovery code", color = Brand.muted, modifier = Modifier.padding(top = 12.dp))
    Text(ui.secret, fontSize = 13.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(vertical = 4.dp))
    Text("Keep it to rejoin from another phone. The quizmaster can also give you a 4-digit code to move your team.", color = Brand.faint, fontSize = 13.sp)
    Spacer(Modifier.height(16.dp))
    HapticsSwitch(vm)
    Spacer(Modifier.height(16.dp))
    OutlinedButton({ openInBrowser(vmContext(vm), vm.webPlayerUrl()) }, modifier = Modifier.fillMaxWidth()) { Text("Open in the browser instead") }
    OutlinedButton(vm::switchTeam, modifier = Modifier.fillMaxWidth()) { Text("Switch team") }
    OutlinedButton(vm::leave, modifier = Modifier.fillMaxWidth()) { Text("Other quizzes") }
}

private fun vmContext(vm: PlayerViewModel) = vm.getApplication<android.app.Application>()

/** A round format this app doesn't draw: the quiz's own player page plays it, already signed in as this team. */
@Composable
private fun BrowserRound(vm: PlayerViewModel, q: Question) {
    val context = LocalContext.current
    QuestionHead(q, 0)
    Text("This round plays in your phone's browser.", style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(top = 16.dp))
    Text("It opens as your team, and you can come back here after.", color = Brand.muted, modifier = Modifier.padding(vertical = 8.dp))
    BigButton("Open this round") { openInBrowser(context, vm.webPlayerUrl()) }
}

@Composable
private fun QuestionHead(q: Question, offset: Long) {
    Text(q.round.uppercase(), color = Brand.gold, fontWeight = FontWeight.Bold, letterSpacing = 2.sp, fontSize = 13.sp)
    Text(q.text, style = MaterialTheme.typography.headlineMedium, modifier = Modifier.padding(top = 6.dp, bottom = 10.dp))
    if (q.isTimed) Countdown(q, offset)
}

/** Time left, from the server's deadline; only a display, as the server decides lateness. */
@Composable
private fun Countdown(q: Question, offset: Long) {
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(q.id, q.open, q.paused) { while (q.open && !q.paused) { now = System.currentTimeMillis(); delay(200) } }
    val left = if (q.paused) q.remaining else maxOf(0L, q.deadline - now - offset)
    val text = when {
        q.paused -> "Paused · ${(q.remaining + 999) / 1000}s left"
        !q.open || left <= 0 -> if (q.revealed) "Answer revealed" else "Answers closed"
        else -> "${(left + 999) / 1000}s left"
    }
    val low = q.open && !q.paused && left in 1..10000
    val colour by animateColorAsState(if (low) Brand.bad else Brand.goldHi, label = "time")
    Text(text, color = if (q.open) colour else Brand.muted, fontFamily = Display, fontWeight = FontWeight.SemiBold, fontSize = 22.sp)
    if (q.open && q.seconds > 0) LinearProgressIndicator(
        progress = { (left.toFloat() / (q.seconds * 1000f)).coerceIn(0f, 1f) }, color = colour, trackColor = Brand.raised,
        modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp).height(8.dp).clip(RoundedCornerShape(4.dp)),
    )
}

@Composable
private fun Question(vm: PlayerViewModel, ui: UiState, q: Question) {
    val game = ui.game!!
    QuestionHead(q, ui.offset)
    if (q.type != "pinpoint") Media(ui.server, q)
    if (q.type == "buzzer") return Buzzer(vm, ui, q)
    if (q.type == "bingo" || q.type == "musicbingo") return Bingo(vm, ui, q)
    if (q.type == "clips") return Clips(vm, ui, q)

    // What the team has put: the submitted answer, else the draft saved on the server.
    val submitted = game.answer
    val locked = submitted != null || !q.open
    var value by remember(q.id) { mutableStateOf(initial(q, submitted?.value ?: game.draft)) }
    LaunchedEffect(value) { if (!locked && value != initial(q, null)) { delay(500); vm.saveDraft(value) } }
    val teamId = game.team?.id ?: ""
    val order: (Int) -> List<Int> = { n -> if (game.settings.scrambleKeypads) seededOrder(n, "$teamId:${q.id}") else List(n) { it } }

    when (q.type) {
        "choice", "vote" -> Keys(order(q.options.size).map { it to "${LETTERS[it]}. ${q.options[it]}" }, colours = true, picked = { q.options[it] == value }, enabled = !locked) { value = q.options[it] }
        "letter" -> LetterPad(order(26), value as? String ?: "", enabled = !locked) { value = it }
        "multi" -> {
            Text("Tick every right answer — wrong ticks cost points", color = Brand.muted, modifier = Modifier.padding(bottom = 8.dp))
            @Suppress("UNCHECKED_CAST") val picked = value as List<String>
            Keys(order(q.options.size).map { it to "${LETTERS[it]}. ${q.options[it]}" }, colours = true, picked = { q.options[it] in picked }, enabled = !locked) {
                val o = q.options[it]; value = if (o in picked) picked - o else picked + o
            }
        }
        "sequence" -> {
            Text("Tap the items in order", color = Brand.muted)
            @Suppress("UNCHECKED_CAST") val picked = value as List<Int>
            Keys(order(q.order.size).map { q.order[it] }.map { it to q.items[it] }, colours = false, picked = { it in picked }, enabled = !locked) { if (it !in picked) value = picked + it }
            picked.forEachIndexed { n, i -> Text("${n + 1}. ${q.items[i]}", fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 4.dp)) }
            if (!locked && picked.isNotEmpty()) TextButton({ value = picked.dropLast(1) }) { Text("Undo last") }
        }
        "tiles" -> {
            Text("Tap the tiles in order to build the answer", color = Brand.muted)
            @Suppress("UNCHECKED_CAST") val picked = value as List<Int>
            Text(tileWord(picked.joinToString("") { q.pieces[it] }, q.wordLengths), fontFamily = Display, fontSize = 30.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(vertical = 8.dp))
            // Tiles are always in a different order on each team's phone.
            LetterTiles(seededOrder(q.pieces.size, "$teamId:${q.id}"), q.pieces, picked, enabled = !locked) { value = picked + it }
            if (!locked && picked.isNotEmpty()) TextButton({ value = picked.dropLast(1) }) { Text("Undo last") }
        }
        "pinpoint" -> {
            @Suppress("UNCHECKED_CAST") val taps = value as List<List<Double>>
            Pinpoint(ui.server, q, taps, enabled = !locked) { value = it }
        }
        "wordsnake" -> {
            @Suppress("UNCHECKED_CAST") val path = value as List<Int>
            WordSnake(vm, q, path, enabled = !locked) { value = it }
        }
        "sheet" -> {
            @Suppress("UNCHECKED_CAST") val answers = value as List<String>
            q.items.forEachIndexed { i, item ->
                OutlinedTextField(answers.getOrElse(i) { "" }, { v -> value = answers.toMutableList().also { it[i] = v.take(300) } }, enabled = !locked,
                    label = { Text("${i + 1}. $item") }, modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp))
            }
        }
        else -> OutlinedTextField(
            value as String, { value = it.take(300) }, enabled = !locked, singleLine = true,
            label = { Text(when (q.type) { "nearest" -> "Your number (closest wins)"; "number" -> "Your number"; else -> "Your answer" }) },
            keyboardOptions = KeyboardOptions(keyboardType = if (q.type == "number" || q.type == "nearest") KeyboardType.Decimal else KeyboardType.Text),
            modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp).testTag("answer"),
        )
    }

    Spacer(Modifier.height(16.dp))
    when {
        submitted != null -> Result(q, submitted.points)
        !q.open -> Text(if (q.revealed) "Answer revealed" else "Answers closed", color = Brand.muted)
        else -> BigButton("Lock in answer", enabled = !ui.busy && ready(q, value)) { vm.submit(value) }
    }
    if (q.revealed && q.answer != null) Text("Answer: ${q.answer}", color = Brand.good, fontWeight = FontWeight.Bold, fontSize = 18.sp, modifier = Modifier.padding(top = 12.dp))
    if (q.revealed && q.answerNote.isNotEmpty()) Text(q.answerNote, color = Brand.muted)
}

/** Scoring feedback: what the server marked, once marking is final. */
@Composable
private fun Result(q: Question, points: Double?) {
    val (text, colour) = when {
        points == null -> "Final answer received" to Brand.goldHi
        points > 0 -> "+${fmt(points)} ${if (points == 1.0) "point" else "points"}" to Brand.good
        points < 0 -> "${fmt(points)} points" to Brand.bad
        else -> "No points this time" to Brand.muted
    }
    val pop by animateFloatAsState(if (points != null && points > 0) 1.08f else 1f, label = "pop")
    Text(text, color = colour, style = MaterialTheme.typography.headlineMedium, modifier = Modifier.scale(pop).fillMaxWidth(), textAlign = TextAlign.Center)
}

/** The answer's shape with the letters so far (tileWord in web/app.js): "BIG BEN" as "BIG B__". */
fun tileWord(letters: String, lengths: List<Int>): String {
    if (lengths.isEmpty()) return letters.ifEmpty { "…" }
    val padded = letters.padEnd(lengths.sum(), '_')
    var at = 0
    return lengths.joinToString(" ") { n -> padded.substring(at, at + n).also { at += n } }
}

private fun fmt(n: Double) = if (n % 1.0 == 0.0) n.toLong().toString() else "%.1f".format(n)

private fun initial(q: Question, saved: Any?): Any = when (q.type) {
    "multi" -> (saved as? JSONArray)?.let { a -> List(a.length()) { a.optString(it) } } ?: emptyList<String>()
    "pinpoint" -> (saved as? JSONArray)?.let { a -> List(a.length()) { i -> a.optJSONArray(i)?.let { p -> listOf(p.optDouble(0), p.optDouble(1)) } ?: emptyList() } } ?: emptyList<List<Double>>()
    "sequence", "tiles", "wordsnake" -> (saved as? JSONArray)?.let { a -> List(a.length()) { a.optInt(it) } } ?: emptyList<Int>()
    "sheet" -> (saved as? JSONArray)?.let { a -> List(q.items.size) { a.optString(it, "") } } ?: List(q.items.size) { "" }
    else -> (saved as? String) ?: ""
}

private fun ready(q: Question, value: Any): Boolean = when (q.type) {
    "sequence" -> (value as List<*>).size == q.items.size
    "sheet" -> (value as List<*>).any { (it as String).isNotBlank() }
    else -> if (value is List<*>) value.isNotEmpty() else (value as String).isNotBlank()
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Keys(keys: List<Pair<Int, String>>, colours: Boolean, picked: (Int) -> Boolean, enabled: Boolean, tap: (Int) -> Unit) {
    val haptics = LocalHapticFeedback.current
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        keys.forEach { (i, label) ->
            val tone = if (colours) Brand.options[i % Brand.options.size] else Brand.violet
            val on = picked(i)
            val fill by animateColorAsState(tone.copy(alpha = if (on) .55f else .18f), label = "key")
            Box(
                Modifier.fillMaxWidth().heightIn(min = 64.dp).clip(RoundedCornerShape(18.dp)).background(fill)
                    .border(if (on) 3.dp else 1.dp, if (on) Brand.text else tone.copy(alpha = .7f), RoundedCornerShape(18.dp))
                    .clickable(enabled = enabled) { haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove); tap(i) }.padding(horizontal = 18.dp, vertical = 14.dp),
                contentAlignment = Alignment.CenterStart,
            ) { Text(label, fontWeight = FontWeight.Bold, fontSize = 19.sp) }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun LetterPad(order: List<Int>, picked: String, enabled: Boolean, tap: (String) -> Unit) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        order.forEach { i ->
            val l = LETTERS[i].toString()
            Box(Modifier.size(56.dp).clip(RoundedCornerShape(14.dp)).background(if (l == picked) Brand.gold else Brand.raised).clickable(enabled = enabled) { tap(l) },
                contentAlignment = Alignment.Center) { Text(l, fontFamily = Display, fontSize = 24.sp, fontWeight = FontWeight.Bold, color = if (l == picked) Brand.onAccent else Brand.text) }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun LetterTiles(order: List<Int>, pieces: List<String>, picked: List<Int>, enabled: Boolean, tap: (Int) -> Unit) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        order.forEach { i ->
            val used = i in picked
            Box(Modifier.size(60.dp).testTag("tile-$i").clip(RoundedCornerShape(12.dp)).background(if (used) Brand.raised.copy(alpha = .4f) else Brand.goldHi)
                .clickable(enabled = enabled && !used) { tap(i) }, contentAlignment = Alignment.Center) {
                Text(pieces[i], fontFamily = Display, fontSize = 24.sp, fontWeight = FontWeight.Bold, color = if (used) Brand.faint else Brand.onAccent)
            }
        }
    }
}

@Composable
private fun Buzzer(vm: PlayerViewModel, ui: UiState, q: Question) {
    val b = q.buzz ?: return
    val haptics = LocalHapticFeedback.current
    val mine = b.buzzed
    val position = b.queue.filter { it.status == "active" || it.status == "queued" }.indexOfFirst { it.team == ui.game?.team?.id } + 1
    val canBuzz = ui.connected && q.open && !q.paused && mine == null && !b.lockedOut && ui.game?.settings?.ended != true
    val status = when {
        b.lockedOut -> "Locked out — wrong answer on the last buzzer question"
        mine == "active" -> "You buzzed first — give your answer!"
        mine == "queued" -> "Buzzed · you are #$position in the queue"
        mine == "wrong" -> "Ruled wrong"; mine == "passed" -> "Passed"; mine == "correct" -> "Correct!"
        b.activeName != null -> "${b.activeName} is answering"
        q.open -> "Buzz when you know it!"
        else -> "Buzzing closed"
    }
    val press by animateFloatAsState(if (canBuzz) 1f else .94f, label = "buzz")
    Box(Modifier.fillMaxWidth().padding(vertical = 20.dp), contentAlignment = Alignment.Center) {
        Box(
            Modifier.size(240.dp).scale(press).clip(CircleShape).background(if (canBuzz) Brand.pink else Brand.raised)
                .border(6.dp, if (mine == "active") Brand.goldHi else Color.White.copy(alpha = .15f), CircleShape)
                .clickable(enabled = canBuzz && !ui.busy) { haptics.performHapticFeedback(HapticFeedbackType.LongPress); vm.buzz() }
                .semantics { contentDescription = "Buzz" },
            contentAlignment = Alignment.Center,
        ) { Text("BUZZ", fontFamily = Display, fontSize = 52.sp, fontWeight = FontWeight.Bold, color = if (canBuzz) Brand.text else Brand.faint) }
    }
    Text(status, style = MaterialTheme.typography.titleLarge, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
    if (b.agreeOpen) {
        Text("${b.activeName ?: ""} answered “${b.announced.ifEmpty { "…" }}”. Do you agree?", color = Brand.muted, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp))
        val canAgree = mine !in setOf("active", "passed", "wrong") && !b.agreed
        BigButton(if (b.agreed) "✓ You agreed" else "I agree", enabled = canAgree && !ui.busy, colour = Brand.teal) { vm.agree() }
    }
}

/** A picture from the quiz laptop, or a sound to play on the phone. */
@Composable
private fun Media(server: String, q: Question) {
    if (q.media.isEmpty()) return
    val url = if (q.media.startsWith("http")) q.media else server + q.media
    if (Regex("\\.(mp3|ogg|wav)$", RegexOption.IGNORE_CASE).containsMatchIn(q.media)) {
        val player = remember(url) { MediaPlayer().apply { setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).build()); setDataSource(url); prepareAsync() } }
        DisposableEffect(player) { onDispose { player.release() } }
        var playing by remember(url) { mutableStateOf(false) }
        OutlinedButton({ if (playing) player.pause() else player.start(); playing = !playing }, modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
            Text(if (playing) "❚❚  Pause the clip" else "▶  Play the clip")
        }
        return
    }
    val bitmap by produceState<android.graphics.Bitmap?>(null, url) {
        value = withContext(Dispatchers.IO) { try { URL(url).openStream().use { BitmapFactory.decodeStream(it) } } catch (_: Exception) { null } }
    }
    bitmap?.let {
        Image(it.asImageBitmap(), "Quiz picture", contentScale = ContentScale.Fit,
            modifier = Modifier.fillMaxWidth().aspectRatio(it.width.toFloat() / it.height).clip(RoundedCornerShape(14.dp)).padding(vertical = 8.dp))
    }
}
