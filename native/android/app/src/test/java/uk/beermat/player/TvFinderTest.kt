package uk.beermat.player

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import uk.beermat.player.tv.TvFinder

/** BeerMat TV finds the quiz laptop: the last address that worked, the Wi-Fi's gateway (the laptop, on the quiz Wi-Fi), then BeerMat's hotspot. */
class TvFinderTest {
    @Test fun placesToTryInOrderEachOnce() {
        assertEquals(listOf("http://192.168.1.20:3000", "http://192.168.1.1", "http://10.42.0.1"), TvFinder.candidates("192.168.1.20:3000", "192.168.1.1"))
        assertEquals(listOf("http://10.42.0.1"), TvFinder.candidates(null, "10.42.0.1"), "the quiz Wi-Fi: the gateway is the hotspot")
        assertEquals(listOf("http://10.42.0.1"), TvFinder.candidates("", "0.0.0.0"))
        assertEquals(listOf("https://quiz.example", "http://10.42.0.1"), TvFinder.candidates("https://quiz.example/", null))
    }

    @Test fun theFirstThatAnswersAsBeerMatInOrder() = runBlocking {
        val answers = mapOf("http://10.42.0.1" to "Tuesday Quiz", "http://192.168.1.1" to null)
        assertEquals("http://10.42.0.1" to "Tuesday Quiz", TvFinder.find(listOf("http://192.168.1.1", "http://10.42.0.1")) { answers[it] })
        assertEquals("http://a" to "A", TvFinder.find(listOf("http://a", "http://b")) { if (it == "http://a") "A" else "B" })
        assertNull(TvFinder.find(listOf("http://192.168.1.1")) { null })
    }

    @Test fun signingInGoesToBeerMatOnlinesTvPage() {
        assertEquals("https://online.beermatquiz.co.uk/tv?app=1", uk.beermat.player.tv.TvActivity.onlineTv("https://online.beermatquiz.co.uk/"), "BeerMat Online's TV page, as the app")
    }

    @Test fun aBatchAtATimeStoppingAtTheFirst() = runBlocking {
        val asked = mutableListOf<String>()
        val found = TvFinder.find((1..10).map { "http://h$it" }, batch = 4) { asked += it; if (it == "http://h6") "Pub" else null }
        assertEquals("http://h6" to "Pub", found, "found in the second batch")
        assertEquals(8, asked.size, "the third batch isn’t asked")
    }

    private fun assertEquals(expected: Any?, actual: Any?, message: String) = org.junit.Assert.assertEquals(message, expected, actual)
}
