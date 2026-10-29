package uk.beermat.player.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import uk.beermat.player.R

/** BeerMat's tokens (web/style.css, native/beermat_desk/qml/Desk/Theme.qml): night-purple, gold, pink, teal. A quiz's
 *  look (GET /api/looks/<id>) replaces them while the team plays, as on the TV and in the browser; reading one in a
 *  composable redraws it when the look changes. */
object Brand {
    private val defaults = mapOf(
        "bg" to Color(0xFF140B2E), "bg2" to Color(0xFF0D0720), "panel" to Color(0xFF221447), "raised" to Color(0xFF2C1A5C),
        "line" to Color(0x21FFF3D6), "text" to Color(0xFFFFF8EC), "muted" to Color(0xFFC8B9E4), "faint" to Color(0xFF8D82A8),
        "gold" to Color(0xFFFFB21A), "goldHi" to Color(0xFFFFD25E), "pink" to Color(0xFFFF3D81), "teal" to Color(0xFF1FD6C6),
        "violet" to Color(0xFF7A2CF0), "good" to Color(0xFF34D399), "bad" to Color(0xFFFF5470), "onAccent" to Color(0xFF1C1036))
    private val colours = androidx.compose.runtime.mutableStateMapOf<String, Color>().apply { putAll(defaults) }
    private fun c(name: String) = colours[name] ?: defaults.getValue(name)
    val bg get() = c("bg"); val bg2 get() = c("bg2"); val panel get() = c("panel"); val raised get() = c("raised")
    val line get() = c("line"); val text get() = c("text"); val muted get() = c("muted"); val faint get() = c("faint")
    val gold get() = c("gold"); val goldHi get() = c("goldHi"); val pink get() = c("pink"); val teal get() = c("teal")
    val violet get() = c("violet"); val good get() = c("good"); val bad get() = c("bad"); val onAccent get() = c("onAccent")
    /** Answer keys, matching the TV's option tiles (the same in every look). */
    val options = listOf(Color(0xFFFF5470), Color(0xFF3B82F6), Color(0xFF34D399), Color(0xFFFFB21A), Color(0xFF7A2CF0), Color(0xFF1FD6C6))

    /** A look's colour tokens (--bg, --gold…, as look.css names them) over BeerMat's own; an empty map goes back. */
    fun apply(tokens: Map<String, String>) {
        colours.clear(); colours.putAll(defaults)
        for ((css, name) in TOKENS) cssColour(tokens[css])?.let { colours[name] = it }
    }
    /** look.css's names for the tokens (as native/beermat_desk/looks.py). */
    private val TOKENS = mapOf("--bg" to "bg", "--bg-2" to "bg2", "--surface-solid" to "panel", "--line" to "line", "--text" to "text",
        "--muted" to "muted", "--gold" to "gold", "--gold-hi" to "goldHi", "--pink" to "pink", "--cyan" to "teal", "--violet" to "violet",
        "--good" to "good", "--bad" to "bad", "--on-accent" to "onAccent")
}

/** '#abc', '#aabbcc', '#aabbccdd' or 'rgb(a)(r, g, b[, a])', as CSS writes them; null for anything else. */
fun cssColour(value: String?): Color? {
    val v = value?.trim() ?: return null
    Regex("^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$").find(v)?.let { m ->
        val hex = m.groupValues[1].let { h -> if (h.length == 3) h.map { "$it$it" }.joinToString("") else h }
        val n = hex.toLong(16)
        return if (hex.length == 6) Color(0xFF000000 or n) else Color(((n and 0xFF) shl 24) or (n shr 8))
    }
    Regex("^rgba?\\(\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)\\s*(?:,\\s*([\\d.]+)\\s*)?\\)$").find(v)?.let { m ->
        val (r, g, b) = m.groupValues.drop(1).take(3).map { it.toInt().coerceIn(0, 255) }
        return Color(r, g, b, ((m.groupValues[4].ifEmpty { "1" }.toFloatOrNull() ?: 1f).coerceIn(0f, 1f) * 255).toInt())
    }
    return null
}

/** What a look draws on phones (tv.json's phone): a background gradient, and pictures placed from the screen's bottom
 *  on a stage 390 wide (scaled to the phone). */
data class PhoneLook(val id: String, val colours: Map<String, String>, val background: List<Pair<Float, Color>>, val scene: List<PhoneLayer>)
data class PhoneLayer(val image: String, val x: Float, val bottom: Float, val width: Float, val height: Float, val opacity: Float)

@OptIn(androidx.compose.ui.text.ExperimentalTextApi::class)
private fun fredoka(weight: Int) = Font(R.font.fredoka, FontWeight(weight), variationSettings = FontVariation.Settings(FontVariation.weight(weight)))
val Display = FontFamily(fredoka(400), fredoka(500), fredoka(600), fredoka(700))

@Composable
fun BeerMatTheme(content: @Composable () -> Unit) {
    val colours = darkColorScheme(
        primary = Brand.gold, onPrimary = Brand.onAccent, secondary = Brand.pink, onSecondary = Brand.text, tertiary = Brand.teal,
        background = Brand.bg, onBackground = Brand.text, surface = Brand.panel, onSurface = Brand.text, surfaceVariant = Brand.raised,
        onSurfaceVariant = Brand.muted, outline = Brand.line, error = Brand.bad,
    )
    val type = Typography(
        displaySmall = TextStyle(fontFamily = Display, fontWeight = FontWeight.Bold, fontSize = 34.sp, lineHeight = 40.sp),
        headlineMedium = TextStyle(fontFamily = Display, fontWeight = FontWeight.Bold, fontSize = 27.sp, lineHeight = 33.sp),
        titleLarge = TextStyle(fontFamily = Display, fontWeight = FontWeight.SemiBold, fontSize = 21.sp),
        labelLarge = TextStyle(fontWeight = FontWeight.Bold, fontSize = 16.sp, letterSpacing = 0.3.sp),
    )
    // Text outside a Surface takes the content colour: BeerMat's cream on the night background, not Material's black.
    MaterialTheme(colorScheme = colours, typography = type) {
        androidx.compose.runtime.CompositionLocalProvider(androidx.compose.material3.LocalContentColor provides Brand.text, content = content)
    }
}
