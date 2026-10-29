package uk.beermat.player.net

import uk.beermat.player.ui.t
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.isActive
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/** A refusal from the quiz server: its own sentence for the player, and the HTTP status. */
class QuizError(message: String, val status: Int) : IOException(message)

/**
 * One quiz laptop (or an online quiz link), spoken to over plain HTTP with the platform's own networking: no internet
 * needed, no cloud service. Every call runs off the main thread.
 */
class QuizServer(base: String) {
    val base: String = normalise(base)

    suspend fun hello(): Hello = withContext(Dispatchers.IO) {
        val o = request("GET", "/api/hello", null, "")
        Hello.parse(o) ?: throw QuizError(t("That address isn’t a BeerMat quiz."), 0)
    }

    suspend fun join(name: String): Joined = withContext(Dispatchers.IO) {
        val o = request("POST", "/api/join", JSONObject().put("name", name), "")
        Joined(o.getString("secret"), o.optBoolean("waiting"), o.optBoolean("rehearsal"))
    }

    /** A 4-digit code from the quizmaster moves a team to this phone. */
    suspend fun transfer(code: String): String = withContext(Dispatchers.IO) {
        request("POST", "/api/transfer", JSONObject().put("code", code), "").getString("secret")
    }

    suspend fun state(secret: String): PlayerState = withContext(Dispatchers.IO) { Parse.state(request("POST", "/api/state", JSONObject(), secret)) }

    suspend fun answer(secret: String, question: Long, value: Any) = withContext(Dispatchers.IO) {
        request("POST", "/api/answer", JSONObject().put("question", question).put("value", value), secret)
    }

    suspend fun draft(secret: String, question: Long, value: Any) = withContext(Dispatchers.IO) {
        request("POST", "/api/draft", JSONObject().put("question", question).put("value", value), secret)
    }

    suspend fun buzz(secret: String, question: Long) = withContext(Dispatchers.IO) { request("POST", "/api/buzz", JSONObject().put("question", question), secret) }

    suspend fun sound(secret: String, index: Int) = withContext(Dispatchers.IO) { request("POST", "/api/team/sound", JSONObject().put("sound", index), secret) }

    /** The team's photo for the TV: a square JPEG; the quizmaster approves it first. */
    suspend fun photo(secret: String, jpeg: ByteArray) = withContext(Dispatchers.IO) { request("POST", "/api/team/photo", null, secret, jpeg) }

    /** The team's result after a live quiz, signed by the quiz laptop, for the player to keep in a profile. */
    suspend fun result(secret: String): JSONObject = withContext(Dispatchers.IO) { request("POST", "/api/team/result", JSONObject(), secret).getJSONObject("claim") }

    /** Bingo: the team shouts; the quizmaster checks the ticket and says yes or no. */
    suspend fun bingo(secret: String, question: Long) = withContext(Dispatchers.IO) { request("POST", "/api/bingo", JSONObject().put("question", question), secret) }

    /** Sound clips: a tap during the clip the team thinks is the one. */
    suspend fun tap(secret: String, question: Long) = withContext(Dispatchers.IO) { request("POST", "/api/tap", JSONObject().put("question", question), secret) }

    /** Word snake (and pinpoint) help: the decoys go, for fewer points. */
    suspend fun goWide(secret: String, question: Long) = withContext(Dispatchers.IO) { request("POST", "/api/gowide", JSONObject().put("question", question), secret) }

    suspend fun agree(secret: String, question: Long) = withContext(Dispatchers.IO) { request("POST", "/api/agree", JSONObject().put("question", question), secret) }

    /** Leaving the app during an open question is reported to the quizmaster, as the web page does. */
    suspend fun away(secret: String, question: Long, state: String) = withContext(Dispatchers.IO) {
        request("POST", "/api/away", JSONObject().put("question", question).put("state", state), secret)
    }

    /**
     * Live updates: the server's event stream sends a number whenever anything changes; each one means "fetch your
     * state again". Emits true when connected (and on every nudge), false when the stream drops; reconnects by itself.
     */
    fun updates(secret: String): Flow<Boolean> = callbackFlow {
        while (isActive) {
            var connection: HttpURLConnection? = null
            try {
                connection = (URL("$base/api/events?key=$secret").openConnection() as HttpURLConnection).apply {
                    connectTimeout = 5000; readTimeout = 45000  // the server pings every few seconds
                    setRequestProperty("Accept", "text/event-stream")
                }
                if (connection.responseCode != 200) throw IOException("stream ${connection.responseCode}")
                trySend(true)
                connection.inputStream.bufferedReader().useLines { lines ->
                    for (line in lines) {
                        if (!isActive) break
                        if (line.startsWith("data:")) trySend(true)
                    }
                }
            } catch (_: IOException) {
            } finally {
                connection?.disconnect()
            }
            trySend(false)
            kotlinx.coroutines.delay(1000)
        }
        awaitClose { }
    }.flowOn(Dispatchers.IO)

    private fun request(method: String, route: String, body: JSONObject?, secret: String, raw: ByteArray? = null): JSONObject {
        val connection = URL(base + route).openConnection() as HttpURLConnection
        try {
            connection.requestMethod = method
            connection.connectTimeout = 6000
            connection.readTimeout = 10000
            if (secret.isNotEmpty()) connection.setRequestProperty("Authorization", "Bearer $secret")
            if (body != null) {
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json")
                connection.outputStream.use { it.write(body.toString().toByteArray()) }
            } else if (raw != null) {
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "image/jpeg")
                connection.outputStream.use { it.write(raw) }
            }
            val status = connection.responseCode
            val text = (if (status in 200..299) connection.inputStream else connection.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
            val json = try { JSONObject(text.ifBlank { "{}" }) } catch (_: Exception) { JSONObject() }
            if (status !in 200..299) throw QuizError(json.optString("error").ifBlank { "The quiz server said $status" }, status)
            return json
        } finally {
            connection.disconnect()
        }
    }

    companion object {
        /** What a player typed or scanned, as a server address: "10.42.0.1:3000" → "http://10.42.0.1:3000". */
        fun normalise(input: String): String {
            var s = input.trim().trimEnd('/')
            if (!s.startsWith("http://") && !s.startsWith("https://")) s = "http://$s"
            // A link to a page on the server (the QR code opens "/") is the server itself.
            val url = URL(s)
            return "${url.protocol}://${url.authority}"
        }

        fun jsonValue(value: Any): Any = if (value is List<*>) JSONArray(value) else value
    }
}

/** What a QR code on the TV says: a quiz address, or the quiz Wi-Fi to join first. */
sealed interface Scanned {
    data class Address(val url: String) : Scanned
    data class Wifi(val ssid: String, val password: String) : Scanned
    data object Unknown : Scanned

    companion object {
        fun parse(text: String): Scanned {
            val t = text.trim()
            if (t.startsWith("WIFI:")) {
                // WIFI:T:WPA;S:<ssid>;P:<password>;; with \ escaping ; , : " and \ (web/qr.js wifiCode).
                val fields = mutableMapOf<String, String>()
                var key = StringBuilder(); var value = StringBuilder(); var inValue = false; var escaped = false
                for (c in t.removePrefix("WIFI:")) {
                    when {
                        escaped -> { (if (inValue) value else key).append(c); escaped = false }
                        c == '\\' -> escaped = true
                        !inValue && c == ':' -> inValue = true
                        c == ';' -> { if (key.isNotEmpty()) fields[key.toString()] = value.toString(); key = StringBuilder(); value = StringBuilder(); inValue = false }
                        else -> (if (inValue) value else key).append(c)
                    }
                }
                return fields["S"]?.let { Wifi(it, fields["P"] ?: "") } ?: Unknown
            }
            return try { Address(QuizServer.normalise(t)) } catch (_: Exception) { Unknown }
        }
    }
}
