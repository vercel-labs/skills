import AppKit
import Foundation

final class LauncherModel: ObservableObject {
    @Published var apps: [AppInfo] = []
    @Published var searchText: String = ""
    /// Bumped every time the launcher is shown so views can reset focus.
    @Published var showCount: Int = 0

    var onDismiss: (() -> Void)?

    var filteredApps: [AppInfo] {
        let query = searchText.trimmingCharacters(in: .whitespaces).lowercased()
        guard !query.isEmpty else { return apps }

        var prefixMatches: [AppInfo] = []
        var containsMatches: [AppInfo] = []
        for app in apps {
            let name = app.name.lowercased()
            if name.hasPrefix(query) {
                prefixMatches.append(app)
            } else if name.contains(query) {
                containsMatches.append(app)
            }
        }
        return prefixMatches + containsMatches
    }

    func refreshApps() {
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let result = AppScanner.scan()
            DispatchQueue.main.async {
                self?.apps = result
            }
        }
    }

    func prepareForShow() {
        searchText = ""
        showCount += 1
        refreshApps()
    }

    func dismiss() {
        onDismiss?()
    }

    func launch(_ app: AppInfo) {
        NSWorkspace.shared.openApplication(
            at: app.url,
            configuration: NSWorkspace.OpenConfiguration(),
            completionHandler: nil
        )
        dismiss()
    }

    func launchFirstResult() {
        guard let first = filteredApps.first else { return }
        launch(first)
    }
}
