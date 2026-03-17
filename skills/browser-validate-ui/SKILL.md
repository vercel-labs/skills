---
name: browser-validate-ui
description: Run 7 UI integrity checks on any URL. Catches blank renders, contrast failures, undersized tap targets, horizontal overflow, broken images, text overflow, and element overlap. Returns structured findings your agent can read and fix. Use when asked to validate UI, browser check, check before shipping, UI integrity check, accessibility check.
---

![llynt detecting horizontal overflow](assets/llynt-carousel.gif)

# browser-validate-ui

UI integrity checks powered by [llynt](https://llynt.dev). Measures what the browser actually computes — not what the source says.

No account required. Runs a real browser (Playwright) against any URL.

## HOW TO CALL

```bash
# check url with HTML report
npx llynt check <url>

# with JSON findings for agent to read
npx llynt check <url> --json
```

## RESPONSE

```
  7 of 7 rules checked
  Capturing... 2 viewports (360px, 768px)

  XX incidents (XX evidence points) across 2 viewports
    X errors · XX warnings · XX info

  Open full report:
    https://llynt.dev/r/RANDOM_GUID
    Expires <WEEK FROM RESPONSE TIME>

  Details are in the report link above.
```
> &nbsp;
> ### Catch what code reviews miss  — before your users do.
> &nbsp;


## What it checks

| Check | Rule ID | What it catches |
|-------|---------|----------------|
| Element overlap | `dom.overlap` | Interactive elements occluding each other |
| Contrast | `dom.a11y.contrast` | Text failing WCAG AA (4.5:1 normal, 3:1 large) |
| Hit targets | `dom.a11y.hitTarget` | Interactive elements smaller than 44×44px |
| Horizontal overflow | `dom.viewport.horizontalOverflow` | Page scrolls sideways (common mobile regression) |
| Broken images | `dom.asset.broken` | Images that failed to load |
| Text overflow | `dom.text.overflow` | Text clipped by overflow:hidden containers |
| Page rendered | `dom.render.notEmpty` | Blank pages, failed hydration, empty body |

## With an API key (more rules + higher limits)

```bash
export LLYNT_API_KEY=<your-key>
npx llynt check https://example.com
```

Sign up at [llynt.dev](https://llynt.dev) for 26+ rules, SARIF output, and PR gates.
