# Content Planner

Automated pipeline for planning, queuing, and scheduling posts. Run this workflow when the user asks to plan content, or proactively suggest it during engagement sessions.

**Core principle:** 60% community/engagement posts, 40% self-showcase posts. Never post more than 2 self-promo posts in a row. It's okay to copy/adapt viral formats that are working for others.

## The Planning Pipeline

### Step 1: Feed Scan (5 min)

Scan the algorithmic feed for trending topics, viral formats, and high-engagement posts.

```bash
twitter feed --json -n 30 --filter
```

### Step 2: Competitor Analysis (5 min)

Fetch recent posts from Tier 1 accounts (listed in content-strategy.md).

```bash
twitter user-posts [TIER1_HANDLE] --max 10 -c --json
```

### Step 3: Trend Research (5 min)

Search for trending and niche-relevant topics.

```bash
twitter search "[niche topic]" -t Latest --max 20 -c --json
```

### Step 4: Reply Opportunities

Draft substantive replies for high-value posts found during the scan.

### Step 5: Post Drafting

Draft 3-5 posts ensuring the 60/40 engagement-to-showcase split. Each post needs:
- Post type and content pillar
- Full text with `[N/280]` character count
- Hook type (from hook-library.md)
- Media requirements (video, image, visual hook image, none)
- First reply text (for links and extra context)
- Hashtags (1-3)
- Strategic reasoning

### Step 6: Scheduling

**User's timezone:** _[set from user-profile.md during onboarding]_

**Optimal Posting Windows (adjust to user's timezone):**

| Slot | UTC Time | Best For |
|------|----------|----------|
| Morning overlap | 13:00-15:00 | US morning + Europe afternoon |
| Afternoon peak | 17:00-19:00 | US afternoon, peak browsing |
| Weekend Saturday | 14:00-16:00 | Less competition, good reach |
| Weekend Sunday | 16:00-18:00 | Evening engagement spike |

**Scheduling Rules:**
- Never schedule 2 showcase posts back-to-back
- Space posts at least 4-6 hours apart
- Prefer the user's historically best-performing time slots (check memory.md)
- Account for the user's availability during the 30-minute golden window

---

## Planned Posts Queue

_[posts are added here by the Content Planner workflow and removed/marked as posted after execution]_

<!--
### Planned Post #N
- **Status:** draft / approved / posted / skipped
- **Type:** [post type from content pillars]
- **Scheduled:** [YYYY-MM-DD HH:MM timezone]
- **Text:** [full post text] [N/280]
- **Media:** [path to media file, "visual hook image needed", or "none"]
- **First Reply:** [link + context for first reply]
- **Hashtags:** [#tag1 #tag2]
- **Strategic Reasoning:** [why this post, why this time, what gap it fills]
- **Post Result:** (filled after posting)
  - Tweet ID: [id]
  - Views: [N]
  - Likes: [N]
  - Replies: [N]
-->
