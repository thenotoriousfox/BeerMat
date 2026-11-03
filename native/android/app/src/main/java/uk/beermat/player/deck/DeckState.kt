package uk.beermat.player.deck

import org.json.JSONObject

/** The question in play, as the phone deck needs it (the host view of server.js's publicQuestion). */
data class DeckQuestion(
    val id: Long, val text: String, val type: String, val round: String,
    val open: Boolean, val live: Boolean, val held: Boolean, val paused: Boolean, val revealed: Boolean, val revealing: Boolean,
    val remaining: Long, val answer: String, val clips: Int, val audio: Boolean, val buzzing: String?,
    /** Wording only the desk shows until the reveal (hideText): the quizmaster reads it out. */
    val hideText: Boolean = false,
)

data class DeckTeam(val name: String, val score: Double, val rank: Int, val connected: Boolean)

/** A team's VAR Check waiting for a ruling: its answer and the question's full points (what Overturn gives). */
data class DeckVar(val id: Long, val team: String, val answer: String, val full: Int)

/**
 * The quiz as the phone deck shows it, from /api/host/state: what the big button does next (the server's nextStep, as
 * the Qt desk's Next), the question and what can be done with it (the desk's canSend, canClose… in desk.py), and the
 * teams. Pure, so it can be tested without a phone.
 */
data class DeckState(
    val title: String, val nextStep: String?, val question: DeckQuestion?, val teams: List<DeckTeam>, val answered: Int,
    val back: String?, val backAnswers: Int, val deskOpen: Boolean, val revealSound: String?, val fastRehearsal: Boolean, val rehearsal: Boolean,
    val varChecks: List<DeckVar> = emptyList(),
) {
    val canNext get() = nextStep != null && question?.live != true
    val canSend get() = question.let { it != null && it.held && it.live }
    val canClose get() = question.let { it != null && (it.open || it.live) && !it.revealed }
    val canReveal get() = question.let { it != null && !it.open && !it.live && !it.revealed && !it.revealing }
    val canPause get() = question.let { it != null && it.open && !it.paused }
    val canResume get() = question.let { it != null && it.paused && !it.held }

    companion object {
        /** The answer to read: an answer sheet's lines (a music round's artist and title) when it has no single answer. */
        private fun answerText(o: JSONObject): String {
            val answer = o.optString("answer").takeIf { !o.isNull("answer") } ?: ""
            val margin = o.optDouble("tolerance", 0.0).takeUnless { it.isNaN() } ?: 0.0
            if (answer.isNotEmpty() && margin > 0) return "$answer (± ${if (margin % 1.0 == 0.0) margin.toLong().toString() else margin.toString()}${if (o.optBoolean("tolerancePercent")) "%" else ""})"
            if (answer.isNotEmpty()) return answer
            val items = o.optJSONArray("items"); val answers = o.optJSONArray("itemAnswers") ?: return ""
            return List(answers.length()) { i -> answers.optString(i).takeIf { it.isNotBlank() }?.let { a -> items?.optString(i)?.takeIf { it.isNotBlank() }?.let { "$it: $a" } ?: a } }
                .filterNotNull().joinToString(" · ")
        }

        fun parse(s: JSONObject): DeckState {
            val q = s.optJSONObject("question")?.let { o ->
                val media = o.optString("media").takeIf { !o.isNull("media") } ?: ""
                DeckQuestion(o.getLong("id"), o.optString("text"), o.optString("type"), o.optString("round"),
                    o.optBoolean("open"), o.optBoolean("live"), o.optBoolean("held"), o.optBoolean("paused"), o.optBoolean("revealed"), o.optBoolean("revealing"),
                    o.optLong("remaining"), answerText(o), o.optJSONArray("clips")?.length() ?: 0,
                    Regex("""\.(mp3|ogg|wav|mp4|webm)$""", RegexOption.IGNORE_CASE).containsMatchIn(media) || o.optJSONObject("clip")?.optString("spotify").orEmpty().isNotEmpty(),
                    o.optJSONObject("buzz")?.optJSONObject("active")?.optString("name"), o.optBoolean("hideText"))
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
                varChecks = s.optJSONArray("varChecks")?.let { a -> List(a.length()) { a.getJSONObject(it) } }.orEmpty().map { DeckVar(it.optLong("id"), it.optString("name"), it.optString("answer"), it.optInt("full", 1)) },
                revealSound = s.optJSONObject("sounds")?.optJSONObject("slots")?.optString("reveal")?.takeIf { it.isNotBlank() },
                fastRehearsal = s.optJSONObject("rehearsal")?.optJSONObject("options")?.optString("speed") == "fast",
                rehearsal = s.optJSONObject("rehearsal")?.optJSONObject("options") != null,
            )
        }
    }
}
