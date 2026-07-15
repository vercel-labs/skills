import SwiftUI

/// The launcher's edge-to-edge background: either the user's own image or a
/// built-in procedural "dark glass domes" scene (no bundled assets needed).
struct BackgroundView: View {
    @EnvironmentObject private var settings: AppSettings

    var body: some View {
        GeometryReader { geo in
            ZStack {
                if let image = settings.wallpaperImage {
                    Image(nsImage: image)
                        .resizable()
                        .scaledToFill()
                        .frame(width: geo.size.width, height: geo.size.height)
                        .clipped()
                    // Scrim keeps icons and text readable over any photo.
                    Color.black.opacity(0.35)
                } else {
                    builtInScene(size: geo.size)
                }
            }
        }
        .ignoresSafeArea()
    }

    private func builtInScene(size: CGSize) -> some View {
        ZStack {
            Color(red: 0.045, green: 0.05, blue: 0.065)

            // Overlapping glass domes rising from the bottom edge.
            glassDome(diameter: size.width * 0.95)
                .position(x: size.width * 0.50, y: size.height * 1.10)
            glassDome(diameter: size.width * 0.75)
                .position(x: size.width * 0.08, y: size.height * 1.00)
            glassDome(diameter: size.width * 0.75)
                .position(x: size.width * 0.92, y: size.height * 0.98)

            // Soft moonlight glow, upper right.
            Circle()
                .fill(
                    RadialGradient(
                        gradient: Gradient(colors: [
                            Color.white.opacity(0.10),
                            Color.white.opacity(0.02),
                            .clear,
                        ]),
                        center: .center,
                        startRadius: 10,
                        endRadius: 260
                    )
                )
                .frame(width: 520, height: 520)
                .position(x: size.width * 0.82, y: size.height * 0.22)

            // Gentle vignette.
            RadialGradient(
                gradient: Gradient(colors: [.clear, Color.black.opacity(0.45)]),
                center: .center,
                startRadius: size.width * 0.30,
                endRadius: size.width * 0.85
            )
        }
    }

    private func glassDome(diameter: CGFloat) -> some View {
        Circle()
            .fill(
                RadialGradient(
                    gradient: Gradient(colors: [
                        Color.white.opacity(0.075),
                        Color.white.opacity(0.02),
                        .clear,
                    ]),
                    center: UnitPoint(x: 0.5, y: 0.05),
                    startRadius: 0,
                    endRadius: diameter * 0.75
                )
            )
            .overlay(
                Circle()
                    .stroke(
                        LinearGradient(
                            gradient: Gradient(colors: [
                                Color.white.opacity(0.35),
                                Color.white.opacity(0.02),
                            ]),
                            startPoint: .top,
                            endPoint: .center
                        ),
                        lineWidth: 1.2
                    )
            )
            .frame(width: diameter, height: diameter)
    }
}
