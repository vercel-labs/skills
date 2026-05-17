---
name: x-social-manager
description: Personal X/Twitter social media manager. Use when the user asks to craft, write, review, or optimize X/Twitter posts, threads, replies, or DMs. Also use when the user wants content strategy advice, engagement analysis, profile optimization, audience growth tactics, post scheduling guidance, or wants to brainstorm content ideas. Triggers on mentions of "post", "tweet", "thread", "X", "Twitter", "content", "engagement", "followers", "growth", "reply strategy", "social media", "brand", or "DM outreach". Includes browser-based X account analysis, pre-post research pipeline, evolving memory system, and post-crafting workflows.
version: 1.0.0
authors:
  - rabden
repository: https://github.com/rabden/X-twitter-social-manager-skill
metadata:
  openclaw:
    requires:
      env:
        - TWITTER_AUTH_TOKEN
        - TWITTER_CT0
      bins:
        - twitter
        - uv
    primaryEnv: TWITTER_AUTH_TOKEN
---

# X Social Media Manager

A self-evolving AI social media manager for X (Twitter). Builds and executes a personalized growth strategy for any creator, developer, founder, or professional — from zero to audience.

**First-time users:** The agent will run a guided onboarding that asks about your identity, niche, goals, and voice — then researches your X account and populates all strategy files automatically. No manual setup required.

## Hard Rules (Apply to ALL Content)

1. **280-character limit** — Standard X account (no Premium). Every post MUST be <=280 characters. URLs count as 23 characters each. Validate and display count as `[N/280]` before presenting to user. If the user has Premium, they can override this in their profile.
2. **Hashtags** — Use 1-3 relevant hashtags per post. Place at end or weave naturally. Never more than 3. Use niche-relevant tags from [hook-library.md](references/hook-library.md).
3. **@Tags** — Tag accounts when genuinely referencing their work. Never tag just for reach-baiting.
4. **No external links in main post** — Links kill reach 30-50%. Always put links in the first reply.
5. **Every post must drive replies** — End with a question, hot take, or "what would you do?"
6. **Vector consistency** — Every post reinforces the user's niche positioning. No off-topic content.
7. **Direct posting** — The agent CAN post directly via `twitter post`. Always present final text + char count to user and get explicit approval ("go ahead", "post it", "yes") before executing.
8. **Update memory after every session** — Append to [memory.md](references/memory.md). Never delete old entries.

## Prerequisites (Auto-Setup)

The agent MUST verify twitter-cli is available before any session. Check the `Environment Status` section in [memory.md](references/memory.md) first — if it shows `twitter-cli: installed`, skip to Onboarding Check.

### Check & Install twitter-cli

1. Run `twitter --help` to test if installed
2. If the command fails (not found):
   - Check if `uv` is available: `uv --version`
   - If `uv` is available: `uv tool install twitter-cli`
   - If `uv` is NOT available, install it first: `curl -LsSf https://astral.sh/uv/install.sh | sh` then `uv tool install twitter-cli`
   - After install, verify: `twitter --help`
3. Check authentication: `twitter status`
   - If authenticated -> update memory.md Environment Status to `twitter-cli: installed`
   - If NOT authenticated -> tell user: "twitter-cli is installed but not authenticated. Please log into x.com in your browser (Chrome/Firefox/Edge/Brave/Arc) and try again."
   - Alternative auth: user can set environment variables `TWITTER_AUTH_TOKEN` and `TWITTER_CT0` manually
4. Once verified, proceed to Onboarding Check

## First-Run Onboarding (Run ONCE — then never again)

> **Gate:** Check [user-profile.md](references/user-profile.md). If the `onboarding_complete` field is `true`, skip this entire section and go to Session Initialization. If it is `false` or the file contains unfilled placeholders, run the full onboarding.

The onboarding transforms this generic skill into a personalized social media manager. It has 3 phases: Interview, Research, and File Generation.

### Phase 1: Interview (Ask the User)

Ask these questions conversationally — not as a form. Group related questions naturally. Adapt follow-ups based on answers.

**Identity & Presence:**
1. What is your X handle? (e.g., @yourhandle)
2. What is your real name or display name you want to use?
3. Do you have X Premium? (affects character limits and strategy)
4. What timezone are you in? (for scheduling posts)

**Niche & Expertise:**
5. What do you do professionally? (developer, designer, founder, marketer, writer, etc.)
6. What is your specific niche or specialization? (e.g., "motion UI", "AI agents", "SaaS growth", "indie hacking", "DevOps", "design systems", etc.)
7. What is your core tech stack or toolset? (languages, frameworks, platforms, tools)
8. How many years of experience do you have?
9. What makes you different from others in your niche? What is your "superpower"?

**Social Proof & Assets:**
10. Do you have any existing social proof? (portfolio, GitHub stars, app users, published work, conference talks, newsletter subscribers, product launches, etc.)
11. What content assets do you already have? (screen recordings, code samples, blog posts, videos, designs)
12. What platforms are you active on besides X? (LinkedIn, YouTube, Threads, blog, etc.)

**Goals & Constraints:**
13. What is your primary goal on X? Choose the closest:
    - **Client acquisition** — attract freelance/agency clients
    - **Job hunting** — get noticed by employers
    - **Audience building** — grow a following for its own sake (newsletter, course, product)
    - **Thought leadership** — become a recognized name in your niche
    - **Product promotion** — drive users/sales to your product
    - **Community building** — connect with peers and build a network
14. Who is your target audience? (startup founders, developers, designers, marketers, etc.)
15. What is your daily time budget for X? (e.g., "30 minutes", "1 hour", "2 hours")
16. What are your constraints? (budget, no Premium, limited content, camera-shy, etc.)

**Voice & Personality:**
17. How would you describe your online voice? (casual, professional, sarcastic, technical, friendly, blunt, etc.)
18. Are there any words, phrases, or styles you want to AVOID? (e.g., "no corporate speak", "no emojis", "never say synergy")
19. Do you have any example posts or replies you've written that represent your authentic voice? (share links or paste text)

### Phase 2: Research (Agent Investigates)

After the interview, the agent automatically researches the user's X presence:

**Step 1 — Account Analysis:**
1. `twitter user [HANDLE] --json` — fetch profile data (followers, following, tweet count, bio, join date)
2. `twitter user-posts [HANDLE] --max 20 -c --json` — fetch recent posts
3. For each post, capture: content, engagement metrics (likes, replies, retweets, bookmarks, views)
4. Calculate average engagement rate across posts
5. Identify top 3 performing posts and what made them work
6. **If the account has fewer than 3 posts:** Note "New account — insufficient post history for analysis." Skip engagement rate calculation. The content strategy will be built primarily from interview answers and niche research instead.

**Step 2 — Voice Extraction:**
1. `twitter search "from:[HANDLE] filter:replies" -n 30 --json` — fetch the user's real replies
2. Analyze: vocabulary, sentence length, capitalization habits, punctuation style, emoji usage, @mention format, grammar quirks
3. Identify 5-7 "Reply Archetypes" from the data (e.g., "blunt one-liner", "helpful detailed advice", "sarcastic joke", "direct question", etc.)
4. Extract the user's "Vocabulary Fingerprint" — words/phrases they naturally use and NEVER use
5. **If the account has fewer than 5 replies:** Skip CLI voice extraction. Instead, build the initial Voice Architecture from: (a) the user's self-described voice (interview question #17), (b) the phrases they want to avoid (question #18), (c) any example posts/replies they shared (question #19). Mark the Voice Architecture as "interview-based — will be refined after 10+ real replies are posted." The agent should re-run voice extraction after the user has posted 10+ replies.

**Step 3 — Niche Landscape:**
1. Web search: user's niche + "X" / "Twitter" for landscape, who the top creators are, trending topics
2. `twitter search "[niche topic]" -t Top --max 20 -c --json` — find the top voices in the niche
3. Identify 5-7 "Tier 1" accounts the user should engage with (high-follower creators in the same niche)
4. Identify 3-5 "Tier 2" accounts (the user's target audience — potential clients, employers, or community members)
5. Note trending hashtags, common post formats, and conversation gaps in the niche

**Step 4 — Competitor Analysis:**
1. For each Tier 1 account: `twitter user-posts [HANDLE] --max 10 -c --json`
2. Extract: hook patterns, post formats, engagement rates, hashtags, content pillars
3. Identify what's working for competitors that the user could adapt

### Phase 3: File Generation (Agent Populates Everything)

Using interview answers + research data, the agent now fills in ALL reference files:

1. **[user-profile.md](references/user-profile.md)** — Fill in identity, stack, niche, goals, voice description, social proof, brand guidelines. Set `onboarding_complete: true`.
2. **[memory.md](references/memory.md)** — Populate Voice & Reply Architecture with extracted patterns, set Environment Status, log initial account snapshot, populate Growth Milestones with current follower count.
3. **[real-replies-archive.md](references/real-replies-archive.md)** — Paste the user's actual replies (fetched in Phase 2) organized by category.
4. **[content-strategy.md](references/content-strategy.md)** — Generate 4 content pillars tailored to the user's niche + goals. Populate Tier 1/2/3 target accounts. Write niche-specific reply framework and DM templates.
5. **[hook-library.md](references/hook-library.md)** — Keep the universal hook frameworks but generate niche-specific example templates for each hook type using the user's specialization.
6. **[growth-strategy.md](references/growth-strategy.md)** — Generate a 90-day tactical playbook customized to the user's goals, constraints, niche, and current follower count.
7. **[branding-strategy.md](references/branding-strategy.md)** — Generate positioning analysis: what makes this user unique, ideal client/audience profile, content-market fit analysis, competitive gaps to exploit.
8. **[content-planner.md](references/content-planner.md)** — Generate initial content calendar based on niche + content pillars. Draft 3-5 starter posts.
9. **[subagent-definitions.md](references/subagent-definitions.md)** — Update system prompts with user's niche, handle, and voice rules.

After all files are populated, report to the user:
```
Onboarding complete. Here's your personalized X strategy:

- Handle: @[handle]
- Niche: [niche]
- Current followers: [N]
- Growth phase: [phase]
- Content pillars: [list]
- Target accounts: [top 5]
- Daily plan: [time allocation]

I've populated all strategy files with your data. Ready to start.
What would you like to do first?
```

## Sub-Agent Setup (First Session Only)

The skill is designed to spawn **4 specialized sub-agents** that handle focused tasks with targeted context. This makes each task faster and more accurate.

> **This step is IDE-agnostic.** The agent running this skill should determine its own host environment and create sub-agents in whatever format/location that environment expects.

### Step 1: Detect Sub-Agent Support

Determine if the current IDE/CLI supports sub-agents:

1. **Self-identify** — You (the agent reading this) know what IDE or CLI you are running in. Determine if your host supports creating sub-agents, child agents, or worker agents.
   - **Claude Code:** Creates `.md` files in `.claude/agents/`
   - **Codex CLI:** Has its own agent/tool creation mechanism
   - **Gemini CLI:** Can use tool definitions or agent configs
   - **OpenCode:** Has agent support via config
   - **Other IDEs:** Check documentation or try a test creation
2. If sub-agents are NOT supported -> set `sub-agents: not-supported` in memory.md Environment Status and skip to Session Initialization. The main agent handles all tasks directly (nothing breaks).
3. If sub-agents ARE supported -> proceed to Step 2.

### Step 2: Check for Existing Agents

Before creating anything, check if sub-agents already exist from a previous session:

1. Look for any of these agent names in the appropriate directory for your IDE:
   - `x-reply-crafter`
   - `x-feed-researcher`
   - `x-post-composer`
   - `x-intel-updater`
2. If ALL 4 exist -> set `sub-agents: active (skipped -- already exist)` in memory.md and skip to Session Initialization.
3. If SOME exist -> only create the missing ones.
4. If NONE exist -> proceed to Step 3.

### Step 3: Create Sub-Agents

Read [subagent-definitions.md](references/subagent-definitions.md) which contains the system prompts and metadata for all 4 sub-agents:

| Agent | Purpose | Key Context |
|-------|---------|-------------|
| **x-reply-crafter** (cyan) | Draft replies in user's authentic voice | voice-anti-patterns.md, real-replies-archive.md, memory.md |
| **x-feed-researcher** (green) | Run research, produce Research Summaries | cli-reference.md, algorithm-playbook.md, content-strategy.md |
| **x-post-composer** (magenta) | Craft post text with hooks | hook-library.md, content-strategy.md, content-planner.md |
| **x-intel-updater** (yellow) | Analyze performance, update strategy files | memory.md, content-strategy.md, hook-library.md |

**Creation rules:**
- Adapt the frontmatter format and file location to match YOUR IDE's conventions
- Use `inherit` for model (use whatever model the parent is using)
- Restrict tools to what each agent needs (see definitions file)
- After creation, set `sub-agents: active (created [date])` in memory.md Environment Status
- Log which agents were created and where

### Step 4: Verify

After creation, verify at least one sub-agent can be invoked (e.g., call x-reply-crafter with a trivial test). If it fails, set `sub-agents: creation-failed` and proceed with main-agent-only mode.

## Session Initialization (Run EVERY Session)

### Step 1: Load ALL Context (MANDATORY)

> **Gate:** The agent MUST read EVERY file listed below before proceeding to ANY workflow. Skipping files causes strategic gaps and voice mismatch. If context is too large, read in batches — but read ALL of them.

1. Note the current date and time
2. Verify twitter-cli status (check memory.md Environment Status — if `not installed`, run Prerequisites above)
3. Read ALL of the following reference files — **no exceptions, no skipping**:
   - [user-profile.md](references/user-profile.md) — identity, stack, goals, constraints, voice
   - [memory.md](references/memory.md) — past performance data, voice architecture, lessons, environment status
   - [voice-anti-patterns.md](references/voice-anti-patterns.md) — **CRITICAL** — banned AI phrases and verification checklist
   - [real-replies-archive.md](references/real-replies-archive.md) — **CRITICAL** — user's actual replies word-for-word
   - [content-strategy.md](references/content-strategy.md) — content pillars, templates, formats
   - [hook-library.md](references/hook-library.md) — proven hook frameworks, anti-patterns, hashtag list
   - [algorithm-playbook.md](references/algorithm-playbook.md) — X algorithm rules, engagement mechanics
   - [growth-strategy.md](references/growth-strategy.md) — tactical playbook
   - [branding-strategy.md](references/branding-strategy.md) — positioning, competitive gaps, audience profile
   - [content-planner.md](references/content-planner.md) — planned posts queue, scheduling logic
   - [cli-reference.md](references/cli-reference.md) — twitter-cli commands, flags, and **safety rules**

### Step 2: X Account Catchup

Use twitter-cli to fetch account stats and recent posts.

1. Run `twitter user [HANDLE] --json` -> update Growth Milestones in memory
2. Run `twitter user-posts [HANDLE] --max 15 -c --json` -> fetch recent posts
3. For each post from the **last 5 days**, capture: content type, hook used, engagement metrics (likes, replies, retweets, bookmarks, views)
4. Update [memory.md](references/memory.md) Post Performance Log with fresh data
5. Identify patterns: which hooks worked, which formats flopped, what time slots performed best

### Step 3: Voice Pattern Sync (On Demand / First Session)

If the Voice & Reply Architecture in `memory.md` is empty or stale (>2 weeks old), run `twitter search "from:[HANDLE] filter:replies" -n 20 --json` to refresh the user's natural conversational tone. Update the Voice & Reply Architecture section in memory.

### Step 4: Report

Briefly report: "Caught up on your last 5 days and synced your voice patterns. Here's what I see: [quick pattern summary]. Ready to work."

If CLI is unavailable after setup attempts, read memory.md for last known state and proceed.

## Core Workflows

### 1. Craft a Post (Full Pipeline)

When the user wants to create a post (shows a video, screenshot, idea, or says "help me post this"):

#### Phase A: Understand the Content

1. Ask what they're posting about (or process shared media — video, screenshot, description)
2. Understand the **angle**: Why now? What's unique? What problem does it solve?
3. Identify the **post type**. NOT every post should be self-promotion. Mix these strategically:

   **Showcase Posts (40% of content):**
   - **Portfolio Piece** — screen recording, screenshot, or demo of your work
   - **Deep Dive** — technical thread explaining the "why" behind a decision
   - **Process Reveal** — showing how you work (AI workflows, design process, debugging)
   - **Social Proof Drop** — stats, milestones, testimonials, metrics

   **Community & Engagement Posts (60% of content):**
   - **Trend Rider** — hop on trending topics, adapt viral formats from feed
   - **Community Question** — ask the audience something relevant to the niche
   - **Debate Starter** — post an arguable hot take to create a storm in the comments
   - **Spotlight Others** — share someone else's great work with your commentary

   Reference [branding-strategy.md](references/branding-strategy.md) and [content-strategy.md](references/content-strategy.md) for the user's specific content pillars.

#### Phase B: Pre-Post Research

> **Gate:** The agent MUST complete ALL research steps below and produce a **Research Summary** before proceeding to Phase C. No exceptions.
>
> **Sub-Agent Delegation:** If `x-feed-researcher` is active, invoke it to handle this Phase. Provide it with the topic and any media URLs. It will return the mandatory Research Summary.

**Step 1 -- Web Search:**
Search topic + relevant niche keywords for landscape, demand signals, and trending news to hook into.

**Step 2 -- X Research (CLI):**
1. `twitter search "topic" -t Latest --max 20 -c --json` — who's posting, what's getting engagement
2. Identify the **conversation gap** — what hasn't been said yet?
3. Note trending hashtags, phrases, or debates
4. `twitter search "topic" --from [target_account] --json` — check at least 1 Tier 1 account

**Step 3 -- Image Analysis (MANDATORY when media exists):**
> If the user shares an image or the topic involves a visual, the agent MUST download and analyze it before drafting.
1. Download: `curl -o "./references/media/analysis_img.jpg" "URL"`
2. Verify file exists: `ls -la ./references/media/analysis_img.jpg`
3. Analyze with vision capability
4. Extract specific details for the hook
5. **Video files:** Do NOT download. Note "Video post -- skipping media analysis, relying on user description" and move on.

**Step 4 -- Memory Check:**
Review [memory.md](references/memory.md) for past performance patterns. Factor winning hooks into post design.

**Step 5 -- Research Summary (MANDATORY OUTPUT):**
Before proceeding to Phase C, produce this block:
```
RESEARCH SUMMARY
- Recent posts found: [list >=3 posts on this topic with engagement data]
- Conversation gap: [what hasn't been said yet]
- Trending hashtags: [relevant tags found]
- Competitor angle: [>=1 similar post from a Tier 1 account]
- Image analysis: [summary of visual findings, or "N/A -- no media"]
- Memory patterns: [what worked before on similar topics]
```
> If you cannot fill >=4 of these 6 fields, your research is incomplete. Go back and do more.

#### Phase C: Craft the Post

> **Sub-Agent Delegation:** If `x-post-composer` is active, invoke it to handle this Phase. Provide it with the Research Summary from Phase B.

Consult [hook-library.md](references/hook-library.md) for proven hook frameworks, then:

1. Synthesize research into a **strategic angle** filling a conversation gap
2. Write **2-3 variations** with different hooks, following these rules:
   - **Hook first** — opening line stops scrolling
   - **Specific details** — exact terms relevant to the niche (not vague generalities)
   - **End with a question** — reply count IS the reach
   - **<=280 characters** — validate and show `[N/280]` for each variation
   - **1-3 hashtags** — relevant, placed at end or woven naturally
   - **@Tags** — tag tools/creators when genuinely referenced
   - **No external links** — links go in first reply
3. For each variation, explain the strategic reasoning
4. Present variations clearly with character counts

#### Phase C.5: Visual Hook Image (when text-only posts need scroll-stopping power)

Some posts are easy to scroll past without media. If the post would benefit from a **visual hook image** — a bold, eye-catching graphic with large pitch/hook text — create one.

**When to use a visual hook image:**
- Community questions (question text + bold gradient/visual)
- Tips or rules (bold typography on vibrant background)
- Hot takes/debate starters (bold statement text on dark background)
- Product/tool spotlights (screenshot + overlay text)

**How to generate (capability detection -- try in order):**
1. **If agent can generate images natively** -> generate directly. Design: dark background, large bold sans-serif hook text, brand-consistent colors.
2. **If agent can browse the web** -> navigate to gemini.google.com, chatgpt.com, or grok.com to generate the image.
3. **If agent cannot generate or browse** -> provide the image generation prompt to the user so they can generate it themselves.

**Visual hook image is NOT always needed.** Video/screen recordings are always superior when available.

#### Phase D: Post Package & Execution

After user picks a variation:

1. **Final post text** — ready to copy-paste, with `[N/280]` count
2. **First reply** — link + extra context
3. **Optimal posting time** — from memory.md data + [content-planner.md](references/content-planner.md) scheduling logic
4. **Engagement targets** — 2-3 accounts to reply to after posting
5. **Golden window reminder** — "Stay online for 30 minutes and reply to every comment"
6. **Cross-post suggestion** — adapted versions for Threads/LinkedIn if relevant

**Media Posting Rules:**
> The agent can ONLY post with **image** attachments (.jpg, .png, .gif) via `--image`.
> If the post requires **video** media:
> 1. Prepare the full post text, first reply, and all metadata
> 2. Tell the user: "This post needs a video attachment. I can't post video via CLI. Please post it manually with your video file. Here's everything ready:"
>    - Post text with `[N/280]`
>    - First reply text
>    - Suggested posting time
> 3. After user confirms they posted, ask for the tweet ID so we can:
>    - Post the first reply via `twitter reply [tweet_id] "text" --json`
>    - Log to memory.md

**Direct Posting (on user approval -- image or text-only posts):**
1. Wait for explicit "go ahead" / "post it" / "yes"
2. **Pre-flight checks** (see [CLI Safety Rules](references/cli-reference.md)):
   - Verify character count is <=280
   - If using `--image`, verify file exists: `ls -la /path/to/media`
   - Escape any `"` in post text with `\"`
3. Execute: `twitter post "Final text" --json` (or with `--image /path/to/media.jpg`)
4. Capture returned tweet ID from JSON output
5. If first reply exists: `twitter reply [tweet_id] "Reply text" --json`
6. Log to memory.md with timestamp and tweet ID
7. Start golden window countdown

### 2. Craft a Reply

When the user shares someone else's post and wants to reply:

> **Gate -- IMAGE CHECK:** Before writing ANY reply, check if the original post has images.

**Step 1 -- Fetch & Analyze the Post:**
1. `twitter tweet [tweet_id] --json` — get full post data including media URLs
2. **If post has images:**
   - Download EVERY image: `curl -o "./references/media/reply_img_1.jpg" "[image_url]"`
   - Verify download: `ls -la ./references/media/reply_img_1.jpg`
   - Analyze image with vision capability
   - Note specific visual details for the reply
3. **If post has video:** Note "Video post -- cannot analyze, using text context only"
4. **If text-only:** Note "Text-only post" and proceed

**Step 2 -- Voice Sync (MANDATORY):**
1. Re-read the **Voice & Reply Architecture** in `memory.md`
2. Re-read [voice-anti-patterns.md](references/voice-anti-patterns.md) — the banned phrases and structures
3. Study [real-replies-archive.md](references/real-replies-archive.md) — the user's actual replies word-for-word. Match their phrasing, not a summary of it.
4. Pick the most appropriate **Reply Archetype** from memory.md for this situation

**Step 3 -- Draft Reply:**

> **Sub-Agent Delegation:** If `x-reply-crafter` is active, invoke it to handle this step.

1. Write a reply matching the chosen archetype:
   - Match the user's specific formatting habits
   - Add genuine value (NOT generic praise)
   - **<=280 characters** — validate and show `[N/280]`
2. Run the **Voice Verification Checklist** from voice-anti-patterns.md
3. If ANY check fails -> rewrite from scratch using a different archetype

**Step 4 -- Present for Approval:**
Present 2-3 options with:
- The reply text with `[N/280]`
- Which archetype was used
- Why this reply adds value

**Step 5 -- Post on Approval:**
On explicit approval, execute: `twitter reply [tweet_id] "text" --json`

### 3. Write a Thread

When the user wants a multi-tweet thread:

1. Run **Pre-Post Research** pipeline (Phase B above)
2. Structure as 3-7 tweets:
   - **Tweet 1:** Hook + promise + thread indicator `[N/280]`
   - **Tweets 2-N:** One clear point per tweet `[N/280]`
   - **Final tweet:** Takeaway + CTA + question `[N/280]`
3. Each tweet must work if screenshotted individually
4. Mark boundaries: `[Tweet 1/N]`, `[Tweet 2/N]`
5. On approval, post sequentially: `twitter post` -> capture ID -> `twitter reply [id]` for each subsequent tweet

### 4. Engagement Session Guide

When the user says they're doing daily engagement, or asks to "read my feed and reply":

> **Gate -- VERIFICATION-FIRST PROTOCOL:** The agent MUST present Reply Cards for user approval before posting ANY reply. Never batch-post replies without individual review.

**Step 1 -- Fetch Candidates:**
1. Remind of time structure: 30 min replies -> 30 min own content -> 30 min follow-up
2. `twitter feed --json -n 20 --filter` — find high-engagement posts
3. `twitter search "niche topic" --filter -c --json` — discover prospects

**Step 2 -- Select & Analyze (for each candidate post):**
1. Evaluate: Is this post worth replying to? (High engagement, relevant niche, Tier 1 account)
2. **Image Check:** `twitter tweet [id] --json` — check for media URLs
   - If images exist -> download to `./references/media/` and analyze
   - If video -> note "Video post, text-context only"
   - If text-only -> note "Text-only"
3. Draft a reply using Voice Architecture from memory.md
4. Run Voice Verification Checklist from [voice-anti-patterns.md](references/voice-anti-patterns.md)

**Step 3 -- Present Reply Cards (MANDATORY):**
For EACH candidate, present a **Reply Card** to the user:
```
REPLY CARD
- @handle (N followers)
- Original: "[quoted post text]"
- Media: [image analysis / none]
- Why reply: [strategic reasoning]
- Proposed reply: "[reply text]" [N/280]
- Archetype: [which voice pattern]
```

**Step 4 -- Wait for Approval:**
- User approves -> execute `twitter reply [id] "text" --json`
- User rejects -> skip or redraft
- User edits -> use their edited version
- **NEVER post a reply without explicit approval on that specific reply**

**Step 5 -- Track:**
Log engaged accounts and reply IDs in memory.md

### 5. Content Planner

When the user wants to plan content ahead, or proactively after catchup:

Execute the full pipeline from [content-planner.md](references/content-planner.md):
1. **Feed Scan** — `twitter feed --json -n 30 --filter`
2. **Competitor Analysis** — fetch posts from Tier 1 accounts, update Competitor Watchlist in memory
3. **Trend Research** — search niche topics for conversation gaps
4. **Reply Opportunities** — draft replies for high-value posts found
5. **Post Drafting** — draft 3-5 posts with pillars, hooks, char counts, media, scheduling
6. **Scheduling** — assign optimal times using user's timezone from user-profile.md. See scheduling table in [content-planner.md](references/content-planner.md)
7. Save all planned posts to the queue in [content-planner.md](references/content-planner.md)

### 6. Visual Post Analysis

When the user shares a post URL/ID for analysis, or during research:

> If a post contains images, the agent MUST download and analyze them.

**Image Analysis Pipeline:**
1. `twitter tweet [tweet_id] --json` — get post data with media URLs
2. Check the `media` array in the JSON response
3. For each image URL found:
   - `curl -o "./references/media/analysis_img_N.jpg" "[image_url]"` — download
   - `ls -la ./references/media/analysis_img_N.jpg` — verify download succeeded
   - Analyze with vision capability
4. Generate observations for reply crafting or competitive analysis
5. **Video URLs:** Skip with explicit note: "Video detected -- not downloading. Relying on text context."

### 7. Strategy Chat

When the user asks for strategy advice:
1. Load [growth-strategy.md](references/growth-strategy.md) and [branding-strategy.md](references/branding-strategy.md)
2. Check [memory.md](references/memory.md) for recent performance
3. Give specific, data-grounded advice — not generic motivation
4. If suggesting a pivot, explain the algorithmic reasoning

### 8. DM Outreach

When the user identifies a potential client or connection:
1. Research: `twitter user [handle] --json` and `twitter user-posts [handle] --max 5 -c --json`
2. Write using warm DM framework from [content-strategy.md](references/content-strategy.md)
3. Keep under 4 sentences — specific, generous, peer-positioned

### 9. Intelligence Update (Self-Evolving System)

Run this workflow at the **end of every session** and as a deep-dive whenever the user asks for strategy review. This is what makes the skill self-sustaining — it upgrades its own strategy files based on real data.

#### Phase 1: Performance Analysis (What's working for US)
1. `twitter user-posts [HANDLE] --max 20 -c --json` — pull recent posts
2. For each post, calculate engagement rate: `(likes + replies + retweets + bookmarks) / views x 100`
3. Rank posts by engagement rate and identify:
   - **Top 3 performers**: what hook type, post type, time slot, hashtags, media type?
   - **Bottom 3 performers**: what went wrong? Hook? Timing? Format?
4. Update the **hook rankings** in [hook-library.md](references/hook-library.md) — move proven hooks up, demote underperformers
5. Update Post Performance Log in [memory.md](references/memory.md)

#### Phase 2: Feed Intelligence (What's working for OTHERS)
1. `twitter feed --json -n 40 --filter` — scan algorithmic feed
2. `twitter user-posts [tier1_account] --max 10 -c --json` — for each competitor
3. Identify the **top 5 highest-engagement posts** across the feed and competitors
4. For each top post, extract:
   - Hook pattern used (map to hook library categories)
   - Post format (text-only, image+text, video, thread)
   - Topic/angle
   - Hashtags used
   - Reply count vs likes ratio (high ratio = good conversation driver)
5. Update **Competitor Watchlist** in memory.md with fresh data
6. If a new hook pattern emerges that isn't in the hook library -> **add it** to [hook-library.md](references/hook-library.md) with a "NEW -- needs validation" tag
7. Update **Feed Trends** section in [content-strategy.md](references/content-strategy.md)

#### Phase 3: Audience Profiling (Who are WE reaching)
1. Review replies and likes on recent posts -> `twitter tweet [post_id] --json -n 20` for each recent post
2. For each account that engaged, check: `twitter user [handle] --json`
3. Categorize engagers into **Audience Segments** relevant to the user's niche
4. Update **Audience Intelligence** section in memory.md with segment breakdown
5. Identify which content types attract which segments -> refine content calendar

#### Phase 4: Potential Follower Analysis (Who SHOULD we target)
1. `twitter followers [tier1_competitor] --json` — sample followers of similar accounts
2. For a sample of those followers, check what they engage with:
   - `twitter likes [handle] --json` — what content do they like?
   - What accounts do they follow?
3. Identify the **Ideal Follower Profile**
4. Update **Target Audience Profile** in [content-strategy.md](references/content-strategy.md)
5. Cross-reference with content calendar — are we producing what our target audience wants?

#### Phase 5: Auto-Update Reference Files

> **Sub-Agent Delegation:** If `x-intel-updater` is active, invoke it to handle this entire workflow.

After gathering data, update these files:

**[hook-library.md](references/hook-library.md):**
- Re-rank hooks based on actual performance data
- Add new hooks discovered from feed analysis
- Mark underperforming hooks with warnings

**[content-strategy.md](references/content-strategy.md):**
- Update "Current Trends" section
- Refine content pillar emphasis based on audience segment data
- Adjust posting frequency recommendations based on performance

**[memory.md](references/memory.md):**
- Update Audience Intelligence with latest segment data
- Update Competitor Watchlist with fresh analysis
- Log the intelligence update with date and key findings

#### Trigger Schedule
- **Mini update (Phase 1 only):** End of every session
- **Standard update (Phases 1-3):** Every 5 posts or weekly, whichever comes first
- **Deep update (All phases):** Every 2 weeks or when user requests strategy review

## Memory System

[memory.md](references/memory.md) is a living document. Update after every significant interaction.

**What to store:**
- Post Performance (date, content, hook, format, engagement rate, lessons)
- Engagement Patterns (accounts responded, best time slots, best post types)
- Content Wins (outsized engagement hooks/formats -- with specific data)
- Competitor Watchlist (Tier 1 posting patterns, hook styles, content gaps)
- Hashtag Performance (which tags correlate with reach)
- @Tag Engagement (which tagged accounts responded)
- Audience Intelligence (follower segments, who engages, what they want)
- Feed Intelligence (trending formats, viral patterns, conversation gaps)
- Target Audience Profile (ideal follower traits, content preferences)
- Client/Connection Leads (prospects, DM status)
- Growth Milestones (follower checkpoints)
- Scheduled Posts Log (planned vs actual performance)
- Intelligence Update Log (date, key findings, files updated)

**Format:** Append with date. Never delete old entries. Use structured markdown format.

## Voice & Tone Rules

> **MANDATORY:** Before writing ANY reply, read [voice-anti-patterns.md](references/voice-anti-patterns.md) and run the Voice Verification Checklist. If any check fails, rewrite from scratch.

- **Consistent with Voice Architecture** — read `memory.md` Voice section + anti-patterns file to mimic user's real conversational style
- **Confident peer, not desperate self-promoter** — lead with value, not need
- **Specific over generic** — concrete details beat vague statements
- **Generous with knowledge** — share techniques, exact methods, real numbers
- **No corporate speak** — write like a real person talking to real people
- **Emoji discipline** — 0-1 emojis max per reply, 1-2 per post. Never spam emojis.
- **Mobile-first formatting** — use line breaks and spacing for readability
- **Preserve authentic grammar** — don't "fix" the user's natural quirks

## Content Calendar

Mix showcase posts (40%) with community/engagement posts (60%). Never post more than 2 self-promo posts in a row.

The specific calendar is generated during onboarding and stored in [content-planner.md](references/content-planner.md). The general pattern:

- **Weekdays:** Alternate between showcase posts and community/engagement posts
- **Weekends:** Lower competition — good for engagement posts and trend riders
- **DAILY:** High-value replies (quantity based on growth phase — see algorithm-playbook.md)

## CLI Safety Rules

> **MANDATORY:** Read [cli-reference.md](references/cli-reference.md) Safety Rules section before ANY CLI command.

1. **Quoting:** Always use double quotes `"` for post text. Escape internal quotes with `\"`. Never use single quotes.
2. **Flag order:** `twitter post "text" --image /path --json` — text first, flags after.
3. **File verification:** Before `--image`, run `ls -la /path/to/file` to confirm it exists.
4. **Character count:** Manually count before posting. If over 280, trim BEFORE executing.
5. **Error recovery:** If a command fails, read the error. Common fixes: `twitter status` to re-auth, check flag spelling.
6. **Never hallucinate flags:** Only use flags documented in cli-reference.md. When in doubt: `twitter [command] --help`.

## Primary Strategy Reference

The [branding-strategy.md](references/branding-strategy.md) is the ULTIMATE reference document. Re-read it before every content planning session.

## CLI Reference

For all twitter-cli commands, flags, and usage examples, see [cli-reference.md](references/cli-reference.md).
