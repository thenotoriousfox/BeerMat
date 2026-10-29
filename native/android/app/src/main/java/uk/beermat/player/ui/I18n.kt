package uk.beermat.player.ui

import android.content.Context
import org.json.JSONObject
import java.util.Locale

/**
 * The phone's words in English, French or Spanish, from the same dictionary as the browser player and the TV
 * (web/i18n.js, exported by scripts/export-i18n.mjs). In a quiz the app follows the quiz's language, as the player
 * page does; elsewhere the phone's own. {name} marks a value.
 */
object I18n {
    @Volatile var lang = "en"
    private var table: Map<String, List<String>> = emptyMap()

    fun load(context: Context) {
        if (table.isNotEmpty()) return
        val json = JSONObject(context.assets.open("i18n.json").bufferedReader().readText())
        table = json.keys().asSequence().associateWith { k -> json.getJSONArray(k).let { a -> List(a.length()) { a.getString(it) } } }
    }

    /** The phone's own language when it's one BeerMat speaks. */
    val phone: String get() = Locale.getDefault().language.takeIf { it == "fr" || it == "es" } ?: "en"

    fun t(text: String, vararg values: Pair<String, Any?>): String {
        val index = when (lang) { "fr" -> 0; "es" -> 1; else -> -1 }
        val template = if (index < 0) text else table[text]?.getOrNull(index) ?: text
        return values.fold(template) { s, (name, value) -> s.replace("{$name}", value.toString()) }
    }
}

fun t(text: String, vararg values: Pair<String, Any?>) = I18n.t(text, *values)
