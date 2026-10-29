package uk.beermat.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import uk.beermat.player.update.UpdateManifest

/** The app reads BeerMat's update manifest (shared/update.js, made by scripts/update-manifest.mjs) for itself. */
class UpdateManifestTest {
    private val hash = "a".repeat(64)
    private fun manifest(version: String = "0.5.6", code: Int = 606, name: String = "BeerMat-0.5.6.apk", kind: String = "beermat.update") =
        """{"v":1,"kind":"$kind","version":"$version","files":{"android":{"name":"$name","sha256":"$hash","size":2855042,"versionCode":$code},
            "windows-installer":{"name":"BeerMat-Desk-Setup-$version.exe","sha256":"$hash","size":5}},"sig":"x"}"""

    @Test fun aNewerAppIsOffered() {
        val offer = UpdateManifest.offer(manifest(), 605, "https://downloads.test")!!
        assertEquals("0.5.6", offer.version)
        assertEquals("https://downloads.test/0.5.6/BeerMat-0.5.6.apk", offer.url)
        assertEquals(2855042L, offer.size)
    }

    @Test fun theSameOrOlderIsNot() {
        assertNull(UpdateManifest.offer(manifest(code = 605), 605))
        assertNull(UpdateManifest.offer(manifest(version = "0.5.4", code = 604), 605))
    }

    @Test fun anythingOddIsIgnored() {
        assertNull(UpdateManifest.offer(manifest(name = "../evil.apk"), 605))
        assertNull(UpdateManifest.offer(manifest(name = "BeerMat.exe"), 605))
        assertNull(UpdateManifest.offer(manifest(kind = "something.else"), 605))
        assertNull(UpdateManifest.offer(manifest(version = "latest"), 605))
        assertNull(UpdateManifest.offer("""{"v":1,"kind":"beermat.update","version":"0.5.6","files":{}}""", 605))
        assertNull(UpdateManifest.offer("not json", 605))
    }
}
