# Real Replies Archive

> **PURPOSE:** This file contains the user's actual replies word-for-word. The agent MUST read this file before drafting ANY reply to study the user's authentic voice, phrasing, and tone. This is NOT a summary -- these are exact quotes.
>
> **Populated during onboarding** by fetching the user's real replies via `twitter search "from:[HANDLE] filter:replies"`. New replies should be appended periodically.

---

## How This File Gets Populated

During onboarding, the agent runs:
```bash
twitter search "from:[HANDLE] filter:replies" -n 30 --json
```

The agent then organizes the replies into categories based on tone and content type. Categories vary per user but common ones include:

- **Technical / Product Replies** — replies about tools, code, technical topics
- **Casual / Conversational** — everyday chat, opinions, banter
- **Playful / Sarcastic** — humor, jokes, roasts
- **Helpful / Advisory** — giving advice, sharing knowledge
- **Self-Promo / Outreach** — mentioning own work, connecting
- **Storytelling / Personal** — sharing experiences, backstory
- **Feedback / Acknowledgment** — responding to praise, criticism

---

## Archived Replies

_[populated during onboarding -- the agent pastes real replies here organized by category]_

---

_Last updated: never_
_Next update: Run onboarding or manually run `twitter search "from:[HANDLE] filter:replies" -n 50 --json` and append new replies not already in this file._
