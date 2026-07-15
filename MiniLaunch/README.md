# MiniLaunch

A LaunchMe-inspired app launcher for macOS, built in Swift + SwiftUI.
Press **⌥ Space** (Option + Space) anywhere and a beautiful full-screen
launcher appears: dark glassy wallpaper, a grid of all your apps, and a
search bar. Type to filter, press Return (or click) to launch, Esc to close.

> **Working title.** "MiniLaunch" is a placeholder — rename it whenever
> inspiration strikes.

## Requirements

- A Mac running **macOS 13 Ventura or newer**
- **Xcode** (free, from the Mac App Store) — or just the Command Line Tools
- No Apple developer account needed. Building and running your own app is free.

## Run it (Option A — Xcode, recommended)

1. Open **Xcode**.
2. **File → Open…** and select the `MiniLaunch` **folder** (the one
   containing `Package.swift`). Xcode understands Swift Packages directly —
   there is no `.xcodeproj`, and that's normal.
3. Wait a few seconds for Xcode to index, then press **⌘R** (Run).
4. Nothing dramatic appears — that's correct! MiniLaunch is a menu-bar app.
   Look for the **grid icon in your menu bar** (top-right of the screen).
5. Press **⌥ Space**. Enjoy.

## Run it (Option B — Terminal)

```bash
cd MiniLaunch
swift run -c release
```

First build takes a minute; later runs are fast. Quit with the menu bar
icon → **Quit MiniLaunch** (or Ctrl-C in the terminal).

## Using it

| Action | How |
| --- | --- |
| Open / close the launcher | **⌥ Space** |
| Search | just start typing |
| Launch top search result | **Return** |
| Launch any app | click its tile |
| Close without launching | **Esc** or click the background |
| Settings | menu bar icon → **Settings…** |

### Settings

- **Icon style** — `Classic` (untouched icons), `Glass` (color icons on
  frosted tiles), `Dark` (dimmed, desaturated icons on dark tiles — the
  moody look from the screenshots).
- **Hide app titles** — minimal look.
- **Icon size** — 56–120 pt slider.
- **Wallpaper** — the built-in dark "glass domes" scene, or any image of
  your own (a dark scrim is added automatically so icons stay readable).

## Troubleshooting

- **I don't see anything after running.** Look at the menu bar (top-right)
  for the grid icon — MiniLaunch has no Dock icon by design. Then press ⌥ Space.
- **⌥ Space types a weird space character instead.** Another app may have
  grabbed the hotkey first (e.g. an input-method or another launcher).
  Quit that app for now — a custom hotkey picker is on the roadmap.
- **The grid is empty for a second.** The first scan of /Applications runs
  in the background; it fills in within a moment.
- **Some icons look soft in Dark style.** The dimmed rendition is generated
  at 2× resolution; if a particular app still looks soft, tell me which one.
- **Build errors.** Copy the exact error text from Xcode/terminal and paste
  it back into our chat — first-build errors are a normal part of the loop,
  and fixing them from the message is usually quick.

## Roadmap

- **M1 (this)** — launcher engine + the look: grid, search, ⌥ Space,
  wallpaper, icon styles, hide titles, icon size.
- **M2** — folders/categories, hide & rename apps, date/clock widget tiles,
  weather widget (Open-Meteo), sun-position wallpaper.
- **M3** — the notch bar: hover-to-expand panel, pinned apps, timer with
  ruler UI, custom notch backgrounds.
- **M4** — clipboard history, Spotlight file search, file/drive tiles,
  AirDrop + Pocket drop zones, calculator & emoji in search, music widget.

## How the code is organized (for learning)

| File | Role |
| --- | --- |
| `MiniLaunchApp.swift` | App entry: menu bar item + app delegate that owns the panel, hotkey, settings window |
| `LauncherPanel.swift` | The borderless full-screen overlay window (the "magic trick") |
| `HotkeyManager.swift` | Global ⌥ Space hotkey (Carbon API) |
| `AppScanner.swift` | Finds every `.app` on disk |
| `IconRenderer.swift` | Renders/caches icons per style (Core Image for the Dark look) |
| `LauncherModel.swift` | State: app list, search text, filtering, launching |
| `AppSettings.swift` | Preferences persisted to UserDefaults |
| `BackgroundView.swift` | Procedural dark-glass wallpaper / custom image |
| `LauncherView.swift` | Search bar + grid layout |
| `AppTileView.swift` | A single app tile (hover, click) |
| `SettingsView.swift` | The settings window UI |
