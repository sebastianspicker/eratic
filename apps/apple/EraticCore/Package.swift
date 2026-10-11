// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "EraticCore",
    platforms: [.macOS(.v14), .iOS(.v17)],
    products: [.library(name: "EraticCore", targets: ["EraticCore"])],
    targets: [
        .target(name: "EraticCore"),
        .testTarget(name: "EraticCoreTests", dependencies: ["EraticCore"])
    ]
)
