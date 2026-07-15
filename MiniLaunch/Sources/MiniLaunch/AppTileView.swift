import SwiftUI

/// One app in the grid: icon, optional title, hover highlight, click to launch.
struct AppTileView: View {
    let app: AppInfo

    @EnvironmentObject private var model: LauncherModel
    @EnvironmentObject private var settings: AppSettings
    @State private var hovering = false

    var body: some View {
        let iconSize = CGFloat(settings.iconSize)

        VStack(spacing: 10) {
            Image(nsImage: IconRenderer.shared.icon(for: app, style: settings.iconStyle, pointSize: iconSize))
                .resizable()
                .interpolation(.high)
                .frame(width: iconSize, height: iconSize)

            if !settings.hideTitles {
                Text(app.name)
                    .font(.system(size: 12.5, weight: .medium))
                    .foregroundColor(.white.opacity(0.85))
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .frame(maxWidth: iconSize + 24)
            }
        }
        .padding(.vertical, 14)
        .padding(.horizontal, 8)
        .frame(width: iconSize + 44)
        .background(tileBackground)
        .scaleEffect(hovering ? 1.05 : 1.0)
        .animation(.easeOut(duration: 0.12), value: hovering)
        .contentShape(RoundedRectangle(cornerRadius: 20))
        .onHover { hovering = $0 }
        .onTapGesture { model.launch(app) }
    }

    @ViewBuilder
    private var tileBackground: some View {
        switch settings.iconStyle {
        case .classic:
            RoundedRectangle(cornerRadius: 20)
                .fill(Color.white.opacity(hovering ? 0.10 : 0.0))
        case .glass:
            RoundedRectangle(cornerRadius: 20)
                .fill(.ultraThinMaterial)
                .overlay(
                    RoundedRectangle(cornerRadius: 20)
                        .stroke(Color.white.opacity(hovering ? 0.28 : 0.12), lineWidth: 1)
                )
        case .dark:
            RoundedRectangle(cornerRadius: 20)
                .fill(Color.black.opacity(hovering ? 0.66 : 0.52))
                .overlay(
                    RoundedRectangle(cornerRadius: 20)
                        .stroke(Color.white.opacity(hovering ? 0.22 : 0.08), lineWidth: 1)
                )
        }
    }
}
