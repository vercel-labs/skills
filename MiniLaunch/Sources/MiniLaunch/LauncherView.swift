import SwiftUI

/// The full-screen launcher: search bar on top, app grid below,
/// drawn over the wallpaper background.
struct LauncherView: View {
    @EnvironmentObject private var model: LauncherModel
    @EnvironmentObject private var settings: AppSettings
    @FocusState private var searchFocused: Bool

    var body: some View {
        ZStack {
            BackgroundView()
                .onTapGesture { model.dismiss() }

            VStack(spacing: 30) {
                searchBar
                    .frame(maxWidth: 560)
                    .padding(.top, 64)

                appGrid
            }
        }
        .ignoresSafeArea()
        .onExitCommand { model.dismiss() }
        .onAppear { focusSearch() }
        .onChange(of: model.showCount) { _ in focusSearch() }
    }

    private var searchBar: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass")
                .foregroundColor(.white.opacity(0.55))
            TextField("Search apps", text: $model.searchText)
                .textFieldStyle(.plain)
                .font(.system(size: 17))
                .foregroundColor(.white)
                .focused($searchFocused)
                .onSubmit { model.launchFirstResult() }
        }
        .padding(.vertical, 11)
        .padding(.horizontal, 18)
        .background(
            Capsule()
                .fill(Color.white.opacity(0.09))
                .overlay(Capsule().stroke(Color.white.opacity(0.16), lineWidth: 1))
        )
    }

    @ViewBuilder
    private var appGrid: some View {
        let tileWidth = CGFloat(settings.iconSize) + 44

        if model.filteredApps.isEmpty {
            Spacer()
            Text(model.apps.isEmpty
                 ? "Scanning your applications…"
                 : "No apps match “\(model.searchText)”")
                .font(.system(size: 16))
                .foregroundColor(.white.opacity(0.55))
            Spacer()
        } else {
            ScrollView(showsIndicators: false) {
                LazyVGrid(
                    columns: [GridItem(.adaptive(minimum: tileWidth, maximum: tileWidth + 24), spacing: 10)],
                    spacing: 20
                ) {
                    ForEach(model.filteredApps) { app in
                        AppTileView(app: app)
                    }
                }
                .padding(.horizontal, 64)
                .padding(.bottom, 64)
                .padding(.top, 8)
            }
        }
    }

    private func focusSearch() {
        // Slight delay so the panel has become key before we grab focus.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
            searchFocused = true
        }
    }
}
