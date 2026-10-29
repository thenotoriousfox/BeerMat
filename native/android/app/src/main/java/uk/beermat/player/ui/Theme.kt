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

/** BeerMat's tokens (web/style.css, native/beermat_desk/qml/Desk/Theme.qml): night-purple, gold, pink, teal. */
object Brand {
    val bg = Color(0xFF140B2E)
    val bg2 = Color(0xFF0D0720)
    val panel = Color(0xFF221447)
    val raised = Color(0xFF2C1A5C)
    val line = Color(0x21FFF3D6)
    val text = Color(0xFFFFF8EC)
    val muted = Color(0xFFC8B9E4)
    val faint = Color(0xFF8D82A8)
    val gold = Color(0xFFFFB21A)
    val goldHi = Color(0xFFFFD25E)
    val pink = Color(0xFFFF3D81)
    val teal = Color(0xFF1FD6C6)
    val violet = Color(0xFF7A2CF0)
    val good = Color(0xFF34D399)
    val bad = Color(0xFFFF5470)
    val onAccent = Color(0xFF1C1036)
    /** Answer keys, matching the TV's option tiles. */
    val options = listOf(Color(0xFFFF5470), Color(0xFF3B82F6), Color(0xFF34D399), Color(0xFFFFB21A), Color(0xFF7A2CF0), Color(0xFF1FD6C6))
}

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
