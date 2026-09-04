---
name: taghvim-mcp
description: >
  Deterministic temporal reasoning engine for AI agents. Resolve natural-language dates,
  convert timezones, calculate business days across 100+ countries, look up public holidays,
  generate recurring schedules (RRULE), convert between Gregorian and Persian/Jalali calendars,
  and verify temporal claims to prevent hallucinations. Use this whenever the user mentions
  dates, times, timezones, holidays, business days, schedules, or calendar conversions.
---

# Taghvim — Temporal Intelligence for AI Agents

Taghvim is a deterministic temporal reasoning MCP server. LLMs are bad at dates — Taghvim gives agents reliable date/time computation instead of guessing.

## Install

```bash
npx skills add mrfelfel/taghvim-mcp
```

Or add to your MCP config:

```json
{
  "mcpServers": {
    "taghvim": {
      "command": "npx",
      "args": ["taghvim-mcp"]
    }
  }
}
```

## When to use

Any time a task involves dates, times, timezones, calendars, holidays, business days, or recurring schedules, call Taghvim tools rather than computing dates yourself.

| If the user says... | Use this tool |
|---------------------|---------------|
| "What time is it?" / "What day is it?" | `now` |
| "Tomorrow" / "Next Friday" / "In 3 weeks" | `resolve_time` |
| "Add 3 months" / "End of quarter" | `calculate_date` |
| "What time is that in Tokyo?" | `convert_time` |
| "Is New York in DST?" | `timezone_info` |
| "Next business day" / "Is today a holiday?" | `business_days` / `holidays` |
| "Every Monday" / "Recurring schedule" | `recurrence` |
| "Jalali date" / "Persian calendar" | `calendar` / `jalali_persian` |
| "Format in Japanese" | `format_time` |
| "Is Dec 25 a Saturday?" | `temporal_verify` |

## Tools (12)

| Tool | Description |
|------|-------------|
| `now` | Current deterministic time — never guess the date |
| `resolve_time` | Natural language → ISO timestamp |
| `calculate_date` | Date arithmetic with correct month-end/leap-year handling |
| `convert_time` | Timezone conversion with DST correctness (multi-target) |
| `timezone_info` | UTC offset, DST status, next transition |
| `business_days` | Business day logic for 100+ countries (configurable weekends) |
| `holidays` | Public holidays for 100+ countries |
| `recurrence` | RFC 5545 RRULE from natural language |
| `calendar` | Gregorian ↔ Persian/Jalali ↔ ISO week conversion |
| `format_time` | Locale-aware formatting (ISO, Jalali, human-readable) |
| `temporal_verify` | Verify "is X a Y?" claims to prevent hallucinations |
| `jalali_persian` | Persian calendar events, month overviews |

## Examples

### Schedule around business days
```
User: "Send the report 5 business days before Christmas"
→ business_days(operation=add, date=2026-12-25, count=-5, country_code=US)
```

### International meeting times
```
User: "I have a call at 3 PM Tokyo time. What time is that in London and New York?"
→ convert_time(datetime=<today>T15:00:00, from_timezone=Asia/Tokyo, to_timezone=["Europe/London", "America/New_York"])
```

### Prevent date hallucinations
```
User: "Is Christmas 2027 on a Saturday?"
→ temporal_verify(claim="Is 2027-12-25 a Saturday?")
```

### Persian calendar
```
User: "What Gregorian date is 1405-06-13?"
→ calendar(operation=convert, date=1405-06-13, source_calendar=persian, target_calendar=gregorian)
```

## Key principles

1. **Never guess** — always call the tool instead of inferring dates
2. **Use IANA timezone names** — `America/New_York`, not `EST`
3. **Return structured JSON** — other agents can parse results directly
4. **Specify country codes** for business days/holidays — defaults to US
5. **Always bound recurrence** — never generate infinite date lists

## Links

- **npm**: https://www.npmjs.com/package/taghvim-mcp
- **GitHub**: https://github.com/mrfelfel/taghvim
- **License**: MIT
