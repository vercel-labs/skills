# Session Patterns — Reference Guide

## Basic single-turn session

```swift
let session = LanguageModelSession()
let response = try await session.respond(to: Prompt("What is Swift?"))
print(response.content) // String
```

## Session with instructions

From `ChatViewModel.swift`:

```swift
let session = LanguageModelSession(
    model: languageModel,
    instructions: Instructions("""
        You are a helpful, friendly AI assistant. Engage in natural conversation
        and provide thoughtful, detailed responses.
    """)
)
```

## Session with model + tools

From `HealthChatViewModel.swift`:

```swift
let tools: [any Tool] = [HealthDataTool(), HealthAnalysisTool()]

let session = LanguageModelSession(
    tools: tools,
    instructions: Instructions(Self.baseInstructions)
)
```

## Updating instructions mid-conversation

From `ChatViewModel.swift:180`:

```swift
func updateInstructions(_ newInstructions: String) {
    instructions = newInstructions
    languageModel = createLanguageModel()
    session = LanguageModelSession(
        model: languageModel,
        instructions: Instructions(instructions)
    )
    currentTokenCount = 0
}
```

This creates a fresh session — all previous transcript is discarded.

## Accessing the transcript

```swift
// Iterate transcript entries
for entry in session.transcript {
    switch entry {
    case .instructions: ...
    case .prompt: ...
    case .response: ...
    default: ...
    }
}

// Token counting
let count = await session.transcript.tokenCount(using: languageModel)
```

## Session from existing transcript (sliding window)

From `ChatViewModel.swift:450`:

```swift
let windowedTranscript = Transcript(entries: finalEntries)
session = LanguageModelSession(model: model, transcript: windowedTranscript)
```

## Repo files

| File | Purpose |
|------|---------|
| `Foundation Lab/ViewModels/ChatViewModel.swift` | Multi-turn session management |
| `Foundation Lab/Health/ViewModels/HealthChatViewModel.swift` | Session with tools |
| `Foundation Lab/Services/ToolExecutor.swift` | Single-turn tool sessions |
| `Foundation Lab/ViewModels/RAGChatViewModel.swift` | Session with custom instructions |
| `Foundation Lab/Playgrounds/02_GettingStartedWithSessions/` | 16 playground examples |
