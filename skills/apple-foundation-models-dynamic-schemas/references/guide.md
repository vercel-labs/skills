# Dynamic Schemas — Reference Guide

## Schema example files

The repo has a comprehensive set of dynamic schema examples:

| File | Pattern |
|------|---------|
| `BasicDynamicSchemaView.swift` | Simple property schemas |
| `ArrayDynamicSchemaView.swift` | Collection/array schemas |
| `EnumDynamicSchemaView.swift` | Enum and union type schemas |
| `NestedDynamicSchemaView.swift` | Nested object schemas |
| `ReferencedSchemaView.swift` | Schema references |
| `GuidedDynamicSchemaView.swift` | Guided constraint schemas |
| `UnionTypesSchemaView.swift` | Union/discriminated union schemas |
| `FormBuilderSchemaView.swift` | Multi-step form generation |
| `InvoiceProcessingSchemaView.swift` | Complex document parsing |
| `SchemaErrorHandlingView.swift` | Schema error patterns |
| `GenerablePatternView.swift` | Patterns bridging @Generable and dynamic |

All files are in `Foundation Lab/Views/Examples/DynamicSchemas/`.

## Helper files

Each view has a corresponding `*Helpers.swift` file with schema construction logic:

- `DynamicSchemaHelpers.swift` — Shared utilities
- `DynamicSchemaExecutorExtension.swift` — Execution helpers
- `NestedSchemaFormatter.swift` — Formatting nested results
- `InvoiceSchemas.swift` + `InvoiceSchemasHelpers.swift` — Invoice-specific schemas

## Key patterns

### Basic dynamic schema

```swift
// Build schema with properties
let schema = DynamicGenerationSchema(...)

// Generate
let session = LanguageModelSession()
let response = try await session.respond(to: prompt, generating: schema)
// response.content is a dictionary
```

### Error handling

From `SchemaErrorHandlingView.swift` and `SchemaErrorHandlingHelpers.swift`:

- `decodingFailure` — Schema couldn't parse the model output
- `unsupportedGuide` — A guide constraint isn't compatible with the schema type

## Repo files

All in `Foundation Lab/Views/Examples/DynamicSchemas/` — 26 files total covering every dynamic schema pattern.
