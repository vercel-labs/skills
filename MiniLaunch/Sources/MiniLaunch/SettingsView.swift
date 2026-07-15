import SwiftUI
import UniformTypeIdentifiers

struct SettingsView: View {
    @EnvironmentObject private var model: LauncherModel
    @EnvironmentObject private var settings: AppSettings

    var body: some View {
        Form {
            Section {
                Picker("Icon style", selection: $settings.iconStyle) {
                    ForEach(IconStyle.allCases) { style in
                        Text(style.label).tag(style)
                    }
                }
                .pickerStyle(.segmented)

                Toggle("Hide app titles", isOn: $settings.hideTitles)

                VStack(alignment: .leading) {
                    Text("Icon size: \(Int(settings.iconSize)) pt")
                    Slider(value: $settings.iconSize, in: 56...120, step: 4)
                }
            } header: {
                Text("Appearance")
            }

            Section {
                HStack {
                    Text(wallpaperLabel)
                        .lineLimit(1)
                        .truncationMode(.middle)
                        .foregroundColor(.secondary)
                    Spacer()
                    Button("Choose Image…") { chooseWallpaper() }
                    if settings.wallpaperPath != nil {
                        Button("Use Built-in") { settings.wallpaperPath = nil }
                    }
                }
            } header: {
                Text("Wallpaper")
            }

            Section {
                HStack {
                    Text("\(model.apps.count) apps found")
                        .foregroundColor(.secondary)
                    Spacer()
                    Button("Rescan Apps") { model.refreshApps() }
                }
                Text("Open the launcher anytime with ⌥ Space.")
                    .font(.callout)
                    .foregroundColor(.secondary)
            } header: {
                Text("General")
            }
        }
        .formStyle(.grouped)
        .frame(width: 460, height: 380)
    }

    private var wallpaperLabel: String {
        if let path = settings.wallpaperPath {
            return (path as NSString).lastPathComponent
        }
        return "Built-in dark glass"
    }

    private func chooseWallpaper() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.image]
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        panel.message = "Choose a wallpaper image for the launcher"
        if panel.runModal() == .OK, let url = panel.url {
            settings.wallpaperPath = url.path
        }
    }
}
