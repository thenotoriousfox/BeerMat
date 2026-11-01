package uk.beermat.player

import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assume.assumeTrue
import org.junit.Test
import uk.beermat.player.net.QuizServer
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * The leaderboard reveal on a team's phone, against the real quiz server (tests/fixtures/serve.mjs): a place shows
 * only once the TV has shown it, the team's own included. Skipped when Node isn't installed.
 */
class BoardRevealTest {
    private var process: Process? = null

    @After fun stop() { process?.outputStream?.close(); process?.waitFor() }

    private fun call(server: QuizServer, route: String, body: JSONObject, key: String): JSONObject {
        val c = URL(server.base + route).openConnection() as HttpURLConnection
        c.requestMethod = "POST"; c.doOutput = true
        c.setRequestProperty("Content-Type", "application/json"); c.setRequestProperty("Authorization", "Bearer $key")
        c.outputStream.use { it.write(body.toString().toByteArray()) }
        val text = (if (c.responseCode < 300) c.inputStream else c.errorStream).bufferedReader().readText()
        if (c.responseCode >= 300) error("$route: ${c.responseCode} $text")
        return JSONObject(text)
    }

    @Test fun thePhoneFollowsTheTvsReveal() = runBlocking {
        val root = File("../../..").canonicalFile
        assumeTrue("Node.js is needed for this test", runCatching { ProcessBuilder("node", "--version").start().waitFor() == 0 }.getOrDefault(false))
        val p = ProcessBuilder("node", "--disable-warning=ExperimentalWarning", "tests/fixtures/serve.mjs", "pro").directory(root).redirectErrorStream(true).start()
        process = p
        val ready = JSONObject(p.inputStream.bufferedReader().readLine() ?: error("the test server didn't start"))
        val server = QuizServer("127.0.0.1:${ready.getInt("port")}"); val host = ready.getString("hostKey")

        val app = server.join("Owls")
        val others = listOf("Bears", "Cats").map { call(server, "/api/join", JSONObject().put("name", it), "").getString("secret") }
        call(server, "/api/host/open", JSONObject().put("text", "Say yes").put("type", "text").put("answer", "yes").put("seconds", 30).put("points", 2), host)
        val q = server.state(app.secret).question!!
        for (s in others) call(server, "/api/answer", JSONObject().put("question", q.id).put("value", "yes"), s)
        call(server, "/api/host/close", JSONObject(), host)
        call(server, "/api/host/board", JSONObject().put("action", "show"), host)

        var state = server.state(app.secret)
        assertEquals("nothing before the TV shows it", emptyList<String>(), state.board.map { it.name })
        assertEquals(3, state.boardHidden)
        call(server, "/api/host/board", JSONObject().put("action", "next"), host)
        state = server.state(app.secret)
        assertEquals("last place, the team's own, as on the TV", listOf("Owls"), state.board.map { it.name })
        // Bears and Cats tie for first: their moment comes together, and the board is complete.
        call(server, "/api/host/board", JSONObject().put("action", "next"), host)
        state = server.state(app.secret)
        assertEquals(3, state.board.size); assertEquals(0, state.boardHidden)
    }
}
