package uk.beermat.player.net

import org.json.JSONArray
import org.json.JSONObject

/**
 * The quiz server's player protocol (docs/CLIENT-PROTOCOL.md), version 1. Only what the app draws is read; anything
 * else in a state is ignored, as the protocol requires. The server decides everything: these are views of its state.
 */
const val PROTOCOL = 1

data class Hello(val protocol: Int, val title: String, val rehearsal: Boolean, val registrationOpen: Boolean) {
    companion object {
        fun parse(o: JSONObject): Hello? = if (o.optString("app") != "BeerMat") null
            else Hello(o.optInt("protocol", 0), o.optString("title", "BeerMat"), o.optBoolean("rehearsal"), o.optBoolean("registrationOpen", true))
    }
}

data class Joined(val secret: String, val waiting: Boolean, val rehearsal: Boolean)

data class Team(val id: String, val name: String, val waiting: Boolean)

data class Standing(val name: String, val score: Double?, val rank: Int)

data class BuzzEntry(val team: String, val name: String, val status: String)

data class Buzz(
    val buzzed: String?, val activeName: String?, val queue: List<BuzzEntry>, val lockedOut: Boolean,
    val agreeOpen: Boolean, val agreed: Boolean, val announced: String,
)

data class Question(
    val id: Long, val type: String, val round: String, val text: String,
    val options: List<String>, val items: List<String>, val order: List<Int>, val pieces: List<String>,
    val media: String, val points: Double, val seconds: Int,
    val deadline: Long, val remaining: Long, val open: Boolean, val live: Boolean, val paused: Boolean, val revealed: Boolean,
    val answer: String?, val answerNote: String, val buzz: Buzz?,
    val wordLengths: List<Int> = emptyList(),
    /** The whole question as the server sent it, for the formats with more to draw (bingo, word snake, clips…). */
    val raw: JSONObject = JSONObject(),
) {
    val isTimed get() = type != "bingo" && type != "musicbingo"
}

data class Answer(val value: Any?, val points: Double?)

data class Settings(val title: String, val ended: Boolean, val registrationOpen: Boolean, val scrambleKeypads: Boolean, val leaderboardVisible: Boolean)

data class PlayerState(
    val protocol: Int, val serverTime: Long, val build: String, val event: String,
    val settings: Settings, val team: Team?, val question: Question?, val answer: Answer?, val draft: Any?,
    val teams: List<Standing>,
    /** A real phone in a rehearsal: connected, never playing. */
    val testDevice: Boolean,
)

private fun JSONArray?.strings(): List<String> = if (this == null) emptyList() else List(length()) { optString(it) }
private fun JSONArray?.ints(): List<Int> = if (this == null) emptyList() else List(length()) { optInt(it) }
private fun JSONObject.str(name: String): String = if (isNull(name)) "" else optString(name, "")
private fun JSONObject.strOrNull(name: String): String? = if (!has(name) || isNull(name)) null else opt(name).let { if (it is JSONArray) it.strings().joinToString(", ") else it.toString() }
private fun JSONObject.numOrNull(name: String): Double? = if (!has(name) || isNull(name)) null else optDouble(name).takeUnless { it.isNaN() }

object Parse {
    fun state(o: JSONObject): PlayerState {
        val s = o.optJSONObject("settings") ?: JSONObject()
        val rehearsal = o.optJSONObject("rehearsal")
        return PlayerState(
            protocol = o.optInt("protocol", 0), serverTime = o.optLong("serverTime", System.currentTimeMillis()),
            build = o.str("build"), event = o.str("event"),
            settings = Settings(s.optString("title", "BeerMat"), s.optBoolean("ended"), s.optBoolean("registrationOpen", true),
                s.optBoolean("scrambleKeypads"), s.optBoolean("leaderboardVisible", true)),
            team = o.optJSONObject("team")?.let { Team(it.str("id"), it.str("name"), it.optBoolean("waiting")) },
            question = o.optJSONObject("question")?.let(::question),
            answer = o.optJSONObject("answer")?.let { Answer(it.opt("value"), it.numOrNull("points")) },
            draft = o.optJSONObject("draft")?.opt("value"),
            teams = o.optJSONArray("teams")?.let { a -> List(a.length()) { a.getJSONObject(it) }.map { Standing(it.str("name"), it.numOrNull("score"), it.optInt("rank")) } } ?: emptyList(),
            testDevice = rehearsal?.optBoolean("device") == true,
        )
    }

    fun question(q: JSONObject) = Question(
        id = q.optLong("id"), type = q.str("type"), round = q.str("round"), text = q.str("text"),
        options = q.optJSONArray("options").strings(), items = q.optJSONArray("items").strings(),
        order = q.optJSONArray("order").ints(), pieces = q.optJSONArray("pieces").strings(),
        media = q.str("media"), points = q.optDouble("points", 0.0), seconds = q.optInt("seconds"),
        deadline = q.optLong("deadline"), remaining = q.optLong("remaining"),
        open = q.optBoolean("open"), live = q.optBoolean("live"), paused = q.optBoolean("paused"), revealed = q.optBoolean("revealed"),
        answer = q.strOrNull("answer"), answerNote = q.str("answerNote"),
        buzz = q.optJSONObject("buzz")?.let { b ->
            val queue = b.optJSONArray("queue")?.let { a -> List(a.length()) { a.getJSONObject(it) }.map { BuzzEntry(it.str("team"), it.str("name"), it.str("status")) } } ?: emptyList()
            Buzz(b.strOrNull("buzzed"), b.optJSONObject("active")?.str("name"), queue, b.optBoolean("lockedOut"), b.optBoolean("agreeOpen"), b.optBoolean("agreed"), b.str("announced"))
        },
        wordLengths = q.optJSONArray("wordLengths").ints(),
        raw = q,
    )
}
