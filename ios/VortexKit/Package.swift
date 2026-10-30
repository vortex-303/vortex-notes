// swift-tools-version:6.0
import PackageDescription

let package = Package(
    name: "VortexKit",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "VortexKit", targets: ["VortexKit"]),
    ],
    targets: [
        .target(name: "VortexKit"),
        .testTarget(name: "VortexKitTests", dependencies: ["VortexKit"]),
    ]
)
