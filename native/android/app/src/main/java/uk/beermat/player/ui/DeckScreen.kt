package uk.beermat.player.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
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
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import uk.beermat.player.deck.DeckQuestion
import uk.beermat.player.deck.DeckStage
import uk.beermat.player.deck.DeckState
import uk.beermat.player.deck.DeckUi
import uk.beermat.player.deck.DeckViewModel

/** What the big button does next: the Qt desk's words for the server's nextStep (desk.py STEP_LABELS). */
fun stepLabel(step: String?): String = when (step) {
    "reveal" -> t("Reveal next position"); "revealFirst" -> t("Reveal the leader"); "revealSecond" -> t("Reveal second place")
    "show" -> t("Show leaderboard"); "recap" -> t("Reveal the secret round"); "recapAnswer" -> t("Reveal the next secret answer")
    "recapResults" -> t("Show the round’s results"); "finish" -> t("Finish quiz"); "round" -> t("Start next round"); "question" -> t("Start next question")
    else -> t("Quiz finished")
}

/** Run the night: the quizmaster's phone hosting the quiz on the laptop (DeckViewModel). */
@Composable
fun DeckScreen(vm: DeckViewModel, ui: DeckUi) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp).testTag("deck")) {
        Text(t("Run the night"), style = MaterialTheme.typography.displaySmall)
        when (ui.stage) {
            DeckStage.Find -> DeckFind(vm, ui)
            DeckStage.Code -> DeckCode(vm, ui)
            DeckStage.Run -> ui.deck?.let { DeckRun(vm, ui, it) } ?: Text(t("Connecting…"), color = Brand.muted, modifier = Modifier.padding(vertical = 12.dp))
        }
        if (ui.message.isNotEmpty()) Text(ui.message, color = if (ui.error) Brand.bad else Brand.goldHi, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(vertical = 8.dp).testTag("deckMessage"))
    }
}

@Composable
private fun DeckFind(vm: DeckViewModel, ui: DeckUi) {
    var address by rememberSaveable { mutableStateOf(ui.address.removePrefix("http://")) }
    Text(t("Host the quiz on the laptop from this phone: the questions, the reveals and the leaderboard. The laptop keeps the TV and the sound."),
        color = Brand.muted, modifier = Modifier.padding(vertical = 8.dp))
    BigButton(if (ui.searching) t("Looking for the quiz…") else t("Find the quiz"), enabled = !ui.searching && !ui.busy, modifier = Modifier.testTag("deckFind")) { vm.search() }
    Text(t("Or type the laptop’s address"), color = Brand.muted, modifier = Modifier.padding(top = 16.dp))
    OutlinedTextField(address, { address = it.trim() }, singleLine = true, placeholder = { Text("192.168.1.20:3000") }, modifier = Modifier.fillMaxWidth().testTag("deckAddress"))
    OutlinedButton({ vm.connect(address) }, enabled = address.isNotBlank() && !ui.busy, modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) { Text(t("Connect")) }
}

@Composable
private fun DeckCode(vm: DeckViewModel, ui: DeckUi) {
    var code by rememberSaveable { mutableStateOf("") }
    Text(t("Found {title}.", "title" to ui.title), fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 8.dp))
    Text(t("On the laptop: Settings → Phone deck → Show a code. Type it here."), color = Brand.muted, modifier = Modifier.padding(vertical = 8.dp))
    OutlinedTextField(code, { code = it.filter(Char::isDigit).take(6) }, singleLine = true, label = { Text(t("Code")) },
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword), modifier = Modifier.fillMaxWidth().testTag("deckCode"))
    Spacer(Modifier.height(12.dp))
    BigButton(t("Host this quiz"), enabled = code.length == 6 && !ui.busy, modifier = Modifier.testTag("deckSignIn")) { vm.code(code) }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun DeckRun(vm: DeckViewModel, ui: DeckUi, d: DeckState) {
    var confirm by remember { mutableStateOf<String?>(null) }
    Text(d.title + if (d.rehearsal) " · " + t("Rehearsal") else "", color = Brand.muted, modifier = Modifier.padding(bottom = 12.dp))
    d.question?.let { QuestionCard(vm, ui, d, it) }
    Spacer(Modifier.height(12.dp))
    BigButton(stepLabel(d.nextStep), enabled = d.canNext && !ui.busy, modifier = Modifier.testTag("deckNext")) { if (d.nextStep == "finish") confirm = "finish" else vm.next() }
    if (d.back != null) TextButton({ if (d.backAnswers > 0) confirm = "back" else vm.back() }, enabled = !ui.busy) { Text(t("Back: {step}", "step" to d.back.replaceFirstChar { it.lowercase() })) }
    if (!d.deskOpen) Text(t("The desk isn’t open on the laptop: clips, songs and sounds need it."), color = Brand.goldHi, fontSize = 13.sp)

    Text(t("Leaderboard"), style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(top = 20.dp, bottom = 6.dp))
    if (d.teams.isEmpty()) Text(t("No teams yet"), color = Brand.muted)
    for (team in d.teams) Row(Modifier.fillMaxWidth().padding(vertical = 3.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(if (team.rank > 0) "${team.rank}" else "–", color = Brand.faint, modifier = Modifier.padding(end = 10.dp))
        Text(team.name, modifier = Modifier.weight(1f), color = if (team.connected) Brand.text else Brand.faint)
        Text(team.score.let { if (it % 1.0 == 0.0) it.toLong().toString() else it.toString() }, fontWeight = FontWeight.Bold, color = Brand.goldHi)
    }
    Text(t("Marking, rounds and settings stay on the laptop’s desk."), color = Brand.faint, fontSize = 13.sp, modifier = Modifier.padding(top = 16.dp))
    OutlinedButton({ vm.leave() }, enabled = !ui.busy, modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) { Text(t("Stop hosting from this phone")) }

    when (confirm) {
        "finish" -> AlertDialog({ confirm = null }, title = { Text(t("Finish quiz")) }, text = { Text(t("Finish this quiz and close answers and registration? You can resume it later.")) },
            confirmButton = { TextButton({ confirm = null; vm.next() }) { Text(t("Finish quiz")) } }, dismissButton = { TextButton({ confirm = null }) { Text(t("Cancel")) } })
        "back" -> AlertDialog({ confirm = null }, title = { Text(t("Back: {step}", "step" to (d.back ?: ""))) },
            text = { Text(t("{n} team(s) have answered; those answers are thrown away.", "n" to d.backAnswers)) },
            confirmButton = { TextButton({ confirm = null; vm.back() }) { Text(t("Go back")) } }, dismissButton = { TextButton({ confirm = null }) { Text(t("Cancel")) } })
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun QuestionCard(vm: DeckViewModel, ui: DeckUi, d: DeckState, q: DeckQuestion) {
    // The countdown, ticking here between the server's updates.
    var left by remember(q.id, q.remaining, q.paused) { mutableLongStateOf(q.remaining) }
    LaunchedEffect(q.id, q.remaining, q.open, q.paused) { while (q.open && !q.paused && left > 0) { delay(1000); left = maxOf(0, left - 1000) } }
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(Brand.panel).padding(16.dp)) {
        if (q.round.isNotBlank()) Text(q.round, color = Brand.faint, fontSize = 13.sp)
        Text(q.text, style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(vertical = 6.dp).testTag("deckQuestion"))
        val status = when {
            q.held -> t("Waiting to be sent to the phones")
            q.paused -> t("Paused")
            q.open -> t("Open: {s}s left", "s" to (left + 999) / 1000)
            q.revealing -> t("Drum roll…")
            q.revealed -> t("Answer: {answer}", "answer" to q.answer)
            else -> t("Closed")
        }
        Text(status, color = if (q.open) Brand.good else Brand.goldHi, fontWeight = FontWeight.SemiBold)
        Text(t("{n} of {total} teams answered", "n" to d.answered, "total" to d.teams.size), color = Brand.muted, fontSize = 13.sp)
        if (!q.revealed && q.answer.isNotBlank()) Text(t("Answer: {answer}", "answer" to q.answer), color = Brand.faint, fontSize = 13.sp)
        FlowRow(Modifier.padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            val busy = ui.busy
            if (d.canSend) OutlinedButton(vm::send, enabled = !busy) { Text(t("Send question")) }
            if (d.canPause) OutlinedButton(vm::pause, enabled = !busy) { Text(t("Pause timer")) }
            if (d.canResume) OutlinedButton(vm::resume, enabled = !busy) { Text(t("Resume timer")) }
            if (d.canClose) OutlinedButton(vm::close, enabled = !busy, modifier = Modifier.testTag("deckClose")) { Text(t("Close answers")) }
            if (d.canReveal) OutlinedButton(vm::reveal, enabled = !busy, modifier = Modifier.testTag("deckReveal")) { Text(t("Reveal answer")) }
        }
        // The round's own controls; what plays, plays from the laptop.
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            val busy = ui.busy || !d.deskOpen
            when (q.type) {
                "clips" -> if (q.live) {
                    OutlinedButton({ vm.desk("playClips") }, enabled = !busy) { Text(t("Play all clips")) }
                    for (i in 0 until q.clips) OutlinedButton({ vm.desk("playClip", i) }, enabled = !busy) { Text(t("Clip {n}", "n" to i + 1)) }
                    OutlinedButton({ vm.desk("stopClips") }, enabled = !busy) { Text(t("Stop")) }
                }
                "bingo", "musicbingo" -> OutlinedButton({ vm.desk("callNumber") }, enabled = !busy) { Text(if (q.type == "bingo") t("Call next number") else t("Next song")) }
                "buzzer" -> q.buzzing?.let { name ->
                    Text(t("{team} buzzed", "team" to name), fontWeight = FontWeight.Bold, modifier = Modifier.align(Alignment.CenterVertically))
                    OutlinedButton({ vm.buzz("correct") }, enabled = !ui.busy) { Text(t("Correct")) }
                    OutlinedButton({ vm.buzz("wrong") }, enabled = !ui.busy) { Text(t("Wrong")) }
                    OutlinedButton({ vm.buzz("pass") }, enabled = !ui.busy) { Text(t("Pass")) }
                }
            }
            if (q.audio) {
                OutlinedButton({ vm.desk("playAudio") }, enabled = !busy) { Text(t("Play the sound again")) }
                OutlinedButton({ vm.desk("pauseAudio") }, enabled = !busy) { Text(t("Pause or carry on")) }
            }
        }
    }
}
