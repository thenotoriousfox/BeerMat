package uk.beermat.player

import androidx.compose.ui.graphics.Color
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import uk.beermat.player.net.Parse
import uk.beermat.player.ui.Brand
import uk.beermat.player.ui.cssColour

/** A quiz's look on the phone: CSS colours read as look.css writes them, and GET /api/looks/<id> as the app uses it. */
class LookTest {
    @Test fun cssColoursAsLookCssWritesThem() {
        assertEquals(Color(0xFFFF7A1A), cssColour("#ff7a1a"))
        assertEquals(Color(0xFFFFAA00), cssColour(" #fa0 "))
        assertEquals(Color(255, 150, 70, 51), cssColour("rgba(255, 150, 70, .2)"))
        assertEquals(Color(0x80112233), cssColour("#11223380"))
        assertEquals(Color(10, 20, 30), cssColour("rgb(10,20,30)"))
        assertNull(cssColour("calc(max(100vw, 150vh))"))
        assertNull(cssColour(null))
    }

    @Test fun aLooksColoursReplaceBeerMatsUntilItGoesBack() {
        val gold = Brand.gold
        Brand.apply(mapOf("--gold" to "#ff7a1a", "--cyan" to "rgba(157, 255, 90, 1)", "--scene" to "calc(1px)"))
        assertEquals(Color(0xFFFF7A1A), Brand.gold)
        assertEquals(Color(157, 255, 90), Brand.teal)
        Brand.apply(emptyMap())
        assertEquals(gold, Brand.gold)
    }

    @Test fun theLookAsTheServerSendsIt() {
        val look = Parse.look(JSONObject("""{"id": "halloween", "name": "Halloween", "colours": {"--gold": "#ff7a1a"},
            "phone": {"background": {"gradient": [[0, "#0c0618"], [1, "#5a2140"]]},
                      "scene": [{"image": "/themes/halloween/art/phone-moon.webp", "x": 140, "bottom": 120, "width": 257, "height": 257}]}}"""), "http://10.42.0.1")
        assertEquals("halloween", look.id)
        assertEquals(mapOf("--gold" to "#ff7a1a"), look.colours)
        assertEquals(listOf(0f to Color(0xFF0C0618), 1f to Color(0xFF5A2140)), look.background)
        assertEquals("http://10.42.0.1/themes/halloween/art/phone-moon.webp", look.scene.single().image)
        assertEquals(120f, look.scene.single().bottom)
        // The default look: no scenery, BeerMat's own colours.
        val stage = Parse.look(JSONObject("""{"id": "stage", "colours": {}, "phone": null}"""), "http://10.42.0.1")
        assertEquals(emptyList<Any>(), stage.scene)
    }
}
