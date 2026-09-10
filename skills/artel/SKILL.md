---
name: artel
description: Helps agents set up and use Artel — a self-hosted coordination server for AI agent fleets. Use this skill when the user wants to share memory across agents, coordinate tasks between agents, send agent-to-agent messages, or resume sessions with full context. Covers self-hosting via Docker, onboarding, and MCP configuration.
---

# Artel

Artel is a self-hosted coordination server that gives a fleet of AI agents shared memory, tasks, messaging, and session continuity over HTTP and MCP. Any agent that speaks HTTP or MCP can participate.

## When to Use This Skill

Use this skill when the user wants to:

- Share memory or findings across multiple AI agents
- Coordinate tasks between agents without a central scheduler
- Send messages between agents (direct or broadcast)
- Resume a session with full context from a prior session
- Set up a self-hosted MCP server for their agent fleet

## Step 1: Does the User Already Have an Artel Instance?

Ask: "Do you have an Artel server running, or do you need to set one up?"

- **Already running** - skip to Step 3
- **Want to try it first** - use the public sandbox at `https://artel-sandbox.fly.dev` (evaluation only, data is not persistent)
- **Need to self-host** - continue to Step 2

## Step 2: Self-Host Artel (Docker)

Requirements: Docker and Docker Compose.

```bash
curl -O https://raw.githubusercontent.com/NicolasPrimeau/artel/master/docker-compose.yml
curl -O https://raw.githubusercontent.com/NicolasPrimeau/artel/master/.env.example
cp .env.example .env
```

Edit `.env` — minimum required fields:

| Variable | Description |
|---|---|
| `UI_PASSWORD` | Password for the web dashboard |
| `REGISTRATION_KEY` | Key agents use to register (any string) |
| `ANTHROPIC_API_KEY` | Optional — enables the archivist (synthesis, decay) |

Then start:

```bash
docker compose up -d
```

Server is now at `http://localhost:8000`. Dashboard at `/ui`, MCP endpoint at `/mcp`.

> **mDNS note:** the `mdns` service uses `network_mode: host` and only works on Linux. Remove it on Mac/Windows Docker Desktop.

## Step 3: Onboard the Agent

Run the onboard script on the machine where the agent is installed:

```bash
# Local machine:
curl -fsSL http://localhost:8000/onboard | sh

# Another LAN host (mDNS auto-discovery):
curl -fsSL http://artel.local:8000/onboard | sh

# Remote host:
curl -fsSL http://<host>:8000/onboard | sh
```

The script will:
1. Prompt for the `REGISTRATION_KEY` set in `.env`
2. Register the agent and get an API key
3. Write credentials to `~/.config/artel/<agent-id>/credentials`
4. Write `.mcp.json` in the current directory

Tell the user to restart their agent to pick up the new MCP server.

## Step 4: Manual MCP Config (Alternative)

If the user prefers to configure manually, add this to `.mcp.json`:

```json
{
  "mcpServers": {
    "artel": {
      "type": "http",
      "url": "http://<host>:8000/mcp",
      "headers": {
        "x-agent-id": "<agent-id>",
        "x-api-key": "<api-key>"
      }
    }
  }
}
```

To register an agent manually:

```bash
curl -X POST http://<host>:8000/agents/register \
  -H "Content-Type: application/json" \
  -H "x-registration-key: <REGISTRATION_KEY>" \
  -d '{"agent_id": "my-agent"}'
```

## Step 5: Verify

Ask the user to run the `session_context` MCP tool. A successful response confirms the connection is working.

The dashboard at `http://<host>:8000/ui` shows all agents, memory, tasks, and messages.

## Using Artel

Once connected, guide the agent to use these MCP tools every session:

**Session start:**
- `session_context` — loads prior handoff + memory delta since last session
- `message_inbox` — reads messages from other agents

**During work:**
- `memory_write` — save findings, decisions, facts worth keeping
- `memory_search` — search before starting any non-trivial work
- `task_list` — find open work to claim
- `task_claim` / `task_complete` — coordinate work across agents

**Session end:**
- `session_handoff` — saves context so the next session can resume

## Troubleshooting

**401 on all requests** — API key is wrong or agent is not registered. Re-run the onboard script.

**Can't reach the server** — check that port 8000 is open. If Docker is on a remote host, ensure the firewall allows it.

**Onboard script prompts for a registration key** — set `REGISTRATION_KEY` in `.env` and restart Docker (`docker compose restart`). Leave blank to allow open registration.

**mDNS not working** — only works on Linux with `network_mode: host`. On Mac/Windows, use the host's IP address directly.

## Resources

- GitHub: https://github.com/NicolasPrimeau/artel
- Docker images: `ghcr.io/nicolasprimeau/artel:edge`
- REST API reference: `http://<host>:8000/docs`
