package uk.beermat.player

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File

/** The app's words come from web/i18n.js, the one dictionary the browser player and the TV use. */
class I18nTest {
    @Test fun dictionaryMatchesTheWebPlayer() {
        val root = File("../../..").canonicalFile
        assumeTrue("Node.js is needed for this test", runCatching { ProcessBuilder("node", "--version").start().waitFor() == 0 }.getOrDefault(false))
        val node = ProcessBuilder("node", "-e", "import('./web/i18n.js').then(m => console.log(JSON.stringify(m.translations)))").directory(root).start()
        val expected = JSONObject(node.inputStream.bufferedReader().readText())
        val asset = JSONObject(File("src/main/assets/i18n.json").readText())
        assertEquals("run scripts/export-i18n.mjs", expected.keys().asSequence().toSet(), asset.keys().asSequence().toSet())
        for (k in expected.keys()) assertEquals(k, expected.getJSONArray(k).toString(), asset.getJSONArray(k).toString())
    }

    @Test fun everyPhraseTheAppUsesIsTranslated() {
        // t("…") calls in the app's sources must name a phrase in the dictionary, or players would see English.
        val asset = JSONObject(File("src/main/assets/i18n.json").readText())
        val missing = File("src/main/java").walk().filter { it.extension == "kt" }.flatMap { f ->
            Regex("""\bt\("((?:[^"\\]|\\.)*)"""").findAll(f.readText()).map { it.groupValues[1].replace("\\\"", "\"") }.filter { !asset.has(it) }.map { "${f.name}: $it" }
        }.toList()
        assertEquals(emptyList<String>(), missing)
    }
}
