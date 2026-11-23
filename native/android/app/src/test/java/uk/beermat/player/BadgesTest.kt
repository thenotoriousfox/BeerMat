package uk.beermat.player

import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File

/** The app's badge catalogue (assets/badges.json) is shared/achievements.js's, as the server awards them. */
class BadgesTest {
    @Test fun badgesMatchTheServer() {
        val root = File("../../..").canonicalFile
        assumeTrue("Node.js is needed for this test", runCatching { ProcessBuilder("node", "--version").start().waitFor() == 0 }.getOrDefault(false))
        val node = ProcessBuilder("node", "-e", "import('./shared/achievements.js').then(m => console.log(JSON.stringify(m.badges.map(({id, name, description}) => ({id, name, description})))))")
            .directory(root).start()
        val expected = JSONArray(node.inputStream.bufferedReader().readText())
        val asset = JSONArray(File("src/main/assets/badges.json").readText())
        assertEquals("regenerate src/main/assets/badges.json from shared/achievements.js", expected.toString(), asset.toString())
    }
}
