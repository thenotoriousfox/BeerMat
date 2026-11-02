package uk.beermat.player

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test
import uk.beermat.player.deck.DeckState
import uk.beermat.player.net.MyVar
import uk.beermat.player.net.Parse

/** VAR Check reaches the app: a team's own (can it ask, how many left, how it went) and the deck's list to rule on. */
class VarCheckTest {
    @Test fun aTeamsVarCheck() {
        val s = Parse.state(JSONObject("""{"settings": {"varCheck": "night"}, "myVar": {"left": 1, "status": null, "points": null, "canAsk": true}}"""))
        assertEquals(MyVar(1, null, null, true), s.myVar)
        assertEquals(true, s.varPerNight)
        assertEquals(MyVar(null, "overturned", 2, false), Parse.state(JSONObject("""{"myVar": {"left": null, "status": "overturned", "points": 2, "canAsk": false}}""")).myVar)
        assertEquals(null, Parse.state(JSONObject("""{"myVar": null}""")).myVar)
    }

    @Test fun runTheNightListsVarChecks() {
        val d = DeckState.parse(JSONObject("""{"varChecks": [{"id": 4, "name": "Owls", "answer": "Cardif", "full": 2}]}"""))
        assertEquals(listOf(uk.beermat.player.deck.DeckVar(4, "Owls", "Cardif", 2)), d.varChecks)
    }
}
