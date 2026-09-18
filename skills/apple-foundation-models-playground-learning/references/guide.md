# Playground Learning — Reference Guide

## Basic playground structure

```swift
import FoundationModels
import Playgrounds

#Playground {
    let session = LanguageModelSession()
    let response = try await session.respond(to: "What is Swift?")
    print("Response: \(response.content)")
}
```

## Prewarming example

From `Playgrounds/02_GettingStartedWithSessions/11_BasicPrewarming.swift`:

```swift
#Playground {
    let session = LanguageModelSession()
    session.prewarm()
    let response = try await session.respond(to: "What is the capital of France?")
    print("Response: \(response.content)")
}
```

## Prewarming with prompt prefix

From `Playgrounds/02_GettingStartedWithSessions/12_PrewarmingWithPromptPrefix.swift`:

```swift
#Playground {
    let session = LanguageModelSession()
    let commonPrefix = Prompt("You are a helpful writing assistant. The user is asking about:")
    session.prewarm(promptPrefix: commonPrefix)

    let fullPrompt = "You are a helpful writing assistant. The user is asking about: grammar rules"
    let response = try await session.respond(to: Prompt(fullPrompt))
    print("Response: \(response.content)")
}
```

## Tool defined at file scope + used in playground

From `Playgrounds/08_BasicToolUse/01_BasicToolProtocol.swift`:

```swift
struct BasicTool: Tool {
    let name = "basicTool"
    let description = "A simple example tool"

    @Generable
    struct Arguments {
        @Guide(description: "The input message to process")
        var message: String
    }

    func call(arguments: Arguments) async throws -> some PromptRepresentable {
        "Processed: \(arguments.message)"
    }
}

#Playground {
    let tool = BasicTool()
    let arguments = BasicTool.Arguments(message: "Hello, tool!")
    let result = try await tool.call(arguments: arguments)
    debugPrint("Tool result: \(result)")
}
```

## Transcript inspection

From `Playgrounds/08_BasicToolUse/06_MultiToolCoordinationDemo.swift`:

```swift
for (index, entry) in session.transcript.enumerated() {
    switch entry {
    case .instructions:
        print("\(index): Instructions")
    case .prompt(let prompt):
        let text = prompt.segments.compactMap { segment -> String? in
            if case .text(let t) = segment { return t.content }
            return nil
        }.joined(separator: " ")
        print("\(index): Prompt: \(text)")
    case .toolCalls(let calls):
        print("\(index): Tool calls: \(calls.map { $0.toolName })")
    case .toolOutput(let output):
        print("\(index): Tool output: \(output.toolName)")
    case .response(let response):
        let text = response.segments.compactMap { segment -> String? in
            if case .text(let t) = segment { return t.content }
            return nil
        }.joined(separator: " ")
        print("\(index): Response: \(text.prefix(100))...")
    @unknown default:
        print("\(index): Unknown")
    }
}
```

## Available playground chapters

| Chapter | Folder | Count | Topics |
|---------|--------|-------|--------|
| 2 | `02_GettingStartedWithSessions/` | 16 | Availability, single/multi-turn, instructions, streaming, prewarming, context window |
| 3 | `03_GenerationOptionsAndSamplingControl/` | 5 | Temperature, token limits, fitness, parameter combos, sampling strategies |
| 8 | `08_BasicToolUse/` | 9 | Tool protocol, search/calculator/weather/location tools, multi-tool, error handling |
| 13 | `13_SupportedLanguagesAndInternationalization/` | 7 | Language queries, display, multilingual gen, sessions, code-switching, production detection |

**Total: 37 runnable playground examples.**
