package uk.beermat.player

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test
import uk.beermat.player.net.Parse

/** A picture revealed over its first seconds (revealSeconds): the app reads how long its reveal takes. */
class RevealSecondsTest {
    private fun picture(extra: String) = Parse.state(JSONObject("""{"protocol": 1, "settings": {}, "teams": [], "question":
        {"id": 7, "type": "picture", "text": "Who is this?", "seconds": 30, "points": 3, "media": "/media/a.png", "reveal": "tiles", "open": true, "live": true$extra}}""")).question!!

    @Test fun readsTheRevealTime() {
        assertEquals(15, picture(""", "revealSeconds": 15""").revealSeconds)
        assertEquals("over the whole time when it doesn't say", 0, picture("").revealSeconds)
    }
}
