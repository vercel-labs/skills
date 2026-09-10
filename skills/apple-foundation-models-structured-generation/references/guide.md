# Structured Generation — Reference Guide

## Basic @Generable struct

From `DataModels.swift`:

```swift
@Generable
struct ConversationSummary {
    @Guide(
        description: "A comprehensive summary of the entire conversation"
    )
    let summary: String

    @Guide(description: "The main topics or themes discussed")
    let keyTopics: [String]

    @Guide(description: "Any specific requests or preferences the user mentioned")
    let userPreferences: [String]
}
```

## Using structured generation

From `ChatViewModel.swift:516`:

```swift
let summarySession = LanguageModelSession(
    model: languageModel,
    instructions: Instructions("You are an expert at summarizing conversations.")
)

let summaryResponse = try await summarySession.respond(
    to: Prompt(summaryPrompt),
    generating: ConversationSummary.self
)

let summary = summaryResponse.content // ConversationSummary instance
```

## Health-specific @Generable

From `Health/Models/AI/ConversationSummary.swift`:

```swift
@Generable
struct HealthConversationSummary {
    @Guide(description: "Summary preserving health metrics, goals, and advice")
    let summary: String

    @Guide(description: "Key health topics discussed")
    let keyTopics: [String]

    @Guide(description: "User's health preferences and concerns")
    let userPreferences: [String]
}
```

## Nested and complex types

The dynamic schemas module demonstrates nested `@Generable` types:

- `FormBuilderSchemaView.swift` — Multi-step form generation
- `InvoiceSchemas.swift` — Complex invoice parsing with nested line items
- `GenerablePatternView.swift` — Patterns for generable types

## Repo files

| File | Purpose |
|------|---------|
| `Foundation Lab/Models/DataModels.swift` | Core `@Generable` models |
| `Foundation Lab/Health/Models/AI/` | Health-specific generable models |
| `Foundation Lab/Views/Examples/StructuredDataView.swift` | Structured generation example UI |
| `Foundation Lab/Views/Examples/DynamicSchemas/GenerablePatternView.swift` | @Generable pattern examples |
| `Foundation Lab/Playgrounds/` | Various playground examples |
