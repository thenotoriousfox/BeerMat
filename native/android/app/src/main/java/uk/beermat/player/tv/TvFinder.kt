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
import java.net.Inet4Address
import java.net.URL

/**
 * Where the quiz laptop is, for the TV app. A TV is usually on the venue's own Wi-Fi, which the laptop stays on beside
 * its quiz Wi-Fi (the quiz server answers the TV page on every network); on the quiz Wi-Fi the laptop is the router.
 * So: the last address that worked, this network's router, BeerMat's hotspot, then every address on the TV's own
 * network at the desk's port. Each is asked /api/hello; the first that answers as BeerMat is the quiz.
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

    /** Every other address on the TV's network (its /24, however big the network), at the desk's port. */
    fun neighbours(own: String?, port: Int = DESK_PORT): List<String> {
        val parts = own?.split(".")?.mapNotNull { it.toIntOrNull() }?.takeIf { it.size == 4 } ?: return emptyList()
        val prefix = parts.take(3).joinToString(".")
        return (1..254).filter { it != parts[3] }.map { "http://$prefix.$it:$port" }
    }

    /** The default gateway of the network the TV is on now (IPv4), if any. */
    fun gateway(context: Context): String? = runCatching {
        val cm = context.getSystemService(ConnectivityManager::class.java)
        cm.getLinkProperties(cm.activeNetwork)?.routes?.firstOrNull { it.isDefaultRoute && it.gateway?.address?.size == 4 }?.gateway?.hostAddress
    }.getOrNull()

    /** The TV's own IPv4 address on the network it's on now. */
    fun ownAddress(context: Context): String? = runCatching {
        val cm = context.getSystemService(ConnectivityManager::class.java)
        cm.getLinkProperties(cm.activeNetwork)?.linkAddresses?.map { it.address }?.firstOrNull { it is Inet4Address && !it.isLoopbackAddress }?.hostAddress
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
