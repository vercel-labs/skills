# Streaming & Context Management — Reference Guide

## Basic streaming

From `ChatViewModel.swift:119`:

```swift
let responseStream = session.streamResponse(to: Prompt(content), options: generationOptions)

streamingTask?.cancel()
let task = Task { @MainActor in
    for try await _ in responseStream {
        // The streaming automatically updates the session transcript
    }
}
streamingTask = task
defer { streamingTask = nil }
do {
    try await task.value
} catch is CancellationError {
    return // User-initiated cancellation
}
```

## Token usage tracking

From `ChatViewModel.swift:318`:

```swift
func updateTokenCount() async {
    currentTokenCount = await session.transcript.tokenCount(using: languageModel)
}

var tokenUsageFraction: Double {
    guard maxContextSize > 0 else { return 0 }
    return min(1.0, Double(currentTokenCount) / Double(maxContextSize))
}
```

## Sliding window implementation

Configuration from `AppConfiguration.swift`:

```swift
static let windowThreshold = 0.75     // Start window at 75% usage
static let targetWindowSize = 2000    // Target tokens after windowing
```

From `ChatViewModel.swift:422`:

```swift
func shouldApplyWindow() async -> Bool {
    await session.transcript.isApproachingLimit(
        threshold: windowThreshold,
        maxTokens: maxContextSize,
        using: languageModel
    )
}

func applySlidingWindow() async {
    let windowEntries = await session.transcript.entriesWithinTokenBudget(
        targetWindowSize, using: model
    )

    // Preserve instructions entry
    var finalEntries = windowEntries
    if let instructions = session.transcript.first(where: {
        if case .instructions = $0 { return true }; return false
    }) {
        if !finalEntries.contains(where: { $0.id == instructions.id }) {
            finalEntries.insert(instructions, at: 0)
        }
    }

    let windowedTranscript = Transcript(entries: finalEntries)
    session = LanguageModelSession(model: model, transcript: windowedTranscript)
    sessionCount += 1
}
```

## Context overflow recovery via summarization

From `ChatViewModel.swift:464`:

```swift
func handleContextWindowExceeded(userMessage: String) async {
    isSummarizing = true
    let summary = try await generateConversationSummary()
    createNewSessionWithContext(summary: summary)
    isSummarizing = false
    try await respondWithNewSession(to: userMessage)
}
```

The `ConversationSummary` is a `@Generable` struct with `summary`, `keyTopics`, and `userPreferences` fields.

## Repo files

| File | Purpose |
|------|---------|
| `Foundation Lab/ViewModels/ChatViewModel.swift` | Full streaming + sliding window + summarization |
| `Foundation Lab/Health/ViewModels/HealthChatViewModel.swift` | Health-specific context rollover |
| `Foundation Lab/ViewModels/RAGChatViewModel.swift` | Streaming in RAG context |
| `Foundation Lab/Services/ConversationContextBuilder.swift` | Builds context instructions from summaries |
| `Foundation Lab/Extensions/Transcript+TokenCounting.swift` | Token counting + windowing extensions |
