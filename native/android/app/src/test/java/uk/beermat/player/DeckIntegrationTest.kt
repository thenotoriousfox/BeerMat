package uk.beermat.player

import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Assume.assumeTrue
import org.junit.Test
import uk.beermat.player.deck.DeckState
import uk.beermat.player.net.QuizError
import uk.beermat.player.net.QuizServer
import java.io.File

/**
 * Run the night (the phone deck) against the real quiz server (tests/fixtures/serve.mjs): the phone signs in with the
 * desk's code, reads the quiz as DeckState, and opens, closes and reveals a question as the Qt desk does. Clips and
 * songs are asked of the desk, which must be open. Skipped when Node isn't installed.
 */
class DeckIntegrationTest {
    private var process: Process? = null

    @After fun stop() { process?.outputStream?.close(); process?.waitFor() }

    @Test fun aPhoneHostsTheQuizWithTheDesksCode() = runBlocking {
        val root = File("../../..").canonicalFile
        assumeTrue("Node.js is needed for this test", runCatching { ProcessBuilder("node", "--version").start().waitFor() == 0 }.getOrDefault(false))
        val p = ProcessBuilder("node", "--disable-warning=ExperimentalWarning", "tests/fixtures/serve.mjs", "pro").directory(root).redirectErrorStream(true).start()
        process = p
        val ready = JSONObject(p.inputStream.bufferedReader().readLine() ?: error("the test server didn't start"))
        val server = QuizServer("127.0.0.1:${ready.getInt("port")}")
        val desk = ready.getString("hostKey")

        val hello = server.deckHello()
        assertTrue(hello.optString("venueKey").isNotBlank())
        try { server.deckLogin("Phone", code = "000000"); fail("no code shown yet") } catch (e: QuizError) { assertEquals(403, e.status) }
        val code = server.host(desk, "deck-code").getString("code")
        val key = server.deckLogin("Dan’s phone", code = code)

        var d = DeckState.parse(server.host(key, "state"))
        assertEquals(hello.optString("title"), d.title)
        assertEquals("question", d.nextStep); assertTrue(d.canNext); assertNull(d.question)
        assertFalse("the desk isn't open", d.deskOpen)

        server.host(key, "next", JSONObject().put("expectedQuestion", JSONObject.NULL))
        d = DeckState.parse(server.host(key, "state"))
        val q = d.question!!
        assertEquals("Which planet is known as the Red Planet?", q.text)
        assertTrue(q.open); assertTrue(d.canClose); assertFalse("Next waits while the question is open", d.canNext); assertFalse(d.canReveal)
        assertEquals("Mars", q.answer)

        server.host(key, "close", JSONObject().put("expectedQuestion", q.id))
        d = DeckState.parse(server.host(key, "state"))
        assertTrue(d.canReveal); assertFalse(d.canClose)
        server.host(key, "reveal", JSONObject().put("question", q.id).put("revealed", true).put("delay", 0))
        d = DeckState.parse(server.host(key, "state"))
        assertTrue(d.question!!.revealed); assertFalse(d.canReveal)
        assertEquals("question", d.nextStep); assertTrue(d.canNext)
        assertTrue("Back is offered", d.back != null)

        // Clips and songs play from the laptop: with no desk open, the phone is told so.
        try { server.host(key, "deck-command", JSONObject().put("action", "playClips")); fail("no desk") } catch (e: QuizError) { assertEquals(409, e.status) }

        // The desk lists the phone and can take it off.
        val decks = server.host(desk, "state").getJSONArray("decks")
        assertEquals("Dan’s phone", decks.getJSONObject(0).getString("name"))
        server.host(desk, "deck/disconnect", JSONObject().put("id", decks.getJSONObject(0).getString("id")))
        try { server.host(key, "state"); fail("taken off") } catch (e: QuizError) { assertEquals(403, e.status) }
    }
}
