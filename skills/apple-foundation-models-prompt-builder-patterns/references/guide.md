# Prompt Builder Patterns — Reference Guide

## Basic Prompt and Instructions

```swift
// Simple prompt
let response = try await session.respond(to: Prompt("What is Swift?"))

// Session with instructions
let session = LanguageModelSession(
    instructions: Instructions("You are a helpful assistant.")
)
```

## @PromptBuilder in ToolExecutor

From `ToolExecutor.swift`:

```swift
func executeWithPromptBuilder<T: Tool>(
    tool: T,
    successMessage: String? = nil,
    clearForm: (@MainActor () -> Void)? = nil,
    @PromptBuilder promptBuilder: () -> Prompt
) async {
    let session = LanguageModelSession(tools: [tool])
    let response = try await session.respond(to: promptBuilder())
    return response.content
}
```

## PromptRepresentable for tool returns

From `Playgrounds/08_BasicToolUse/01_BasicToolProtocol.swift`:

```swift
struct BasicTool: Tool {
    func call(arguments: Arguments) async throws -> some PromptRepresentable {
        "Processed: \(arguments.message)"  // String conforms to PromptRepresentable
    }
}
```

## ExampleExecutor

From `ExampleExecutor.swift` — reusable executor with prompt history:

### Basic execution

```swift
func executeBasic(
    prompt: String,
    instructions: String? = nil,
    successMessage: String? = nil,
    guardrails: SystemLanguageModel.Guardrails = .default
) async {
    let model = SystemLanguageModel(useCase: .general, guardrails: guardrails)
    let session = instructions != nil
        ? LanguageModelSession(model: model, instructions: Instructions(instructions!))
        : LanguageModelSession(model: model)

    let response = try await session.respond(to: Prompt(prompt))
    result = response.content
    lastTokenCount = await session.transcript.tokenCount(using: model)
}
```

### Structured execution

```swift
func executeStructured<T: Generable>(
    prompt: String,
    type: T.Type,
    instructions: String? = nil,
    formatter: @escaping (T) -> String
) async {
    let response = try await session.respond(to: Prompt(prompt), generating: type)
    result = formatter(response.content)
}
```

### Streaming execution

```swift
func executeStreaming(
    prompt: String,
    instructions: String? = nil,
    onPartialResult: @escaping (String) -> Void
) async {
    let stream = session.streamResponse(to: Prompt(prompt))
    for try await partialResponse in stream {
        result = partialResponse.content
        onPartialResult(partialResponse.content)
    }
}
```

### Prompt history

```swift
private func addToHistory(_ prompt: String) {
    promptHistory.removeAll { $0 == prompt }
    promptHistory.insert(prompt, at: 0)
    if promptHistory.count > 10 {
        promptHistory = Array(promptHistory.prefix(10))
    }
}
```

## Repo files

| File | Purpose |
|------|---------|
| `Foundation Lab/Services/ToolExecutor.swift` | @PromptBuilder execution |
| `Foundation Lab/Views/Examples/Components/ExampleExecutor.swift` | Basic/structured/streaming execution + history |
| `Foundation Lab/Views/Examples/Components/PromptField.swift` | Prompt input component |
| `Foundation Lab/Playgrounds/08_BasicToolUse/01_BasicToolProtocol.swift` | PromptRepresentable example |
