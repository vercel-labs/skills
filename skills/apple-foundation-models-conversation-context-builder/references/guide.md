# Conversation Context Builder — Reference Guide

## Full implementation

From `ConversationContextBuilder.swift`:

```swift
enum ConversationContextBuilder {
    static func conversationText(
        from transcript: Transcript,
        userLabel: String,
        assistantLabel: String
    ) -> String {
        transcript.compactMap { entry in
            switch entry {
            case .prompt:
                guard let text = entry.textContent() else { return nil }
                return "\(userLabel) \(text)"
            case .response:
                guard let text = entry.textContent() else { return nil }
                return "\(assistantLabel) \(text)"
            default:
                return nil
            }
        }.joined(separator: "\n\n")
    }

    static func contextInstructions(
        baseInstructions: String,
        summary: String,
        keyTopics: [String],
        userPreferences: [String],
        continuationNote: String? = nil
    ) -> String {
        var contextInstructions = """
        \(baseInstructions)

        You are continuing a conversation with a user. Here's a summary of your previous conversation:

        CONVERSATION SUMMARY:
        \(summary)

        KEY TOPICS DISCUSSED:
        \(keyTopics.bulletList())

        USER PREFERENCES/REQUESTS:
        \(userPreferences.bulletList())
        """

        if let continuationNote {
            contextInstructions += "\n\n\(continuationNote)"
        }

        return contextInstructions
    }
}
```

## Usage in ChatViewModel

From `ChatViewModel.swift:490-543`:

```swift
// Step 1: Extract conversation text
func createConversationText() -> String {
    ConversationContextBuilder.conversationText(
        from: session.transcript,
        userLabel: "User:",
        assistantLabel: "Assistant:"
    )
}

// Step 2: Summarize with a dedicated session
func generateConversationSummary() async throws -> ConversationSummary {
    let summarySession = LanguageModelSession(
        model: languageModel,
        instructions: Instructions("You are an expert at summarizing conversations...")
    )
    let conversationText = createConversationText()
    let summaryResponse = try await summarySession.respond(
        to: Prompt(summaryPrompt),
        generating: ConversationSummary.self
    )
    return summaryResponse.content
}

// Step 3: Build new session with context
func createNewSessionWithContext(summary: ConversationSummary) {
    let contextInstructions = ConversationContextBuilder.contextInstructions(
        baseInstructions: instructions,
        summary: summary.summary,
        keyTopics: summary.keyTopics,
        userPreferences: summary.userPreferences,
        continuationNote: "Continue the conversation naturally..."
    )
    session = LanguageModelSession(
        model: languageModel,
        instructions: Instructions(contextInstructions)
    )
    sessionCount += 1
    currentTokenCount = 0
}
```

## Usage in HealthChatViewModel

```swift
// Health-specific labels
func createConversationText() -> String {
    ConversationContextBuilder.conversationText(
        from: session.transcript,
        userLabel: String(localized: "User:"),
        assistantLabel: String(localized: "Health AI:")
    )
}
```

## Repo files

| File | Purpose |
|------|---------|
| `Foundation Lab/Services/ConversationContextBuilder.swift` | Builder utility |
| `Foundation Lab/ViewModels/ChatViewModel.swift` | Chat usage |
| `Foundation Lab/Health/ViewModels/HealthChatViewModel.swift` | Health usage |
| `Foundation Lab/Models/DataModels.swift` | `ConversationSummary` @Generable struct |
