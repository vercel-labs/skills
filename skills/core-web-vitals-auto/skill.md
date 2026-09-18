# Skill: Core Web Vitals – Next.js + Firebase (Auto Crawl)

## Purpose

Automatically discover all reachable URLs of a Next.js website deployed on Firebase Hosting, test Core Web Vitals, and generate a prioritized optimization plan mapped to concrete code locations.

## Inputs

- base_url (required)
- max_urls (default: 60)
- crawl_depth (default: 5)
- runs (default: 3)
- strategies (mobile, desktop)

## URL Discovery

1. Parse sitemap.xml if available.
2. Crawl internal links starting from root.
3. If repo access exists, enumerate:
   - app/**/page.*
   - pages/** (excluding API and system files)
4. Deduplicate.
5. Exclude:
   - /api
   - /_next
   - static assets
   - query strings
   - fragments

## Testing

For each discovered URL:

- Run Lighthouse (mobile + desktop).
- Repeat N runs.
- Save JSON + HTML.
- Compute medians.

Collect:

- LCP
- CLS
- TBT
- FCP
- Speed Index
- Performance score
- LCP element
- Top 10 opportunities

## Field Data

Integrate web-vitals library:
Capture:

- LCP
- INP
- CLS
Send:
- Firebase Analytics OR custom endpoint

## Firebase Checks

Validate:

- Caching headers in firebase.json
- Immutable fingerprinted assets
- SSR latency
- Compression behavior

## Output

A structured report containing:

1. URL inventory
2. Results tables
3. Prioritized fix list:
   - Quick wins
   - Medium effort
   - Refactors
4. CI guardrails (Lighthouse CI)
