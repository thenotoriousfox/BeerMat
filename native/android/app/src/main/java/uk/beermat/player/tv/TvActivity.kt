package uk.beermat.player.tv

import android.annotation.SuppressLint
import android.content.Context
import android.os.Bundle
import android.view.WindowManager
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import kotlinx.coroutines.delay
import uk.beermat.player.R
import uk.beermat.player.net.QuizServer
import uk.beermat.player.ui.BeerMatTheme
import uk.beermat.player.ui.Brand
import uk.beermat.player.ui.I18n
import uk.beermat.player.ui.t

/**
 * BeerMat TV: an Android TV, Google TV or Fire TV shows the quiz with no cable to the laptop. It finds the quiz laptop
 * on the TV's network (TvFinder), then shows the quiz's own TV page (/tv, the one a TV's browser opens) full screen,
 * with sound, the screen kept on; if the laptop drops off it tries again by itself. Back returns to the address.
 */
class TvActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        I18n.load(this)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        WindowInsetsControllerCompat(window, window.decorView).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
        val prefs = getSharedPreferences("tv", Context.MODE_PRIVATE)
        setContent {
            BeerMatTheme {
                var showing by remember { mutableStateOf<String?>(null) }
                val current = showing
                if (current == null) Connect(saved = prefs.getString("address", null), gateway = { TvFinder.gateway(this) }, own = { TvFinder.ownAddress(this) }) { base ->
                    prefs.edit().putString("address", base).apply(); showing = base
                } else {
                    BackHandler { showing = null }
                    TvPage(current)
                }
            }
        }
    }
}

/** Finding the quiz: automatically on the TV's network, or the address the quizmaster types. */
@Composable
private fun Connect(saved: String?, gateway: () -> String?, own: () -> String?, open: (String) -> Unit) {
    var status by remember { mutableStateOf(t("Looking for the quiz on this Wi-Fi…")) }
    var looking by remember { mutableIntStateOf(1) }
    var typed by remember { mutableStateOf(saved?.removePrefix("http://") ?: "") }
    var checking by remember { mutableStateOf(false) }
    val button = remember { FocusRequester() }
    LaunchedEffect(looking) {
        status = t("Looking for the quiz on this Wi-Fi…")
        val found = TvFinder.find(TvFinder.candidates(saved, gateway())) ?: run {
            status = t("Looking for the quiz laptop on this network…")
            TvFinder.find(TvFinder.neighbours(own()))
        }
        if (found != null) { status = t("Found “{title}”", "title" to found.second); delay(800); open(found.first) }
        else status = t("No quiz found on this network. Is the TV on the same Wi-Fi as the laptop? Or type the address from the desk (TV without a cable…).")
    }
    LaunchedEffect(checking) {
        if (!checking) return@LaunchedEffect
        val base = runCatching { QuizServer.normalise(typed) }.getOrNull()
        val title = base?.let { TvFinder.find(listOf(it)) }
        checking = false
        if (title != null) open(title.first) else status = t("Nothing at {address} answers as a BeerMat quiz.", "address" to typed)
    }
    LaunchedEffect(Unit) { runCatching { button.requestFocus() } }
    Box(Modifier.fillMaxSize().background(Brand.bg), contentAlignment = Alignment.Center) {
        Column(Modifier.width(720.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(18.dp)) {
            Image(painterResource(R.mipmap.ic_launcher_foreground), null, Modifier.size(140.dp))
            Text("BeerMat TV", color = Brand.text, fontSize = 44.sp, fontWeight = FontWeight.Bold)
            Text(status, color = Brand.muted, fontSize = 20.sp, modifier = Modifier.testTag("tv-status"))
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(typed, { typed = it }, label = { Text(t("Quiz address, e.g. 10.42.0.1")) }, singleLine = true,
                    modifier = Modifier.width(420.dp).testTag("tv-address"))
                Button({ checking = true }, enabled = typed.isNotBlank() && !checking, shape = RoundedCornerShape(16.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = Brand.gold, contentColor = Brand.onAccent),
                    modifier = Modifier.focusRequester(button).testTag("tv-connect")) { Text(t("Show the quiz"), fontSize = 18.sp, fontWeight = FontWeight.Bold) }
            }
            OutlinedButton({ looking++ }) { Text(t("Look again"), color = Brand.text) }
        }
    }
}

/** The quiz's TV page, full screen with sound; when the laptop can't be reached it tries again every few seconds. */
@SuppressLint("SetJavaScriptEnabled")
@Composable
private fun TvPage(base: String) {
    var lost by remember { mutableStateOf(false) }
    var view by remember { mutableStateOf<WebView?>(null) }
    LaunchedEffect(lost) { while (lost) { delay(4000); view?.reload() } }
    Box(Modifier.fillMaxSize().background(Brand.bg)) {
        AndroidView({ context ->
            // Debug builds: the page can be inspected from a computer (chrome://inspect), and its console is in logcat.
            WebView.setWebContentsDebuggingEnabled(uk.beermat.player.BuildConfig.DEBUG)
            WebView(context).apply {
                // Full size before the page loads: the TV page sizes itself to the screen (100vh), which a WebView
                // measured at nothing gives as 0, leaving the quiz scaled to nothing.
                layoutParams = android.view.ViewGroup.LayoutParams(android.view.ViewGroup.LayoutParams.MATCH_PARENT, android.view.ViewGroup.LayoutParams.MATCH_PARENT)
                webChromeClient = object : android.webkit.WebChromeClient() {
                    override fun onConsoleMessage(message: android.webkit.ConsoleMessage): Boolean {
                        android.util.Log.i("BeerMatTV", "${message.messageLevel()} ${message.sourceId()}:${message.lineNumber()} ${message.message()}"); return true
                    }
                }
                settings.javaScriptEnabled = true
                settings.domStorageEnabled = true
                // Sound without a press of OK: the TV page plays the quiz's sounds.
                settings.mediaPlaybackRequiresUserGesture = false
                setBackgroundColor(0xFF140B2E.toInt())
                isFocusable = false
                webViewClient = object : WebViewClient() {
                    override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                        if (request.isForMainFrame) lost = true
                    }
                    // Each try starts hopeful; an error for the page itself (not a picture) means the laptop's gone.
                    override fun onPageStarted(view: WebView, url: String, favicon: android.graphics.Bitmap?) { lost = false }
                }
                loadUrl("$base/tv?app=1")
                view = this
            }
        }, modifier = Modifier.fillMaxSize().testTag("tv-page"))
        if (lost) Box(Modifier.fillMaxSize().background(Brand.bg), contentAlignment = Alignment.Center) {
            Text(t("Can’t reach the quiz laptop at {address}. Trying again…", "address" to base.removePrefix("http://")), color = Brand.muted, fontSize = 24.sp,
                modifier = Modifier.padding(40.dp))
        }
    }
}
