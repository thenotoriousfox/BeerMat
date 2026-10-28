package uk.beermat.player

import androidx.test.platform.app.InstrumentationRegistry
import java.io.File

/** Each test starts as a fresh install: no remembered teams, account or settings. */
class FreshApp : org.junit.rules.ExternalResource() {
    override fun before() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        // Through the API: the app process keeps preferences in memory between tests, so deleting the files isn't enough.
        File(context.applicationInfo.dataDir, "shared_prefs").listFiles()?.forEach { file ->
            context.getSharedPreferences(file.nameWithoutExtension, 0).edit().clear().commit()
        }
    }
}
