// swift-tools-version: 5.9
// MiniLaunch — a LaunchMe-inspired launcher for macOS.
// Open this file in Xcode (File → Open…) or run `swift run` in this folder.

import PackageDescription

let package = Package(
    name: "MiniLaunch",
    platforms: [
        .macOS(.v13)
    ],
    targets: [
        .executableTarget(
            name: "MiniLaunch",
            path: "Sources/MiniLaunch"
        )
    ]
)
