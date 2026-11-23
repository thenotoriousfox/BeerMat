// swift-tools-version:5.9
// BeerMatKit: the iPhone app's protocol, networking and shared rules, with no UI, so it builds and tests anywhere Swift
// runs (`swift test` on macOS or Linux). The Xcode app compiles these same files into the app target.
import PackageDescription

let package = Package(
    name: "BeerMatKit",
    platforms: [.iOS(.v16), .macOS(.v13)],
    products: [.library(name: "BeerMatKit", targets: ["BeerMatKit"])],
    targets: [
        .target(name: "BeerMatKit"),
        .testTarget(name: "BeerMatKitTests", dependencies: ["BeerMatKit"]),
    ]
)
