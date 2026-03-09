# Voice Assistant — Reference Guide

## Architecture

```
Voice/
├── VoiceView.swift                    # Main voice interface UI
├── VoiceViewModel.swift               # Voice-specific view model
├── Services/
│   ├── InferenceService.swift         # AI text processing protocol
│   ├── SpeechRecognizer.swift         # Speech recognition wrapper
│   ├── SpeechSynthesizer.swift        # Text-to-speech wrapper
│   └── PermissionManager.swift        # Microphone/speech permissions
├── State/
│   └── SpeechRecognitionStateMachine.swift  # Full workflow state machine
└── Views/
    └── PermissionRequestView.swift    # Permission request UI
```

## State machine states

From `SpeechRecognitionStateMachine.swift`:

```swift
enum State {
    case idle
    case requestingPermission
    case permissionGranted
    case permissionDenied
    case initializingRecognition
    case listening
    case processingSpeech(String)      // Contains recognized text
    case synthesizingResponse(String)  // Contains response text
    case completed
    case error(SpeechRecognitionStateMachineError)
}
```

## Voice mode in ChatViewModel

From `ChatViewModel.swift:212`:

```swift
func startVoiceMode() async {
    // Check permissions
    if !permissionManager.allPermissionsGranted {
        let granted = await permissionManager.requestAllPermissions()
        if !granted { return }
    }

    voiceState = .preparing
    session.prewarm()  // Reduce first-response latency

    let didStart = await initializeSpeechRecognizer()
    guard didStart else { return }

    voiceState = .listening(partialText: "")
    startSpeechObservation()
}
```

## Voice conversation loop

From `ChatViewModel.swift:267`:

```swift
func stopVoiceModeAndSend() async {
    guard case .listening(let text) = voiceState else { return }
    let trimmedText = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmedText.isEmpty else { cancelVoiceMode(); return }

    recognizer.stopRecognition()
    voiceState = .processing

    let response = try await session.respond(to: Prompt(trimmedText))
    voiceState = .speaking(response: response.content)

    try await speechSynthesizer.synthesizeAndSpeak(text: response.content)

    // Auto-return to listening for multi-turn
    restartListening()
}
```

## Speech observation

```swift
func observeSpeechState() async {
    guard let recognizer = speechRecognizer else { return }
    for await state in recognizer.stateValues {
        switch state {
        case .listening(let partialText):
            voiceState = .listening(partialText: partialText)
        case .completed(let finalText):
            voiceState = .listening(partialText: finalText)
        case .error(let speechError):
            handleVoiceError(speechError.localizedDescription)
        case .idle: break
        }
    }
}
```

## Cleanup

```swift
func tearDown() {
    streamingTask?.cancel()
    stopSpeechObservation()
    speechRecognizer?.stopRecognition()
    speechRecognizer = nil
}
```

## Repo files

| File | Purpose |
|------|---------|
| `Foundation Lab/Voice/State/SpeechRecognitionStateMachine.swift` | Full state machine |
| `Foundation Lab/Voice/VoiceViewModel.swift` | Voice view model |
| `Foundation Lab/Voice/VoiceView.swift` | Voice UI |
| `Foundation Lab/Voice/Services/SpeechRecognizer.swift` | Recognition wrapper |
| `Foundation Lab/Voice/Services/SpeechSynthesizer.swift` | Synthesis wrapper |
| `Foundation Lab/Voice/Services/PermissionManager.swift` | Permission handling |
| `Foundation Lab/Voice/Services/InferenceService.swift` | AI processing protocol |
| `Foundation Lab/ViewModels/ChatViewModel.swift` | Voice integration in chat |
