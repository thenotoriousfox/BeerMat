package uk.beermat.player.net

import uk.beermat.player.ui.t
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.isActive
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/**
 * A quiz laptop reached through BeerMat Online's relay, as a fallback when the laptop isn't directly reachable
 * (no LAN path, no quizmaster link). The relay token authenticates the phone: no deckLogin is needed.
 */
class RelayServer(val base: String, val keyId: String, val token: String) {

    /** The quiz state from the relay. */
    suspend fun state(): JSONObject = withContext(Dispatchers.IO) {
        request("GET", "/v1/relay/$keyId/state?token=$token", null)
    }

    /** One of the desk's own routes (/api/host/<route>), forwarded through the relay. */
    suspend fun host(key: String, route: String, body: JSONObject = JSONObject()): JSONObject = withContext(Dispatchers.IO) {
        request("POST", "/v1/relay/$keyId/command", JSONObject().put("token", token).put("route", route).put("body", body))
    }

    /**
     * Live updates through the relay: polls every two seconds (the relay is HTTPS, so SSE would be held back the
     * same way the quizmaster link's HTTPS path already is in QuizServer).
     */
    fun updates(secret: String): Flow<Boolean> = callbackFlow {
        while (isActive) {
            trySend(true)
            kotlinx.coroutines.delay(2000)
        }
        awaitClose { }
    }.flowOn(Dispatchers.IO)

    private fun request(method: String, route: String, body: JSONObject?): JSONObject {
        val connection = URL(base + route).openConnection() as HttpURLConnection
        try {
            connection.requestMethod = method
            connection.connectTimeout = 10000
            connection.readTimeout = 10000
            connection.setRequestProperty("Content-Type", "application/json")
            if (body != null) {
                connection.doOutput = true
                connection.outputStream.use { it.write(body.toString().toByteArray()) }
            }
            val status = try { connection.responseCode } catch (_: IOException) { throw QuizError(t("No connection to BeerMat Online"), 0) }
            val text = (if (status in 200..299) connection.inputStream else connection.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
            val json = try { JSONObject(text.ifBlank { "{}" }) } catch (_: Exception) { JSONObject() }
            if (status !in 200..299) throw QuizError(json.optString("error").ifBlank { "BeerMat Online said $status" }, status)
            return json
        } finally {
            connection.disconnect()
        }
    }
}
