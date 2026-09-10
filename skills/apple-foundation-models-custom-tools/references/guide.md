# Custom Tools — Reference Guide

## Basic Tool protocol implementation

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
```

## Real-world tool examples

### Weather Tool
`Foundation Lab/Views/Tools/WeatherTool.swift` — OpenMeteo API, no API key required.

### Contacts Tool
`Foundation Lab/Views/Tools/ContactsTool.swift` — System contacts search via Contacts framework.

### Calendar Tool
`Foundation Lab/Views/Tools/CalendarTool.swift` — Event creation with EventKit.

### Health Data Tool
`Foundation Lab/Health/Tools/HealthDataTool.swift` — HealthKit queries.

### Music Tool
`Foundation Lab/Views/Tools/MusicTool.swift` — Apple Music catalog search.

## Using tools in a session

From `ToolExecutor.swift`:

```swift
func execute<T: Tool>(tool: T, prompt: String, ...) async {
    let session = LanguageModelSession(tools: [tool])
    let response = try await session.respond(to: Prompt(prompt))
    return response.content
}
```

## Multi-tool session

From `HealthChatViewModel.swift`:

```swift
private let tools: [any Tool] = [
    HealthDataTool(),
    HealthAnalysisTool()
]

let session = LanguageModelSession(
    tools: tools,
    instructions: Instructions(Self.baseInstructions)
)
```

## Handling tool errors

From `FoundationModelsError.swift`:

```swift
static func handleToolCallError(_ error: LanguageModelSession.ToolCallError) -> String {
    return "Tool '\(error.tool.name)' failed: \(error.underlyingError.localizedDescription)"
}
```

## Repo files

| File | Purpose |
|------|---------|
| `Foundation Lab/Views/Tools/WeatherTool.swift` | Weather API tool |
| `Foundation Lab/Views/Tools/Search1WebSearchTool.swift` | Web search tool |
| `Foundation Lab/Views/Tools/ContactsTool.swift` | Contacts tool |
| `Foundation Lab/Views/Tools/CalendarTool.swift` | Calendar tool |
| `Foundation Lab/Views/Tools/RemindersTool.swift` | Reminders tool |
| `Foundation Lab/Views/Tools/LocationTool.swift` | Location tool |
| `Foundation Lab/Views/Tools/MusicTool.swift` | Music tool |
| `Foundation Lab/Views/Tools/WebMetadataTool.swift` | URL metadata tool |
| `Foundation Lab/Health/Tools/HealthDataTool.swift` | HealthKit tool |
| `Foundation Lab/Health/Models/AI/HealthAnalysisTool.swift` | Health analysis tool |
| `Foundation Lab/Services/ToolExecutor.swift` | Reusable tool execution helper |
| `Foundation Lab/Playgrounds/08_BasicToolUse/` | 9 playground examples |
