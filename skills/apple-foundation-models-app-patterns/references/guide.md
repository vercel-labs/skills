# App Patterns — Reference Guide

## ViewModel pattern

Every view model follows this template:

```swift
@MainActor
@Observable
final class SomeViewModel {
    // Published state
    var isLoading: Bool = false
    var errorMessage: String?
    var showError: Bool = false

    // Private session
    private(set) var session: LanguageModelSession

    // Streaming task
    private var streamingTask: Task<Void, Error>?

    init() {
        session = LanguageModelSession(...)
    }

    func sendMessage(_ content: String) async { ... }

    func clearChat() {
        streamingTask?.cancel()
        streamingTask = nil
        session = LanguageModelSession(...)
    }

    func tearDown() {
        streamingTask?.cancel()
        streamingTask = nil
    }
}
```

## Navigation architecture

```
FoundationLabApp.swift
  └── AdaptiveNavigationView
        ├── SidebarView (iPad/Mac)
        │     └── TabSelection enum
        └── ContentView
              ├── ChatView (tab)
              ├── ToolsView (tab)
              ├── ExamplesView (tab)
              └── SettingsView (tab)
```

Key types:
- `TabSelection` enum — navigation destinations
- `NavigationCoordinator.shared` — cross-tab sync
- `AdaptiveNavigationView` — switches between TabView (iPhone) and NavigationSplitView (iPad/Mac)

## Service layer pattern

### ToolExecutor (reusable)

```swift
@MainActor
@Observable
final class ToolExecutor {
    var isRunning = false
    var result: String = ""
    var errorMessage: String?

    func execute<T: Tool>(tool: T, prompt: String, ...) async { ... }
}
```

### LanguageService (singleton)

```swift
@MainActor
@Observable
final class LanguageService {
    private(set) var supportedLanguages: [Locale.Language] = []
    // Auto-loads on init
}
```

### HealthDataManager (shared singleton)

```swift
class HealthDataManager {
    static let shared = HealthDataManager()
}
```

## Error display pattern

```swift
// In ViewModel
var errorMessage: String?
var showError: Bool = false

// Set on error
errorMessage = FoundationModelsErrorHandler.handleError(error)
showError = true

// Dismiss
func dismissError() {
    showError = false
    errorMessage = nil
}
```

## ExampleViewBase

Consistent layout for example views:

```swift
struct MyExampleView: View {
    var body: some View {
        ExampleViewBase(title: "My Example", description: "...") {
            // Content
        }
    }
}
```

## SwiftLint configuration

```yaml
line_length: 140/200
type_body_length: 200/300
file_length: 600/800
identifier_name: min 2/1, max 40/50
type_name: max 50/60
function_body_length: 60/100
nesting: type_level 3/5
```

## Repo files

| File | Purpose |
|------|---------|
| `Foundation Lab/FoundationLabApp.swift` | App entry point |
| `Foundation Lab/Models/NavigationCoordinator.swift` | Navigation sync |
| `Foundation Lab/Models/TabSelection.swift` | Tab destinations |
| `Foundation Lab/Views/AdaptiveNavigationView.swift` | Adaptive navigation |
| `Foundation Lab/Views/Components/ExampleViewBase.swift` | Example view template |
| `Foundation Lab/Services/ToolExecutor.swift` | Reusable tool executor |
| `.swiftlint.yml` | SwiftLint config |
