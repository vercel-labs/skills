import SwiftUI
import AppKit

@main
struct MiniLaunchApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate

    var body: some Scene {
        MenuBarExtra("MiniLaunch", systemImage: "square.grid.3x3.fill") {
            Button("Show Launcher (⌥ Space)") {
                appDelegate.toggleLauncher()
            }
            Button("Rescan Apps") {
                appDelegate.model.refreshApps()
            }
            Divider()
            Button("Settings…") {
                appDelegate.showSettings()
            }
            Divider()
            Button("Quit MiniLaunch") {
                NSApp.terminate(nil)
            }
        }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    let settings = AppSettings()
    lazy var model = LauncherModel()

    private var launcherPanel: LauncherPanel?
    private var hotkeyManager: HotkeyManager?
    private var settingsWindow: NSWindow?

    func applicationDidFinishLaunching(_ notification: Notification) {
        // Menu-bar-only app: no Dock icon, no app switcher entry.
        NSApp.setActivationPolicy(.accessory)

        model.onDismiss = { [weak self] in self?.hideLauncher() }
        model.refreshApps()

        hotkeyManager = HotkeyManager { [weak self] in
            self?.toggleLauncher()
        }
    }

    // MARK: - Launcher panel

    func toggleLauncher() {
        if launcherPanel?.isVisible == true {
            hideLauncher()
        } else {
            showLauncher()
        }
    }

    func showLauncher() {
        let panel = launcherPanel ?? makeLauncherPanel()
        let screen = screenWithMouse()
        panel.setFrame(screen.frame, display: true)

        model.prepareForShow()

        panel.alphaValue = 0
        panel.makeKeyAndOrderFront(nil)
        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.18
            panel.animator().alphaValue = 1
        }
    }

    func hideLauncher() {
        guard let panel = launcherPanel, panel.isVisible else { return }
        NSAnimationContext.runAnimationGroup({ context in
            context.duration = 0.15
            panel.animator().alphaValue = 0
        }, completionHandler: {
            panel.orderOut(nil)
        })
    }

    private func makeLauncherPanel() -> LauncherPanel {
        let screen = screenWithMouse()
        let panel = LauncherPanel(contentRect: screen.frame)
        panel.onEscape = { [weak self] in self?.hideLauncher() }

        let rootView = LauncherView()
            .environmentObject(model)
            .environmentObject(settings)
        panel.contentView = NSHostingView(rootView: rootView)

        launcherPanel = panel
        return panel
    }

    private func screenWithMouse() -> NSScreen {
        let mouseLocation = NSEvent.mouseLocation
        let screen = NSScreen.screens.first { NSMouseInRect(mouseLocation, $0.frame, false) }
        return screen ?? NSScreen.main ?? NSScreen.screens[0]
    }

    // MARK: - Settings window

    func showSettings() {
        if settingsWindow == nil {
            let rootView = SettingsView()
                .environmentObject(model)
                .environmentObject(settings)
            let hosting = NSHostingController(rootView: rootView)
            let window = NSWindow(contentViewController: hosting)
            window.title = "MiniLaunch Settings"
            window.styleMask = [.titled, .closable, .miniaturizable]
            window.isReleasedWhenClosed = false
            window.setContentSize(NSSize(width: 460, height: 380))
            settingsWindow = window
        }
        NSApp.activate(ignoringOtherApps: true)
        settingsWindow?.center()
        settingsWindow?.makeKeyAndOrderFront(nil)
    }
}
