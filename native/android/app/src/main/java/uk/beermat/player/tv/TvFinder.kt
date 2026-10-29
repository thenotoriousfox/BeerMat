package uk.beermat.player.tv

import android.content.Context
import android.net.ConnectivityManager
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withTimeoutOrNull
import uk.beermat.player.net.QuizServer

/**
 * Where the quiz laptop is, for the TV app. On the quiz Wi-Fi the laptop is the network's router, so the Wi-Fi's
 * gateway is the quiz; on a venue network it's wherever the TV last found it, or the address the quizmaster typed.
 * Each place is asked /api/hello; the first that answers as BeerMat is the quiz.
 */
object TvFinder {
    /** BeerMat's own hotspot address (scripts/hotspot): tried when nothing else answers. */
    const val HOTSPOT = "10.42.0.1"

    /** The places to try, in order, each once: the last address that worked, this network's gateway, the hotspot. */
    fun candidates(saved: String?, gateway: String?): List<String> =
        listOfNotNull(saved?.takeIf { it.isNotBlank() }, gateway?.takeIf { it.isNotBlank() && it != "0.0.0.0" }, HOTSPOT)
            .map { QuizServer.normalise(it) }.distinct()

    /** The default gateway of the network the TV is on now (IPv4), if any. */
    fun gateway(context: Context): String? = runCatching {
        val cm = context.getSystemService(ConnectivityManager::class.java)
        cm.getLinkProperties(cm.activeNetwork)?.routes?.firstOrNull { it.isDefaultRoute && it.gateway?.address?.size == 4 }?.gateway?.hostAddress
    }.getOrNull()

    /** The first candidate that answers as a BeerMat quiz, with its title; null when none does. */
    suspend fun find(candidates: List<String>, probe: suspend (String) -> String? = ::hello): Pair<String, String>? = coroutineScope {
        candidates.map { base -> async { withTimeoutOrNull(4000) { probe(base) }?.let { base to it } } }.awaitAll().firstOrNull { it != null }
    }

    private suspend fun hello(base: String): String? = runCatching { QuizServer(base).hello().title }.getOrNull()
}
