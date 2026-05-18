---
name: tuskr
description: Interact with the Tuskr test management API. Activate when the user wants
  to list projects or test cases, create or inspect test runs, import JUnit XML results
  from CI, bulk-add test results, manage test suites, or do anything with Tuskr test
  management. Requires the tuskr-cli package (pipx install tuskr-cli).
---

# tuskr

Use this skill when the user wants to interact with Tuskr: browse projects, manage test cases, create or inspect test runs, import results, or anything involving the Tuskr test management platform.

## Prerequisite Check

Before any Tuskr operation, verify the CLI is available and configured:

```bash
tuskr config show
```

**If `command not found`:**
```bash
pipx install tuskr-cli
# or: pip install tuskr-cli
```

**If config missing:**
```bash
tuskr config set --token <TOKEN> --tenant-id <TENANT_ID>
```
Tokens are found at: Tuskr → Top Menu → User Profile Icon → API.

---

## Command Reference

### Config
```
tuskr config set --token TOKEN --tenant-id TENANT_ID
tuskr config show
tuskr config validate
```

### Projects
```
tuskr project list [--limit N] [--offset N] [--json]
tuskr project create --name NAME [--description D] [--json]
```

### Test Cases
```
tuskr case list [--project-id ID] [--limit N] [--offset N] [--json]
tuskr case create --name NAME --project-id ID [--json]
tuskr case upsert --file cases.json [--json]
tuskr case import --file cases.json [--json]
```

### Test Runs
```
tuskr run list [--project-id ID] [--limit N] [--json]
tuskr run create --name NAME --project-id ID [--json]
tuskr run results RUN_ID [--status passed|failed|untested] [--limit N] [--json]
tuskr run add-results --run-id RUN_ID --file results.json [--json]
tuskr run import-junit --run-id RUN_ID --project-id ID --file junit.xml [--json]
```

### Test Suites
```
tuskr suite list [--project-id ID] [--json]
```

---

## Common Patterns

### Find a project ID
```bash
tuskr project list --json
```
Extract `data.rows[].id` for use in follow-up commands.

### List all test cases in a project
```bash
tuskr case list --project-id <PROJECT_ID> --json
```

### Create a test run and get its ID
```bash
tuskr run create --name "Sprint 12 regression" --project-id <PROJECT_ID> --json
```
Capture `data.id` from the output.

### Import CI results from JUnit XML
```bash
tuskr run import-junit --run-id <RUN_ID> --project-id <PROJECT_ID> --file test-results.xml
```

### Bulk-add results (from JSON)
The results JSON file should be an array of result objects:
```json
[{"testCase": "<CASE_ID>", "status": "passed"}, ...]
```
```bash
tuskr run add-results --run-id <RUN_ID> --file results.json
```

### Check what failed in a run
```bash
tuskr run results <RUN_ID> --status failed --json
```

---

## Output Parsing

Always use `--json` when you need to extract a field for a follow-up command. Key fields by entity:

| Entity    | Key fields                       |
|-----------|----------------------------------|
| project   | id, name, status                 |
| test-case | id, name, project                |
| test-run  | id, name, status, project        |
| result    | id, testCase, status, assignedTo |
| suite     | id, name, project                |

All list responses return `data.rows` (array) and `data.count` (total). Use `--limit` and `--offset` for pagination.
