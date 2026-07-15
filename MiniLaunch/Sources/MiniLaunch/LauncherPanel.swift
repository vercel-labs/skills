import AppKit

/// Borderless, full-screen panel that hosts the launcher UI.
///
/// It sits above the menu bar and Dock, joins every Space, and can become
/// the key window without activating the app (Spotlight-style), so typing
/// goes straight into the search field.
final class LauncherPanel: NSPanel {
    var onEscape: (() -> Void)?

    init(contentRect: NSRect) {
        super.init(
            contentRect: contentRect,
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )

        isFloatingPanel = true
        level = NSWindow.Level(rawValue: NSWindow.Level.mainMenu.rawValue + 1)
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        backgroundColor = .clear
        isOpaque = false
        hasShadow = false
        hidesOnDeactivate = false
        becomesKeyOnlyIfNeeded = false
        animationBehavior = .none
    }

    // Borderless windows refuse key status by default; we need it for the search field.
    override var canBecomeKey: Bool { true }

    // Esc anywhere in the panel closes the launcher.
    override func cancelOperation(_ sender: Any?) {
        onEscape?()
    }
}
