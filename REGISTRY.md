# Skills Registry API Spec

This document defines the API contract for a skills registry compatible with the `skills` CLI. Implementing this spec allows any self-hosted registry to work as a drop-in replacement for skills.sh by setting `SKILLS_API_URL`.

## Endpoints

### `GET /api/search`

Search for skills by keyword.

**Query parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| `q` | string | Search query. If omitted or empty, returns all skills. |
| `limit` | number | Maximum results to return (optional). |

**Response**

```json
{
  "query": "find-skills",
  "searchType": "fuzzy",
  "skills": [
    {
      "id": "vercel-labs/skills/find-skills",
      "skillId": "find-skills",
      "name": "find-skills",
      "installs": 1591220,
      "source": "vercel-labs/skills"
    }
  ],
  "count": 1,
  "duration_ms": 42
}
```

**Envelope fields**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `query` | string | no | The search query that produced these results. |
| `searchType` | string | no | Search strategy used (e.g. `"fuzzy"`, `"all"`). |
| `skills` | array | yes | Array of skill results. |
| `count` | number | no | Total number of results returned. |
| `duration_ms` | number | no | Time taken to execute the search in milliseconds. |

**Skill fields**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Canonical identifier for the skill. Recommended format: `{source}/{name}` (e.g. `vercel-labs/skills/find-skills`). Used as the URL path for the detail page. |
| `skillId` | string | no | Short skill name slug (e.g. `find-skills`). When present, the CLI uses this as the URL slug in preference to `id`. Self-hosted registries may set this to a different value than `name` (e.g. a full path slug). |
| `name` | string | yes | Display name of the skill. |
| `installs` | number | yes | Install count. Use `0` if not tracked. |
| `source` | string | yes | Repository source in `{org}/{repo}` format. |

### GET Skill Details

Returns detail for a single skill. Two URL forms are supported:

- `GET /{id}` — look up by the `id` field from a search result (e.g. `vercel-labs/skills/find-skills` or a UUID for registries that use opaque identifiers)
- `GET /{skillId}` — look up by the `skillId` field (e.g. `find-skills`, or a full path slug like `{source}/{name}` for self-hosted registries)

**Response**: the full skill record. Shape is registry-defined; the CLI does not currently consume this endpoint directly but links to it in terminal output.

### `GET /api/bundles/search`

Search for bundles — curated sets of skills defined by a `bundles/<name>/bundle.yaml` manifest in a repository. Used by `skills bundle search`. Uses semantic (vector) search when the query can be embedded, falling back to fuzzy text search otherwise — the same two-tier strategy as `GET /api/search`.

**Query parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| `q` | string | Search query. If omitted or empty, returns all bundles. |

**Response**

```json
{
  "query": "pr review",
  "searchType": "semantic",
  "bundles": [
    {
      "name": "pbi-to-pr-loop",
      "description": "Autonomous PBI → plan → review → implement → PR loop.",
      "source": "vercel-labs/skills",
      "version": "0.2.0",
      "installs": 0,
      "skills": ["skills/community/write-plan", "skills/community/review-plan", "skills/community/implement-plan"],
      "tags": ["delivery", "automation"]
    }
  ],
  "count": 1,
  "duration_ms": 8
}
```

**Envelope fields**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `bundles` | array | yes | Array of bundle results. |
| `query` | string | no | The search query that produced these results. |
| `searchType` | string | no | Search strategy used: `"semantic"`, `"fuzzy"`, or `"all"` (empty query). |
| `count` | number | no | Total number of results returned. |
| `duration_ms` | number | no | Time taken to execute the search in milliseconds. |

**Bundle fields**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Bundle name. Used to install the bundle via `skills bundle install {source}@{name}`. |
| `description` | string | no | Human-readable summary shown in search results. |
| `source` | string | no | Repository the bundle lives in, in `{org}/{repo}` format. When present, the CLI can print the exact `bundle install {source}@{name}` command. |
| `version` | string | no | Bundle manifest version (semver). |
| `installs` | number | no | Install count. Use `0` if not tracked. |
| `skills` | array | no | Member skill paths declared by the bundle (repo-relative, e.g. `skills/community/write-plan`). |
| `tags` | array | no | Discovery keywords for the bundle (e.g. from the bundle manifest's `tags`). Folded into search matching. |

A registry that does not implement this endpoint should return `404`; the CLI treats that as "bundle search not available" and still supports installing a known bundle by name.

## Self-hosting

Point the CLI at your registry by setting `SKILLS_API_URL`:

```bash
SKILLS_API_URL=https://skills.example.com npx skills find <query>
```

Both the search API calls and rendered detail URLs in terminal output will use this base URL.
