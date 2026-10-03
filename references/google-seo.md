# Google SEO + Search Console (2026)

Frontend-focused. Assumes **Next.js** for metadata and performance fixes. Use with **field data** (Chrome UX Report via Search Console) as the primary signal for “what Google sees,” not lab-only scores.

---

## What still matters

- **Helpful content** aligned to search intent (clear answers, not keyword stuffing)
- **Discoverable** URLs: stable, readable paths; HTTPS; crawlable links in HTML
- **Indexability**: canonical tags, correct `robots` / `noindex`, no accidental blocking
- **Core Web Vitals** from **field data** (CrUX) in Search Console experience reports
- **Mobile-first** layout, legible type, tap targets
- **Trust signals** for sensitive topics: clear authorship, citations, contact, policies where appropriate

---

## Core Web Vitals (thresholds)

| Metric | Good | Poor |
|--------|------|------|
| **LCP** | ≤ 2.5s | > 4s |
| **INP** | ≤ 200ms | > 500ms |
| **CLS** | ≤ 0.1 | > 0.25 |

INP replaced FID. Use Search Console → **Experience → Core Web Vitals** (or the URL-level experience report) for URL groups. Use Lighthouse in CI for **regression debugging**, not as a ranking guarantee.

---

## Search Console workflows (check in this order)

1. **Page indexing** - why URLs are indexed, crawled but not indexed, excluded, or duplicate
2. **URL Inspection** - live URL test, request indexing after meaningful fixes, view rendered HTML
3. **Performance** - queries, pages, countries, devices; CTR vs position; allow ~2–3 days lag for fresh data
4. **Sitemaps** - submit `sitemap.xml`; fix “couldn’t fetch” or 404 sitemap URLs
5. **Core Web Vitals** - fix “Poor” templates first (hero media, fonts, layout shift, long tasks)
6. **Mobile usability** - viewport, text size, tap targets, intrusive interstitials
7. **Security & manual actions** - resolve hacked content or policy issues before chasing rankings
8. **Enhancements / rich results** - validate structured data after deploy (Article, FAQ, Product, etc.)

---

## URL and information architecture (SEO-friendly)

- **Short, descriptive slugs** - lowercase, hyphens; avoid dates or opaque IDs in evergreen URLs unless needed
- **One topic per URL** - avoid one page ranking for unrelated head terms; split when intent diverges
- **Stable URLs** - redirects (301) when renaming; update internal links and sitemap
- **Pagination** - `rel=next`/`prev` deprecated in practice; prefer clear page numbers in path or `?page=` with self-canonical per page and unique titles
- **Parameters** - strip tracking params in canonical; avoid infinite crawl spaces (`?sort=` combinations)
- **Trailing slashes** - pick one convention sitewide; redirect the other
- **International** - `hreflang` annotations for equivalent locale pages; reciprocal consistency

---

## Metadata and on-page

- Unique **title** per URL (~50–60 visible chars target; avoid boilerplate repetition sitewide)
- **Meta description** as a compelling snippet (~140–160 chars); not a ranking lever but affects CTR
- Single clear **H1**; **H2** outline matches searcher questions
- **Canonical** when duplicates exist (`www` vs apex, `http` vs `https`, print URLs, UTM variants)
- **Open Graph + Twitter** for share previews (`summary_large_image`, 1200×630 image guidance)
- **Breadcrumbs** in UI + optional `BreadcrumbList` JSON-LD for eligible results

---

## Structured data (JSON-LD)

- Pick one primary type per page (`Article`, `Product`, `FAQPage`, `Organization`, `WebSite` + `SearchAction`, etc.)
- Output **valid JSON** (no comments); match visible content (no FAQ schema for hidden text)
- Validate with Rich Results Test after deploy; monitor **Enhancements** in Search Console for errors

---

## Next.js fixes that move CWV and crawl quality

| Issue | Fix |
|-------|-----|
| Slow LCP | `next/image`, correct priority for hero, modern formats, avoid lazy-loading LCP image |
| CLS | explicit image dimensions, `next/font`, reserve space for embeds and dynamic slots |
| High INP | reduce client JS, code-split, defer third-party scripts, prefer Server Components for static shell |
| Metadata drift | App Router `metadata` / `generateMetadata`; avoid duplicate tags across layout + page |
| Soft 404s | real 404 status for missing products; avoid “empty” pages with 200 |

---

## Content and query intent (high-level)

- Map each URL to **one primary intent** (informational, navigational, transactional, commercial investigation)
- Cover **sub-questions** competitors answer (comparison tables, prerequisites, limits, pricing transparency where relevant)
- **Internal links** with descriptive anchors to hub pages and related guides
- **Freshness** where the topic demands it (docs, regulations, release notes) - update visible dates when materially changed

---

## Don’t

- Promise #1 rankings or fixed timelines
- Cloak, hide text, or auto-generated thin pages at scale
- Block critical CSS/JS in ways that break rendering for Googlebot
- Stuff keywords in footers or hidden DOM
- Rely on lab green scores while field data stays red

---

## Quick reference: high-intent checks before shipping a template

- [ ] Field LCP/INP/CLS acceptable for template in Search Console (or not yet measured - state that)
- [ ] Canonical correct for parameterized and duplicate paths
- [ ] Title + description unique and aligned to H1/H2
- [ ] JSON-LD valid and matches on-page content
- [ ] `robots.txt` allows important sections; sitemap lists canonical URLs only
- [ ] Mobile layout passes basic usability (no unreadable text, no overlapping tap targets)

---

## Experience, expertise, and trust (on-page signals)

- **Clear bylines** or team attribution where the topic needs credibility (health, finance, legal).
- **Primary sources** - link to official docs, standards, or data; avoid orphan claims.
- **Update history** - visible “last updated” when facts change (regulations, pricing ranges, APIs).
- **Contact and policies** - about, editorial policy, or support paths for YMYL-style topics.
- **Thin aggregation** - do not copy competitor paragraphs; add synthesis, tables, or steps they omit.

---

## Keyword demand without stuffing

- Use **Search Console Performance** (queries + pages) for *your* site’s real demand - not generic volume guesses.
- Complement with **related searches**, **People Also Ask**, and **competitor headings** for gap ideas.
- Place terms in **title, H1, first paragraph, and URL slug** only when they match intent; avoid footer or hidden repetition.
- One primary phrase per URL; use supporting phrases in H2s and body naturally.

---

## URL slug checklist (SEO-friendly paths)

- Lowercase, hyphens, **no** underscore in public marketing URLs unless legacy forces it.
- **Match intent** - `/docs/install-cli` beats `/page?id=3` for evergreen topics.
- Avoid **keyword stuffing** in path segments (`/buy-best-cheap-widgets-widgets`).
- Keep depth reasonable; every extra folder dilutes perceived focus unless IA requires it.
- When renaming: **301**, internal links, sitemap, GSC URL Inspection after deploy.

---

## Discover and freshness

- **Helpful content** updates: change visible date only when facts materially change.
- **Release notes / changelog** pages: unique titles per version; avoid duplicate boilerplate titles.
- **Video** on page: use structured data where eligible; transcript or captions for accessibility and indexing context.

---

## Monitoring after deploy

- Add **Search Console annotations** or team notes for deploy dates; compare queries and impressions week over week.
- Watch **indexed vs excluded** counts after template migrations.
- Re-run **Rich Results Test** when JSON-LD templates change.

---

## skills.sh CLI alignment (install one skill)

Per [skills.sh documentation](https://www.skills.sh/docs), installs use the open-source `skills` CLI:

```bash
npx skills add https://github.com/bh611627/skills --skill seo-expert
```

That pulls **one** skill into the host - not the whole npm bundle. Use `npm install @skillcodex/skills` when you need **programmatic** imports in Node.

---

## Team log template (“what we fixed”)

| Date | URL / template | Symptom in GSC | Change shipped | Result (2 weeks later) |
|------|----------------|----------------|----------------|-------------------------|
| | | | | |
