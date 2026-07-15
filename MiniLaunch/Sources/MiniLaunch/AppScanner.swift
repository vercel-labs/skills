import Foundation

struct AppInfo: Identifiable, Hashable {
    let id: String // full bundle path — stable and unique
    let name: String
    let url: URL
}

/// Finds installed applications on disk.
enum AppScanner {
    private static var searchRoots: [String] {
        [
            "/Applications",
            "/System/Applications",
            "/System/Applications/Utilities",
            NSHomeDirectory() + "/Applications",
        ]
    }

    static func scan() -> [AppInfo] {
        var found: [String: AppInfo] = [:]
        for root in searchRoots {
            scanDirectory(root, depth: 0, into: &found)
        }
        return found.values.sorted {
            $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending
        }
    }

    /// Collects .app bundles in `path`, descending one level into plain
    /// subfolders (e.g. /Applications/Utilities) but never inside bundles.
    private static func scanDirectory(_ path: String, depth: Int, into found: inout [String: AppInfo]) {
        let fm = FileManager.default
        guard let entries = try? fm.contentsOfDirectory(atPath: path) else { return }

        for entry in entries where !entry.hasPrefix(".") {
            let fullPath = path + "/" + entry
            if entry.hasSuffix(".app") {
                let name = fm.displayName(atPath: fullPath)
                found[fullPath] = AppInfo(
                    id: fullPath,
                    name: name,
                    url: URL(fileURLWithPath: fullPath)
                )
            } else if depth < 1 {
                var isDirectory: ObjCBool = false
                if fm.fileExists(atPath: fullPath, isDirectory: &isDirectory), isDirectory.boolValue {
                    scanDirectory(fullPath, depth: depth + 1, into: &found)
                }
            }
        }
    }
}
