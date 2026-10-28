package uk.beermat.player

import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Assume.assumeTrue
import org.junit.Test
import uk.beermat.player.net.QuizError
import uk.beermat.player.net.QuizServer
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * The app's client against the real quiz server (tests/fixtures/serve.mjs, needs Node.js): a live quiz on Pro played
 * by this app and a browser-style team side by side, and a rehearsal on Free where this app is a test device that the
 * server keeps out of the game. Skipped when Node isn't installed.
 */
class ServerIntegrationTest {
    private var process: Process? = null

    private fun start(plan: String): Pair<QuizServer, String> {
        val root = File("../../..").canonicalFile
        assumeTrue("Node.js is needed for this test", runCatching { ProcessBuilder("node", "--version").start().waitFor() == 0 }.getOrDefault(false))
        val p = ProcessBuilder("node", "--disable-warning=ExperimentalWarning", "tests/fixtures/serve.mjs", plan).directory(root).redirectErrorStream(true).start()
        process = p
        val ready = JSONObject(p.inputStream.bufferedReader().readLine() ?: error("the test server didn't start"))
        return QuizServer("127.0.0.1:${ready.getInt("port")}") to ready.getString("hostKey")
    }

    @After fun stop() { process?.outputStream?.close(); process?.waitFor() }

    /** The quizmaster's side, and a browser's: plain HTTP, as web/host.js and web/client.js send it. */
    private fun call(server: QuizServer, route: String, body: JSONObject, key: String): JSONObject {
        val c = URL(server.base + route).openConnection() as HttpURLConnection
        c.requestMethod = "POST"; c.doOutput = true
        c.setRequestProperty("Content-Type", "application/json"); c.setRequestProperty("Authorization", "Bearer $key")
        c.outputStream.use { it.write(body.toString().toByteArray()) }
        val text = (if (c.responseCode < 300) c.inputStream else c.errorStream).bufferedReader().readText()
        if (c.responseCode >= 300) error("$route: ${c.responseCode} $text")
        return JSONObject(text)
    }

    @Test fun liveQuizAppAndBrowserScoredAlike() = runBlocking {
        val (server, host) = start("pro")
        val hello = server.hello()
        assertEquals(1, hello.protocol); assertFalse(hello.rehearsal)

        val app = server.join("Android Aces")
        assertFalse(app.rehearsal)
        val browser = call(server, "/api/join", JSONObject().put("name", "Browser Brains"), "").getString("secret")
        // Live updates: the stream connects and nudges.
        withTimeout(5000) { server.updates(app.secret).first { it } }

        call(server, "/api/host/next", JSONObject().put("expectedQuestion", JSONObject.NULL), host)
        val q = server.state(app.secret).question!!
        assertEquals("choice", q.type); assertTrue(q.open); assertNull("no answer before the reveal", q.answer)

        server.answer(app.secret, q.id, "Mars")
        call(server, "/api/answer", JSONObject().put("question", q.id).put("value", "Venus"), browser)
        // One final answer: a second is refused by the server, whoever sends it.
        try { server.answer(app.secret, q.id, "Venus"); fail("a second answer must be refused") } catch (e: QuizError) { assertTrue(e.status in 400..499) }

        call(server, "/api/host/close", JSONObject().put("expectedQuestion", q.id), host)
        call(server, "/api/host/reveal", JSONObject().put("question", q.id).put("revealed", true).put("delay", 0), host)
        val after = server.state(app.secret)
        assertTrue(after.question!!.revealed); assertEquals("Mars", after.question!!.answer)
        assertEquals(1.0, after.answer!!.points!!, 0.0)
        val board = after.teams.associate { it.name to it.score }
        assertEquals(1.0, board["Android Aces"]!!, 0.0); assertEquals(0.0, board["Browser Brains"]!!, 0.0)

        // A sequence answer is a list of item indexes, as the browser sends it.
        call(server, "/api/host/next", JSONObject().put("expectedQuestion", q.id), host)
        val seq = server.state(app.secret).question!!
        assertEquals("sequence", seq.type); assertEquals(3, seq.order.size)
        server.answer(app.secret, seq.id, QuizServer.jsonValue(listOf(0, 1, 2)))
        assertTrue(server.state(app.secret).answer != null)
    }

    @Test fun rehearsalKeepsTheAppOutOfTheGame() = runBlocking {
        val (server, host) = start("free")
        assertTrue(server.hello().rehearsal)
        val phone = server.join("Test Phone")
        assertTrue(phone.rehearsal)
        call(server, "/api/host/rehearsal/start", JSONObject().put("options", JSONObject().put("teams", 2).put("auto", false)), host)
        // Starting the rehearsal cleared the room: the phone joins again, still as a test device.
        val again = server.join("Test Phone")
        call(server, "/api/host/next", JSONObject().put("expectedQuestion", JSONObject.NULL), host)
        val state = server.state(again.secret)
        assertTrue(state.testDevice); assertNull("a test device never sees the question", state.question)
        for (attempt in listOf<suspend () -> Unit>({ server.answer(again.secret, 1, "Mars") }, { server.buzz(again.secret, 1) }, { server.draft(again.secret, 1, "x") })) {
            try { attempt(); fail("the server must refuse a test device") } catch (e: QuizError) { assertEquals(403, e.status) }
        }
        // The desk sees it apart from the simulated teams.
        val desk = call(server, "/api/host/state", JSONObject(), host).getJSONObject("rehearsal")
        assertEquals("Test Phone", desk.getJSONArray("devices").getJSONObject(0).getString("name"))
        assertEquals(2, desk.getJSONArray("sims").length())
    }
}
