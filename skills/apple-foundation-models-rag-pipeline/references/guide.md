# RAG Pipeline — Reference Guide

## Configuration

From `RAGService.swift`:

```swift
struct RAGConfig {
    static func makeDefault() throws -> RAGConfig {
        let options = VecturaConfig.SearchOptions(defaultNumResults: 5, minThreshold: 0.5)
        let chunking = try ChunkingConfig(
            chunkSize: 500,
            overlapPercentage: 0.15,
            strategy: .semantic,
            contentType: .prose
        )
        return RAGConfig(searchOptions: options, chunkingConfig: chunking)
    }
}
```

## RAGService

From `RAGService.swift`:

```swift
@MainActor
final class RAGService {
    private let lumoKit: LumoKit

    func indexDocument(url: URL) async throws -> [UUID] {
        let accessing = url.startAccessingSecurityScopedResource()
        defer { if accessing { url.stopAccessingSecurityScopedResource() } }
        return try await lumoKit.parseAndIndex(url: url, chunkingConfig: chunkingConfig)
    }

    func indexText(_ text: String) async throws -> [UUID] {
        let chunks = try lumoKit.chunkText(text, config: chunkingConfig)
        return try await lumoKit.addDocuments(texts: chunks.map { $0.text })
    }

    func search(query: String) async throws -> [VecturaSearchResult] {
        try await lumoKit.semanticSearch(query: query, numResults: 5, threshold: 0.5)
    }
}
```

## LumoKit initialization

From `RAGChatViewModel.swift`:

```swift
let lumoKit = try await LumoKit(
    config: VecturaConfig(name: "foundation-lab-rag", searchOptions: config.searchOptions),
    chunkingConfig: config.chunkingConfig
)
service = RAGService(lumoKit: lumoKit, chunkingConfig: config.chunkingConfig)
```

## RAG prompt composition

From `RAGChatViewModel.swift`:

```swift
let systemPrompt = """
You are a helpful assistant. Answer using only the sources provided.
Cite sources with [1], [2]. If the sources do not contain the answer, say you don't know.
"""

let contextText = chunks.enumerated()
    .map { index, chunk in "[\(index + 1)] \(chunk.content)" }
    .joined(separator: "\n\n")

let prompt = "SOURCES:\n\(contextText)\n\nQUESTION:\n\(query)"

let session = LanguageModelSession(
    model: SystemLanguageModel(useCase: .general),
    instructions: Instructions(systemPrompt)
)
```

## State persistence

Indexed URLs, source titles, and chunk-to-title mappings are persisted via `UserDefaults`:

```swift
private let indexedURLsKey = "ragIndexedURLs"
private let sourceTitlesKey = "ragSourceTitles"
private let chunkTitlesKey = "ragChunkTitles"
```

## Repo files

| File | Purpose |
|------|---------|
| `Foundation Lab/Services/RAGService.swift` | RAG service + config |
| `Foundation Lab/ViewModels/RAGChatViewModel.swift` | RAG chat view model |
| `Foundation Lab/Views/Examples/RAGChatView.swift` | RAG chat UI |
| `Foundation Lab/Views/Examples/RAGChatView+Types.swift` | RAG entry/chunk types |
| `Foundation Lab/Views/Chat/RAGDocumentPickerView.swift` | Document picker |
