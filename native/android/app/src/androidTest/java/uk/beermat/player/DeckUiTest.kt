package uk.beermat.player

import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * Run the night (the phone deck) in the real app, against a quiz server of its own (native/android/scripts/ui-test.sh
 * passes deckServer and deckHostKey): Profile → Run the night, the laptop's address, the desk's code, then the first
 * question opened, closed and revealed from the phone. Screenshots go to the app's files folder.
 */
@OptIn(ExperimentalTestApi::class)
@RunWith(AndroidJUnit4::class)
class DeckUiTest {
    private val composeRule = createAndroidComposeRule<MainActivity>()
    @get:Rule val chain: org.junit.rules.RuleChain = org.junit.rules.RuleChain.outerRule(FreshApp()).around(composeRule)
    private val rule get() = composeRule
    private val args = InstrumentationRegistry.getArguments()
    private val server = args.getString("deckServer") ?: ""
    private val desk = args.getString("deckHostKey") ?: ""

    private fun call(route: String, body: JSONObject = JSONObject()): JSONObject {
        val c = URL(server + route).openConnection() as HttpURLConnection
        c.requestMethod = "POST"; c.doOutput = true
        c.setRequestProperty("Content-Type", "application/json"); c.setRequestProperty("Authorization", "Bearer $desk")
        c.outputStream.use { it.write(body.toString().toByteArray()) }
        val text = (if (c.responseCode < 300) c.inputStream else c.errorStream).bufferedReader().readText()
        check(c.responseCode < 300) { "$route: ${c.responseCode} $text" }
        return JSONObject(text)
    }

    private fun shot(name: String) {
        rule.waitForIdle()
        val bitmap = InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot() ?: return
        val folder = rule.activity.getExternalFilesDir("shots")!!
        File(folder, "$name.png").outputStream().use { bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
    }

    private fun tap(tag: String) = rule.onNodeWithTag(tag).performScrollTo().performClick()

    @Test fun runTheNightWithTheDesksCode() {
        assumeTrue("run by scripts/ui-test.sh", server.isNotEmpty())
        rule.onNodeWithTag("tab-Profile").performClick()
        tap("runTheNight")
        rule.waitUntilAtLeastOneExists(hasTestTag("deckAddress"), 10000)
        rule.onNodeWithTag("deckAddress").performTextInput(server.removePrefix("http://"))
        rule.onNode(hasText("Connect")).performClick()
        rule.waitUntilAtLeastOneExists(hasTestTag("deckCode"), 15000)
        shot("deck-code")
        rule.onNodeWithTag("deckCode").performTextInput(call("/api/host/deck-code").getString("code"))
        tap("deckSignIn")
        rule.waitUntilAtLeastOneExists(hasTestTag("deckNext"), 15000)
        assertEquals(1, call("/api/host/state").getJSONArray("decks").length())

        tap("deckNext")
        rule.waitUntilAtLeastOneExists(hasText("Which planet is known as the Red Planet?"), 15000)
        shot("deck-question")
        tap("deckClose")
        rule.waitUntilAtLeastOneExists(hasTestTag("deckReveal"), 15000)
        tap("deckReveal")
        rule.waitUntil(15000) { call("/api/host/state").getJSONObject("question").optBoolean("revealed") }
        rule.waitUntilAtLeastOneExists(hasText("Answer: Mars"), 15000)
        shot("deck-revealed")
    }
}
