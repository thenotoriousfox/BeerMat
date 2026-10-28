/// The same shuffle as seededOrder() in web/app.js, bit for bit, so scrambled keypads and letter tiles sit in the same
/// places on a team's phone in a browser, the Android app and this app.
public func seededOrder(_ length: Int, _ seed: String) -> [Int] {
    var h: UInt32 = 2166136261
    // JavaScript iterates code points and takes each one's first UTF-16 unit.
    for scalar in seed.unicodeScalars {
        let unit = UInt32(String(scalar).utf16.first!)
        h = (h ^ unit) &* 16777619
    }
    var order = Array(0..<max(0, length))
    var i = length - 1
    while i > 0 {
        h = ((h ^ (h >> 15)) &* 2246822507) ^ UInt32(i)
        let j = Int(h % UInt32(i + 1))
        order.swapAt(i, j)
        i -= 1
    }
    return order
}
