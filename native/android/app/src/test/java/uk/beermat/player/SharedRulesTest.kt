package uk.beermat.player

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import uk.beermat.player.game.seededOrder
import uk.beermat.player.net.Hello
import uk.beermat.player.net.Parse
import uk.beermat.player.net.QuizServer
import uk.beermat.player.net.Scanned

/** What the app must do exactly as the browser player and the server do. */
class SharedRulesTest {
    // Expected orders are seededOrder() in web/app.js run in Node, so a scrambled keypad matches a browser's.
    @Test fun seededOrderMatchesTheWebPlayer() {
        assertEquals(listOf(15, 5, 18, 10, 4, 11, 0, 25, 14, 7, 6, 3, 2, 12, 22, 16, 23, 21, 24, 20, 9, 8, 13, 19, 1, 17), seededOrder(26, "abc123:7"))
        assertEquals(listOf(1, 3, 0, 2), seededOrder(4, "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a6978:42"))
        assertEquals(listOf(3, 2, 1, 5, 7, 6, 8, 9, 0, 4), seededOrder(10, "team:1"))
        assertEquals(listOf(3, 1, 5, 4, 2, 0), seededOrder(6, "é🍺x:3"))
    }

    @Test fun addressesAndWifiCodes() {
        assertEquals("http://10.42.0.1:3000", QuizServer.normalise(" 10.42.0.1:3000/ "))
        assertEquals("http://10.42.0.1", QuizServer.normalise("http://10.42.0.1/"))
        assertEquals("https://abc.trycloudflare.com", QuizServer.normalise("https://abc.trycloudflare.com/?x=1"))
        assertEquals(Scanned.Address("http://192.168.1.20:3000"), Scanned.parse("http://192.168.1.20:3000/"))
        // web/qr.js wifiCode: WIFI:T:WPA;S:<ssid>;P:<password>;; with \ escapes.
        assertEquals(Scanned.Wifi("Pub Quiz;1", "pa:ss"), Scanned.parse("WIFI:T:WPA;S:Pub Quiz\\;1;P:pa\\:ss;;"))
        assertEquals(Scanned.Wifi("BeerMat", ""), Scanned.parse("WIFI:T:nopass;S:BeerMat;;"))
    }

    @Test fun helloRecognisesOnlyBeerMat() {
        assertNull(Hello.parse(JSONObject("""{"app":"Other"}""")))
        val hello = Hello.parse(JSONObject("""{"app":"BeerMat","protocol":1,"title":"Quiz","rehearsal":true,"registrationOpen":true}"""))!!
        assertTrue(hello.rehearsal); assertEquals(1, hello.protocol)
    }

    @Test fun rehearsalTestDeviceState() {
        // The state a real phone gets in a rehearsal (server.js): connected, no question, no play.
        val s = Parse.state(JSONObject("""{"protocol":1,"serverTime":1,"build":"b","settings":{"title":"Rehearsal night"},"event":"e","question":null,"teams":[],
            "team":{"id":"t","name":"Dave's phone","waiting":false},"answer":null,"draft":null,"rehearsal":{"device":true,"connected":true,"title":"Rehearsal night"}}"""))
        assertTrue(s.testDevice); assertNull(s.question); assertEquals("Dave's phone", s.team?.name)
    }

    @Test fun questionNeverCarriesTheAnswerUntilRevealed() {
        val q = Parse.question(JSONObject("""{"id":3,"type":"choice","round":"R1","text":"Q?","options":["A","B"],"points":1,"seconds":30,"deadline":99,"remaining":0,"open":true,"live":true,"paused":false,"revealed":false}"""))
        assertNull(q.answer); assertFalse(q.revealed); assertEquals(listOf("A", "B"), q.options)
        val revealed = Parse.question(JSONObject("""{"id":3,"type":"multi","options":["A","B"],"answer":["A","B"],"revealed":true}"""))
        assertEquals("A, B", revealed.answer)
    }
}
