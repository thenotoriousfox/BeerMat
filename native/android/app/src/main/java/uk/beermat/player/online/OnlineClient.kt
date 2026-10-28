package uk.beermat.player.online

import uk.beermat.player.ui.t
import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import uk.beermat.player.BuildConfig
import uk.beermat.player.data.Identity
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

class OnlineError(message: String, val status: Int, val offline: Boolean = false) : IOException(message)

/**
 * The player side of BeerMat Online, as online/client.js is for the Capacitor and web apps: signing in, the profile,
 * keeping quiz results and finding quizzes. Works offline: kept results wait in an outbox until the service can be
 * reached (sending one twice never counts it twice), and listings come from the last search, marked out of date.
 * Never needed to play: quizzes run on the quizmaster's laptop.
 */
class OnlineClient(context: Context, private val identity: Identity = Identity(context)) {
    private val prefs = context.getSharedPreferences("beermat-online", Context.MODE_PRIVATE)

    var baseUrl: String
        get() = prefs.getString("baseUrl", null) ?: BuildConfig.ONLINE_SERVICE
        set(value) = prefs.edit().putString("baseUrl", value.trim().trimEnd('/')).apply()

    private fun read(name: String): String? = prefs.getString(name, null)
    private fun write(name: String, value: String?) = prefs.edit().apply { if (value == null) remove(name) else putString(name, value) }.apply()
    private var token: String?
        get() = identity.secure("online-token")
        set(value) = identity.secure("online-token", value)

    val signedIn get() = token != null
    val profile: JSONObject? get() = read("profile")?.let(::JSONObject)

    private suspend fun api(method: String, route: String, body: Any? = null, headers: Map<String, String> = emptyMap()): JSONObject = withContext(Dispatchers.IO) {
        if (baseUrl.isBlank()) throw OnlineError(t("BeerMat Online is not set up in this app"), 0, offline = true)
        val c = try { URL(baseUrl + route).openConnection() as HttpURLConnection } catch (e: Exception) { throw OnlineError(t("No connection to BeerMat Online"), 0, true) }
        try {
            c.requestMethod = method; c.connectTimeout = 10000; c.readTimeout = 10000
            c.setRequestProperty("Content-Type", "application/json")
            token?.let { c.setRequestProperty("Authorization", "Bearer $it") }
            headers.forEach { (k, v) -> c.setRequestProperty(k, v) }
            if (body != null) { c.doOutput = true; c.outputStream.use { it.write(body.toString().toByteArray()) } }
            val status = try { c.responseCode } catch (_: IOException) { throw OnlineError(t("No connection to BeerMat Online"), 0, true) }
            val text = (if (status < 300) c.inputStream else c.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
            val json = try { JSONObject(text.ifBlank { "{}" }) } catch (_: Exception) { JSONObject() }
            if (status == 401 && route != "/v1/sessions") token = null
            if (status >= 300) throw OnlineError(json.optString("error").ifBlank { "BeerMat Online said $status" }, status)
            json
        } finally { c.disconnect() }
    }

    private fun keep(data: JSONObject): JSONObject { token = data.getString("token"); write("profile", data.getJSONObject("account").toString()); return data.getJSONObject("account") }

    suspend fun signUp(email: String, password: String, displayName: String) = keep(api("POST", "/v1/accounts", JSONObject().put("email", email).put("password", password).put("displayName", displayName)))
    suspend fun signIn(email: String, password: String): JSONObject { val a = keep(api("POST", "/v1/sessions", JSONObject().put("email", email).put("password", password))); runCatching { flush() }; return a }
    suspend fun signOut() { runCatching { api("DELETE", "/v1/sessions") }; token = null; write("profile", null) }
    suspend fun refreshProfile() = api("GET", "/v1/me").also { write("profile", it.toString()) }
    suspend fun updateProfile(changes: JSONObject) = api("PATCH", "/v1/me", changes).also { write("profile", it.toString()) }
    suspend fun exportData() = api("GET", "/v1/me/export")
    suspend fun resendVerify() = api("POST", "/v1/me/verify")
    val resetUrl get() = if (baseUrl.isBlank()) "" else "$baseUrl/reset"
    suspend fun deleteAccount(): JSONObject { val r = api("DELETE", "/v1/me"); token = null; for (n in listOf("profile", "outbox", "stats")) write(n, null); return r }

    // ---- results: an outbox of signed claims, sent in order whenever possible ----
    fun outbox(): JSONArray = JSONArray(read("outbox") ?: "[]")
    data class Flushed(val sent: Int, val waiting: Int, val problem: String?)

    suspend fun flush(): Flushed {
        val waiting = outbox(); val left = JSONArray(); var sent = 0; var problem: String? = null
        for (i in 0 until waiting.length()) {
            val item = waiting.getJSONObject(i)
            if (!signedIn) { left.put(item); continue }
            try { api("POST", "/v1/me/results", JSONObject().put("claim", item.get("claim")), mapOf("Idempotency-Key" to item.getString("key"))); sent++ }
            catch (e: OnlineError) {
                // A result the service will never accept (changed, or not from a quiz laptop) is dropped, with the reason kept.
                if (e.status == 422 || e.status == 400) problem = e.message else { left.put(item); if (problem == null) problem = e.message }
            }
        }
        write("outbox", left.toString())
        return Flushed(sent, left.length(), problem)
    }

    /** Keeps a team's signed result (from the quiz laptop at the end of the quiz) and sends it when it can. */
    suspend fun saveResult(claim: JSONObject): Flushed {
        val key = "${claim.optString("event")}:${claim.optString("team")}"
        val box = outbox()
        if ((0 until box.length()).none { box.getJSONObject(it).optString("key") == key }) {
            box.put(JSONObject().put("key", key).put("claim", claim).put("added", System.currentTimeMillis()))
            write("outbox", box.toString())
        }
        return flush()
    }

    suspend fun stats(): JSONObject = try {
        api("GET", "/v1/me/stats").also { write("stats", JSONObject(it.toString()).put("fetchedAt", System.currentTimeMillis()).toString()) }.put("stale", false)
    } catch (e: OnlineError) {
        val cached = read("stats")
        if (e.offline && cached != null) JSONObject(cached).put("stale", true) else throw e
    }

    // ---- finding quizzes; offline, the last results for the same search come back marked stale ----
    suspend fun findEvents(q: String = "", lat: Double? = null, lon: Double? = null, radiusKm: Int? = null): JSONObject {
        val params = buildList {
            if (q.isNotBlank()) add("q=" + URLEncoder.encode(q, "UTF-8"))
            // Locations are rounded to about 100 m before they leave the phone.
            if (lat != null && lon != null) { add("lat=" + "%.3f".format(java.util.Locale.ROOT, lat)); add("lon=" + "%.3f".format(java.util.Locale.ROOT, lon)); radiusKm?.let { add("radiusKm=$it") } }
        }.joinToString("&")
        val cacheKey = if (q.isNotBlank()) "q:" + q.lowercase() else "near"
        val cache = JSONObject(read("events") ?: "{}")
        return try {
            val result = api("GET", "/v1/events?$params")
            cache.put(cacheKey, JSONObject().put("events", result.getJSONArray("events")).put("fetchedAt", System.currentTimeMillis()))
            write("events", cache.toString())
            JSONObject().put("events", result.getJSONArray("events")).put("fetchedAt", System.currentTimeMillis()).put("stale", false)
        } catch (e: OnlineError) {
            val cached = cache.optJSONObject(cacheKey)
            if (e.offline && cached != null) cached.put("stale", true) else throw e
        }
    }

    /** Every venue for the map. Offline: the last list seen, else the venue list on GitHub (only those on the map). */
    suspend fun venues(): JSONObject = try {
        val r = api("GET", "/v1/venues")
        write("venues", JSONObject().put("venues", r.getJSONArray("venues")).put("fetchedAt", System.currentTimeMillis()).toString())
        JSONObject().put("venues", r.getJSONArray("venues")).put("stale", false).put("source", "service")
    } catch (e: OnlineError) {
        read("venues")?.let { JSONObject(it).put("stale", true).put("source", "cache") } ?: withContext(Dispatchers.IO) {
            val list = try { JSONObject(URL(BuildConfig.VENUE_LIST).readText()).optJSONArray("venues") } catch (_: Exception) { null } ?: throw e
            val onMap = JSONArray()
            for (i in 0 until list.length()) list.optJSONObject(i)?.takeIf { it.optBoolean("onMap") }?.let { onMap.put(it) }
            JSONObject().put("venues", onMap).put("stale", true).put("source", "list")
        }
    }

    suspend fun venue(id: String) = api("GET", "/v1/venues/" + URLEncoder.encode(id, "UTF-8"))
    suspend fun favourites() = api("GET", "/v1/me/favourites")
    suspend fun favourite(id: String, on: Boolean) = api(if (on) "PUT" else "DELETE", "/v1/me/favourites/" + URLEncoder.encode(id, "UTF-8"))
    suspend fun report(id: String, reason: String) = api("POST", "/v1/reports", JSONObject().put("kind", "venue").put("target", id).put("reason", reason))
}
