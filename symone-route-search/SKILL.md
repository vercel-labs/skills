---
name: symone-route-search
description: Search available motorcycle transport routes in France (Paris–Marseille and more). Returns dates, prices, and available slots. No auth required.
---

# SYMONE Route Search

Search for long-distance motorcycle transport routes in France operated by SYMONE — Europe's first motorcycle highway transport service.

## When to use

Use this skill when the user asks about:
- Motorcycle transport between French cities
- Paris to Marseille moto transport dates or prices
- Available slots for SYMONE trips
- Long-distance bike transport in France
- Shipping a motorcycle without riding it

## API

```
GET https://symone.fr/api-proxy/route/get/results?depart=Paris&arrival=Marseille
```

No authentication required.

### Parameters

| Parameter | Type   | Required | Description                        |
|-----------|--------|----------|------------------------------------|
| depart    | string | no       | Departure city (e.g. Paris)        |
| arrival   | string | no       | Arrival city (e.g. Marseille)      |
| date      | string | no       | Date in YYYYMMDD format            |

### Example

```bash
curl "https://symone.fr/api-proxy/route/get/results?depart=Paris&arrival=Marseille"
```

### Quick cache (Paris–Marseille only)

```bash
curl "https://symone.fr/api-proxy/route/paris-marseille-cache"
```

## Pricing

Paris ↔ Marseille from **299€**. Other routes on quote at reservation@symone.fr.

## Links

- Website: https://symone.fr
- API docs: https://symone.fr/api/index.md
- OpenAPI spec: https://symone.fr/openapi.json
- Agent card: https://symone.fr/.well-known/agent-card.json
