package uk.beermat.player.tv

import android.content.Context
import android.net.ConnectivityManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject
import uk.beermat.player.net.QuizServer
import java.net.HttpURLConnection
import java.net.URL

/**
 * Where the quiz laptop is, for the TV app, without the account: on BeerMat's own quiz Wi-Fi the laptop is the router
 * (no internet needed), so the last address that worked, this network's router and BeerMat's hotspot are each asked
 * /api/hello. Anywhere else the TV signs in through the BeerMat account instead (BeerMat Online's TV page, TvActivity):
 * venue Wi-Fi often keeps devices apart, so searching its network finds nothing.
 */
object TvFinder {
    /** BeerMat's own hotspot address (scripts/hotspot): tried when nothing else answers. */
    const val HOTSPOT = "10.42.0.1"
    /** The port BeerMat Desk's quiz server answers on, on the venue network (beermat_desk --port). */
    const val DESK_PORT = 3000

    /** The places to try first, in order, each once: the last address that worked, this network's gateway, the hotspot. */
    fun candidates(saved: String?, gateway: String?): List<String> =
        listOfNotNull(saved?.takeIf { it.isNotBlank() }, gateway?.takeIf { it.isNotBlank() && it != "0.0.0.0" }, HOTSPOT)
            .map { QuizServer.normalise(it) }.distinct()

    /** The default gateway of the network the TV is on now (IPv4), if any. */
    fun gateway(context: Context): String? = runCatching {
        val cm = context.getSystemService(ConnectivityManager::class.java)
        cm.getLinkProperties(cm.activeNetwork)?.routes?.firstOrNull { it.isDefaultRoute && it.gateway?.address?.size == 4 }?.gateway?.hostAddress
    }.getOrNull()

    /** The first place that answers as a BeerMat quiz (in the order given), with its title; null when none does. Asked
     *  a batch at a time, so a quiz near the start of the list is found without waiting for the rest. */
    suspend fun find(places: List<String>, batch: Int = 64, probe: suspend (String) -> String? = ::hello): Pair<String, String>? = coroutineScope {
        for (chunk in places.chunked(batch)) {
            val found = chunk.map { base -> async { withTimeoutOrNull(3000) { probe(base) }?.let { base to it } } }.awaitAll().firstOrNull { it != null }
            if (found != null) return@coroutineScope found
        }
        null
    }

    /** /api/hello, quickly: most addresses on a network have nothing there, and the search shouldn't wait on them. */
    suspend fun hello(base: String): String? = withContext(Dispatchers.IO) {
        runCatching {
            val connection = URL("$base/api/hello").openConnection() as HttpURLConnection
            connection.connectTimeout = 800; connection.readTimeout = 2000
            try {
                if (connection.responseCode != 200) null
                else JSONObject(connection.inputStream.bufferedReader().readText()).takeIf { it.optString("app") == "BeerMat" }?.optString("title", "BeerMat")
            } finally { connection.disconnect() }
        }.getOrNull()
    }
}
