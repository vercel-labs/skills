# Siri Shortcuts Integration — Reference Guide

## AppShortcutsProvider

From `FoundationLabAppShortcuts.swift`:

```swift
nonisolated struct FoundationLabAppShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: OpenChatIntent(),
            phrases: [
                "Open \(.applicationName) chat",
                "Start chatting in \(.applicationName)",
                "Open chat in \(.applicationName)"
            ],
            shortTitle: "Open Chat",
            systemImageName: "message.fill"
        )
        AppShortcut(
            intent: OpenExampleIntent(),
            phrases: [
                "Open \(\.$example) in \(.applicationName)",
                "Show \(\.$example) in \(.applicationName)"
            ],
            shortTitle: "Open Example",
            systemImageName: "sparkles"
        )
        // ... more shortcuts for tools, schemas, languages
    }
}
```

## AppIntent with parameter

From `OpenExampleIntent.swift`:

```swift
struct OpenExampleIntent: AppIntent {
    static let title: LocalizedStringResource = "Open Example"
    static let description = IntentDescription("Opens a specific Foundation Lab example")
    static let supportedModes: IntentModes = .foreground

    @Parameter(title: "Example")
    var example: ExampleDestination

    static var parameterSummary: some ParameterSummary {
        Summary("Open \(\.$example)")
    }

    @MainActor
    func perform() async throws -> some IntentResult {
        NavigationCoordinator.shared.navigateToExample(example.exampleType)
        return .result()
    }
}
```

## AppEnum destinations

From `AppIntentDestinations.swift`:

```swift
enum ExampleDestination: String, AppEnum, CaseIterable {
    case basicChat, journaling, creativeWriting, structuredData
    case streamingResponse, modelAvailability, generationGuides
    case generationOptions, health, rag

    static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "Example")

    static var caseDisplayRepresentations: [ExampleDestination: DisplayRepresentation] = [
        .basicChat: DisplayRepresentation(title: "One-shot"),
        .journaling: DisplayRepresentation(title: "Journaling"),
        // ...
    ]

    var exampleType: ExampleType {
        switch self {
        case .basicChat: return .basicChat
        // ...
        }
    }
}
```

Four destination enums:
- `ExampleDestination` — 10 cases (examples)
- `ToolDestination` — 9 cases (system tools)
- `SchemaDestination` — 11 cases (dynamic schema examples)
- `LanguageDestination` — 4 cases (language features)

## Repo files

| File | Purpose |
|------|---------|
| `Foundation Lab/AppIntents/FoundationLabAppShortcuts.swift` | Shortcut provider |
| `Foundation Lab/AppIntents/AppIntentDestinations.swift` | All 4 destination enums |
| `Foundation Lab/AppIntents/OpenChatIntent.swift` | Chat intent |
| `Foundation Lab/AppIntents/OpenExampleIntent.swift` | Example intent |
| `Foundation Lab/AppIntents/OpenToolIntent.swift` | Tool intent |
| `Foundation Lab/AppIntents/OpenSchemaIntent.swift` | Schema intent |
| `Foundation Lab/AppIntents/OpenLanguageIntent.swift` | Language intent |
| `Foundation Lab/Models/NavigationCoordinator.swift` | Navigation target |
