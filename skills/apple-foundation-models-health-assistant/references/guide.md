# Health Assistant — Reference Guide

## Architecture

```
Health/
├── Models/
│   ├── HealthMetric.swift           # MetricType enum + health metric model
│   ├── HealthInsight.swift          # SwiftData model for AI insights
│   ├── HealthSession.swift          # SwiftData model for coaching sessions
│   ├── HealthDataManager.swift      # Shared HealthKit data manager
│   └── AI/
│       ├── HealthDataTool.swift     # HealthKit query tool
│       ├── HealthAnalysisTool.swift # Health analysis tool
│       ├── HealthAI.swift           # AI helper types
│       ├── HealthAnalysis.swift     # Analysis models
│       ├── PersonalizedHealthPlan.swift # Health plan generation
│       └── ConversationSummary.swift    # HealthConversationSummary
├── ViewModels/
│   └── HealthChatViewModel.swift    # Health chat view model
└── Views/
    ├── HealthDashboardView.swift    # AI health dashboard
    ├── HealthChatView.swift         # Health chat UI
    └── Components/                  # Health UI components
```

## Session initialization

From `HealthChatViewModel.swift`:

```swift
private let tools: [any Tool] = [HealthDataTool(), HealthAnalysisTool()]

init(healthDataManager: HealthDataManager? = nil) {
    self.healthDataManager = healthDataManager ?? .shared
    self.session = LanguageModelSession(
        tools: tools,
        instructions: Instructions(Self.baseInstructions)
    )
}

static let baseInstructions = """
You are a friendly and knowledgeable health coach AI assistant.
Based on the user's health data, provide personalized, encouraging responses.
Be supportive and celebrate small wins. Use emojis occasionally.
"""
```

## Loading health data

```swift
func loadInitialHealthData() async {
    try await healthDataManager.fetchTodayHealthData()
    currentHealthMetrics = [
        .steps: healthDataManager.todaySteps,
        .heartRate: healthDataManager.currentHeartRate,
        .sleep: healthDataManager.lastNightSleep,
        .activeEnergy: healthDataManager.todayActiveEnergy,
        .distance: healthDataManager.todayDistance
    ]
}
```

## SwiftData persistence

Messages are saved to `HealthSession` via `ModelContext`:

```swift
func saveMessageToSession(_ content: String, isFromUser: Bool) async {
    let sessions = try modelContext.fetch(descriptor)
    let activeSession: HealthSession

    if let existing = sessions.first,
       existing.startDate.timeIntervalSinceNow > -sessionTimeout {
        activeSession = existing
    } else {
        activeSession = HealthSession(sessionType: .coaching)
        modelContext.insert(activeSession)
    }

    let message = BuddyMessage(content: content, isFromUser: isFromUser)
    activeSession.messages.append(message)
    try modelContext.save()
}
```

## Auto-insight generation

```swift
func shouldGenerateInsight(from response: String) -> Bool {
    let keywords = ["goal", "achieve", "progress", "improve", "recommend", "suggest", "tip", "advice"]
    return keywords.contains { response.lowercased().contains($0) }
}
```

## Context overflow handling

Uses `HealthConversationSummary` (health-specific version) and falls back to a fresh session if summarization fails.

## Repo files

| File | Purpose |
|------|---------|
| `Foundation Lab/Health/ViewModels/HealthChatViewModel.swift` | Main health chat VM |
| `Foundation Lab/Health/Models/HealthDataManager.swift` | HealthKit data manager |
| `Foundation Lab/Health/Models/AI/HealthDataTool.swift` | HealthKit tool |
| `Foundation Lab/Health/Models/AI/HealthAnalysisTool.swift` | Analysis tool |
| `Foundation Lab/Health/Views/HealthDashboardView.swift` | Dashboard UI |
| `Foundation Lab/Views/Examples/HealthExampleView.swift` | Health example |
