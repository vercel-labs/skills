# ask_human.md — async human-↔-agent comm channel

> Adopted convention: [ask-human-mcp](https://github.com/masony817/ask-human-mcp) by masony817 (MIT, 150★).
>
> **Agents write questions to this file. The operator answers by replacing `answer: PENDING` inline. The agent re-reads and continues.** Q blocks are never deleted after they're answered — this file is the audit trail of every decision the operator was asked to make and how they decided.

## How to use this file

### As an agent

Generate a Q-id with `openssl rand -hex 4`. Append a block at the **bottom** of the `## Questions` section using the canonical format below. Then do non-blocking work until the operator answers (or queue a polite reminder via `ask-human-mcp --timeout <seconds>` if you've installed the file-watching daemon).

```markdown
### Q<8-char-hex-id>
ts: YYYY-MM-DD HH:MM
q: <one-paragraph question — specific, no preamble>
ctx: <2-3 sentences: what you're working on, what file/PR/task, why you can't decide alone>
answer: PENDING
```

### As the operator

Find any `answer: PENDING` line. Replace `PENDING` with your decision. Done. The agent that asked will pick up the change on its next file read (or instantly if the `ask-human-mcp` daemon is running). Optionally add `decided: YYYY-MM-DD HH:MM` on a new line under `answer:` for the audit trail.

If the question is unclear, ambiguous, or asks for something you'd rather not decide: write `answer: <your concern, or "rephrase">` and the agent will iterate.

### When to ask vs. when to decide

**Ask** — irreversible decisions, choices that cross strategic moats, names of people/teams/products, private-knowledge gaps (which Slack channel, which Jira project, which API key), anything that would force a doc rewrite if wrong.

**Decide** — reversible choices, established repo conventions, routine implementation details. Operator time is the scarcest resource; asking about a reversible choice is a tax on it.

### Installing the file-watching daemon (optional but recommended)

```bash
pipx install ask-human-mcp
# Then add to .cursor/mcp.json or .claude/mcp.json:
#   { "mcpServers": { "ask-human": { "command": "ask-human-mcp" } } }
```

The daemon watches this file, unblocks the asking agent the instant `PENDING` is replaced, and supports concurrent questions / size limits / file rotation. See the [ask-human-mcp README](https://github.com/masony817/ask-human-mcp) for the full option list.

## Anchor

- The global agentbrew shared rule "Async human comms — ask_human.md" (`~/.config/agentbrew/shared-rules.md`) — the convention this file instantiates.
- The agentbrew catalog `ask-human` MCP server entry — the installable file-watching daemon.
- Rule #1 (don't reinvent the wheel) — we adopted `ask-human-mcp` rather than rolling our own.

## Questions

<!--
  Append new blocks below this line. Newest Qs go at the BOTTOM.
  Never delete a Q after it's answered — they are the audit trail.
  Format spec is in the "How to use this file" section above.
-->

<!-- No entries yet. -->
