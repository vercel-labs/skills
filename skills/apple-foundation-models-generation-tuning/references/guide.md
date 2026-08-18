# Generation Tuning — Reference Guide

## GenerationOptions construction

From `ChatViewModel.swift:72`:

```swift
var generationOptions: GenerationOptions {
    switch samplingStrategy {
    case .default:
        return GenerationOptions()
    case .greedy:
        return GenerationOptions(sampling: .greedy)
    case .sampling:
        let seed: UInt64? = useFixedSeed ? (samplingSeed ?? generateAndStoreSeed()) : nil
        return GenerationOptions(sampling: .random(top: topKSamplingValue, seed: seed))
    }
}
```

## Seed management

From `ChatViewModel.swift:412`:

```swift
func generateAndStoreSeed() -> UInt64 {
    let seed = UInt64.random(in: UInt64.min...UInt64.max)
    samplingSeed = seed
    return seed
}
```

## UI for generation parameters

From `GenerationOptionsView.swift`:

```swift
@State private var temperature: Double = 0.7
@State private var topK: Int = 50
@State private var topP: Double = 0.9
@State private var maximumResponseTokens: Int = 500
@State private var useSampling: Bool = true
@State private var samplingMode: SamplingType = .nucleus
```

The view provides:
- Temperature slider (0.0–1.0)
- Sampling mode picker (greedy / top-k / nucleus)
- Top-K value slider (1–100)
- Top-P probability threshold slider (0.1–1.0)
- Max response tokens slider

## Passing options to generation

```swift
let options = createGenerationOptions(from: config)
let session = LanguageModelSession()
let response = try await session.respond(to: Prompt(prompt), options: options)
```

Or with streaming:

```swift
let responseStream = session.streamResponse(to: Prompt(content), options: generationOptions)
```

## Repo files

| File | Purpose |
|------|---------|
| `Foundation Lab/ViewModels/ChatViewModel.swift` | GenerationOptions construction + seed storage |
| `Foundation Lab/Views/GenerationOptionsView.swift` | Full parameter tuning UI |
| `Foundation Lab/Views/GenerationOptionsHelpers.swift` | Helper types for generation config |
| `Foundation Lab/Playgrounds/03_GenerationOptions/` | 5 playground examples |
