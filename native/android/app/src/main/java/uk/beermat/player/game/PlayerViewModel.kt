package uk.beermat.player.game

import uk.beermat.player.ui.t
import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import uk.beermat.player.data.Identity
import uk.beermat.player.net.Hello
import uk.beermat.player.net.PROTOCOL
import uk.beermat.player.net.PlayerState
import uk.beermat.player.net.QuizError
import uk.beermat.player.net.QuizServer
import uk.beermat.player.net.Scanned

/** Round formats the app draws itself; any other opens the quiz's own player page in the browser (same team). */
val NATIVE_TYPES = setOf("text", "picture", "audio", "choice", "vote", "multi", "letter", "number", "nearest", "sequence", "tiles", "sheet", "buzzer",
    "pinpoint", "wordsnake", "bingo", "musicbingo", "clips")

enum class Stage { Connect, Join, Play }

data class UiState(
    val stage: Stage = Stage.Connect,
    val server: String = "",
    val hello: Hello? = null,
    val game: PlayerState? = null,
    val secret: String = "",
    val connected: Boolean = false,
    val busy: Boolean = false,
    val message: String = "",
    val error: Boolean = false,
    val wifi: Scanned.Wifi? = null,
    /** Server clock minus this phone's, so countdowns run locally between updates. */
    val offset: Long = 0,
    val recent: List<Identity.Recent> = emptyList(),
    /** The quiz's look on this phone: background and scenery (its colours are in Brand). */
    val look: uk.beermat.player.ui.PhoneLook? = null,
)

/**
 * The player's side of a quiz. It shows the server's state and sends what the team does; the server times, checks and
 * scores everything (docs/CLIENT-PROTOCOL.md), so nothing here decides a score, a deadline or who may play.
 */
class PlayerViewModel(app: Application) : AndroidViewModel(app) {
    private val identity = Identity(app)
    private val _ui = MutableStateFlow(UiState(recent = identity.recent()))
    val ui: StateFlow<UiState> = _ui
    private val _nudges = MutableSharedFlow<Unit>(extraBufferCapacity = 4)
    /** A short buzz in the pocket: a new question, or the team's turn to answer a buzzer. */
    val nudges: SharedFlow<Unit> = _nudges
    val haptics get() = identity.haptics

    private var server: QuizServer? = null
    private var live: Job? = null
    private var seenQuestion: Long? = null
    private var buzzTurn: Long? = null

    fun say(text: String, error: Boolean = false) = _ui.update { it.copy(message = text, error = error) }

    // ---- connecting ----
    fun scanned(text: String) {
        when (val s = Scanned.parse(text)) {
            is Scanned.Address -> connect(s.url)
            is Scanned.Wifi -> _ui.update { it.copy(wifi = s, message = "", error = false) }
            Scanned.Unknown -> say(t("That code isn’t a BeerMat quiz."), true)
        }
    }

    fun dismissWifi() = _ui.update { it.copy(wifi = null) }

    fun connect(address: String) {
        val quiz = try { QuizServer(address) } catch (_: Exception) { return say(t("That doesn’t look like a quiz address."), true) }
        work {
            val hello = quiz.hello()
            if (hello.protocol > PROTOCOL) throw QuizError(t("This quiz needs a newer BeerMat app. You can still play in the phone’s browser."), 0)
            server = quiz
            identity.remember(quiz.base, hello.title)
            _ui.update { it.copy(server = quiz.base, hello = hello, recent = identity.recent(), wifi = null) }
            val saved = identity.team(quiz.base)
            if (saved != null && resume(saved.secret)) return@work
            _ui.update { it.copy(stage = Stage.Join) }
        }
    }

    private suspend fun resume(secret: String): Boolean = try {
        val state = server!!.state(secret)
        play(secret, state); true
    } catch (e: QuizError) {
        // The quiz moved on (a new quiz forgets every team) or the code was replaced.
        if (e.status == 401) { identity.forgetTeam(server!!.base); say(t("A new quiz has started — pick your team name again.")) } else say(e.message ?: "", true)
        false
    }

    fun join(name: String, table: Int? = null) = work {
        val joined = server!!.join(name.trim(), table)
        identity.saveTeam(Identity.Saved(server!!.base, joined.secret, name.trim(), ""))
        play(joined.secret, server!!.state(joined.secret))
    }

    fun recover(code: String) = work {
        val c = code.trim()
        val secret = if (Regex("^\\d{4}$").matches(c)) server!!.transfer(c) else c
        val state = server!!.state(secret)
        identity.saveTeam(Identity.Saved(server!!.base, secret, state.team?.name ?: "", state.event))
        play(secret, state)
        say(t("Welcome back"))
    }

    fun leave() {
        live?.cancel(); live = null
        undress()
        server = null; seenQuestion = null
        _ui.update { UiState(recent = identity.recent()) }
    }

    fun switchTeam() {
        server?.let { identity.forgetTeam(it.base) }
        live?.cancel(); live = null
        _ui.update { it.copy(stage = Stage.Join, game = null, secret = "") }
    }

    // ---- playing ----
    private fun play(secret: String, state: PlayerState) {
        show(secret, state)
        _ui.update { it.copy(stage = Stage.Play, secret = secret) }
        live?.cancel()
        live = viewModelScope.launch {
            launch { server!!.updates(secret).collect { on -> _ui.update { it.copy(connected = on) }; if (on) refresh() } }
            // A slow poll covers missed updates, as the web page does.
            while (isActive) { delay(15000); refresh() }
        }
    }

    fun refresh() {
        val quiz = server ?: return
        val secret = _ui.value.secret.ifEmpty { return }
        viewModelScope.launch {
            try { show(secret, quiz.state(secret)) } catch (e: QuizError) {
                if (e.status == 401) {
                    identity.forgetTeam(quiz.base); live?.cancel()
                    _ui.update { it.copy(stage = Stage.Join, game = null, secret = "", message = t("A new quiz has started — pick your team name again."), error = false) }
                } else say(e.message ?: "", true)
            } catch (_: Exception) { _ui.update { it.copy(connected = false) } }
        }
    }

    private fun show(secret: String, state: PlayerState) {
        val q = state.question
        if (q != null && q.open && !state.testDevice && seenQuestion != null && seenQuestion != q.id) _nudges.tryEmit(Unit)
        if (q != null) seenQuestion = q.id else if (seenQuestion == null) seenQuestion = 0
        if (q?.buzz?.buzzed == "active" && buzzTurn != q.id) { buzzTurn = q.id; _nudges.tryEmit(Unit) }
        server?.let { identity.saveTeam(Identity.Saved(it.base, secret, state.team?.name ?: "", state.event)) }
        _ui.update { it.copy(game = state, offset = state.serverTime - System.currentTimeMillis(), connected = true) }
        dress(state.look)
    }

    // The quiz's look, fetched once each time it changes: its colours for the whole app, its scenery for the play screen.
    private var lookShown = ""
    private fun dress(id: String) {
        if (id == lookShown) return
        lookShown = id
        val quiz = server ?: return
        viewModelScope.launch {
            val look = try { if (id == "stage") null else quiz.look(id) } catch (_: Exception) { null }
            if (lookShown != id) return@launch
            uk.beermat.player.ui.Brand.apply(look?.colours ?: emptyMap())
            _ui.update { it.copy(look = look) }
        }
    }
    private fun undress() { lookShown = ""; uk.beermat.player.ui.Brand.apply(emptyMap()); _ui.update { it.copy(look = null) } }

    fun submit(value: Any, wager: Int? = null) {
        val q = _ui.value.game?.question ?: return
        work(quiet = true) { server!!.answer(_ui.value.secret, q.id, QuizServer.jsonValue(value), wager); refresh() }
    }

    fun saveDraft(value: Any) {
        val q = _ui.value.game?.question ?: return
        viewModelScope.launch { try { server?.draft(_ui.value.secret, q.id, QuizServer.jsonValue(value)) } catch (_: Exception) {} }
    }

    fun buzz() { val q = _ui.value.game?.question ?: return; work(quiet = true) { server!!.buzz(_ui.value.secret, q.id); refresh() } }

    /** The signed result to keep (after the quiz ends); null with a message when there's none. */
    suspend fun result(): org.json.JSONObject? = try { server?.result(_ui.value.secret) } catch (e: QuizError) { say(e.message ?: "", true); null } catch (_: Exception) { say(t("Can’t reach the quiz"), true); null }

    fun rename(name: String) = work(quiet = true) { server!!.rename(_ui.value.secret, name.trim()); say(t("Team name saved")); refresh() }
    /** VAR Check: ask the quizmaster to look at this team's marking of the question again. */
    fun askVar(question: Long) = work(quiet = true) { server!!.varCheck(_ui.value.secret, question); say(t("VAR Check sent: the quizmaster is reviewing it")); refresh() }
    fun setSound(index: Int) = work(quiet = true) { server!!.sound(_ui.value.secret, index); say(t("Buzzer sound saved")); refresh() }

    /** A picture from the phone, cropped square to 360 px and sent as a JPEG (as the browser player does). */
    fun setPhoto(uri: android.net.Uri) = work(quiet = true) {
        val jpeg = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Default) {
            val resolver = getApplication<Application>().contentResolver
            val source = resolver.openInputStream(uri)!!.use { android.graphics.BitmapFactory.decodeStream(it) }
            val side = minOf(source.width, source.height)
            val square = android.graphics.Bitmap.createBitmap(source, (source.width - side) / 2, (source.height - side) / 2, side, side)
            val small = android.graphics.Bitmap.createScaledBitmap(square, 360, 360, true)
            java.io.ByteArrayOutputStream().also { small.compress(android.graphics.Bitmap.CompressFormat.JPEG, 85, it) }.toByteArray()
        }
        server!!.photo(_ui.value.secret, jpeg); say(t("Photo sent: the quizmaster approves it first")); refresh()
    }

    fun claimBingo() { val q = _ui.value.game?.question ?: return; work(quiet = true) { server!!.bingo(_ui.value.secret, q.id); say(t("BINGO called — the quizmaster is checking")); refresh() } }

    fun tap() { val q = _ui.value.game?.question ?: return; work(quiet = true) { server!!.tap(_ui.value.secret, q.id); say(t("Tap recorded")); refresh() } }

    fun fifty() { val q = _ui.value.game?.question ?: return; work(quiet = true) { server!!.fifty(_ui.value.secret, q.id); refresh() } }
    fun goWide() { val q = _ui.value.game?.question ?: return; work(quiet = true) { server!!.goWide(_ui.value.secret, q.id); refresh() } }

    /** What the team has put but not locked in, per question: survives the phone being turned (as the browser keeps
     *  it in its storage); also saved to the server as a draft. */
    val localDrafts = mutableMapOf<Long, Any>()

    /** Bingo dabs stay on the phone, as on paper (the server checks the ticket against the calls). */
    val dabs = androidx.compose.runtime.mutableStateMapOf<Long, Set<String>>()
    fun dab(question: Long, cell: String) { val now = dabs[question] ?: emptySet(); dabs[question] = if (cell in now) now - cell else now + cell }

    /** Music bingo's reaction table: one go per song, so the songs tried are remembered. */
    val reacted = androidx.compose.runtime.mutableStateListOf<String>()
    fun react(title: String?) {
        val q = _ui.value.game?.question ?: return
        val song = q.raw.optJSONObject("reactionTable")?.optInt("song") ?: return
        val key = "${q.id}:$song"
        if (song == 0 || key in reacted) return
        reacted += key
        viewModelScope.launch {
            try { server?.react(_ui.value.secret, q.id, title); say(if (title == null) t("Passed on this song") else t("Dabbed: if it’s the song playing, your time is on the TV")) }
            catch (e: QuizError) { say(e.message ?: "", true) } catch (_: Exception) {}
        }
    }

    fun agree() { val q = _ui.value.game?.question ?: return; work(quiet = true) { server!!.agree(_ui.value.secret, q.id); refresh() } }

    /** The app went to the background (or came back) during an open question: the quizmaster sees it. */
    fun away(state: String) {
        val q = _ui.value.game?.question ?: return
        if (!q.live || _ui.value.game?.answer != null || _ui.value.game?.testDevice == true) return
        viewModelScope.launch { try { server?.away(_ui.value.secret, q.id, state) } catch (_: Exception) {} }
        if (state == "back") refresh()
    }

    /** The quiz's own player page, already signed in as this team (for formats the app doesn't draw). */
    fun webPlayerUrl(): String = "${_ui.value.server}/#team=${_ui.value.secret}"

    fun setHaptics(on: Boolean) { identity.haptics = on }

    private fun work(quiet: Boolean = false, block: suspend () -> Unit) {
        if (_ui.value.busy) return
        _ui.update { it.copy(busy = true, message = if (quiet) it.message else "", error = false) }
        viewModelScope.launch {
            try { block() } catch (e: QuizError) { say(e.message ?: "", true) } catch (_: Exception) {
                say(t("Can’t reach the quiz. Check you’re on the quiz Wi-Fi, then try again."), true)
            } finally { _ui.update { it.copy(busy = false) } }
        }
    }
}
