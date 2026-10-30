package uk.beermat.player.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import android.os.SystemClock
import androidx.lifecycle.compose.LifecycleResumeEffect
import kotlinx.coroutines.launch
import uk.beermat.player.BuildConfig
import uk.beermat.player.update.AppUpdater
import uk.beermat.player.update.Offer
import java.io.File

/** The last check: when, whether it failed, and what it found. Quiet either way (no internet at the venue is normal). */
private object UpdateCheck { var at = 0L; var failed = false; var offer: Offer? = null }

/** A newer app, if BeerMat's website has one; null in a store build. Asked again when the app comes back to the screen,
 *  at most every half hour, or after two minutes when the last try failed (on the quiz Wi-Fi, without the internet):
 *  Android keeps an app alive in the background for days, so once per start missed new versions. */
suspend fun updateOffer(apps: AppUpdater): Offer? {
    if (!BuildConfig.SELF_UPDATE) return null
    val now = SystemClock.elapsedRealtime()
    if (UpdateCheck.at == 0L || now - UpdateCheck.at > if (UpdateCheck.failed) 2 * 60_000L else 30 * 60_000L) {
        val result = runCatching { apps.check() }
        // A failed try keeps what was found before; a successful one replaces it (null: nothing newer).
        if (result.isSuccess) UpdateCheck.offer = result.getOrNull()
        UpdateCheck.failed = result.isFailure; UpdateCheck.at = now
    }
    return UpdateCheck.offer
}

/** A newer app from BeerMat's website: download it and hand it to Android's installer (update/Updates.kt). Shown on
 *  the start screen only, never in a quiz; on BeerMat TV, on its address screen (worded for a remote). */
@Composable
fun UpdateBanner(updater: AppUpdater? = null, tv: Boolean = false, buttonFocus: androidx.compose.ui.focus.FocusRequester? = null) {
    if (!BuildConfig.SELF_UPDATE) return
    val context = LocalContext.current
    val apps = remember { updater ?: AppUpdater(context.applicationContext) }
    var offer by remember { mutableStateOf(UpdateCheck.offer) }
    var progress by remember { mutableStateOf<Float?>(null) }
    var file by remember { mutableStateOf<File?>(null) }
    var message by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()
    LifecycleResumeEffect(Unit) {
        val check = scope.launch { offer = updateOffer(apps) }
        onPauseOrDispose { check.cancel() }
    }
    val o = offer ?: return
    Column(Modifier.fillMaxWidth().padding(bottom = 16.dp).clip(RoundedCornerShape(14.dp)).background(Brand.panel).padding(16.dp).testTag("update")) {
        Text(t("BeerMat {version} is out", "version" to o.version), fontWeight = FontWeight.Bold)
        Text(message.ifEmpty { t("Update the app now, before the quiz starts.") }, color = Brand.muted, fontSize = 14.sp, modifier = Modifier.padding(top = 4.dp, bottom = 10.dp))
        val downloading = progress != null && file == null
        // On a TV the button stays enabled while it downloads (a disabled one loses the remote's selection to the address
        // box, opening the keyboard); presses then do nothing.
        BigButton(if (downloading) t("Downloading… {percent}%", "percent" to ((progress ?: 0f) * 100).toInt()) else t("Update"), enabled = tv || !downloading,
            modifier = if (buttonFocus != null) Modifier.focusRequester(buttonFocus) else Modifier, keepFocus = tv) {
            if (downloading) return@BigButton
            val ready = file
            if (ready != null) { apps.install(ready); return@BigButton }
            message = ""; progress = 0f
            scope.launch {
                runCatching { apps.download(o) { p -> progress = p } }
                    .onSuccess { file = it; if (!apps.install(it)) message = if (tv) t("Allow BeerMat to install apps (Settings → Apps, or My Fire TV → Developer options), then press Update again.") else t("Allow BeerMat to install apps, then tap Update again.") }
                    .onFailure { message = it.message ?: t("The update didn’t download"); progress = null }
            }
        }
    }
}
