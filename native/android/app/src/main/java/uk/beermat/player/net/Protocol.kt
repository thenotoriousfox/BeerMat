package uk.beermat.player.net

import org.json.JSONArray
import org.json.JSONObject

/**
 * The quiz server's player protocol (docs/CLIENT-PROTOCOL.md), version 1. Only what the app draws is read; anything
 * else in a state is ignored, as the protocol requires. The server decides everything: these are views of its state.
 */
const val PROTOCOL = 1

/** The eight synthesised buzzer sounds every quiz has (web/app.js `sounds`), before any the quizmaster adds. */
val BUILT_IN_BUZZERS = listOf("Classic buzz", "Doorbell", "Siren", "Beep beep", "Low horn", "Chime", "Laser", "Boing")

/** [askTable]: the quizmaster wants each team's table number when it joins (the room map). */
data class Hello(val protocol: Int, val title: String, val rehearsal: Boolean, val registrationOpen: Boolean, val askTable: Boolean = false) {
    companion object {
        fun parse(o: JSONObject): Hello? = if (o.optString("app") != "BeerMat") null
            else Hello(o.optInt("protocol", 0), o.optString("title", "BeerMat"), o.optBoolean("rehearsal"), o.optBoolean("registrationOpen", true), o.optBoolean("askTable"))
    }
}

data class Joined(val secret: String, val waiting: Boolean, val rehearsal: Boolean)

data class Team(val id: String, val name: String, val waiting: Boolean, val sound: Int? = null, val photo: String = "", val photoStatus: String = "")

data class Standing(val name: String, val score: Double?, val rank: Int)

/** The leaderboard being revealed on the TV, a place at a time (server.js boardReveal): who isn't up yet, whether the
 *  leader's moment has come, and whether it's all shown. */
data class BoardReveal(val hidden: Set<String>, val leader: Boolean, val done: Boolean) {
    val active get() = !done
}

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
    /** Waiting for the quizmaster's Send: nothing to read or answer yet (the clock hasn't started). */
    val held: Boolean = false,
    /** An answer sheet's answers, line by line, once revealed (a music round's artist and title). */
    val itemAnswers: List<String> = emptyList(),
    /** Number: answers within ± this count (tolerancePercent: of the answer). Nearest wins: closest without going over. */
    val tolerance: Double = 0.0, val tolerancePercent: Boolean = false, val notOver: Boolean = false,
    /** Multiple choice as letters only: six fixed A–F buttons (fixedSix), or a question asked on the fly. */
    val fixedSix: Boolean = false,
    val onTheFly: Boolean = false,
    /** The picture shows itself over the question's time: "blur", "tiles" or "". */
    val reveal: String = "",
    /** The picture shows itself over these first seconds, then stays whole (0: over the whole time). */
    val revealSeconds: Int = 0,
    /** The whole question as the server sent it, for the formats with more to draw (bingo, word trail, clips…). */
    val raw: JSONObject = JSONObject(),
) {
    val isTimed get() = type != "bingo" && type != "musicbingo"
}

data class Answer(val value: Any?, val points: Double?)

data class Settings(val title: String, val ended: Boolean, val registrationOpen: Boolean, val scrambleKeypads: Boolean, val leaderboardVisible: Boolean, val teamPhotos: Boolean = false, val language: String = "en")

/** VAR Check: whether this team can appeal the question just revealed, how many it has left (null: no limit), how it went. */
data class MyVar(val left: Int?, val status: String?, val points: Int?, val canAsk: Boolean)

data class PlayerState(
    val protocol: Int, val serverTime: Long, val build: String, val event: String,
    val settings: Settings, val team: Team?, val question: Question?, val answer: Answer?, val draft: Any?,
    val teams: List<Standing>,
    /** The extra buzzer sounds the quizmaster added (after the eight built-in ones). */
    val buzzerNames: List<String> = emptyList(),
    /** A real phone in a rehearsal: connected, never playing. */
    val testDevice: Boolean,
    /** The question's look (its theme's id), for the app's colours and scenery (GET /api/looks/<id>). */
    val look: String = "stage",
    /** The leaderboard reveal on the TV, while there is one. */
    val reveal: BoardReveal? = null,
    /** VAR Check for the question on the phone (null when switched off); one a night rather than one a round. */
    val myVar: MyVar? = null, val varPerNight: Boolean = false,
) {
    /** The leaderboard as a team's phone shows it: during a reveal, only the places already on the TV. */
    val board: List<Standing> get() = reveal?.takeIf { it.active }?.let { r -> teams.filter { it.name !in r.hidden } } ?: teams
    /** Still to come on the TV, so not on the phone yet either. */
    val boardHidden: Int get() = teams.size - board.size
    fun shown(name: String?) = board.any { it.name == name }
}

private fun JSONArray?.strings(): List<String> = if (this == null) emptyList() else List(length()) { optString(it) }
private fun JSONArray?.ints(): List<Int> = if (this == null) emptyList() else List(length()) { optInt(it) }
private fun JSONObject.str(name: String): String = if (isNull(name)) "" else optString(name, "")
private fun JSONObject.strOrNull(name: String): String? = if (!has(name) || isNull(name)) null else opt(name).let { if (it is JSONArray) it.strings().joinToString(", ") else it.toString() }
private fun JSONObject.numOrNull(name: String): Double? = if (!has(name) || isNull(name)) null else optDouble(name).takeUnless { it.isNaN() }

object Parse {
    /** GET /api/looks/<id>: the look's colour tokens and what phones draw; picture addresses made whole with [base]. */
    fun look(o: JSONObject, base: String): uk.beermat.player.ui.PhoneLook {
        val colours = o.optJSONObject("colours")?.let { c -> c.keys().asSequence().associateWith { c.optString(it) } } ?: emptyMap()
        val phone = o.optJSONObject("phone")
        val stops = phone?.optJSONObject("background")?.optJSONArray("gradient")
        val background = if (stops == null) emptyList() else List(stops.length()) { stops.getJSONArray(it) }
            .mapNotNull { s -> uk.beermat.player.ui.cssColour(s.optString(1))?.let { s.optDouble(0).toFloat() to it } }
        val layers = phone?.optJSONArray("scene")
        val scene = if (layers == null) emptyList() else List(layers.length()) { layers.getJSONObject(it) }.map { l ->
            uk.beermat.player.ui.PhoneLayer(base + l.optString("image"), l.optDouble("x", 0.0).toFloat(), l.optDouble("bottom", 0.0).toFloat(),
                l.optDouble("width", 0.0).toFloat(), l.optDouble("height", 0.0).toFloat(), l.optDouble("opacity", 1.0).toFloat())
        }
        return uk.beermat.player.ui.PhoneLook(o.optString("id"), colours, background, scene)
    }

    fun state(o: JSONObject): PlayerState {
        val s = o.optJSONObject("settings") ?: JSONObject()
        val rehearsal = o.optJSONObject("rehearsal")
        return PlayerState(
            protocol = o.optInt("protocol", 0), serverTime = o.optLong("serverTime", System.currentTimeMillis()),
            build = o.str("build"), event = o.str("event"),
            settings = Settings(s.optString("title", "BeerMat"), s.optBoolean("ended"), s.optBoolean("registrationOpen", true),
                s.optBoolean("scrambleKeypads"), s.optBoolean("leaderboardVisible", true), s.optBoolean("teamPhotos"), s.optString("language", "en")),
            team = o.optJSONObject("team")?.let { Team(it.str("id"), it.str("name"), it.optBoolean("waiting"), if (it.isNull("sound") || !it.has("sound")) null else it.optInt("sound"), it.str("photo"), it.str("photoStatus")) },
            buzzerNames = o.optJSONObject("sounds")?.optJSONArray("buzzers")?.let { a -> List(a.length()) { a.optJSONObject(it)?.optString("name") ?: "" } } ?: emptyList(),
            question = o.optJSONObject("question")?.let(::question),
            answer = o.optJSONObject("answer")?.let { Answer(it.opt("value"), it.numOrNull("points")) },
            draft = o.optJSONObject("draft")?.opt("value"),
            teams = o.optJSONArray("teams")?.let { a -> List(a.length()) { a.getJSONObject(it) }.map { Standing(it.str("name"), it.numOrNull("score"), it.optInt("rank")) } } ?: emptyList(),
            testDevice = rehearsal?.optBoolean("device") == true,
            look = o.optString("look", "stage").ifBlank { "stage" },
            reveal = o.optJSONObject("reveal")?.let { r -> BoardReveal(r.optJSONArray("hidden").strings().toSet(), r.optBoolean("leader"), r.optBoolean("done")) },
            myVar = o.optJSONObject("myVar")?.let { v -> MyVar(if (v.isNull("left")) null else v.optInt("left"), v.strOrNull("status"), if (v.isNull("points") || !v.has("points")) null else v.optInt("points"), v.optBoolean("canAsk")) },
            varPerNight = s.optString("varCheck") == "night",
        )
    }

    fun question(q: JSONObject) = Question(
        id = q.optLong("id"), type = q.str("type"), round = q.str("round"), text = q.str("text"),
        options = q.optJSONArray("options").strings(), items = q.optJSONArray("items").strings(),
        order = q.optJSONArray("order").ints(), pieces = q.optJSONArray("pieces").strings(),
        media = q.str("media"), points = q.optDouble("points", 0.0), seconds = q.optInt("seconds"),
        deadline = q.optLong("deadline"), remaining = q.optLong("remaining"),
        open = q.optBoolean("open"), live = q.optBoolean("live"), paused = q.optBoolean("paused"), revealed = q.optBoolean("revealed"),
        answer = q.strOrNull("answer"), answerNote = q.str("answerNote"), itemAnswers = q.optJSONArray("itemAnswers").strings(),
        tolerance = q.optDouble("tolerance", 0.0).takeUnless { it.isNaN() } ?: 0.0, tolerancePercent = q.optBoolean("tolerancePercent"), notOver = q.optBoolean("notOver"),
        buzz = q.optJSONObject("buzz")?.let { b ->
            val queue = b.optJSONArray("queue")?.let { a -> List(a.length()) { a.getJSONObject(it) }.map { BuzzEntry(it.str("team"), it.str("name"), it.str("status")) } } ?: emptyList()
            Buzz(b.strOrNull("buzzed"), b.optJSONObject("active")?.str("name"), queue, b.optBoolean("lockedOut"), b.optBoolean("agreeOpen"), b.optBoolean("agreed"), b.str("announced"))
        },
        wordLengths = q.optJSONArray("wordLengths").ints(),
        held = q.optBoolean("held"), fixedSix = q.optBoolean("fixedSix"), onTheFly = q.optBoolean("onTheFly"), reveal = q.str("reveal"), revealSeconds = q.optInt("revealSeconds"),
        raw = q,
    )
}
