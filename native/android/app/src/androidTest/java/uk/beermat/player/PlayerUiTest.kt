package uk.beermat.player

import android.graphics.Bitmap
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.click
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * The real app on a device or emulator, against a real quiz server on the computer running the tests
 * (tests/fixtures/serve.mjs pro full --bind 0.0.0.0, reached from the emulator at 10.0.2.2). Run by
 * native/android/scripts/ui-test.sh, which starts the servers and passes their addresses:
 *   server, hostKey: a live quiz (Pro) with every format;  rehearsal: a Free laptop's rehearsal.
 * A team joins through the app's own screens and answers each format natively; the server's state shows each answer
 * arrived. Screenshots go to the app's files folder (the script pulls them).
 */
@OptIn(ExperimentalTestApi::class)
@RunWith(AndroidJUnit4::class)
class PlayerUiTest {
    private val composeRule = createAndroidComposeRule<MainActivity>()
    @get:Rule val chain: org.junit.rules.RuleChain = org.junit.rules.RuleChain.outerRule(FreshApp()).around(composeRule)
    private val rule get() = composeRule
    private val args = InstrumentationRegistry.getArguments()
    private val server = args.getString("server") ?: ""
    private val host = args.getString("hostKey") ?: ""

    private fun call(route: String, body: JSONObject = JSONObject(), base: String = server, key: String = host): JSONObject {
        val c = URL(base + route).openConnection() as HttpURLConnection
        c.requestMethod = "POST"; c.doOutput = true
        c.setRequestProperty("Content-Type", "application/json"); c.setRequestProperty("Authorization", "Bearer $key")
        c.outputStream.use { it.write(body.toString().toByteArray()) }
        val text = (if (c.responseCode < 300) c.inputStream else c.errorStream).bufferedReader().readText()
        check(c.responseCode < 300) { "$route: ${c.responseCode} $text" }
        return JSONObject(text)
    }

    private fun shot(name: String) {
        rule.waitForIdle()
        val bitmap = InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot() ?: return
        val folder = rule.activity.getExternalFilesDir("shots")!!
        File(folder, "$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }

    private fun waitText(text: String, timeout: Long = 15000) = rule.waitUntilAtLeastOneExists(hasText(text, substring = true), timeout)

    private fun join(address: String, team: String) {
        waitText("Scan the code on the TV")
        rule.onNodeWithTag("address").performTextInput(address)
        rule.onNodeWithText("Connect").performClick()
        waitText("Pick a team name")
        rule.onNodeWithTag("teamName").performTextInput(team)
        rule.onNodeWithText("Join the quiz").performClick()
    }

    private lateinit var questions: List<JSONObject>
    private var current: Long? = null

    /** The quizmaster opens a question (as Start on the desk); returns the host's view of it, answer and all. */
    private fun open(match: (JSONObject) -> Boolean): JSONObject {
        current?.let { runCatching { call("/api/host/close", JSONObject().put("expectedQuestion", it)) } }
        val q = questions.first(match)
        call("/api/host/start", JSONObject().put("id", q.getString("id")).put("expectedQuestion", current ?: JSONObject.NULL))
        val live = call("/api/host/state").getJSONObject("question")
        current = live.getLong("id")
        waitText(q.getString("text").take(30))
        return live
    }

    private fun team(): JSONObject = call("/api/host/state").getJSONArray("teams").let { t -> (0 until t.length()).map(t::getJSONObject).first { it.getString("name") == "Android Aces" } }

    private fun answers(): JSONArray = call("/api/host/state").getJSONArray("answers")

    private fun lockIn(name: String) {
        rule.onNodeWithText("Lock in answer").performScrollTo().performClick()
        waitText("Final answer received")
        shot(name)
        check(answers().length() == 1) { "$name: the server has the answer" }
    }

    @Test fun playsEveryFormatNatively() {
        assumeTrue("needs the ui-test.sh servers", server.isNotEmpty())
        questions = call("/api/host/library").getJSONArray("rounds").let { r -> (0 until r.length()).flatMap { i -> r.getJSONObject(i).getJSONArray("questions").let { a -> (0 until a.length()).map(a::getJSONObject) } } }
        join(server.removePrefix("http://"), "Android Aces")
        waitText("You’re in!")
        shot("01-lobby")

        // The quizmaster switches the quiz to French: the app follows, as the TV and browsers do.
        call("/api/host/settings", JSONObject().put("language", "fr"))
        waitText("C’est bon, vous êtes inscrits !")
        shot("01-french")
        call("/api/host/settings", JSONObject().put("language", "en"))
        waitText("You’re in!")

        // The team's buzzer sound and photo (the quizmaster approves photos first).
        rule.onNodeWithText("Picked from your team name").performScrollTo().performClick()
        rule.onNodeWithText("Siren").performClick()
        rule.waitUntil(10000) { team().optInt("sound", -1) == 2 }
        call("/api/host/settings", JSONObject().put("teamPhotos", true))
        val picture = File(rule.activity.cacheDir, "team.png").apply {
            outputStream().use { Bitmap.createBitmap(640, 480, Bitmap.Config.ARGB_8888).apply { eraseColor(android.graphics.Color.MAGENTA) }.compress(Bitmap.CompressFormat.PNG, 100, it) }
        }
        androidx.lifecycle.ViewModelProvider(rule.activity)[uk.beermat.player.game.PlayerViewModel::class.java].setPhoto(android.net.Uri.fromFile(picture))
        rule.waitUntil(10000) { team().optString("photo_status") == "pending" }
        waitText("Waiting for the quizmaster to approve it")

        open { it.getString("type") == "choice" && it.getString("answer") == "Mars" }
        rule.onNode(hasText("Mars", substring = true)).performClick()
        lockIn("02-choice")
        call("/api/host/close", JSONObject().put("expectedQuestion", current))
        call("/api/host/reveal", JSONObject().put("question", current).put("revealed", true).put("delay", 0))
        waitText("+1 point"); shot("03-scored")

        open { it.getString("type") == "letter" }
        rule.onNode(hasText("R")).performClick()
        lockIn("04-letter")

        val seq = open { it.getString("type") == "sequence" }
        for (item in listOf("Mercury", "Venus", "Earth", "Mars")) rule.onNode(hasText(item) and !hasText(".", substring = true)).performClick()
        lockIn("05-sequence")

        open { it.getString("type") == "text" && it.optString("answer") == "Canberra" }
        // A draft survives the phone being turned: it's saved on the server and comes back.
        rule.onNodeWithTag("answer").performTextInput("Canb")
        Thread.sleep(1500)
        rule.activityRule.scenario.onActivity { it.requestedOrientation = android.content.pm.ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE }
        waitText("Canb")
        shot("06a-rotated")
        rule.activityRule.scenario.onActivity { it.requestedOrientation = android.content.pm.ActivityInfo.SCREEN_ORIENTATION_PORTRAIT }
        waitText("Canb")
        // Leaving the app during an open question is reported to the quizmaster, as a browser tab is.
        rule.activityRule.scenario.moveToState(androidx.lifecycle.Lifecycle.State.CREATED)
        Thread.sleep(1000)
        rule.activityRule.scenario.moveToState(androidx.lifecycle.Lifecycle.State.RESUMED)
        rule.waitUntil(10000) { call("/api/host/state").getJSONArray("away").length() == 1 }
        rule.onNodeWithTag("answer").performTextInput("erra")
        lockIn("06-text")

        val pin = open { it.getString("type") == "pinpoint" }
        val target = pin.getJSONObject("target")
        rule.waitUntilAtLeastOneExists(hasContentDescription("Quiz picture", substring = true), 15000)
        rule.onNode(hasContentDescription("Quiz picture", substring = true)).performTouchInput {
            click(Offset((target.getDouble("x") * width).toFloat(), (target.getDouble("y") * height).toFloat()))
        }
        lockIn("07-pinpoint")

        val snake = open { it.getString("type") == "wordsnake" }
        val path = snake.getJSONArray("snakePath")
        for (i in 0 until path.length()) rule.onNodeWithTag("cell-${path.getInt(i)}").performClick()
        waitText("LONDON")
        lockIn("08-wordsnake")

        val tiles = open { it.getString("type") == "tiles" }
        val pieces = tiles.getJSONArray("pieces").let { a -> List(a.length()) { a.getString(it) } }
        val order = tiles.getJSONArray("tiles").let { a -> List(a.length()) { a.getString(it) } }
        val used = mutableSetOf<Int>()
        for (t in order) { val i = pieces.indices.first { pieces[it] == t && it !in used }; used += i; rule.onNodeWithTag("tile-$i").performClick() }
        lockIn("09-tiles")

        val multi = open { it.getString("type") == "multi" }
        val options = multi.getJSONArray("options").let { a -> List(a.length()) { a.getString(it) } }
        multi.getJSONArray("correct").let { c -> for (i in 0 until c.length()) { val o = c.getString(i); rule.onNode(hasText("${'A' + options.indexOf(o)}. $o")).performClick() } }
        lockIn("13-multi")

        open { it.getString("type") == "number" }
        rule.onNodeWithTag("answer").performTextInput("6")
        lockIn("14-number")

        open { it.getString("type") == "nearest" }
        rule.onNodeWithTag("answer").performTextInput("1912")
        lockIn("15-nearest")

        open { it.getString("type") == "picture" }
        rule.onNodeWithTag("answer").performTextInput("Triangle")
        lockIn("16-picture")

        open { it.getString("type") == "audio" }
        waitText("Play the clip")
        rule.onNodeWithTag("answer").performTextInput("4")
        lockIn("17-audio")

        open { it.getString("type") == "vote" }
        rule.onNode(hasText("A. Crisps")).performClick()
        lockIn("18-vote")

        val sheet = open { it.getString("type") == "sheet" }
        sheet.getJSONArray("itemAnswers").let { a -> for (i in 0 until a.length()) rule.onNodeWithTag("sheet-$i").performScrollTo().performTextInput(a.getString(i)) }
        lockIn("19-sheet")

        open { it.getString("type") == "buzzer" }
        rule.onNode(hasContentDescription("Buzz")).performClick()
        waitText("You buzzed first"); shot("10-buzzer")

        val clips = open { it.getString("type") == "clips" }
        call("/api/host/clip", JSONObject().put("question", clips.getLong("id")).put("clip", 0))
        rule.waitUntil(15000) { runCatching { rule.onNode(hasContentDescription("Tap for this clip")).assertExists(); true }.getOrDefault(false) }
        waitText("Clip 1 of")
        rule.onNode(hasContentDescription("Tap for this clip")).performClick()
        waitText("You tapped"); shot("11-clips")

        val bingo = open { it.getString("type") == "bingo" }
        call("/api/host/bingo", JSONObject().put("question", bingo.getLong("id")))
        waitText("1 called")
        rule.onNodeWithText("BINGO!").performScrollTo().performClick()
        waitText("being checked"); shot("12-bingo")
    }

    @Test fun rehearsalShowsConnectedOnly() {
        val rehearsal = args.getString("rehearsal") ?: ""
        assumeTrue("needs the ui-test.sh servers", rehearsal.isNotEmpty())
        join(rehearsal.removePrefix("http://"), "Test Phone")
        waitText("You’re connected")
        waitText("This is a rehearsal")
        shot("20-rehearsal")
    }

    /** The network drops (Wi-Fi and mobile data off) and comes back: the app says so, then reconnects by itself. */
    @Test fun reconnectsAfterTheNetworkDrops() {
        val rehearsal = args.getString("rehearsal") ?: ""
        assumeTrue("needs the ui-test.sh servers", rehearsal.isNotEmpty())
        val shell = { command: String -> InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand(command).close() }
        join(rehearsal.removePrefix("http://"), "Flaky Phone")
        waitText("CONNECTED")
        try {
            shell("svc wifi disable"); shell("svc data disable")
            waitText("RECONNECTING", 30000)
            shot("21-offline")
        } finally { shell("svc wifi enable"); shell("svc data enable") }
        waitText("● CONNECTED", 60000)
        shot("22-back")
    }
}
