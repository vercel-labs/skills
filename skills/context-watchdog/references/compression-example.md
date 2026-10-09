# Compression Examples

## L1 Summary (60-70% reduction)
```
Before (800 tokens):
"First we analyzed the auth module, found the JWT validation was missing
expiry check, then we fixed middleware.go, added unit tests, ran them..."

After (280 tokens):
"Auth audit: added JWT expiry check in middleware.go + unit tests.
Files: middleware.go, auth_test.go"
```

## L2 Ultra-compact (1-2 lines + IDs)
```
Ref: engram-obs-42 (JWT expiry fix)
Ref: engram-obs-43 (test suite)
```

## When to compress
| After | Action |
|-------|--------|
| ~8 messages | L1 oldest block |
| ~20 messages / 3 L1s | L2 on L1s |
| Window >60% | L3 on everything |
| Hallucination detected | FORCE RED |
