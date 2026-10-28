package uk.beermat.player

import androidx.test.platform.app.InstrumentationRegistry
import java.io.File

/** Each test starts as a fresh install: no remembered teams, account or settings. */
class FreshApp : org.junit.rules.ExternalResource() {
    override fun before() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        File(context.applicationInfo.dataDir, "shared_prefs").listFiles()?.forEach { it.delete() }
    }
}
