import AppKit
import Foundation

/// User preferences, persisted to UserDefaults.
final class AppSettings: ObservableObject {
    private enum Keys {
        static let iconStyle = "iconStyle"
        static let hideTitles = "hideTitles"
        static let iconSize = "iconSize"
        static let wallpaperPath = "wallpaperPath"
    }

    @Published var iconStyle: IconStyle {
        didSet { defaults.set(iconStyle.rawValue, forKey: Keys.iconStyle) }
    }

    @Published var hideTitles: Bool {
        didSet { defaults.set(hideTitles, forKey: Keys.hideTitles) }
    }

    /// Icon edge length in points (56–120).
    @Published var iconSize: Double {
        didSet { defaults.set(iconSize, forKey: Keys.iconSize) }
    }

    /// Path to a user-chosen wallpaper image; nil means the built-in background.
    @Published var wallpaperPath: String? {
        didSet {
            defaults.set(wallpaperPath, forKey: Keys.wallpaperPath)
            loadWallpaperImage()
        }
    }

    /// Loaded once per path change so views never touch the disk.
    @Published private(set) var wallpaperImage: NSImage?

    private let defaults = UserDefaults.standard

    init() {
        let styleRaw = defaults.string(forKey: Keys.iconStyle) ?? IconStyle.dark.rawValue
        iconStyle = IconStyle(rawValue: styleRaw) ?? .dark
        hideTitles = defaults.object(forKey: Keys.hideTitles) as? Bool ?? false
        let storedSize = defaults.object(forKey: Keys.iconSize) as? Double ?? 76
        iconSize = min(max(storedSize, 56), 120)
        wallpaperPath = defaults.string(forKey: Keys.wallpaperPath)
        loadWallpaperImage()
    }

    private func loadWallpaperImage() {
        if let path = wallpaperPath, let image = NSImage(contentsOfFile: path) {
            wallpaperImage = image
        } else {
            wallpaperImage = nil
        }
    }
}
