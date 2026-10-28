package uk.beermat.player.data

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * What the phone remembers: each quiz's team recovery code (encrypted with a key that never leaves the Android
 * Keystore) and the recent quiz addresses. Nothing here is sent anywhere but the quiz server it belongs to.
 */
class Identity(context: Context) {
    private val prefs = context.getSharedPreferences("beermat", Context.MODE_PRIVATE)

    data class Saved(val server: String, val secret: String, val team: String, val event: String)
    data class Recent(val server: String, val title: String, val at: Long)

    fun team(server: String): Saved? {
        val raw = prefs.getString("team:$server", null) ?: return null
        return try {
            val o = JSONObject(raw)
            Saved(server, decrypt(o.getString("secret")), o.optString("team"), o.optString("event"))
        } catch (_: Exception) { null }
    }

    fun saveTeam(saved: Saved) {
        prefs.edit().putString("team:${saved.server}", JSONObject().put("secret", encrypt(saved.secret)).put("team", saved.team).put("event", saved.event).toString()).apply()
    }

    fun forgetTeam(server: String) = prefs.edit().remove("team:$server").apply()

    fun recent(): List<Recent> = try {
        val a = JSONArray(prefs.getString("recent", "[]"))
        List(a.length()) { a.getJSONObject(it) }.map { Recent(it.getString("server"), it.optString("title"), it.optLong("at")) }
    } catch (_: Exception) { emptyList() }

    fun remember(server: String, title: String) {
        val list = listOf(Recent(server, title, System.currentTimeMillis())) + recent().filter { it.server != server }
        prefs.edit().putString("recent", JSONArray(list.take(8).map { JSONObject().put("server", it.server).put("title", it.title).put("at", it.at) }).toString()).apply()
    }

    var haptics: Boolean
        get() = prefs.getBoolean("haptics", true)
        set(on) = prefs.edit().putBoolean("haptics", on).apply()

    // ---- Keystore ----
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getEntry(ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }

    private fun encrypt(text: String): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
        return Base64.encodeToString(cipher.iv + cipher.doFinal(text.toByteArray()), Base64.NO_WRAP)
    }

    private fun decrypt(text: String): String {
        val bytes = Base64.decode(text, Base64.NO_WRAP)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes, 0, 12)) }
        return String(cipher.doFinal(bytes, 12, bytes.size - 12))
    }

    private companion object { const val ALIAS = "beermat-team-codes" }
}
