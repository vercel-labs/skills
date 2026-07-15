#!/bin/bash
# Builds MiniLaunch and packages it as a double-clickable macOS app bundle.
# Run from anywhere:  ./scripts/package-app.sh
# Result:             dist/MiniLaunch.app  (drag it into /Applications)

set -euo pipefail
cd "$(dirname "$0")/.."

APP_NAME="MiniLaunch"
BINARY=".build/release/$APP_NAME"
APP_BUNDLE="dist/$APP_NAME.app"

echo "==> Building release binary (first time takes a minute)…"
swift build -c release

echo "==> Assembling $APP_BUNDLE…"
rm -rf "$APP_BUNDLE"
mkdir -p "$APP_BUNDLE/Contents/MacOS"
cp "$BINARY" "$APP_BUNDLE/Contents/MacOS/$APP_NAME"

cat > "$APP_BUNDLE/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleName</key>
	<string>MiniLaunch</string>
	<key>CFBundleDisplayName</key>
	<string>MiniLaunch</string>
	<key>CFBundleIdentifier</key>
	<string>local.minilaunch</string>
	<key>CFBundleExecutable</key>
	<string>MiniLaunch</string>
	<key>CFBundlePackageType</key>
	<string>APPL</string>
	<key>CFBundleShortVersionString</key>
	<string>0.1.0</string>
	<key>CFBundleVersion</key>
	<string>1</string>
	<key>LSMinimumSystemVersion</key>
	<string>13.0</string>
	<key>LSUIElement</key>
	<true/>
	<key>NSHighResolutionCapable</key>
	<true/>
</dict>
</plist>
PLIST

printf 'APPL????' > "$APP_BUNDLE/Contents/PkgInfo"

# Ad-hoc signature: required for locally built apps on Apple Silicon.
echo "==> Signing (ad-hoc, local use)…"
codesign --force --deep --sign - "$APP_BUNDLE"

echo ""
echo "✅ Done: $APP_BUNDLE"
echo ""
echo "Next steps:"
echo "  1. Move it to Applications:   cp -R \"$APP_BUNDLE\" /Applications/"
echo "  2. Open it (Finder double-click, or):  open /Applications/$APP_NAME.app"
echo "  3. Look for the grid icon in the menu bar, then press Option+Space."
echo ""
echo "Auto-start at login: System Settings → General → Login Items → '+' → pick MiniLaunch."
