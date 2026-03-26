---
name: draftmachine
description: >
  Use this skill whenever the user wants to send a batch of personalized emails, do a mail merge,
  or draft outreach emails for multiple recipients using Gmail. DraftMachine is a CLI tool that
  creates Gmail drafts (not sends them) from a CSV recipient list and a Markdown/Jinja2 template,
  so the user can review everything in Gmail before sending. Trigger this skill for requests like
  "send personalized emails to my contacts", "do a mail merge to Gmail", "draft outreach emails",
  "email everyone on this list", "create Gmail drafts from a spreadsheet", or any time the user
  wants to compose similar emails to multiple people at once. Also trigger it if the user asks
  to use draftmachine directly.
---

# DraftMachine — Gmail Mail Merge via CLI

DraftMachine creates Gmail **drafts** from a CSV list + Markdown template. Drafts land in the
user's Gmail Drafts folder for review before sending — nothing gets sent automatically.

## Step 1 — Check installation

```bash
draftmachine --version
```

If the command is not found, install it:

```bash
pip install draftmachine
```

## Step 2 — Check Gmail credentials

Two files must exist:

| File | Purpose |
|------|---------|
| `~/.draftmachine/client_secret.json` | OAuth app credential downloaded from Google Cloud Console |
| `~/.draftmachine/creds.json` | Cached OAuth token (created automatically by `draftmachine setup`) |

Check for them:

```bash
ls ~/.draftmachine/
```

### If `client_secret.json` is missing — walk the user through GCP setup

Tell the user they need to do a one-time setup to connect DraftMachine to their Gmail:

1. Go to [Google Cloud Console](https://console.cloud.google.com/) and create a project (or pick an existing one).
2. Navigate to **APIs & Services → Enable APIs & Services** and enable the **Gmail API**.
3. Go to **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
4. Choose **Desktop app** as the application type.
5. Click **Download JSON** and save the file to `~/.draftmachine/client_secret.json`.
   - You may need to `mkdir ~/.draftmachine` first.
6. Run `draftmachine setup` — this opens a browser window, asks for Gmail permission (draft-only scope), and saves the token.

### If `client_secret.json` exists but `creds.json` is missing

Run `draftmachine setup` to complete the OAuth consent flow.

### If both files exist

Credentials are ready — skip to Step 3.

## Step 3 — Gather the recipient list and compose the template

### CSV file

The CSV needs at minimum an email column (default column name: `email`). Any other columns become
available as template variables. Ask the user what data they have. If they paste data in the
conversation, write it to a `.csv` file.

Example:
```csv
email,first_name,company
jane@example.com,Jane,Acme Corp
bob@example.com,Bob,
```

### Markdown template

The template is a `.md` file with a YAML frontmatter block for the subject line and a Markdown
body using [Jinja2](https://jinja.palletsprojects.com/) syntax. Ask the user what the email
should say, then write the template.

```markdown
---
subject: "Quick note for {{ first_name }}"
---
Hi {{ first_name }},

{% if company %}
I came across {{ company }} and thought you might find this useful.
{% endif %}

[Body of the message here]

Best,
[Sender name]
```

**Tips for good templates:**
- Use `{{ variable }}` to insert CSV column values.
- Wrap optional content in `{% if variable %}...{% endif %}` so missing values don't cause awkward blanks.
- The subject line supports Jinja2 too.
- Filters like `{{ first_name | title }}` and loops are supported.

## Step 4 — Preview before creating drafts

Always run `--preview` first. It renders the **first row only** to the terminal — no API calls, no
drafts created. This is a fast sanity check for template errors and formatting.

```bash
draftmachine send list.csv template.md --preview
```

If the rendered output looks right, proceed. If there are errors (undefined variables, broken
conditionals, etc.), fix the template and re-preview.

## Step 5 — Create the drafts

Once the preview looks good:

```bash
draftmachine send list.csv template.md
```

If the email address is in a column other than `email`, use `--to-column`:

```bash
draftmachine send list.csv template.md --to-column work_email
```

DraftMachine uses a **two-pass strategy**: it renders all rows first (aborting early if any row
has template errors), then creates all drafts via the Gmail API. This means it's all-or-nothing
per run — no partial draft batches on template errors.

## Step 6 — Report back

After the command completes, tell the user:
- How many drafts were created.
- That the drafts are in their Gmail Drafts folder, ready to review and send.
- A reminder to check for any rows that were skipped (DraftMachine warns about empty/missing
  `to` addresses in the terminal output).

## Error reference

| Error | Fix |
|-------|-----|
| `command not found: draftmachine` | `pip install draftmachine` |
| `No such file: client_secret.json` | Complete GCP + OAuth setup (Step 2) |
| `403 Forbidden` | OAuth token lacks correct scope — re-run `draftmachine setup` |
| `429 Too Many Requests` | Gmail API rate limit hit; DraftMachine retries 3× with backoff. If it persists, wait and re-run |
| `UndefinedError: '...' is undefined` | CSV column name in template doesn't match actual column header |
| Partial drafts on 429 | No resume; re-run the full command after a short wait (may create duplicates — delete extra drafts) |
