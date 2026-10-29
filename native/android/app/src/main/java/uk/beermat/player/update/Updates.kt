package uk.beermat.player.update

import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import uk.beermat.player.BuildConfig
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/** A newer BeerMat app, from BeerMat's update manifest (downloads.beermatquiz.co.uk/latest.json, shared/update.js). */
data class Offer(val version: String, val versionCode: Int, val name: String, val sha256: String, val size: Long, val url: String)

object UpdateManifest {
    private val fileName = Regex("^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\\.apk$")
    private val version = Regex("^\\d{1,4}\\.\\d{1,4}\\.\\d{1,4}$")

    /** The manifest's Android app when it's newer than this one (by versionCode) and well formed; otherwise null. The
     *  manifest's signature is for the desk; here the file's SHA-256 and the app's own signing key are what count. */
    fun offer(json: String, currentCode: Int, base: String = BuildConfig.DOWNLOADS): Offer? = runCatching {
        val m = JSONObject(json)
        val v = m.getString("version")
        val app = m.getJSONObject("files").optJSONObject("android") ?: return null
        val o = Offer(v, app.getInt("versionCode"), app.getString("name"), app.getString("sha256"), app.getLong("size"), "")
        if (m.optString("kind") != "beermat.update" || !version.matches(v) || !fileName.matches(o.name) || !Regex("^[0-9a-f]{64}$").matches(o.sha256) || o.size <= 0) return null
        if (o.versionCode <= currentCode) null else o.copy(url = "$base/$v/${o.name}")
    }.getOrNull()
}

/** Updates for the app when it's installed from BeerMat's website (not a store): check, download the new APK into
 *  the app's cache and check it, then hand it to Android's installer, which asks the player. Android only installs
 *  it over this app if it's signed with the same key; it's checked here first too, to say so plainly. */
class AppUpdater(private val context: Context) {
    private val folder get() = File(context.cacheDir, "updates")

    suspend fun check(): Offer? = withContext(Dispatchers.IO) {
        val connection = URL("${BuildConfig.DOWNLOADS}/latest.json").openConnection() as HttpURLConnection
        try {
            connection.connectTimeout = 10_000; connection.readTimeout = 15_000; connection.useCaches = false
            if (connection.responseCode != 200) return@withContext null
            UpdateManifest.offer(connection.inputStream.bufferedReader().readText(), BuildConfig.VERSION_CODE)
        } finally { connection.disconnect() }
    }

    /** The new APK, its size and SHA-256 checked; progress from 0 to 1. */
    suspend fun download(offer: Offer, progress: (Float) -> Unit): File = withContext(Dispatchers.IO) {
        folder.deleteRecursively(); folder.mkdirs()
        val target = File(folder, offer.name)
        val connection = URL(offer.url).openConnection() as HttpURLConnection
        try {
            connection.connectTimeout = 15_000; connection.readTimeout = 30_000
            if (connection.responseCode != 200) throw IllegalStateException("The download failed (${connection.responseCode})")
            val digest = MessageDigest.getInstance("SHA-256")
            var got = 0L
            connection.inputStream.use { input -> target.outputStream().use { out ->
                val buffer = ByteArray(64 * 1024)
                while (true) {
                    val n = input.read(buffer); if (n < 0) break
                    got += n
                    if (got > offer.size) throw IllegalStateException("The download is bigger than BeerMat released")
                    digest.update(buffer, 0, n); out.write(buffer, 0, n)
                    progress(got.toFloat() / offer.size)
                }
            } }
            val hash = digest.digest().joinToString("") { "%02x".format(it) }
            if (got != offer.size || hash != offer.sha256) throw IllegalStateException("The download doesn’t match what BeerMat released")
            if (!sameSigner(target)) throw IllegalStateException("The new app isn’t signed like this one: install it from the BeerMat website")
            target
        } catch (e: Exception) {
            target.delete(); throw e
        } finally { connection.disconnect() }
    }

    @Suppress("DEPRECATION")
    private fun signers(info: PackageInfo?): Set<String> = when {
        info == null -> emptySet()
        Build.VERSION.SDK_INT >= 28 -> info.signingInfo?.let { s -> (if (s.hasMultipleSigners()) s.apkContentsSigners else s.signingCertificateHistory) }?.map { it.toCharsString() }?.toSet() ?: emptySet()
        else -> info.signatures?.map { it.toCharsString() }?.toSet() ?: emptySet()
    }

    @Suppress("DEPRECATION")
    fun sameSigner(apk: File): Boolean {
        val flag = if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES
        val pm = context.packageManager
        val mine = signers(pm.getPackageInfo(context.packageName, flag))
        val theirs = pm.getPackageArchiveInfo(apk.path, flag)
        return theirs?.packageName == context.packageName && signers(theirs).any { it in mine }
    }

    /** Android may first need the player to let BeerMat install apps (once): that page opens instead, and false. */
    fun install(apk: File): Boolean {
        if (Build.VERSION.SDK_INT >= 26 && !context.packageManager.canRequestPackageInstalls()) {
            context.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            return false
        }
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.updates", apk)
        context.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK))
        return true
    }
}
