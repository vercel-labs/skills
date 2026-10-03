# System Tools — Reference Guide

## Available system tools

| Tool | File | API | Auth |
|------|------|-----|------|
| Weather | `WeatherTool.swift` | OpenMeteo | None |
| Web Search | `Search1WebSearchTool.swift` | Search1API | None |
| Contacts | `ContactsTool.swift` | Contacts framework | Runtime permission |
| Calendar | `CalendarTool.swift` | EventKit | Runtime permission |
| Reminders | `RemindersTool.swift` | EventKit | Runtime permission |
| Location | `LocationTool.swift` | CoreLocation | Runtime permission |
| Music | `MusicTool.swift` | MusicKit | Runtime permission |
| Web Metadata | `WebMetadataTool.swift` | LinkPresentation | None |

All tool files are in `Foundation Lab/Views/Tools/`.

## ToolExecutor pattern

From `ToolExecutor.swift`:

```swift
@MainActor
@Observable
final class ToolExecutor {
    var isRunning = false
    var result: String = ""
    var errorMessage: String?
    var successMessage: String?

    func execute<T: Tool>(
        tool: T,
        prompt: String,
        successMessage: String? = nil,
        clearForm: (@MainActor () -> Void)? = nil
    ) async {
        // Creates LanguageModelSession(tools: [tool])
        // Calls session.respond(to: Prompt(prompt))
        // Manages isRunning, result, errorMessage state
    }
}
```

## Using ToolExecutor with PromptBuilder

```swift
func executeWithPromptBuilder<T: Tool>(
    tool: T,
    @PromptBuilder promptBuilder: () -> Prompt
) async {
    let session = LanguageModelSession(tools: [tool])
    let response = try await session.respond(to: promptBuilder())
    return response.content
}
```

## Using ToolExecutor with custom session

```swift
func executeWithCustomSession(
    sessionBuilder: () -> LanguageModelSession,
    prompt: String,
    ...
) async {
    let session = sessionBuilder()
    let response = try await session.respond(to: Prompt(prompt))
    return response.content
}
```

## Tool views

Each tool has a corresponding view in `Foundation Lab/Views/Tools/`:
- `ToolsView.swift` — Main tool listing and navigation
- `HealthToolView.swift` — Health-specific tool view

## Repo files

| File | Purpose |
|------|---------|
| `Foundation Lab/Services/ToolExecutor.swift` | Reusable tool execution with state management |
| `Foundation Lab/Views/Tools/ToolsView.swift` | Tool listing UI |
| `Foundation Lab/Views/Tools/*.swift` | Individual tool implementations |
