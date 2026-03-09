# Feedback & Sentiment API — Reference Guide

## ViewModel feedback state

From `ChatViewModel.swift`:

```swift
// State tracking
private(set) var feedbackState: [Transcript.Entry.ID: LanguageModelFeedback.Sentiment] = [:]

// Submit feedback
@MainActor
func submitFeedback(for entryID: Transcript.Entry.ID, sentiment: LanguageModelFeedback.Sentiment) {
    feedbackState[entryID] = sentiment
    let feedbackData = session.logFeedbackAttachment(sentiment: sentiment)
    _ = feedbackData
}

// Query feedback
@MainActor
func getFeedback(for entryID: Transcript.Entry.ID) -> LanguageModelFeedback.Sentiment? {
    return feedbackState[entryID]
}
```

Feedback state is cleared in `clearChat()`:

```swift
func clearChat() {
    feedbackState.removeAll()
    // ... reset other state
}
```

## FeedbackView UI

From `FeedbackView.swift`:

```swift
struct FeedbackView: View {
    let viewModel: ChatViewModel
    @Binding var isPresented: Bool

    // Filter to only assistant responses
    private var assistantEntries: [Transcript.Entry] {
        viewModel.session.transcript.filter { entry in
            if case .response = entry { return true }
            return false
        }
    }
}
```

## FeedbackRowView

```swift
struct FeedbackRowView: View {
    let entry: Transcript.Entry
    let viewModel: ChatViewModel

    // Extract text from response segments
    private var responseText: String {
        guard case .response(let response) = entry else { return "" }
        return response.segments.compactMap { segment in
            if case .text(let textSegment) = segment {
                return textSegment.content
            }
            return nil
        }.joined(separator: " ")
    }

    private var existingFeedback: LanguageModelFeedback.Sentiment? {
        viewModel.getFeedback(for: entry.id)
    }

    // Thumbs up/down buttons, disabled after submission
    Button(action: {
        viewModel.submitFeedback(for: entry.id, sentiment: .positive)
    }) { ... }
    .disabled(existingFeedback != nil)
}
```

## Repo files

| File | Purpose |
|------|---------|
| `Foundation Lab/Views/Components/FeedbackView.swift` | Feedback UI (full + row) |
| `Foundation Lab/ViewModels/ChatViewModel.swift` | Feedback state + API calls |
