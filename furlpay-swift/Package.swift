// swift-tools-version: 5.7
import PackageDescription

let package = Package(
    name: "FurlPay",
    platforms: [
        .iOS(.v16),
        .macOS(.v13)
    ],
    products: [
        .library(name: "FurlPay", targets: ["FurlPay"]),
    ],
    targets: [
        .target(name: "FurlPay", dependencies: []),
        .testTarget(name: "FurlPayTests", dependencies: ["FurlPay"]),
    ]
)