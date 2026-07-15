import AppKit
import CoreImage

enum IconStyle: String, CaseIterable, Identifiable {
    case classic
    case glass
    case dark

    var id: String { rawValue }

    var label: String {
        switch self {
        case .classic: return "Classic"
        case .glass: return "Glass"
        case .dark: return "Dark"
        }
    }
}

/// Produces (and caches) app icons in the selected visual style.
final class IconRenderer {
    static let shared = IconRenderer()

    private let cache = NSCache<NSString, NSImage>()
    private let ciContext = CIContext(options: nil)

    private init() {
        cache.countLimit = 1200
    }

    func icon(for app: AppInfo, style: IconStyle, pointSize: CGFloat) -> NSImage {
        let key = "\(app.id)|\(style.rawValue)|\(Int(pointSize))" as NSString
        if let cached = cache.object(forKey: key) {
            return cached
        }

        let base = NSWorkspace.shared.icon(forFile: app.url.path)
        base.size = NSSize(width: pointSize, height: pointSize)

        let result: NSImage
        switch style {
        case .classic, .glass:
            result = base
        case .dark:
            result = dimmed(base, pointSize: pointSize) ?? base
        }

        cache.setObject(result, forKey: key)
        return result
    }

    func clearCache() {
        cache.removeAllObjects()
    }

    /// Desaturated, slightly darkened rendition for the "Dark" theme —
    /// approximates the tinted look without needing the new icon format.
    private func dimmed(_ image: NSImage, pointSize: CGFloat) -> NSImage? {
        // Ask for a 2x-sized bitmap so Retina screens stay sharp.
        var proposedRect = NSRect(x: 0, y: 0, width: pointSize * 2, height: pointSize * 2)
        guard let cgImage = image.cgImage(forProposedRect: &proposedRect, context: nil, hints: nil) else {
            return nil
        }

        let input = CIImage(cgImage: cgImage)
        guard let filter = CIFilter(name: "CIColorControls") else { return nil }
        filter.setValue(input, forKey: kCIInputImageKey)
        filter.setValue(0.15, forKey: kCIInputSaturationKey)
        filter.setValue(-0.08, forKey: kCIInputBrightnessKey)
        filter.setValue(0.95, forKey: kCIInputContrastKey)

        guard let output = filter.outputImage,
              let rendered = ciContext.createCGImage(output, from: output.extent) else {
            return nil
        }

        return NSImage(cgImage: rendered, size: NSSize(width: pointSize, height: pointSize))
    }
}
