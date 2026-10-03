# UI Design System — Reference Guide

## Spacing & CornerRadius

From `Spacing.swift`:

```swift
enum Spacing {
    static let xSmall: CGFloat = 4
    static let small: CGFloat = 8
    static let medium: CGFloat = 12
    static let large: CGFloat = 16
    static let xLarge: CGFloat = 24
    static let xxLarge: CGFloat = 32
}

enum CornerRadius {
    static let small: CGFloat = 8
    static let medium: CGFloat = 12
    static let large: CGFloat = 16
    static let xLarge: CGFloat = 20
}
```

## ExampleViewBase

From `ExampleViewBase.swift`:

```swift
struct ExampleViewBase<Content: View>: View {
    let title: String
    let description: String
    let defaultPrompt: String
    @Binding var currentPrompt: String
    let isRunning: Bool
    let errorMessage: String?
    let codeExample: String?
    let onRun: () -> Void
    let onReset: () -> Void
    let content: Content
}
```

Provides: prompt editor, run/clear buttons, error display, optional `CodeDisclosure`.

## ToolViewBase

From `ToolViewBase.swift`:

```swift
struct ToolViewBase<Content: View>: View {
    let title: String
    let icon: String
    let description: String
    let isRunning: Bool
    let errorMessage: String?
    let content: Content
}
```

Provides: navigation title, subtitle, error banner, scrollable content.

## CodeViewer & CodeDisclosure

From `CodeViewer.swift`:

```swift
// Inline syntax-highlighted code with copy button
CodeViewer(code: "let x = 42", language: "swift")

// Collapsible code section
CodeDisclosure(code: "let x = 42")
```

Uses `HighlightSwift` with Xcode theme (light/dark adaptive).

## TokenUsageBar

From `TokenUsageBar.swift`:

```swift
TokenUsageBar(
    currentTokenCount: 1500,
    maxContextSize: 4096,
    tokenUsageFraction: 0.37
)
```

Color thresholds:
- Green: 0–50%
- Yellow: 50–75%
- Orange: 75–90%
- Red: 90%+

## PromptSuggestions

```swift
PromptSuggestions(suggestions: ["Tell a joke", "Write a poem"]) { selected in
    prompt = selected
}
```

## Button styles (LiquidGlasKit)

```swift
// Standard glass button
Button("Action") { }.buttonStyle(.glass)

// Prominent glass button
Button("Primary") { }.buttonStyle(.glassProminent)

// Material background
.background(.thinMaterial, in: .rect(cornerRadius: CornerRadius.small))
```

## All reusable components

| Component | File | Purpose |
|-----------|------|---------|
| `ExampleViewBase` | `Examples/Components/ExampleViewBase.swift` | Standard example layout |
| `ToolViewBase` | `Components/ToolViewBase.swift` | Standard tool layout |
| `CodeViewer` | `Examples/Components/CodeViewer.swift` | Syntax-highlighted code |
| `CodeDisclosure` | `Examples/Components/CodeViewer.swift` | Collapsible code |
| `ExampleExecutor` | `Examples/Components/ExampleExecutor.swift` | Execution helper |
| `PromptField` | `Examples/Components/PromptField.swift` | Prompt input |
| `Spacing` / `CornerRadius` | `Examples/Components/Spacing.swift` | Design constants |
| `TokenUsageBar` | `Components/TokenUsageBar.swift` | Token usage display |
| `FeedbackView` | `Components/FeedbackView.swift` | Response feedback |
| `MessageBubbleView` | `Components/MessageBubbleView.swift` | Chat bubbles |
| `ChatInputView` | `Components/ChatInputView.swift` | Chat input |
| `ResponseDisplayView` | `Components/ResponseDisplayView.swift` | Response rendering |
| `ResultDisplay` | `Components/ResultDisplay.swift` | Success/error result |
| `GenericCardView` | `Components/GenericCardView.swift` | Card layout |
| `ToolBanners` | `Components/ToolBanners.swift` | Tool status banners |
| `ToolInputs` | `Components/ToolInputs.swift` | Tool input fields |
| `PermissiveGuardrailsToggle` | `Components/PermissiveGuardrailsToggle.swift` | Guardrails toggle |
| `HealthColors` | `Health/Views/Components/HealthColors.swift` | Health color palette |
| `HealthEffects` | `Health/Views/Components/HealthEffects.swift` | Health visual effects |
