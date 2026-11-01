package uk.beermat.player.deck

import android.app.Application
import android.os.Build
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import org.json.JSONObject
import uk.beermat.player.net.QuizError
import uk.beermat.player.net.QuizServer
import uk.beermat.player.online.OnlineClient
import uk.beermat.player.online.OnlineError
import uk.beermat.player.tv.TvFinder
import uk.beermat.player.ui.t

enum class DeckStage { Find, Code, Run }

data class DeckUi(
    val stage: DeckStage = DeckStage.Find,
    val searching: Boolean = false,
    val address: String = "",
    val title: String = "",
    val deck: DeckState? = null,
    val busy: Boolean = false,
    val message: String = "",
    val error: Boolean = false,
)

/**
 * Run the night: this phone hosting the quiz on the laptop, beside the Qt desk (the deck routes in server.js). It finds the
 * laptop as the TV app does (the quiz Wi-Fi or the venue's), signs in with a ticket from BeerMat Online when the
 * account runs the venue (or is an admin's), or with the code the desk shows, and then does what the desk's Next,
 * Close, Reveal and the round's own controls do. Clips, songs and audio play from the laptop: the phone asks the desk.
 */
class DeckViewModel(app: Application) : AndroidViewModel(app) {
    private val prefs = app.getSharedPreferences("beermat-deck", 0)
    private val online = OnlineClient(app)
    private val _ui = MutableStateFlow(DeckUi(address = prefs.getString("address", "") ?: ""))
    val ui: StateFlow<DeckUi> = _ui
    private var server: QuizServer? = null
    private var key: String? = prefs.getString("key", null)
    private var following: Job? = null
    private val name get() = online.profile?.optString("displayName")?.takeIf { it.isNotBlank() }?.let { t("{name}’s phone", "name" to it) } ?: Build.MODEL

    fun say(text: String, error: Boolean = false) = _ui.update { it.copy(message = text, error = error) }

    /** Where the laptop is: the last address, the network's router and the quiz Wi-Fi's, then the whole network. */
    fun search() {
        if (_ui.value.searching) return
        _ui.update { it.copy(searching = true, message = "", error = false) }
        viewModelScope.launch {
            val context = getApplication<Application>()
            val gateway = TvFinder.gateway(context)
            val first = TvFinder.candidates(prefs.getString("address", null), gateway) + listOfNotNull(gateway, TvFinder.HOTSPOT).map { QuizServer.normalise("$it:${TvFinder.DESK_PORT}") }
            val found = TvFinder.find((first + TvFinder.neighbours(TvFinder.ownAddress(context))).distinct()) { base ->
                runCatching { QuizServer(base).deckHello().optString("title", "BeerMat") }.getOrNull()
            }
            _ui.update { it.copy(searching = false) }
            if (found == null) say(t("No quiz found. Join the quiz Wi-Fi (or the venue’s, with the laptop on it) and try again, or type the laptop’s address."), true)
            else connect(found.first)
        }
    }

    /** The laptop at [address]: a ticket from BeerMat Online if this account may host there, else the desk's code. */
    fun connect(address: String) = work {
        val s = try { QuizServer(address) } catch (_: Exception) { throw QuizError(t("That address isn’t a BeerMat quiz."), 0) }
        val hello = s.deckHello()
        server = s
        prefs.edit().putString("address", s.base).apply()
        _ui.update { it.copy(address = s.base, title = hello.optString("title", "BeerMat")) }
        // Back to a laptop this phone already hosts: the key it had still works until the desk takes it off.
        if (key != null && prefs.getString("keyFor", null) == s.base && runCatching { s.host(key!!, "state") }.isSuccess) return@work run()
        val ticket = if (online.signedIn) try { online.deckTicket(hello.getString("venueKey")) } catch (e: OnlineError) { say(e.message ?: "", true); null } else null
        if (ticket == null) { _ui.update { it.copy(stage = DeckStage.Code) }; return@work }
        signedIn(s.deckLogin(name, ticket = ticket))
    }

    fun code(code: String) = work { signedIn(server!!.deckLogin(name, code = code)) }

    private fun signedIn(newKey: String) {
        key = newKey
        prefs.edit().putString("key", newKey).putString("keyFor", server!!.base).apply()
        run()
    }

    private fun run() {
        _ui.update { it.copy(stage = DeckStage.Run) }
        following?.cancel()
        val s = server ?: return; val k = key ?: return
        following = viewModelScope.launch { s.updates(k).collect { if (it) refresh() } }
    }

    private suspend fun refresh() {
        val s = server ?: return; val k = key ?: return
        try {
            val d = DeckState.parse(s.host(k, "state"))
            _ui.update { it.copy(deck = d) }
            // The answer appears when the TV's drum roll ends, which nothing announces: look again until it has.
            if (d.question?.revealing == true) viewModelScope.launch { kotlinx.coroutines.delay(1000); refresh() }
        }
        catch (e: QuizError) { if (e.status == 401 || e.status == 403) signedOut(t("The desk has taken this phone off. Sign in again to host.")) }
        catch (_: Exception) {}
    }

    private fun signedOut(why: String) {
        following?.cancel(); key = null
        prefs.edit().remove("key").remove("keyFor").apply()
        _ui.update { it.copy(stage = DeckStage.Find, deck = null) }
        say(why, true)
    }

    fun leave() = work {
        runCatching { server?.host(key!!, "logout") }
        signedOut(t("This phone no longer hosts the quiz"))
        say(t("This phone no longer hosts the quiz"))
    }

    private fun work(block: suspend () -> Unit) {
        if (_ui.value.busy) return
        _ui.update { it.copy(busy = true, message = "", error = false) }
        viewModelScope.launch {
            try { block() } catch (e: Exception) { say(e.message ?: t("Something went wrong"), true) }
            finally { _ui.update { it.copy(busy = false) } }
        }
    }

    /** One of the desk's routes; [done] is said when it works. */
    private fun act(route: String, body: JSONObject = JSONObject(), done: String) = work {
        server!!.host(key!!, route, body)
        say(done)
        refresh()
    }

    private val deck get() = _ui.value.deck
    private val current get() = deck?.question?.id?.let { it as Any } ?: JSONObject.NULL

    // ---- as the Qt desk's Next, Back, Send, Close, Reveal, Pause (desk.py) ----
    fun next() {
        when (val step = deck?.takeIf { it.canNext }?.nextStep ?: return) {
            "finish" -> work {
                val s = server!!; val k = key!!; val ended = JSONObject().put("ended", true).put("leaderboardVisible", true)
                s.host(k, "settings", ended)
                if (deck?.question != null) s.host(k, "board", JSONObject().put("action", "show"))
                say(t("Quiz finished: the final standings are on the TV")); refresh()
            }
            "show" -> act("board", JSONObject().put("action", "show"), t("Leaderboard on the TV"))
            "recap" -> act("recap", JSONObject().put("action", "start"), t("The secret round’s first answer is on the TV"))
            "recapAnswer", "recapResults" -> act("recap", JSONObject().put("action", "next"), if (step == "recapResults") t("The round’s results are on the TV") else t("Next secret answer revealed"))
            "reveal", "revealFirst", "revealSecond" -> act("board", JSONObject().put("action", "next"), when (step) { "revealFirst" -> t("The leader revealed"); "revealSecond" -> t("Second place revealed: the full board"); else -> t("Next position revealed") })
            else -> act("next", JSONObject().put("expectedQuestion", current), t("Next question opened"))
        }
    }

    fun back() {
        val label = deck?.back ?: return
        work {
            val step = server!!.host(key!!, "state").optJSONObject("back") ?: return@work
            server!!.host(key!!, "back", JSONObject().put("kind", step.getString("kind")).apply { if (step.optInt("answers") > 0) put("discard", true) })
            say(t("Back: {step}", "step" to label)); refresh()
        }
    }

    fun send() { if (deck?.canSend == true) act("send", done = t("Question sent to the phones")) }
    fun close() { if (deck?.canClose == true) act("close", JSONObject().put("expectedQuestion", current), t("Answers closed")) }
    fun pause() { if (deck?.canPause == true) act("pause", JSONObject().put("expectedQuestion", current), t("Timer paused")) }
    fun resume() { if (deck?.canResume == true) act("resume", JSONObject().put("expectedQuestion", current), t("Timer resumed")) }

    /** The TV plays the drum roll and the answer appears as it ends (up to 10 s), as on the desk. */
    fun reveal() {
        val d = deck?.takeIf { it.canReveal } ?: return
        work {
            val delay = if (d.fastRehearsal || d.revealSound == null) 0 else minOf(10000, server!!.soundLength(d.revealSound))
            server!!.host(key!!, "reveal", JSONObject().put("question", d.question!!.id).put("revealed", true).put("delay", delay))
            say(if (delay > 0) t("Drum roll… the answer appears in {n}s", "n" to (delay + 999) / 1000) else t("Answer revealed on the TV")); refresh()
        }
    }

    fun buzz(action: String) {
        val q = deck?.question ?: return
        act("buzz", JSONObject().put("question", q.id).put("action", action).put("announced", ""), when (action) { "correct" -> t("Marked correct"); "wrong" -> t("Marked wrong"); else -> t("Passed to the next buzzer") })
    }

    /** Clips, songs, bingo calls and audio play from the laptop: the desk does them. */
    fun desk(action: String, value: Int? = null) = work {
        server!!.host(key!!, "deck-command", JSONObject().put("action", action).apply { if (value != null) put("value", value) })
        say(t("Asked the desk"))
    }

    init { if (_ui.value.address.isNotBlank() && key != null) connect(_ui.value.address) }

    override fun onCleared() { following?.cancel() }
}
