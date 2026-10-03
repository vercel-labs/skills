# Token Budget Management — Reference Guide

## Estimated token counting (fallback)

From `Transcript+TokenCounting.swift`:

```swift
/// ~4.5 characters per token heuristic
func estimateTokensAdvanced(_ text: String) -> Int {
    guard !text.isEmpty else { return 0 }
    return max(1, Int(ceil(Double(text.count) / 4.5)))
}

/// For structured JSON content
func estimateTokensForStructuredContent(_ content: GeneratedContent) -> Int {
    let count = content.jsonString.count
    return max(1, Int(ceil(Double(count) / 4.5)))
}
```

Per-entry estimation handles all entry types:

```swift
extension Transcript.Entry {
    var estimatedTokenCount: Int {
        switch self {
        case .instructions(let instructions):
            return instructions.segments.reduce(0) { $0 + $1.estimatedTokenCount }
        case .prompt(let prompt):
            return prompt.segments.reduce(0) { $0 + $1.estimatedTokenCount }
        case .response(let response):
            return response.segments.reduce(0) { $0 + $1.estimatedTokenCount }
        case .toolCalls(let toolCalls):
            return toolCalls.reduce(0) { total, call in
                total + estimateTokensAdvanced(call.toolName) +
                estimateTokensForStructuredContent(call.arguments) + 5
            }
        case .toolOutput(let output):
            return output.segments.reduce(0) { $0 + $1.estimatedTokenCount } + 3
        @unknown default:
            return 0
        }
    }
}
```

## Real token counting (iOS 26.4+)

```swift
@available(iOS 26.4, macOS 26.4, visionOS 26.4, *)
extension Transcript {
    func realTokenCount(using model: SystemLanguageModel = .default) async throws -> Int {
        try await model.tokenUsage(for: Array(self)).tokenCount
    }
}
```

## Unified counting (best available)

```swift
extension Transcript {
    func tokenCount(using model: SystemLanguageModel = .default) async -> Int {
        #if compiler(>=6.3)
        if #available(iOS 26.4, macOS 26.4, visionOS 26.4, *) {
            if let real = try? await realTokenCount(using: model) {
                return real
            }
        }
        #endif
        return estimatedTokenCount
    }
}
```

## Safety buffers

```swift
func safeTokenCount(using model: SystemLanguageModel = .default) async -> Int {
    // Real: 5% buffer
    // Estimated: 25% buffer + 100 overhead
    #if compiler(>=6.3)
    if #available(iOS 26.4, macOS 26.4, visionOS 26.4, *) {
        if let realTokens = try? await realTokenCount(using: model) {
            let buffer = Int(Double(realTokens) * 0.05)
            return realTokens + buffer
        }
    }
    #endif
    let baseTokens = estimatedTokenCount
    let buffer = Int(Double(baseTokens) * 0.25)
    return baseTokens + buffer + 100
}
```

## Binary search token budget window (iOS 26.4+)

```swift
@available(iOS 26.4, macOS 26.4, visionOS 26.4, *)
func realTokenBudgetWindow(
    instructions: Transcript.Entry?,
    conversation: [Transcript.Entry],
    budget: Int,
    model: SystemLanguageModel
) async -> [Transcript.Entry]? {
    let base: [Transcript.Entry] = instructions.map { [$0] } ?? []

    guard let baseTokens = base.isEmpty
        ? 0 : try? await model.tokenUsage(for: base).tokenCount
    else { return nil }

    if baseTokens > budget { return base }

    var low = 0
    var high = conversation.count

    while low < high {
        let mid = (low + high + 1) / 2
        let recentEntries = Array(conversation.suffix(mid))
        let candidate = base + recentEntries

        guard let tokens = try? await model.tokenUsage(for: candidate).tokenCount
        else { return nil }

        if tokens <= budget { low = mid }
        else { high = mid - 1 }
    }

    return base + Array(conversation.suffix(low))
}
```

## Limit checking

```swift
func isApproachingLimit(
    threshold: Double = 0.70,
    maxTokens: Int = 4096,
    using model: SystemLanguageModel = .default
) async -> Bool {
    let currentTokens = await safeTokenCount(using: model)
    return currentTokens > Int(Double(maxTokens) * threshold)
}
```

## Repo files

| File | Purpose |
|------|---------|
| `Foundation Lab/Extensions/Transcript+TokenCounting.swift` | All token counting + windowing logic |
| `Foundation Lab/Models/AppConfiguration.swift` | Context size constants |
| `Foundation Lab/ViewModels/ChatViewModel.swift` | Token usage in chat |
| `Foundation Lab/Views/Components/TokenUsageBar.swift` | Token usage UI component |
