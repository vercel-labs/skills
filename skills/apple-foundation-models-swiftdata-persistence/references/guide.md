# SwiftData Persistence — Reference Guide

## HealthSession model

From `HealthSession.swift`:

```swift
@Model
final class HealthSession {
    var id: UUID
    var startDate: Date
    var endDate: Date?
    var messages: [BuddyMessage]
    var sessionType: SessionType
    var summary: String?

    init(sessionType: SessionType = .general) {
        self.id = UUID()
        self.startDate = Date()
        self.sessionType = sessionType
        self.messages = []
    }

    func addMessage(_ message: BuddyMessage) {
        messages.append(message)
    }

    func endSession(withSummary summary: String? = nil) {
        self.endDate = Date()
        self.summary = summary
    }
}

@Model
final class BuddyMessage {
    var id: UUID
    var content: String
    var isFromUser: Bool
    var timestamp: Date
    var relatedMetricTypes: [MetricType]
}
```

## Codable enums for @Model

```swift
enum SessionType: String, Codable, CaseIterable {
    case general = "General Chat"
    case healthCheck = "Health Check-in"
    case goalSetting = "Goal Setting"
    case analysis = "Health Analysis"
    case coaching = "Coaching Session"

    var icon: String { ... }
}
```

## HealthInsight model

From `HealthInsight.swift`:

```swift
@Model
final class HealthInsight {
    var id: UUID
    var title: String
    var content: String
    var category: InsightCategory
    var priority: InsightPriority
    var relatedMetrics: [MetricType]
    var generatedAt: Date
    var isRead: Bool
    var actionItems: [String]
}

enum InsightCategory: String, Codable, CaseIterable {
    case trend, achievement, recommendation, warning, goal, comparison
    var icon: String { ... }
}

enum InsightPriority: String, Codable, CaseIterable {
    case low, medium, high, urgent
    var color: String { ... }
}
```

## Saving messages to active session

From `HealthChatViewModel.swift`:

```swift
func saveMessageToSession(_ content: String, isFromUser: Bool) async {
    guard let modelContext = modelContext else { return }

    let descriptor = FetchDescriptor<HealthSession>(
        sortBy: [SortDescriptor<HealthSession>(\.startDate, order: .reverse)]
    )

    let sessions = try modelContext.fetch(descriptor)
    let activeSession: HealthSession

    if let existingSession = sessions.first,
       existingSession.startDate.timeIntervalSinceNow > -sessionTimeout {
        activeSession = existingSession
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
func generateHealthInsight(from response: String) async {
    guard let modelContext = modelContext else { return }

    let insight = HealthInsight(
        title: "AI Health Tip",
        content: response,
        category: .recommendation,
        priority: .medium,
        relatedMetrics: []
    )

    modelContext.insert(insight)
    try modelContext.save()
}
```

## Repo files

| File | Purpose |
|------|---------|
| `Foundation Lab/Health/Models/HealthSession.swift` | Session + message models |
| `Foundation Lab/Health/Models/HealthInsight.swift` | Insight model + enums |
| `Foundation Lab/Health/Models/HealthMetric.swift` | MetricType enum |
| `Foundation Lab/Health/ViewModels/HealthChatViewModel.swift` | Persistence logic |
