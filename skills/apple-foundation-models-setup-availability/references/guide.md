# Setup & Availability — Reference Guide

## Key imports

```swift
import FoundationModels
```

## Creating a language model

```swift
// Default model
let model = SystemLanguageModel.default

// With use case
let model = SystemLanguageModel(useCase: .general)

// With custom guardrails
let model = SystemLanguageModel(useCase: .general, guardrails: .permissiveContentTransformations)
```

## Querying context size

From `Foundation Lab/Models/AppConfiguration.swift`:

```swift
enum AppConfiguration {
    enum TokenManagement {
        static let defaultMaxTokens = 4096

        static func contextSize(for model: SystemLanguageModel = .default) async -> Int {
            #if compiler(>=6.3)
            if let size = try? await model.contextSize {
                return size
            }
            #endif
            return defaultMaxTokens
        }
    }
}
```

Always fall back to a safe default when the runtime context size is unavailable.

## Prewarming

Call `session.prewarm()` before the first generation to reduce latency:

```swift
// From ChatViewModel.swift — called during voice mode setup
session.prewarm()
```

## Supported languages

Query at runtime via `SystemLanguageModel.default.supportedLanguages`:

```swift
let model = SystemLanguageModel.default
let languages = Array(model.supportedLanguages)
```

See `Foundation Lab/Services/LanguageService.swift` for the full pattern.

## Repo files

| File | Purpose |
|------|---------|
| `Foundation Lab/Models/AppConfiguration.swift` | Context size + token constants |
| `Foundation Lab/Services/LanguageService.swift` | Language availability checks |
| `Foundation Lab/ViewModels/ChatViewModel.swift` | Model creation with guardrails |
