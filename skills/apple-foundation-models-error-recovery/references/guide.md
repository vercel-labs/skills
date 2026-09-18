# Error Recovery — Reference Guide

## FoundationModelsErrorHandler

From `FoundationModelsError.swift`:

```swift
struct FoundationModelsErrorHandler: Sendable {
    static func handleGenerationError(_ error: LanguageModelSession.GenerationError) -> String {
        switch error {
        case .exceededContextWindowSize(let context):
            return "Context window exceeded: \(context.debugDescription)"
        case .assetsUnavailable(let context):
            return "Model assets unavailable: \(context.debugDescription)"
        case .guardrailViolation(let context):
            return "Content policy violation: \(context.debugDescription)"
        case .decodingFailure(let context):
            return "Failed to decode response: \(context.debugDescription)"
        case .unsupportedGuide(let context):
            return "Unsupported generation guide: \(context.debugDescription)"
        case .unsupportedLanguageOrLocale(let context):
            return "Unsupported language/locale: \(context.debugDescription)"
        case .rateLimited(let context):
            return "Rate limited: \(context.debugDescription)"
        case .concurrentRequests(let context):
            return "Too many concurrent requests: \(context.debugDescription)"
        case .refusal(_, let context):
            return "Model refused to respond: \(context.debugDescription)"
        @unknown default:
            return "Unknown generation error"
        }
    }

    static func handleToolCallError(_ error: LanguageModelSession.ToolCallError) -> String {
        return "Tool '\(error.tool.name)' failed: \(error.underlyingError.localizedDescription)"
    }

    static func handleError(_ error: Error) -> String {
        if let generationError = error as? LanguageModelSession.GenerationError {
            return handleGenerationError(generationError)
        } else if let toolCallError = error as? LanguageModelSession.ToolCallError {
            return handleToolCallError(toolCallError)
        } else if let customError = error as? FoundationModelsError {
            return customError.localizedDescription
        } else {
            return "Unexpected error: \(error.localizedDescription)"
        }
    }
}
```

## Custom error enum

```swift
nonisolated enum FoundationModelsError: LocalizedError, Sendable {
    case sessionCreationFailed
    case responseGenerationFailed(String)
    case toolCallFailed(String)
    case streamingFailed(String)
    case modelUnavailable(String)
}
```

## Context overflow recovery

From `ChatViewModel.swift`:

```swift
// Catch specifically
} catch LanguageModelSession.GenerationError.exceededContextWindowSize {
    await handleContextWindowExceeded(userMessage: content)
} catch {
    errorMessage = FoundationModelsErrorHandler.handleError(error)
    showError = true
}
```

Recovery flow:
1. Generate `ConversationSummary` from current transcript
2. Create new session with summary baked into instructions
3. Retry the failed user message on the new session

## Health module fallback

From `HealthChatViewModel.swift` — if summarization itself fails:

```swift
} catch {
    isSummarizing = false
    session = LanguageModelSession(
        tools: tools,
        instructions: Instructions(Self.baseInstructions)
    )
    currentTokenCount = 0
    let restartMessage = "I need to start a fresh conversation. Please repeat your question."
    await saveMessageToSession(restartMessage, isFromUser: false)
}
```

## CancellationError handling

Always catch `CancellationError` before general errors:

```swift
do {
    try await task.value
} catch is CancellationError {
    return  // User-initiated, not an error
}
```

## Repo files

| File | Purpose |
|------|---------|
| `Foundation Lab/Models/FoundationModelsError.swift` | Error types + handler |
| `Foundation Lab/ViewModels/ChatViewModel.swift` | Context overflow recovery |
| `Foundation Lab/Health/ViewModels/HealthChatViewModel.swift` | Health error recovery with fallback |
| `Foundation Lab/Views/Examples/DynamicSchemas/SchemaErrorHandlingView.swift` | Schema-specific errors |
