package uk.beermat.player.game

/**
 * The same shuffle as seededOrder() in web/app.js, bit for bit: scrambled keypads and letter tiles appear in the same
 * places on a team's phone whether it plays in a browser or in the app, and differently from the next team's.
 */
fun seededOrder(length: Int, seed: String): List<Int> {
    var h = 2166136261L.toInt()
    // JavaScript iterates code points and takes each one's first UTF-16 unit.
    var i = 0
    while (i < seed.length) {
        val c = seed[i]
        h = (h xor c.code) * 16777619
        i += if (Character.isHighSurrogate(c) && i + 1 < seed.length && Character.isLowSurrogate(seed[i + 1])) 2 else 1
    }
    val order = MutableList(length) { it }
    for (k in length - 1 downTo 1) {
        h = ((h xor (h ushr 15)) * 2246822507L.toInt()) xor k
        val j = ((h.toLong() and 0xffffffffL) % (k + 1)).toInt()
        val swap = order[k]; order[k] = order[j]; order[j] = swap
    }
    return order
}
