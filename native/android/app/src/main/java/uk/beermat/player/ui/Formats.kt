package uk.beermat.player.ui

import android.graphics.BitmapFactory
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.material3.OutlinedButton
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import uk.beermat.player.game.PlayerViewModel
import uk.beermat.player.game.UiState
import uk.beermat.player.net.Question
import java.net.URL

private fun JSONArray?.ints() = if (this == null) emptyList() else List(length()) { optInt(it) }
private fun JSONArray?.strings() = if (this == null) emptyList() else List(length()) { optString(it) }

/**
 * Pinpoint: tap the picture. Go wide allows a second tap, scored lower if the first misses. Points are fractions of
 * the picture, as the server expects ([[x, y], …]); the target appears once revealed.
 */
@Composable
fun Pinpoint(server: String, q: Question, taps: List<List<Double>>, enabled: Boolean, onTaps: (List<List<Double>>) -> Unit) {
    val url = if (q.media.startsWith("http")) q.media else server + q.media
    val bitmap by produceState<android.graphics.Bitmap?>(null, url) {
        value = withContext(Dispatchers.IO) { try { URL(url).openStream().use { BitmapFactory.decodeStream(it) } } catch (_: Exception) { null } }
    }
    val most = if (q.raw.optBoolean("goWide")) 2 else 1
    val target = q.raw.optJSONObject("target")
    Text(if (most == 2) t("Tap the picture. Go wide: a second tap scores {n} if your first misses.", "n" to q.raw.optInt("goWidePoints")) else t("Tap the picture to place your answer"),
        color = Brand.muted, modifier = Modifier.padding(bottom = 8.dp))
    val image = bitmap ?: return Text(t("Loading the picture…"), color = Brand.faint)
    Box(Modifier.fillMaxWidth().aspectRatio(image.width.toFloat() / image.height).clip(RoundedCornerShape(12.dp))
        .pointerInput(enabled, taps) {
            if (enabled) detectTapGestures { at ->
                val point = listOf((at.x / size.width).toDouble().coerceIn(0.0, 1.0), (at.y / size.height).toDouble().coerceIn(0.0, 1.0))
                onTaps(if (taps.size < most) taps + listOf(point) else taps.dropLast(1) + listOf(point))
            }
        }.semantics { contentDescription = t("Quiz picture: tap to place your answer") }) {
        Image(image.asImageBitmap(), null, contentScale = ContentScale.FillBounds, modifier = Modifier.matchParentSize())
        Canvas(Modifier.matchParentSize()) {
            taps.forEachIndexed { i, t ->
                val c = Offset((t[0] * size.width).toFloat(), (t[1] * size.height).toFloat())
                drawCircle(if (i == 0) Brand.pink else Brand.gold, 14.dp.toPx(), c)
                drawCircle(Brand.text, 14.dp.toPx(), c, style = Stroke(3.dp.toPx()))
            }
            if (target != null && q.revealed) {
                drawCircle(Brand.good, (target.optDouble("r") * size.width).toFloat(), Offset((target.optDouble("x") * size.width).toFloat(), (target.optDouble("y") * size.height).toFloat()),
                    style = Stroke(4.dp.toPx()))
            }
        }
    }
    if (enabled && taps.isNotEmpty()) TextButton({ onTaps(taps.dropLast(1)) }) { Text(t("Undo tap")) }
}

/** Word trail: trace the answer, each letter touching the last (diagonals too); a letter that doesn't touch starts again. */
@Composable
fun WordSnake(vm: PlayerViewModel, q: Question, path: List<Int>, enabled: Boolean, onPath: (List<Int>) -> Unit) {
    val grid = q.raw.optJSONObject("grid") ?: return
    val n = grid.optInt("size")
    val letters = grid.optJSONArray("letters").strings()
    val wide = q.raw.optJSONArray("wideCells")?.ints()
    val haptics = LocalHapticFeedback.current
    fun adjacent(a: Int, b: Int) = a != b && kotlin.math.abs(a / n - b / n) <= 1 && kotlin.math.abs(a % n - b % n) <= 1
    Text(t("Trace the answer: each letter touches the last, diagonals too."), color = Brand.muted)
    Text(path.joinToString("") { letters[it] }.ifEmpty { t("Tap the first letter") }, fontFamily = Display, fontSize = 28.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(vertical = 8.dp))
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        for (row in 0 until n) Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            for (col in 0 until n) {
                val i = row * n + col
                val gone = wide != null && i !in wide
                val step = path.indexOf(i)
                Box(Modifier.weight(1f).aspectRatio(1f).testTag("cell-$i").clip(RoundedCornerShape(10.dp))
                    .background(if (step >= 0) Brand.gold else if (gone) Brand.raised.copy(alpha = .25f) else Brand.raised)
                    .clickable(enabled = enabled && !gone) {
                        haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                        val last = path.lastOrNull()
                        onPath(if (last == null || (i !in path && adjacent(last, i))) path + i else listOf(i))
                    }, contentAlignment = Alignment.Center) {
                    Text(letters.getOrElse(i) { "" }, fontFamily = Display, fontSize = 24.sp, fontWeight = FontWeight.Bold, color = if (step >= 0) Brand.onAccent else if (gone) Brand.faint else Brand.text)
                }
            }
        }
    }
    Row {
        if (enabled && path.isNotEmpty()) TextButton({ onPath(emptyList()) }) { Text(t("Start again")) }
        if (enabled && q.raw.optBoolean("goWide") && wide == null) TextButton({ vm.goWide() }) { Text(t("Go wide (scores {n})", "n" to q.raw.optInt("goWidePoints"))) }
    }
}

/** Bingo and music bingo: the team's ticket (dabbed on the phone, as on paper) and the BINGO shout. */
@Composable
fun Bingo(vm: PlayerViewModel, ui: UiState, q: Question) {
    val b = q.raw.optJSONObject("bingo") ?: return
    val music = b.optBoolean("music")
    val dabbed = vm.dabs[q.id] ?: emptySet()
    val card = b.optJSONArray("card")
    val mine = b.optJSONObject("myShout")
    val calls = if (music) b.optInt("played") else b.optInt("count")
    val checking = mine?.optString("status") == "pending"
    val turnedDown = mine?.optString("status") == "wrong" && mine.optInt("seq") == calls
    val claimed = b.optBoolean("claimed")
    Text(if (music) t("Music bingo · {n} played", "n" to b.optInt("played")) else t("{n} called", "n" to b.optInt("count")), color = Brand.muted)
    Text(if (music) (if (b.optInt("played") > 0) t("Song {n}", "n" to b.optInt("played")) else "–") else (if (b.isNull("last")) "–" else b.optInt("last").toString()),
        fontFamily = Display, fontSize = 64.sp, fontWeight = FontWeight.Bold, color = Brand.goldHi)
    if (music) b.optJSONArray("titles").strings().lastOrNull()?.let { Text(t("Revealed: {title}", "title" to it), color = Brand.muted) }
    else if (!b.isNull("phrase")) Text(b.optString("phrase"), color = Brand.muted)
    Column(verticalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(vertical = 12.dp)) {
        for (r in 0 until (card?.length() ?: 0)) Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            val row = card!!.optJSONArray(r)
            for (c in 0 until row.length()) {
                val cell = row.opt(c)
                val label = if (cell == null || cell == JSONObject.NULL) "" else cell.toString()
                val on = label.isNotEmpty() && label in dabbed
                Box(Modifier.weight(1f).aspectRatio(if (music) 1.6f else 1f).clip(RoundedCornerShape(8.dp))
                    .background(if (label.isEmpty()) Brand.bg2 else if (on) Brand.pink else Brand.raised)
                    .clickable(enabled = label.isNotEmpty()) {
                        // The reaction table: dabbing a song sends it (one go per song; the server times it against the song playing).
                        if (music && label !in dabbed && q.raw.has("reactionTable")) vm.react(label)
                        vm.dab(q.id, label)
                    }, contentAlignment = Alignment.Center) {
                    Text(label, fontSize = if (music) 11.sp else 18.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center, maxLines = 2, color = Brand.text)
                }
            }
        }
    }
    q.raw.optJSONObject("reactionTable")?.let { r ->
        Text(t("Dab the song as soon as you know it: the quickest team on each song is on the TV."), color = Brand.muted, fontSize = 13.sp)
        OutlinedButton({ vm.react(null) }, enabled = ui.connected && q.live && !q.paused && r.optInt("song") > 0 && "${q.id}:${r.optInt("song")}" !in vm.reacted,
            modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp)) { Text(t("Not on my ticket")) }
        val now = r.optJSONArray("now")
        if (now != null && now.length() > 0) {
            Text(t("Reactions · song {n}", "n" to r.optInt("song")), color = Brand.teal, fontWeight = FontWeight.Bold)
            for (i in 0 until minOf(5, now.length())) now.optJSONObject(i)?.let { Text("${i + 1}. ${it.optString("name")}  ${"%.1f".format(it.optLong("ms") / 1000.0)}s", color = if (i == 0) Brand.goldHi else Brand.text) }
        }
    }
    BigButton(t("BINGO!"), enabled = ui.connected && q.live && !q.paused && !claimed && !b.optBoolean("over") && !checking && !turnedDown && !ui.busy, colour = Brand.pink) { vm.claimBingo() }
    Text(when {
        claimed -> t("✓ Bingo! The quizmaster says yes.")
        checking -> t("Your BINGO call is being checked…")
        turnedDown -> t("Not a bingo this time — keep playing")
        else -> b.optJSONArray("winners").strings().takeIf { it.isNotEmpty() }?.let { t("Winners: {names}", "names" to it.joinToString(", ")) } ?: ""
    }, color = Brand.goldHi, modifier = Modifier.padding(top = 8.dp))
}

/** Sound clips: the clips play on the TV; tap while the one the question asks for is playing. */
@Composable
fun Clips(vm: PlayerViewModel, ui: UiState, q: Question) {
    val c = q.raw.optJSONObject("clipGame") ?: return
    val playing = if (c.isNull("playing")) null else c.optInt("playing")
    val tapped = if (c.isNull("tapped")) null else c.opt("tapped")
    val canTap = ui.connected && q.live && !q.paused && playing != null && tapped == null
    val haptics = LocalHapticFeedback.current
    Text(when {
        tapped != null -> t("You tapped: {clip}", "clip" to tapped)
        playing != null -> t("🎵 Clip {n} of {count}", "n" to playing, "count" to c.optInt("count"))
        q.live -> t("Get ready — listen for the clips")
        else -> t("Clips finished")
    }, style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(vertical = 12.dp))
    Box(Modifier.fillMaxWidth().padding(vertical = 12.dp), contentAlignment = Alignment.Center) {
        Box(Modifier.size(220.dp).clip(CircleShape).background(if (canTap) Brand.teal else Brand.raised).border(6.dp, Brand.text.copy(alpha = .15f), CircleShape)
            .clickable(enabled = canTap && !ui.busy) { haptics.performHapticFeedback(HapticFeedbackType.LongPress); vm.tap() }
            .semantics { contentDescription = t("Tap for this clip") }, contentAlignment = Alignment.Center) {
            Text(t("TAP"), fontFamily = Display, fontSize = 52.sp, fontWeight = FontWeight.Bold, color = if (canTap) Brand.onAccent else Brand.faint)
        }
    }
}
