package uk.beermat.player.deck

import org.json.JSONObject

/** The question in play, as the phone deck needs it (the host view of server.js's publicQuestion). */
data class DeckQuestion(
    val id: Long, val text: String, val type: String, val round: String,
    val open: Boolean, val live: Boolean, val held: Boolean, val paused: Boolean, val revealed: Boolean, val revealing: Boolean,
    val remaining: Long, val answer: String, val clips: Int, val audio: Boolean, val buzzing: String?,
)

data class DeckTeam(val name: String, val score: Double, val rank: Int, val connected: Boolean)

/**
 * The quiz as the phone deck shows it, from /api/host/state: what the big button does next (the server's nextStep, as
 * the Qt desk's Next), the question and what can be done with it (the desk's canSend, canClose… in desk.py), and the
 * teams. Pure, so it can be tested without a phone.
 */
data class DeckState(
    val title: String, val nextStep: String?, val question: DeckQuestion?, val teams: List<DeckTeam>, val answered: Int,
    val back: String?, val backAnswers: Int, val deskOpen: Boolean, val revealSound: String?, val fastRehearsal: Boolean, val rehearsal: Boolean,
) {
    val canNext get() = nextStep != null && question?.live != true
    val canSend get() = question.let { it != null && it.held && it.live }
    val canClose get() = question.let { it != null && (it.open || it.live) && !it.revealed }
    val canReveal get() = question.let { it != null && !it.open && !it.live && !it.revealed && !it.revealing }
    val canPause get() = question.let { it != null && it.open && !it.paused }
    val canResume get() = question.let { it != null && it.paused && !it.held }

    companion object {
        fun parse(s: JSONObject): DeckState {
            val q = s.optJSONObject("question")?.let { o ->
                val media = o.optString("media").takeIf { !o.isNull("media") } ?: ""
                DeckQuestion(o.getLong("id"), o.optString("text"), o.optString("type"), o.optString("round"),
                    o.optBoolean("open"), o.optBoolean("live"), o.optBoolean("held"), o.optBoolean("paused"), o.optBoolean("revealed"), o.optBoolean("revealing"),
                    o.optLong("remaining"), o.optString("answer").takeIf { !o.isNull("answer") } ?: "", o.optJSONArray("clips")?.length() ?: 0,
                    Regex("""\.(mp3|ogg|wav)$""", RegexOption.IGNORE_CASE).containsMatchIn(media),
                    o.optJSONObject("buzz")?.optJSONObject("active")?.optString("name"))
            }
            val teams = s.optJSONArray("teams")?.let { a -> List(a.length()) { a.getJSONObject(it) } }.orEmpty()
                .filter { it.optBoolean("enabled", true) && !it.optBoolean("waiting") }
            val back = s.optJSONObject("back")
            return DeckState(
                title = s.optJSONObject("settings")?.optString("title").orEmpty().ifBlank { "BeerMat" },
                nextStep = s.optString("nextStep").takeIf { !s.isNull("nextStep") && it.isNotBlank() },
                question = q,
                teams = teams.map { DeckTeam(it.optString("name"), it.optDouble("score", 0.0), it.optInt("rank"), it.optBoolean("connected")) }.sortedWith(compareBy({ if (it.rank > 0) it.rank else 999 }, { it.name.lowercase() })),
                answered = s.optJSONArray("answers")?.length() ?: 0,
                back = back?.optString("label")?.takeIf { it.isNotBlank() }, backAnswers = back?.optInt("answers") ?: 0,
                deskOpen = s.optBoolean("deskConnected"),
                revealSound = s.optJSONObject("sounds")?.optJSONObject("slots")?.optString("reveal")?.takeIf { it.isNotBlank() },
                fastRehearsal = s.optJSONObject("rehearsal")?.optJSONObject("options")?.optString("speed") == "fast",
                rehearsal = s.optJSONObject("rehearsal")?.optJSONObject("options") != null,
            )
        }
    }
}
