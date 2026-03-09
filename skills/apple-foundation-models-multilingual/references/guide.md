# Multilingual — Reference Guide

## LanguageService

From `LanguageService.swift`:

```swift
@MainActor
@Observable
final class LanguageService {
    private(set) var supportedLanguages: [Locale.Language] = []
    private(set) var isLoading = false

    func loadSupportedLanguages() async {
        isLoading = true
        let model = SystemLanguageModel.default
        supportedLanguages = Array(model.supportedLanguages)
        isLoading = false
    }

    func getDisplayName(for language: Locale.Language) -> String {
        let code = language.languageCode?.identifier ?? ""
        let region = language.region?.identifier ?? ""
        let languageName = Locale.current.localizedString(forLanguageCode: code) ?? code
        if !region.isEmpty {
            return "\(languageName) (\(code)-\(region))"
        } else {
            return languageName
        }
    }

    func getCurrentUserLanguage() -> String {
        return getCurrentUserLanguageDisplayName()
    }

    func getSupportedLanguageNames() -> [String] {
        return supportedLanguages.map { getDisplayName(for: $0) }.sorted()
    }
}
```

## Using language-specific instructions

For a session that responds in a specific language:

```swift
let session = LanguageModelSession(
    instructions: Instructions("""
        You are a helpful assistant.
        Always respond in Japanese. Do not switch languages.
    """)
)
```

## Production language example

The repo includes a production-quality multilingual example:

- `Foundation Lab/Views/Languages/ProductionLanguageExampleView.swift` — Nutrition analysis in multiple languages
- `Foundation Lab/Views/Languages/LanguagesView.swift` — Language selection UI

## Playground examples

`Foundation Lab/Playgrounds/13_Languages/` contains 7 playground examples covering:
- Language detection
- Multi-language sessions
- Code-switching prevention
- Locale-aware generation

## Repo files

| File | Purpose |
|------|---------|
| `Foundation Lab/Services/LanguageService.swift` | Language detection and display |
| `Foundation Lab/Views/Languages/LanguagesView.swift` | Language selection UI |
| `Foundation Lab/Views/Languages/ProductionLanguageExampleView.swift` | Production multilingual example |
| `Foundation Lab/Playgrounds/13_Languages/` | 7 language playground examples |
| `Localizable.xcstrings` | App translations (10 languages) |
