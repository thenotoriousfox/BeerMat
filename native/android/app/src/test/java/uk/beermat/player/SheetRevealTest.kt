package uk.beermat.player

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test
import uk.beermat.player.net.Parse

/** An answer sheet's revealed answers (a music round's artist and title) reach the app, line by line. */
class SheetRevealTest {
    @Test fun aSheetsAnswersAreRead() {
        val q = Parse.question(JSONObject("""{"id": 7, "type": "sheet", "items": ["Artist", "Title"], "itemAnswers": ["Tracy Chapman", "Fast Car"], "answer": "", "revealed": true}"""))
        assertEquals(listOf("Tracy Chapman", "Fast Car"), q.itemAnswers)
        assertEquals(emptyList<String>(), Parse.question(JSONObject("""{"id": 8, "type": "text", "answer": "Cardiff"}""")).itemAnswers)
    }

    /** Run the night shows the quizmaster a sheet's answers to read out, before and after the reveal. */
    @Test fun runTheNightShowsASheetsAnswers() {
        fun deck(q: String) = uk.beermat.player.deck.DeckState.parse(JSONObject("""{"question": $q}""")).question!!.answer
        assertEquals("Artist: Tracy Chapman · Title: Fast Car", deck("""{"id": 7, "type": "sheet", "items": ["Artist", "Title"], "itemAnswers": ["Tracy Chapman", "Fast Car"], "answer": ""}"""))
        assertEquals("Cardiff", deck("""{"id": 8, "type": "text", "answer": "Cardiff"}"""))
    }
}
