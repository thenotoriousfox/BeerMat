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
import androidx.compose.foundation.layout.width
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
import androidx.compose.ui.draw.alpha
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
import kotlinx.coroutines.launch
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import org.json.JSONArray
import uk.beermat.player.game.NATIVE_TYPES
import uk.beermat.player.game.PlayerViewModel
import uk.beermat.player.game.UiState
import uk.beermat.player.game.seededOrder
import uk.beermat.player.net.Question
import java.net.URL

private const val LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"

@Composable
fun PlayScreen(vm: PlayerViewModel, ui: UiState, online: uk.beermat.player.online.OnlineViewModel) {
    val game = ui.game ?: return
    val q = game.question
    val haptics = LocalHapticFeedback.current
    LaunchedEffect(Unit) { vm.nudges.collect { if (vm.haptics) haptics.performHapticFeedback(HapticFeedbackType.LongPress) } }
    var menu by remember { mutableStateOf(false) }

    Column(Modifier.fillMaxSize()) {
        // Team bar: name, score, connection.
        Row(Modifier.fillMaxWidth().background(Brand.panel).padding(horizontal = 18.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(10.dp).clip(CircleShape).background(if (ui.connected) Brand.good else Brand.bad).semantics { contentDescription = if (ui.connected) t("Connected") else t("Reconnecting") })
            Text(game.team?.name ?: "", fontWeight = FontWeight.Bold, fontSize = 17.sp, maxLines = 1, modifier = Modifier.padding(start = 10.dp).weight(1f))
            // During the leaderboard reveal, the team's place stays hidden until the TV shows it.
            val mine = game.board.firstOrNull { it.name == game.team?.name }
            if (mine?.score != null && game.settings.leaderboardVisible) Text(t("#{rank} · {score} pts", "rank" to mine.rank, "score" to fmt(mine.score)), color = Brand.goldHi, fontWeight = FontWeight.Bold)
            TextButton({ menu = !menu }) { Text(if (menu) t("Close") else t("Team"), color = Brand.muted) }
        }
        if (!ui.connected) Text(t("Connection lost — reconnecting…"), color = Brand.onAccent, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth().background(Brand.bad).padding(6.dp))
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp)) {
            if (menu) TeamMenu(vm, ui)
            else when {
                game.team?.waiting == true -> { Lobby(t("You’re in the waiting room"), t("The quizmaster will let you in shortly.")); WaitingSetup(vm, ui) }
                game.settings.ended -> {
                    Lobby(t("That’s the quiz!"), t("Thanks for playing. Final scores are on the TV."))
                    // A live quiz's result, signed by the quiz laptop, can be kept in a BeerMat Online profile.
                    val scope = androidx.compose.runtime.rememberCoroutineScope()
                    if (online.client.baseUrl.isNotBlank()) BigButton(t("Keep this result"), enabled = !ui.busy) { scope.launch { vm.result()?.let(online::keepResult) } }
                    val o = online.ui.collectAsStateWithLifecycle().value
                    if (o.message.isNotEmpty()) Text(t(o.message), color = if (o.error) Brand.bad else Brand.goldHi, modifier = Modifier.padding(top = 8.dp))
                }
                q == null -> { Lobby(t("You’re in!"), t("Waiting for the quiz to start. Keep this app open.")); WaitingSetup(vm, ui) }
                q.type !in NATIVE_TYPES -> BrowserRound(vm, q)
                else -> Question(vm, ui, q)
            }
            // Between questions the leaderboard, as on the browser player and the TV.
            if (!menu && q != null && !q.live && !game.settings.ended && game.team?.waiting != true) Leaderboard(game)
            Message(ui)
        }
    }
}

@Composable
private fun Leaderboard(game: uk.beermat.player.net.PlayerState) {
    Text(t("Leaderboard"), style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(top = 24.dp, bottom = 6.dp).testTag("leaderboard"))
    when {
        !game.settings.leaderboardVisible -> Text(t("The quizmaster has hidden scores for now."), color = Brand.muted)
        game.teams.isEmpty() -> Text(t("Waiting for teams"), color = Brand.muted)
        else -> {
            if (game.boardHidden > 0) Text(t("Revealing the leaderboard on the TV…"), color = Brand.goldHi, modifier = Modifier.padding(bottom = 6.dp))
            for (team in game.board) {
                val mine = team.name == game.team?.name
                Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(if (mine) Brand.raised else Brand.panel).padding(horizontal = 14.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically) {
                    Text("${team.rank}", color = if (team.rank == 1) Brand.gold else Brand.faint, fontWeight = FontWeight.Bold, modifier = Modifier.width(32.dp))
                    Text(team.name, fontWeight = if (mine) FontWeight.Bold else FontWeight.Normal, modifier = Modifier.weight(1f))
                    Text(team.score?.let(::fmt) ?: "", color = Brand.goldHi, fontWeight = FontWeight.Bold)
                }
                Spacer(Modifier.height(6.dp))
            }
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

/** Until the quiz starts, or while the quizmaster hasn't let the team in yet, as the browser player's waiting screen. */
@Composable
private fun WaitingSetup(vm: PlayerViewModel, ui: UiState) {
    Spacer(Modifier.height(24.dp))
    Text(t("While you wait: add a team photo and pick your buzzer sound."), color = Brand.muted, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
    TeamSetup(vm, ui)
}

@Composable
private fun TeamMenu(vm: PlayerViewModel, ui: UiState) {
    Text(t("Your team"), style = MaterialTheme.typography.headlineMedium)
    Text(t("Recovery code"), color = Brand.muted, modifier = Modifier.padding(top = 12.dp))
    Text(ui.secret, fontSize = 13.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(vertical = 4.dp))
    Text(t("Keep it to rejoin from another phone. The quizmaster can also give you a 4-digit code to move your team."), color = Brand.faint, fontSize = 13.sp)
    TeamSetup(vm, ui)
    Spacer(Modifier.height(16.dp))
    HapticsSwitch(vm)
    Spacer(Modifier.height(16.dp))
    OutlinedButton({ openInBrowser(vmContext(vm), vm.webPlayerUrl()) }, modifier = Modifier.fillMaxWidth()) { Text(t("Open in the browser instead")) }
    OutlinedButton(vm::switchTeam, modifier = Modifier.fillMaxWidth()) { Text(t("Switch team")) }
    OutlinedButton(vm::leave, modifier = Modifier.fillMaxWidth()) { Text(t("Other quizzes")) }
}

private fun vmContext(vm: PlayerViewModel) = vm.getApplication<android.app.Application>()

/** The team's buzzer sound (heard on the TV when it buzzes first) and its photo for the big screen. */
@Composable
private fun TeamSetup(vm: PlayerViewModel, ui: UiState) {
    val game = ui.game ?: return
    val team = game.team ?: return
    val names = uk.beermat.player.net.BUILT_IN_BUZZERS + game.buzzerNames
    var open by remember { mutableStateOf(false) }
    Text(t("Your buzzer sound"), style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(top = 8.dp))
    Box {
        OutlinedButton({ open = true }, modifier = Modifier.fillMaxWidth()) { Text(team.sound?.let { names.getOrNull(it) } ?: t("Chosen for you: tap to pick one")) }
        androidx.compose.material3.DropdownMenu(open, { open = false }) {
            names.forEachIndexed { i, name -> androidx.compose.material3.DropdownMenuItem({ Text(name) }, { open = false; vm.setSound(i) }) }
        }
    }
    if (game.settings.teamPhotos) {
        val pick = androidx.activity.compose.rememberLauncherForActivityResult(androidx.activity.result.contract.ActivityResultContracts.PickVisualMedia()) { uri -> uri?.let(vm::setPhoto) }
        Text(t("Team photo"), style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(top = 16.dp))
        Text(when { team.photo.isEmpty() -> t("Add a team photo to appear on the big screen. The quizmaster approves it first.")
                    team.photoStatus == "approved" -> t("✓ Approved — showing on the TV"); else -> t("Waiting for the quizmaster to approve it") }, color = Brand.muted)
        OutlinedButton({ pick.launch(androidx.activity.result.PickVisualMediaRequest(androidx.activity.result.contract.ActivityResultContracts.PickVisualMedia.ImageOnly)) },
            modifier = Modifier.fillMaxWidth()) { Text(if (team.photo.isEmpty()) t("Choose a photo") else t("Change the photo")) }
    }
}

/** A round format this app doesn't draw: the quiz's own player page plays it, already signed in as this team. */
@Composable
private fun BrowserRound(vm: PlayerViewModel, q: Question) {
    val context = LocalContext.current
    QuestionHead(q, 0)
    Text(t("This round plays in your phone’s browser."), style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(top = 16.dp))
    Text(t("It opens as your team, and you can come back here after."), color = Brand.muted, modifier = Modifier.padding(vertical = 8.dp))
    BigButton(t("Open this round")) { openInBrowser(context, vm.webPlayerUrl()) }
}

@Composable
private fun QuestionHead(q: Question, offset: Long) {
    Text(q.round.uppercase(), color = Brand.gold, fontWeight = FontWeight.Bold, letterSpacing = 2.sp, fontSize = 13.sp)
    // Waiting for the quizmaster's Send, or wording kept off phones: the team listens.
    Text(if (q.held) t("Listen to the quizmaster…") else q.text.ifEmpty { t("Listen to the quizmaster") }, style = MaterialTheme.typography.headlineMedium, modifier = Modifier.padding(top = 6.dp, bottom = 10.dp))
    if (q.isTimed) Countdown(q, offset)
}

/** Time left, from the server's deadline; only a display, as the server decides lateness. */
@Composable
private fun Countdown(q: Question, offset: Long) {
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(q.id, q.open, q.paused) { while (q.open && !q.paused) { now = System.currentTimeMillis(); delay(200) } }
    val left = if (q.paused) q.remaining else maxOf(0L, q.deadline - now - offset)
    val text = when {
        q.held -> t("Listen: the question comes to your phone when it’s been read out")
        q.paused -> t("Paused · {n}s remaining", "n" to (q.remaining + 999) / 1000)
        !q.open || left <= 0 -> if (q.revealed) t("Answer revealed") else t("Answers closed")
        else -> t("{n}s remaining", "n" to (left + 999) / 1000)
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
    if (q.held) return
    if (q.type != "pinpoint") Media(ui.server, q, ui.offset)
    if (q.type == "buzzer") return Buzzer(vm, ui, q)
    if (q.type == "bingo" || q.type == "musicbingo") return Bingo(vm, ui, q)
    if (q.type == "clips") return Clips(vm, ui, q)

    // What the team has put: the submitted answer, else the draft saved on the server.
    val submitted = game.answer
    val locked = submitted != null || !q.open
    // Kept through the phone being turned (Compose's saved state), and in the view model as a second copy.
    var value by androidx.compose.runtime.saveable.rememberSaveable(q.id) {
        mutableStateOf(if (submitted != null) initial(q, submitted.value) else vm.localDrafts[q.id] ?: initial(q, game.draft))
    }
    LaunchedEffect(value) { if (!locked && value != initial(q, null)) { vm.localDrafts[q.id] = value; delay(500); vm.saveDraft(value) } }
    val teamId = game.team?.id ?: ""
    val order: (Int) -> List<Int> = { n -> if (game.settings.scrambleKeypads) seededOrder(n, "$teamId:${q.id}") else List(n) { it } }

    when (q.type) {
        // Letters only: six fixed A–F buttons (a letter past the last option is a wrong answer, sent as "#E"), or the
        // options of a question asked on the fly.
        "choice" -> {
            // A 50/50 taken: the choices it took away go (and a pick of one of them is cleared).
            val removed = q.raw.optJSONArray("fiftyRemoved")?.let { a -> List(a.length()) { a.optString(it) } }
            LaunchedEffect(removed) { if (removed != null && value in removed) value = initial(q, null) }
            if (q.fixedSix || q.onTheFly) {
                val count = if (q.fixedSix) 6 else q.options.size
                val valueOf: (Int) -> String = { i -> q.options.getOrNull(i) ?: "#${LETTERS[i]}" }
                Keys(List(count) { it }.filter { removed == null || valueOf(it) !in removed }.map { it to LETTERS[it].toString() }, colours = true, picked = { valueOf(it) == value }, enabled = !locked) { value = valueOf(it) }
            } else Keys(order(q.options.size).filter { removed == null || q.options[it] !in removed }.map { it to "${LETTERS[it]}. ${q.options[it]}" }, colours = true, picked = { q.options[it] == value }, enabled = !locked) { value = q.options[it] }
            if (!locked && q.raw.optBoolean("fiftyFifty") && removed == null)
                ConfirmButton(t("50/50 (scores {n})", "n" to q.raw.optInt("fiftyPoints")),
                    t("50/50? Half the wrong answers disappear, but a right answer scores {fifty} instead of {full}.", "fifty" to q.raw.optInt("fiftyPoints"), "full" to q.raw.optInt("points"))) { vm.fifty() }
        }
        "vote" -> Keys(order(q.options.size).map { it to "${LETTERS[it]}. ${q.options[it]}" }, colours = true, picked = { q.options[it] == value }, enabled = !locked) { value = q.options[it] }
        "letter" -> LetterPad(order(26), value as? String ?: "", enabled = !locked) { value = it }
        "multi" -> {
            Text(t("Tick every right answer — wrong ticks cost points"), color = Brand.muted, modifier = Modifier.padding(bottom = 8.dp))
            @Suppress("UNCHECKED_CAST") val picked = value as List<String>
            Keys(order(q.options.size).map { it to "${LETTERS[it]}. ${q.options[it]}" }, colours = true, picked = { q.options[it] in picked }, enabled = !locked) {
                val o = q.options[it]; value = if (o in picked) picked - o else picked + o
            }
        }
        "sequence" -> {
            Text(t("Tap the items in order"), color = Brand.muted)
            @Suppress("UNCHECKED_CAST") val picked = value as List<Int>
            Keys(order(q.order.size).map { q.order[it] }.map { it to q.items[it] }, colours = false, picked = { it in picked }, enabled = !locked) { if (it !in picked) value = picked + it }
            picked.forEachIndexed { n, i -> Text("${n + 1}. ${q.items[i]}", fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 4.dp)) }
            if (!locked && picked.isNotEmpty()) TextButton({ value = picked.dropLast(1) }) { Text(t("Undo last")) }
        }
        "tiles" -> {
            Text(t("Tap the tiles in order to build the answer"), color = Brand.muted)
            @Suppress("UNCHECKED_CAST") val picked = value as List<Int>
            Text(tileWord(picked.joinToString("") { q.pieces[it] }, q.wordLengths), fontFamily = Display, fontSize = 30.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(vertical = 8.dp))
            // Tiles are always in a different order on each team's phone.
            LetterTiles(seededOrder(q.pieces.size, "$teamId:${q.id}"), q.pieces, picked, enabled = !locked) { value = picked + it }
            if (!locked && picked.isNotEmpty()) TextButton({ value = picked.dropLast(1) }) { Text(t("Undo last")) }
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
                    label = { Text("${i + 1}. $item") }, modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp).testTag("sheet-$i"))
            }
        }
        else -> OutlinedTextField(
            value as String, { value = it.take(300) }, enabled = !locked, singleLine = true,
            label = { Text(when (q.type) { "nearest" -> t("Your number (closest wins)"); "number" -> t("Your number"); else -> t("Your answer") }) },
            keyboardOptions = KeyboardOptions(keyboardType = if (q.type == "number" || q.type == "nearest") KeyboardType.Decimal else KeyboardType.Text),
            modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp).testTag("answer"),
        )
    }

    Spacer(Modifier.height(16.dp))
    when {
        submitted != null -> Result(q, submitted.points)
        !q.open -> Text(if (q.revealed) t("Answer revealed") else t("Answers closed"), color = Brand.muted)
        else -> BigButton(t("Lock in answer"), enabled = !ui.busy && ready(q, value)) { vm.submit(value) }
    }
    if (q.revealed && q.answer != null) Text(t("Answer: {answer}", "answer" to q.answer), color = Brand.good, fontWeight = FontWeight.Bold, fontSize = 18.sp, modifier = Modifier.padding(top = 12.dp))
    if (q.revealed && q.answerNote.isNotEmpty()) Text(q.answerNote, color = Brand.muted)
}

/** Scoring feedback: what the server marked, once marking is final. */
@Composable
private fun Result(q: Question, points: Double?) {
    val (text, colour) = when {
        points == null -> t("Final answer received") to Brand.goldHi
        points > 0 -> (if (points == 1.0) t("+1 point") else t("+{n} points", "n" to fmt(points))) to Brand.good
        points < 0 -> t("{n} points", "n" to fmt(points)) to Brand.bad
        else -> t("No points this time") to Brand.muted
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
    // As the browser player (style.css .keypad): answers are solid colour blocks with a darker bottom edge; the picked
    // one gets a white ring and the rest step back. Other lists are plain keys that turn gold when picked.
    val anyPicked = keys.any { picked(it.first) }
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        keys.forEach { (i, label) ->
            val on = picked(i)
            val shape = RoundedCornerShape(16.dp)
            val fade by androidx.compose.animation.core.animateFloatAsState(if (!enabled) .55f else if (colours && anyPicked && !on) .4f else 1f, label = "key")
            val (light, dark) = if (colours) Brand.options[i % Brand.options.size] else if (on) Brand.goldHi to Brand.gold else Brand.raised to Brand.raised
            Box(
                Modifier.fillMaxWidth().heightIn(min = 64.dp).alpha(fade).clip(shape)
                    .background(if (colours) Color(dark.red * .78f, dark.green * .78f, dark.blue * .78f) else dark)
                    .padding(bottom = if (colours) 4.dp else 0.dp).clip(shape)
                    .background(androidx.compose.ui.graphics.Brush.linearGradient(listOf(light, dark)))
                    .then(if (on && colours) Modifier.border(4.dp, Color.White, shape) else if (!colours) Modifier.border(1.dp, Brand.line, shape) else Modifier)
                    .clickable(enabled = enabled) { haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove); tap(i) }.padding(horizontal = 18.dp, vertical = 14.dp),
                contentAlignment = Alignment.CenterStart,
            ) {
                Text(label, fontWeight = FontWeight.ExtraBold, fontSize = 19.sp,
                    color = when { colours && i % 8 == 3 && !on -> Brand.onYellow; !colours && on -> Brand.onAccent; else -> Color.White })
            }
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
        b.lockedOut -> t("Locked out — wrong answer on the last buzzer question")
        mine == "active" -> t("You buzzed first — give your answer!")
        mine == "queued" -> t("Buzzed · you are #{n} in the queue", "n" to position)
        mine == "wrong" -> t("Ruled wrong"); mine == "passed" -> t("Passed"); mine == "correct" -> t("Correct!")
        b.activeName != null -> t("{name} is answering", "name" to b.activeName)
        q.open -> t("Buzz when you know it!")
        else -> t("Buzzing closed")
    }
    val press by animateFloatAsState(if (canBuzz) 1f else .94f, label = "buzz")
    Box(Modifier.fillMaxWidth().padding(vertical = 20.dp), contentAlignment = Alignment.Center) {
        Box(
            Modifier.size(240.dp).scale(press).clip(CircleShape).background(if (canBuzz) Brand.pink else Brand.raised)
                .border(6.dp, if (mine == "active") Brand.goldHi else Color.White.copy(alpha = .15f), CircleShape)
                .clickable(enabled = canBuzz && !ui.busy) { haptics.performHapticFeedback(HapticFeedbackType.LongPress); vm.buzz() }
                .semantics { contentDescription = t("Buzz") },
            contentAlignment = Alignment.Center,
        ) { Text(t("BUZZ"), fontFamily = Display, fontSize = 52.sp, fontWeight = FontWeight.Bold, color = if (canBuzz) Brand.text else Brand.faint) }
    }
    Text(status, style = MaterialTheme.typography.titleLarge, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
    if (b.agreeOpen) {
        Text(t("{name} answered “{answer}”. Do you agree?", "name" to (b.activeName ?: ""), "answer" to b.announced.ifEmpty { "…" }), color = Brand.muted, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp))
        val canAgree = mine !in setOf("active", "passed", "wrong") && !b.agreed
        BigButton(if (b.agreed) t("✓ You agreed") else t("I agree"), enabled = canAgree && !ui.busy, colour = Brand.teal) { vm.agree() }
    }
}

/** A picture from the quiz laptop, or a sound to play on the phone. A picture with a reveal shows itself over the
 *  question's time: loaded tiny and stretched (soft) then sharper, or under twelve tiles going in the web pages' order. */
@Composable
private fun Media(server: String, q: Question, offset: Long) {
    if (q.media.isEmpty()) return
    val url = if (q.media.startsWith("http")) q.media else server + q.media
    if (Regex("\\.(mp3|ogg|wav)$", RegexOption.IGNORE_CASE).containsMatchIn(q.media)) {
        val player = remember(url) { MediaPlayer().apply { setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).build()); setDataSource(url); prepareAsync() } }
        DisposableEffect(player) { onDispose { player.release() } }
        var playing by remember(url) { mutableStateOf(false) }
        OutlinedButton({ if (playing) player.pause() else player.start(); playing = !playing }, modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
            Text(if (playing) t("❚❚  Pause the clip") else t("▶  Play the clip"))
        }
        return
    }
    val bitmap by produceState<android.graphics.Bitmap?>(null, url) {
        value = withContext(Dispatchers.IO) { try { URL(url).openStream().use { BitmapFactory.decodeStream(it) } } catch (_: Exception) { null } }
    }
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(q.id, q.open, q.paused, q.reveal) { while (q.reveal.isNotEmpty() && q.open && !q.paused) { now = System.currentTimeMillis(); delay(100) } }
    val shown = revealShare(q, now, offset)
    bitmap?.let { full ->
        // Blur: the picture shrunk and stretched (soft), sharper as it goes: twenty sizes from 6 to 240 pixels wide, the
        // next one fading in over this one so it sharpens smoothly rather than in jumps (as the Qt TV).
        val level = if (q.reveal == "blur" && shown < 1f) shown * 20f else -1f
        fun width(k: Int) = Math.round(6 * Math.pow(40.0, k / 20.0)).toInt()
        fun scaled(w: Int) = android.graphics.Bitmap.createScaledBitmap(full, w, maxOf(1, w * full.height / full.width), true)
        val step = if (level >= 0f) level.toInt() else -1
        val picture = remember(full, step) { if (step < 0) full else scaled(width(step)) }
        val sharper = remember(full, step) { if (step < 0) null else scaled(width(minOf(20, step + 1))) }
        Box(Modifier.fillMaxWidth().aspectRatio(full.width.toFloat() / full.height).padding(vertical = 8.dp).clip(RoundedCornerShape(14.dp))) {
            Image(picture.asImageBitmap(), t("Quiz picture"), contentScale = ContentScale.FillBounds, filterQuality = androidx.compose.ui.graphics.FilterQuality.High, modifier = Modifier.fillMaxSize())
            sharper?.let { Image(it.asImageBitmap(), null, contentScale = ContentScale.FillBounds, filterQuality = androidx.compose.ui.graphics.FilterQuality.High, alpha = level - step, modifier = Modifier.fillMaxSize()) }
            if (q.reveal == "tiles") {
                val order = remember(q.id) { seededOrder(12, "tiles:${q.id}") }
                val gone = (shown * 12).toInt()
                Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    for (r in 0 until 3) Row(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(3.dp)) {
                        for (c in 0 until 4) {
                            val fade by animateFloatAsState(if (order[r * 4 + c] < gone) 0f else 1f, label = "tile")
                            Box(Modifier.weight(1f).fillMaxSize().clip(RoundedCornerShape(6.dp)).background(Brand.violet.copy(alpha = fade)))
                        }
                    }
                }
            }
        }
    }
}

/** How much of a revealing picture shows (0–1): all of it once answers close or without a reveal. */
private fun revealShare(q: Question, now: Long, offset: Long): Float {
    if (q.reveal.isEmpty() || !q.live || q.revealed) return 1f
    if (q.held) return 0f
    val left = if (q.paused) q.remaining else maxOf(0L, q.deadline - now - offset)
    // Over the first revealSeconds when set (then whole for the rest of the time), else the whole time.
    return ((q.seconds * 1000f - left) / ((q.revealSeconds.takeIf { it > 0 } ?: q.seconds) * 1000f)).coerceIn(0f, 1f)
}

/** A button that asks first: for the hint and the 50/50, which cost points. */
@Composable
internal fun ConfirmButton(label: String, question: String, onConfirm: () -> Unit) {
    var asking by remember { mutableStateOf(false) }
    TextButton({ asking = true }) { Text(label) }
    if (asking) androidx.compose.material3.AlertDialog(
        onDismissRequest = { asking = false },
        text = { Text(question) },
        confirmButton = { TextButton({ asking = false; onConfirm() }) { Text(label) } },
        dismissButton = { TextButton({ asking = false }) { Text(t("Cancel")) } })
}
