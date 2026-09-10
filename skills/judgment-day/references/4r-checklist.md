# 4R Review Checklist

## Risk (security/stability)
- [ ] Input validation at all boundaries
- [ ] SQL injection / command injection
- [ ] Sensitive data exposure
- [ ] Error messages leak internals?
- [ ] Rate limiting / DoS surface

## Readability (maintainability)
- [ ] Consistent naming with project conventions
- [ ] Functions < 50 lines
- [ ] Comments explain WHY, not WHAT
- [ ] No dead code / commented-out blocks

## Reliability (correctness)
- [ ] Error handling for all failure modes
- [ ] Edge cases: empty, null, boundary values
- [ ] Race conditions in async code
- [ ] Idempotent operations where expected

## Resilience (failure recovery)
- [ ] Retry logic for transient failures
- [ ] Circuit breaker / fallback
- [ ] Graceful degradation
- [ ] Clear error messages to user
