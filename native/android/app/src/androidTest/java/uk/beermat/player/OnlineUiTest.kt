package uk.beermat.player

import android.graphics.Bitmap
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextClearance
import androidx.compose.ui.test.performTextInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * The app's BeerMat Online screens against a real BeerMat Online (tests/fixtures/online.mjs, with a Pro venue in
 * Bristol and a quiz night) and a live quiz (tests/fixtures/serve.mjs pro): create an account, find the quiz night,
 * open the map, then play a quiz to the end and keep the team's signed result in the profile.
 */
@OptIn(ExperimentalTestApi::class)
@RunWith(AndroidJUnit4::class)
class OnlineUiTest {
    private val composeRule = createAndroidComposeRule<MainActivity>()
    @get:Rule val chain: org.junit.rules.RuleChain = org.junit.rules.RuleChain.outerRule(FreshApp()).around(composeRule)
    private val rule get() = composeRule
    private val args = InstrumentationRegistry.getArguments()
    private val online = args.getString("online") ?: ""
    private val server = args.getString("keepServer") ?: ""
    private val host = args.getString("keepHostKey") ?: ""

    private fun call(route: String, body: JSONObject = JSONObject()): JSONObject {
        val c = URL(server + route).openConnection() as HttpURLConnection
        c.requestMethod = "POST"; c.doOutput = true
        c.setRequestProperty("Content-Type", "application/json"); c.setRequestProperty("Authorization", "Bearer $host")
        c.outputStream.use { it.write(body.toString().toByteArray()) }
        val text = (if (c.responseCode < 300) c.inputStream else c.errorStream).bufferedReader().readText()
        check(c.responseCode < 300) { "$route: ${c.responseCode} $text" }
        return JSONObject(text)
    }

    private fun shot(name: String) {
        rule.waitForIdle()
        val bitmap = InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot() ?: return
        File(rule.activity.getExternalFilesDir("shots")!!, "$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }

    private fun waitText(text: String, timeout: Long = 15000) = rule.waitUntilAtLeastOneExists(hasText(text, substring = true), timeout)

    /** Taps the map where a place is (just above it, where a pin's icon sits): the map is an Android view, not Compose. */
    private fun tapMapAt(lat: Double, lon: Double) {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        var x = 0f; var y = 0f
        instrumentation.runOnMainSync {
            fun find(v: android.view.View): org.osmdroid.views.MapView? = v as? org.osmdroid.views.MapView
                ?: (v as? android.view.ViewGroup)?.let { g -> (0 until g.childCount).firstNotNullOfOrNull { find(g.getChildAt(it)) } }
            val map = find(rule.activity.window.decorView)!!
            val point = map.projection.toPixels(org.osmdroid.util.GeoPoint(lat, lon), null)
            val at = IntArray(2).also { map.getLocationOnScreen(it) }
            x = (at[0] + point.x).toFloat(); y = (at[1] + point.y - 12 * map.resources.displayMetrics.density)
        }
        val down = android.os.SystemClock.uptimeMillis()
        instrumentation.sendPointerSync(android.view.MotionEvent.obtain(down, down, android.view.MotionEvent.ACTION_DOWN, x, y, 0))
        instrumentation.sendPointerSync(android.view.MotionEvent.obtain(down, down + 50, android.view.MotionEvent.ACTION_UP, x, y, 0))
    }

    @Test fun profileFindMapAndKeepAResult() {
        assumeTrue("needs the ui-test.sh servers", online.isNotEmpty() && server.isNotEmpty())
        // Profile: point the app at the test service, create an account.
        rule.onNodeWithTag("tab-Profile").performClick()
        rule.onNodeWithText("Advanced").performScrollTo().performClick()
        rule.onNodeWithTag("service").performScrollTo().performTextClearance()
        rule.onNodeWithTag("service").performTextInput(online)
        rule.onNodeWithText("Use this address").performScrollTo().performClick()
        rule.onNodeWithTag("email").performScrollTo().performTextInput("player@example.com")
        rule.onNodeWithTag("password").performTextInput("correct horse battery")
        rule.onNodeWithTag("displayName").performTextInput("Pat")
        rule.onNodeWithText("Create account").performScrollTo().performClick()
        waitText("Signed in as Pat")
        waitText("Badges")
        shot("30-profile")

        // Find a quiz: the Pro venue's quiz night in Bristol.
        rule.onNodeWithTag("tab-Find a quiz").performClick()
        rule.onNodeWithTag("search").performTextInput("Bristol")
        rule.onNodeWithText("Search").performClick()
        waitText("Halloween special")
        rule.onNodeWithText("The Red Lion, Bristol", substring = true).performClick()
        waitText("☆ Save venue")
        rule.onNodeWithText("☆ Save venue").performClick()
        waitText("★ Saved")
        shot("31-venue")
        rule.onNodeWithText("Close").performScrollTo().performClick()

        // The map.
        rule.onNodeWithTag("tab-Map").performClick()
        rule.waitUntilAtLeastOneExists(hasTestTag("map"), 10000)
        Thread.sleep(2000)
        shot("32-map")
        // Its pin opens a popup with the venue and its next quiz, not the venue page's list.
        tapMapAt(51.4545, -2.5879)
        rule.waitUntilAtLeastOneExists(hasTestTag("venue-popup"), 5000)
        waitText("Next: Halloween special")
        waitText("1 King St")
        shot("33-map-pin")
        rule.onNodeWithText("Close").performClick()
        rule.waitUntilDoesNotExist(hasTestTag("venue-popup"), 5000)

        // Play a live quiz to the end, then keep the team's result.
        rule.onNodeWithTag("tab-Play").performClick()
        rule.onNodeWithTag("address").performTextInput(server.removePrefix("http://"))
        rule.onNodeWithText("Connect").performClick()
        waitText("Pick a team name")
        rule.onNodeWithTag("teamName").performTextInput("Profile Pals")
        rule.onNodeWithText("Join the quiz").performClick()
        waitText("You’re in!")
        val q = call("/api/host/library").getJSONArray("rounds").getJSONObject(0).getJSONArray("questions").getJSONObject(0)
        call("/api/host/start", JSONObject().put("id", q.getString("id")).put("expectedQuestion", JSONObject.NULL))
        waitText(q.getString("text").take(20))
        rule.onNode(hasText("Mars", substring = true)).performClick()
        rule.onNodeWithText("Lock in answer").performScrollTo().performClick()
        waitText("Final answer received")
        val live = call("/api/host/state").getJSONObject("question").getLong("id")
        call("/api/host/close", JSONObject().put("expectedQuestion", live))
        call("/api/host/settings", JSONObject().put("ended", true))
        waitText("That’s the quiz!")
        rule.onNodeWithText("Keep this result").performClick()
        waitText("Result kept")
        shot("33-kept")
    }
}
