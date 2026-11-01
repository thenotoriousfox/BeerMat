package uk.beermat.player.online

import uk.beermat.player.ui.t
import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

data class Badge(val id: String, val name: String, val description: String)

data class OnlineState(
    val service: String = "",
    val profile: JSONObject? = null,
    val stats: JSONObject? = null,
    val outbox: Int = 0,
    val events: List<JSONObject> = emptyList(),
    val eventsStale: Long? = null,
    val searched: Boolean = false,
    val venues: List<JSONObject> = emptyList(),
    val venuesNote: String = "",
    val venue: JSONObject? = null,
    val favourites: Set<String> = emptySet(),
    /** Signed in with a venue's account or an admin's: the app offers Run the night (the phone deck). */
    val hosts: Boolean = false,
    val busy: Boolean = false,
    val message: String = "",
    val error: Boolean = false,
)

/** Profile, Find a quiz and the map. None of it is needed to play; all of it is optional and the player's choice. */
class OnlineViewModel(app: Application) : AndroidViewModel(app) {
    val client = OnlineClient(app)
    private val _ui = MutableStateFlow(OnlineState(service = client.baseUrl, profile = client.profile, outbox = client.outbox().length()))
    val ui: StateFlow<OnlineState> = _ui
    val badges: List<Badge> = JSONArray(app.assets.open("badges.json").bufferedReader().readText()).let { a ->
        List(a.length()) { a.getJSONObject(it).let { b -> Badge(b.getString("id"), b.getString("name"), b.getString("description")) } }
    }
    val favouritesHere = app.getSharedPreferences("beermat-online", 0)

    fun say(text: String, error: Boolean = false) = _ui.update { it.copy(message = text, error = error) }

    private fun work(block: suspend () -> Unit) {
        if (_ui.value.busy) return
        _ui.update { it.copy(busy = true, message = "", error = false) }
        viewModelScope.launch {
            try { block() } catch (e: OnlineError) { say(e.message ?: "", true) } catch (e: Exception) { say(e.message ?: t("Something went wrong"), true) }
            finally { _ui.update { it.copy(busy = false, profile = client.profile, outbox = client.outbox().length()) } }
        }
    }

    fun setService(url: String) { client.baseUrl = url; _ui.update { it.copy(service = client.baseUrl) } }

    // ---- profile ----
    fun signIn(email: String, password: String) = work { client.signIn(email, password); loadProfile(); say(t("Signed in")) }
    fun signUp(email: String, password: String, name: String) = work { client.signUp(email, password, name); loadProfile(); say(t("Account created: check your email to confirm it")) }
    fun signOut() = work { client.signOut(); favouritesHere.edit().remove("hosts").apply(); _ui.update { it.copy(stats = null, hosts = false) }; say(t("Signed out")) }
    fun refresh() = work { if (client.signedIn) loadProfile() }

    private suspend fun loadProfile() {
        runCatching { client.refreshProfile() }
        val venues = runCatching { client.myVenues().length() }.getOrNull()
        // Offline, what it was last time (a quizmaster may well be on the quiz Wi-Fi, with no internet).
        val hosts = client.profile?.optBoolean("admin") == true || (venues ?: if (_ui.value.hosts) 1 else 0) > 0
        favouritesHere.edit().putBoolean("hosts", hosts).apply()
        _ui.update { it.copy(hosts = hosts) }
        val flushed = client.flush()
        if (flushed.sent > 0) say(t("{n} result(s) added to your profile", "n" to flushed.sent))
        val stats = runCatching { client.stats() }.getOrNull()
        _ui.update { it.copy(stats = stats ?: it.stats) }
        runCatching { client.favourites() }.getOrNull()?.let { f -> _ui.update { it.copy(favourites = List(f.getJSONArray("venues").length()) { i -> f.getJSONArray("venues").getJSONObject(i).getString("id") }.toSet()) } }
    }

    fun rename(name: String) = work { client.updateProfile(JSONObject().put("displayName", name)); say(t("Saved")) }
    fun privacy(key: String, on: Boolean) = work { client.updateProfile(JSONObject().put("privacy", JSONObject().put(key, on))); say(t("Privacy saved")) }
    fun resendVerify() = work { client.resendVerify(); say(t("We’ve sent the email again")) }
    fun deleteAccount() = work { client.deleteAccount(); favouritesHere.edit().remove("hosts").apply(); _ui.update { it.copy(stats = null, hosts = false) }; say(t("Your account and everything in it are deleted")) }
    suspend fun exportData(): String = client.exportData().toString(2)

    /** The team's signed result from the quiz laptop, kept in the profile (or waiting until signed in and online). */
    fun keepResult(claim: JSONObject) = work {
        val r = client.saveResult(claim)
        say(when {
            r.sent > 0 -> t("Result kept in your profile")
            !client.signedIn -> t("Result kept on this phone: sign in under Profile to add it")
            else -> t("Result kept on this phone; it’s added when BeerMat Online can be reached")
        })
    }

    // ---- finding quizzes ----
    fun search(q: String) = work { showEvents(client.findEvents(q = q)) }
    fun near(lat: Double, lon: Double) = work { showEvents(client.findEvents(lat = lat, lon = lon, radiusKm = 25)) }
    private fun showEvents(r: JSONObject) {
        val list = r.getJSONArray("events")
        _ui.update { it.copy(events = List(list.length()) { i -> list.getJSONObject(i) }, eventsStale = if (r.optBoolean("stale")) r.optLong("fetchedAt") else null, searched = true) }
    }

    fun loadVenues() = work {
        val r = client.venues()
        val list = r.getJSONArray("venues")
        _ui.update { it.copy(venues = List(list.length()) { i -> list.getJSONObject(i) },
            venuesNote = when (r.optString("source")) { "cache" -> t("Offline: the venues as last seen."); "list" -> t("Offline: venues from BeerMat’s venue list."); else -> "" }) }
    }

    fun openVenue(id: String?) {
        if (id == null) { _ui.update { it.copy(venue = null) }; return }
        work {
            val v = client.venue(id)
            val events = runCatching { client.findEvents(q = v.optString("name")) }.getOrNull()?.getJSONArray("events")
            val upcoming = JSONArray()
            if (events != null) for (i in 0 until events.length()) events.getJSONObject(i).takeIf { it.getJSONObject("venue").optString("id") == id }?.let { upcoming.put(it) }
            _ui.update { it.copy(venue = v.put("upcoming", upcoming)) }
        }
    }

    /** Favourite venues are kept on the phone, and in the profile when signed in. */
    fun favourite(id: String, on: Boolean) {
        val here = (favouritesHere.getStringSet("favourites", emptySet()) ?: emptySet()).toMutableSet().apply { if (on) add(id) else remove(id) }
        favouritesHere.edit().putStringSet("favourites", here).apply()
        _ui.update { it.copy(favourites = if (on) it.favourites + id else it.favourites - id) }
        if (client.signedIn) viewModelScope.launch { runCatching { client.favourite(id, on) } }
    }

    init {
        _ui.update { it.copy(favourites = favouritesHere.getStringSet("favourites", emptySet()) ?: emptySet(), hosts = client.signedIn && favouritesHere.getBoolean("hosts", false)) }
        if (client.signedIn) refresh()
    }
}
