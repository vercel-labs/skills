---
name: vector-cli
description: Complete guide to using the Vector CLI (vcli) — a command-line interface for Vector, an open-source project management platform. Covers authentication, organizations, teams, projects, issues, documents, roles, notifications, and scripting workflows.
---

# Vector CLI

Use this skill when a user asks how to use the Vector CLI (`vcli`), needs command examples, or wants to manage their Vector workspace from the terminal.

Vector is an open-source project management platform (similar to Linear). The CLI gives you full access to organizations, teams, projects, issues, documents, roles, notifications, and more.

## Installation

```bash
# npm
npm install -g @rehpic/vcli

# pnpm
pnpm add -g @rehpic/vcli

# yarn
yarn global add @rehpic/vcli

# bun
bun add -g @rehpic/vcli
```

Requires Node.js >= 20.19.0.

After installing, the `vcli` binary is available globally.

## Global Options

Every command accepts these flags:

| Flag | Description |
|---|---|
| `--app-url <url>` | Vector app URL (or set `NEXT_PUBLIC_APP_URL`) |
| `--convex-url <url>` | Convex deployment URL (or set `NEXT_PUBLIC_CONVEX_URL`) |
| `--org <slug>` | Organization slug override |
| `--profile <name>` | CLI profile (default: `default`) |
| `--json` | Output as JSON for scripting |

## Core Concepts

### Profiles

Profiles let you keep separate CLI sessions on one machine. Each profile stores its session at `~/.vector/cli-<profile>.json`.

```bash
# Use a named profile
vcli --profile work auth login you@example.com --password 'secret'
vcli --profile staging --app-url https://staging.example.com auth whoami
```

### Organization Context

Most commands require an active organization. You can either:

- Pass `--org <slug>` on every command, or
- Set it once with `vcli org use <slug>`

### Member Resolution

Anywhere a `<member>` argument is needed, you can use an email address, username, or user ID.

### Date Format

Dates use ISO format: `YYYY-MM-DD` or full ISO 8601 datetime.

---

## Authentication

```bash
# Sign up
vcli auth signup --email you@example.com --username yourname --password 'secret'

# Log in (accepts email or username)
vcli auth login you@example.com --password 'secret'

# Check current session
vcli auth whoami

# Log out
vcli auth logout
```

`whoami` shows the current user, org memberships, and active org.

---

## Organizations

```bash
# List your organizations
vcli org list

# Create a new org
vcli org create --name "Acme" --slug acme

# Set active org
vcli org use acme

# Show active org
vcli org current

# Update org details
vcli org update acme --name "Acme Corp" --new-slug acme-corp

# Get org statistics
vcli org stats acme

# Upload org logo
vcli org logo acme --file ./logo.png

# List members (includes roles)
vcli org members acme

# Invite a member
vcli org invite acme --email teammate@example.com --role admin

# Change a member's role
vcli org member-role teammate@example.com --role admin

# Remove a member
vcli org remove-member teammate@example.com

# List pending invites
vcli org invites acme

# Revoke an invite
vcli org revoke-invite <inviteId>
```

---

## Invitations

Manage invitations from the invited user's perspective:

```bash
# List your pending invitations
vcli invite list

# Accept an invite
vcli invite accept <inviteId>

# Decline an invite
vcli invite decline <inviteId>
```

---

## Teams

```bash
# List teams
vcli team list

# Get team details
vcli team get eng

# Create a team
vcli team create --key eng --name "Engineering" --description "Core engineering"

# Update a team
vcli team update eng --name "Platform Engineering" --icon code --color "#3B82F6"

# Delete a team
vcli team delete eng

# Manage members
vcli team members eng
vcli team add-member eng alice@example.com --role lead
vcli team remove-member eng alice@example.com
vcli team set-lead eng alice@example.com
```

---

## Projects

```bash
# List projects (optionally filter by team)
vcli project list --team eng

# Get project details
vcli project get api

# Create a project
vcli project create --key api --name "API" --team eng --status "In Progress"

# Update a project
vcli project update api --description "Backend API" --due-date 2025-06-01

# Delete a project
vcli project delete api

# Manage members
vcli project members api
vcli project add-member api bob@example.com --role lead
vcli project remove-member api bob@example.com
vcli project set-lead api bob@example.com
```

Clear optional fields with `--clear-*` flags (e.g., `--clear-team`, `--clear-due-date`).

---

## Issues

### CRUD

```bash
# List issues (filter by project and/or team)
vcli issue list --project api --team eng --limit 50

# Get issue details
vcli issue get API-1

# Create an issue
vcli issue create \
  --title "Ship CLI" \
  --project api \
  --team eng \
  --priority "High" \
  --assignee alice@example.com \
  --state "In Progress" \
  --due-date 2025-04-01

# Update an issue
vcli issue update API-1 --title "Ship CLI v2" --priority "Urgent"

# Delete an issue
vcli issue delete API-1
```

### Assignments

```bash
# Assign a member
vcli issue assign API-1 alice@example.com --state "In Progress"

# Unassign a member
vcli issue unassign API-1 alice@example.com

# List all assignments
vcli issue assignments API-1

# Replace all assignees at once
vcli issue replace-assignees API-1 alice@example.com,bob@example.com

# Manage individual assignments
vcli issue set-assignment-state <assignmentId> <state>
vcli issue reassign-assignment <assignmentId> bob@example.com
vcli issue remove-assignment <assignmentId>
```

### Other Issue Operations

```bash
# Set priority directly
vcli issue set-priority API-1 "High"

# Set time estimates per state
vcli issue set-estimates API-1 --values "todo=4,in_progress=8"

# Add a comment
vcli issue comment API-1 --body "Looks good, shipping tomorrow"

# Create a sub-issue
vcli issue create --title "Sub-task" --parent API-1 --project api
```

---

## Documents

```bash
# List documents
vcli document list --folder-id <folderId>

# Get document details
vcli document get <documentId>

# Create a document
vcli document create \
  --title "Architecture Overview" \
  --content "# Overview\n\nThis document covers..." \
  --team eng \
  --project api

# Update a document
vcli document update <documentId> --title "Updated Title" --content "New content"

# Move to a folder
vcli document move <documentId> --folder-id <folderId>

# Delete a document
vcli document delete <documentId>
```

---

## Folders

```bash
# List folders
vcli folder list

# Create a folder
vcli folder create --name "Engineering Docs" --description "Internal docs"

# Update a folder
vcli folder update <folderId> --name "Eng Docs"

# Delete a folder
vcli folder delete <folderId>
```

---

## Roles (RBAC)

```bash
# List organization roles
vcli role list

# Get role details and permissions
vcli role get "Engineering Lead"

# Create a custom role
vcli role create \
  --name "Triage Lead" \
  --permissions "issue:create,issue:update,issue:assign" \
  --description "Can triage and assign issues"

# Update a role
vcli role update "Triage Lead" \
  --name "Triage Manager" \
  --permissions "issue:create,issue:update,issue:assign,issue:delete"

# Assign/unassign roles to members
vcli role assign "Triage Lead" alice@example.com
vcli role unassign "Triage Lead" alice@example.com
```

---

## Notifications

```bash
# View inbox
vcli notification inbox --filter unread --limit 10

# Get unread count
vcli notification unread-count

# Mark as read
vcli notification mark-read <recipientId>
vcli notification mark-all-read

# Archive a notification
vcli notification archive <recipientId>

# View/update notification preferences
vcli notification preferences
vcli notification set-preference assignments --in-app true --email true --push false

# Manage push subscriptions
vcli notification subscriptions
vcli notification remove-subscription <subscriptionId>
```

---

## Workspace Discovery

### Reference Data

Get all workspace metadata (states, priorities, statuses, members, teams, projects) in one call:

```bash
vcli refdata acme
```

### Global Search

```bash
vcli search "billing" --limit 10
```

Searches across issues, teams, projects, and documents.

### Permission Checks

```bash
# Check a single permission
vcli permission check issue:create --team eng --project api

# Check multiple permissions at once
vcli permission check-many "issue:create,issue:update,project:delete" --team eng
```

### Icon Search

```bash
vcli icons "check" --limit 5
```

Searches Lucide icons by name.

---

## Activity Feed

```bash
vcli activity project api --limit 10
vcli activity team eng --limit 10
vcli activity issue API-1 --limit 10
vcli activity document <documentId> --limit 10
```

All activity commands support `--cursor` for pagination.

---

## Issue States, Priorities, and Project Statuses

Customize your workspace metadata:

```bash
# States (for issues)
vcli state list
vcli state create --name "In Review" --position 3 --type in_progress --color "#F59E0B" --icon eye
vcli state update <state> --name "Reviewing" --position 3 --type in_progress --color "#F59E0B"
vcli state delete <state>
vcli state reset  # Reset to defaults

# Priorities (for issues)
vcli priority list
vcli priority create --name "Critical" --weight 5 --color "#EF4444" --icon alert-triangle
vcli priority update <priority> --name "Blocker" --color "#DC2626"
vcli priority delete <priority>
vcli priority reset  # Reset to defaults

# Statuses (for projects)
vcli status list
vcli status create --name "On Hold" --position 3 --type planned --color "#6B7280" --icon pause
vcli status update <status> --name "Paused" --position 3 --type planned --color "#6B7280"
vcli status delete <status>
vcli status reset  # Reset to defaults
```

---

## Platform Admin

Requires platform-admin privileges:

```bash
# Branding
vcli admin branding
vcli admin set-branding --name "My Platform" --theme-color "#1E40AF" --logo ./logo.png

# Signup policy
vcli admin signup-policy
vcli admin set-signup-policy --blocked "spam.com,trash.com" --allowed "company.com"

# Sync disposable email domains
vcli admin sync-disposable-domains
```

---

## Common Workflows

### First-Run Setup

```bash
vcli auth signup --email you@example.com --username you --password 'secret'
vcli org create --name "Acme" --slug acme
vcli org use acme
vcli team create --key eng --name "Engineering"
vcli project create --key api --name "API" --team eng
vcli issue create --title "First issue" --project api --team eng
vcli auth whoami
```

### Invite and Onboard a Teammate

```bash
# You (org admin)
vcli org invite acme --email teammate@example.com --role member

# Teammate
vcli auth signup --email teammate@example.com --username teammate --password 'secret'
vcli invite list
vcli invite accept <inviteId>
vcli org use acme
```

### Discover Workspace Before Scripting

```bash
vcli refdata acme                          # See all states, priorities, teams, projects
vcli search --org acme "billing"           # Find entities
vcli permission check issue:create         # Verify permissions
```

### Script With JSON Output

```bash
# Pipe to jq for structured processing
vcli --json issue list --org acme | jq '.[].title'
vcli --json notification inbox --filter unread | jq 'length'
```

Tips for scripting:
- Always use `--json` for parseable output
- Always use explicit `--profile` and `--org` flags
- Use `refdata` to discover valid keys before mutations

---

## Troubleshooting

| Error | Fix |
|---|---|
| `Not logged in` | Run `vcli auth login` or `vcli auth signup` |
| `app URL is required` | Pass `--app-url <url>`, set `NEXT_PUBLIC_APP_URL`, or log in once with `--app-url` so the profile stores it |
| `Organization slug is required` | Pass `--org <slug>` or run `vcli org use <slug>` |
| Auth errors against wrong server | Verify `--app-url` matches the running app origin |
| Convex connection errors | Check `NEXT_PUBLIC_CONVEX_URL` or pass `--convex-url` |
| Validation errors on create/update | Check keys, slugs, and required options. Use `vcli refdata` to discover valid values first |
