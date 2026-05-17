# X Algorithm Playbook (Phoenix Update -- 2026)

## How the Algorithm Ranks Posts

The Phoenix algorithm scores 1,500 candidate posts per user per feed refresh. It predicts 19 interaction types and weights them as follows:

| Signal | Weight | What It Means |
|--------|--------|---------------|
| **Author-Engaged Reply** | Exponential multiplier | The author replies back to someone who replied -> triggers cascading reach |
| **Bookmark** | High | User saves it -> "Knowledge Node" signal, high utility content |
| **Thread Expansion** | High | User clicks to read the full thread -> session depth |
| **Substantive Reply** | Moderate-High | A reply with real content (not just an emoji) -> conversation signal |
| **Repost (Retweet)** | Moderate | Shares to their followers -> out-of-network discovery |
| **Dwell Time (>3 seconds)** | Moderate | User paused scrolling -> "scroll-stopper" worked |
| **Like** | Baseline (1x) | Necessary but not sufficient for reach |

### Key Takeaway
A post with 5 back-and-forth replies in the comments will outperform a post with 50 likes and zero conversation. **Replies > Likes. Always.**

### CLI Scoring Implementation
When using `twitter-cli`, you can mimic the Phoenix algorithm to find engagement opportunities:
- Use `twitter search "topic" --filter --json` to sort results algorithmically.
- The default CLI scoring formula heavily weights Replies and Bookmarks.
- **Tip:** Use `--compact` (`-c`) along with `--json` when fetching large lists to save context tokens while still receiving engagement metrics.

---

## The 30-Minute Golden Window

The algorithm makes its primary distribution decision within the first 30 minutes of a post going live.

**What to do:**
1. Post the content
2. Stay online for the next 30 minutes
3. Reply to EVERY comment immediately -- this triggers "Author-Engaged Reply" signals
4. Ask follow-up questions in your replies to keep threads going
5. The algorithm sees sustained conversation -> pushes post to "out-of-network" users

**What NOT to do:**
- Post and close the app
- Post and check back 3 hours later
- Post and only like the comments without replying

---

## Vector Consistency

The algorithm maps every account into a multi-dimensional vector space using "Dynamic Embeddings." This means:

- Every post pushes your account vector in a direction
- Consistent topics = strong, clear vector = algorithm knows who to show you to
- Random, off-topic posts = confused vector = algorithm stops distributing you

**For your account:** Every post must reinforce your niche positioning as defined in your user-profile.md. Polluting the vector (posting about unrelated topics) will cause algorithmic isolation.

---

## Link Suppression

External links cause a **30-50% reach penalty**. The algorithm wants users to stay on X.

**Workaround:**
1. Post the content natively (text + video/image)
2. Build engagement in the first 30-60 minutes
3. Drop the link in the first REPLY (not the main post)
4. The reply's reach is smaller, but followers who engaged will see it

---

## No-Premium Penalties & Workarounds

Without X Premium, there's a documented 2-4x visibility penalty. Workarounds:

### 1. First Reply Speed
Even without Premium, being the first high-quality reply on a trending post maintains visibility. Set notifications for Tier 1 accounts.

### 2. Media Dwell Time
Video and image posts get outsized dwell time signals. If your work naturally produces visual content, this is a structural advantage.

### 3. Zombie Post Tactic
48 hours after posting, reply to the top comment on your best-performing post with additional value. This triggers a second distribution wave.

### 4. Cross-Platform Amplification
Post every piece of content on X, Threads, and LinkedIn simultaneously. External engagement signals can indirectly boost X performance through increased profile visits.

### 5. Get Premium When Possible
The math: Premium costs ~$8/month. If your content gets 3x the reach, you need 1 client/sale to pay for years of Premium. Once you hit the monetization threshold (500 followers + 5M impressions in 3 months), Premium pays for itself.

---

## Session Depth Signals

The algorithm rewards content that keeps users in the app:

- **Native video > External links** (users watch on X vs leaving)
- **Threads > Single tweets** (users expand to read more)
- **Conversations > Broadcasts** (author replies create session depth)
- **Long-form text > Short quips** (if Premium, use extended tweets)

---

## Timing Heuristics

Research-based best posting times for various niches:

| Day | Best Time (UTC) | Why |
|-----|----------------|-----|
| Weekdays | 13:00-15:00 | US morning + Europe afternoon overlap |
| Weekdays | 17:00-19:00 | US afternoon, peak browsing |
| Saturday | 14:00-16:00 | Weekend browsing, less competition |
| Sunday | 16:00-18:00 | Sunday evening engagement spike |

**Note:** These are starting heuristics. Track actual performance in memory.md and adjust based on what works for your specific audience. Convert these to your local timezone using the timezone in user-profile.md.

---

## Negative Signals to Avoid

| Signal | Impact | How to Avoid |
|--------|--------|-------------|
| High block/mute rate | Candidate Isolation (shadowban) | Never rage-bait or be controversial outside niche |
| Fast unfollows after post | Negative quality signal | Stay on-topic, maintain vector |
| Link-only posts | 30-50% reach penalty | Put links in replies, not main post |
| Low reply rate from author | Missed Author-Engaged multiplier | Always reply to comments for 30 min after posting |
| Generic replies on others' posts | Zero algorithmic value | Write substantive, multi-sentence replies |

---

## Growth Phase Strategy

| Phase | Focus | Daily Engagement |
|-------|-------|--------------------|
| **0-500 followers** | 80% replying, 20% posting | 20-50 high-value replies/day |
| **500-2,000 followers** | 60% replying, 40% posting | 15-30 replies + 1-2 posts/day |
| **2,000-10,000 followers** | 40% replying, 60% posting | 10-20 replies + 2-3 posts/day |
| **10,000+ followers** | 20% replying, 80% posting | 5-10 replies + daily posting |

Check your current phase in memory.md and adjust your effort allocation accordingly.
