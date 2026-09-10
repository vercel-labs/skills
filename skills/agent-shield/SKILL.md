---
name: agent-shield
description: Security scanner for AI agent skills, MCP servers, and plugins. Use when users want to check if a skill, MCP server, or plugin is safe before installing. Scan for backdoors, data exfiltration, prompt injection, tool poisoning, and supply chain attacks. Activate when users mention "security scan", "is this safe", "check for backdoors", "scan this plugin", "MCP security", or want to verify a skill before installation.
---

# AgentShield — Security Scanner

Scan AI agent skills, MCP servers, and plugins for security vulnerabilities before installing them.

## When to Use This Skill

Use this skill when the user:

- Wants to check if a skill or MCP server is safe before installing
- Asks "is this plugin safe?" or "scan this for security issues"
- Wants to audit a project for backdoors, data exfiltration, or prompt injection
- Needs to run security CI on agent-related code
- Mentions MCP security, tool poisoning, or supply chain attacks

## Quick Start

```bash
# Scan any skill, MCP server, or plugin
npx @elliotllliu/agent-shield scan ./path/to/skill/

# Scan with JSON output
npx @elliotllliu/agent-shield scan ./path/ --json

# Scan a GitHub repo
npx @elliotllliu/agent-shield scan https://github.com/user/mcp-server

# Scan a Dify plugin archive
npx @elliotllliu/agent-shield scan ./plugin.difypkg

# Fail CI if score below threshold
npx @elliotllliu/agent-shield scan ./path/ --fail-under 70
```

## What It Detects

30 security rules across 5 dimensions:

### 🔴 Code Execution (30% weight)
- `eval()`/`exec()` with dynamic input
- Command injection, reverse shells
- Crypto mining

### 🟠 Data Safety (25% weight)
- Cross-file data exfiltration paths
- Credential/secret theft
- Sensitive file reads (SSH keys, .env)

### 🟡 Prompt Injection & Tool Poisoning (20% weight)
- Multi-language prompt injection (8 languages)
- Description-code integrity mismatch
- Tool shadowing attacks

### 🔵 Supply Chain (15% weight)
- Typosquatting (fake package names)
- Code obfuscation
- Hidden files and suspicious post-install scripts

### 🟢 Code Quality (10% weight)
- Weak crypto, SSRF risks
- Input validation gaps

## Scoring System (v2)

AgentShield uses 5-dimension weighted scoring with diminishing returns:

| Grade | Score | Meaning |
|-------|-------|---------|
| ✅ A | 90-100 | Safe to install |
| 🟡 B | 75-89 | Low risk, worth reviewing |
| 🟠 C | 60-74 | Medium risk, review before use |
| 🔴 D | 40-59 | High risk, not recommended |
| ⛔ F | 5-39 | Critical, do not install |

Same-type findings use diminishing penalties (×0.5 decay). Bonus points for security best practices (SECURITY.md, LICENSE, TypeScript, etc.).

## Key Features

- **AST taint tracking** — real code flow analysis, not regex
- **Cross-file analysis** — traces data from credential reads to HTTP exfiltration
- **Kill chain detection** — 5-stage attack model
- **100% offline** — your code never leaves your machine
- **Zero install** — runs via `npx`
- **0% false positive rate** at high severity

## Links

- 📦 [npm](https://www.npmjs.com/package/@elliotllliu/agent-shield)
- 🔗 [GitHub](https://github.com/elliotllliu/agent-shield)
- 📖 [Integration Guide](https://github.com/elliotllliu/agent-shield/blob/main/docs/integration-guide.md)
