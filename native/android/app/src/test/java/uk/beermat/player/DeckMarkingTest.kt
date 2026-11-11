package uk.beermat.player

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import uk.beermat.player.deck.DeckAnswer
import uk.beermat.player.deck.DeckMarking
import uk.beermat.player.deck.DeckState

/** Run the night shows what each team answered to the question in play, to overrule the automatic marking. */
class DeckMarkingTest {
    @Test fun eachTeamsAnswerForTheQuestionInPlay() {
        val d = DeckState.parse(JSONObject("""{"question": {"id": 7, "text": "Capital of France?"}, "deckAnswers": {"question": 7, "full": 2, "canMark": true,
            "rows": [{"team": "t1", "name": "Bears", "answer": "Pari", "points": 0}, {"team": "t2", "name": "Owls", "answer": "Paris", "points": 2}]}}"""))
        assertEquals(DeckMarking(7, 2, true, listOf(DeckAnswer("t1", "Bears", "Pari", 0, true), DeckAnswer("t2", "Owls", "Paris", 2, true))), d.marking)
        // While answers are open, a team's mark can be changed once it has locked its answer in.
        val open = DeckState.parse(JSONObject("""{"question": {"id": 7}, "deckAnswers": {"question": 7, "full": 1, "canMark": false,
            "rows": [{"team": "t1", "name": "Bears", "answer": "Pari", "points": 0, "canMark": true}, {"team": "t2", "name": "Owls", "answer": "", "points": 0, "canMark": false}]}}"""))
        assertEquals(listOf(true, false), open.marking?.rows?.map { it.canMark })
        // Another question's answers (a state from just before Next) aren't shown against this one.
        assertNull(DeckState.parse(JSONObject("""{"question": {"id": 8}, "deckAnswers": {"question": 7, "full": 1, "canMark": false, "rows": []}}""")).marking)
        assertNull(DeckState.parse(JSONObject("""{"question": null, "deckAnswers": null}""")).marking)
    }
}
