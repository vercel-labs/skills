# Twitter CLI Reference

All operations use the `twitter` command (installed via `uv tool install twitter-cli`). Do not hallucinate flags -- use only what is documented here.

## CLI Safety Rules (READ BEFORE EVERY COMMAND)

These rules prevent the most common agent tool-call failures:

### Quoting & Escaping
- **Always use double quotes** `"` for post text arguments. NEVER use single quotes `'`.
- **Escape internal double quotes** with `\"`. Example: `twitter post "Hot take: \"CSS is enough\" is wrong" --json`
- **Newlines in post text:** Use `\n` for line breaks. Example: `twitter post "Line one\n\nLine two" --json`
- **Special characters:** `$`, `` ` ``, `!` can cause shell expansion. Escape with `\` if needed.

### Pre-Flight Checks (before every post/reply)
1. **Count characters first.** If the text is >280 characters, trim BEFORE executing. Don't execute and hope.
2. **Verify media files exist.** Before using `--image`, run: `ls -la /path/to/file` -- if it doesn't exist, the command will fail silently.
3. **Verify authentication.** If any command returns an auth error, run `twitter status` to check session.

### Command Structure
- **Flag order:** Text argument comes FIRST, then flags. Correct: `twitter post "text" --image /path --json`
- **JSON output:** Always add `--json` flag when parsing results. Never parse table output.
- **Compact mode:** Add `-c` when fetching large result sets to save context tokens.

### Error Recovery
| Error | Fix |
|-------|-----|
| Auth/cookie error | Run `twitter status`. If expired, user must re-login in browser. |
| Flag not recognized | Remove the flag. Check this file for valid flags. Run `twitter [command] --help`. |
| Media upload failed | Verify file path, format (.jpg/.png/.gif only for images), and file size (<15MB). |
| Rate limit | Wait 15 minutes. Reduce fetch volume. |
| Empty response | Check if `--json` flag is present. Try without `--filter`. |

### NEVER Do
- Invent flags not listed in this document
- Use `--video` flag (doesn't exist -- video uses `--image` flag with .mp4)
- Post without verifying character count
- Chain multiple `twitter` commands with `&&` without checking each one succeeded
- Use single quotes for text arguments

## Fetching Data

| Command | Usage | Key Flags |
|---------|-------|-----------|
| **Feed** | `twitter feed --json -n 30` | `--type for-you\|following`, `--filter`, `-o file.json` |
| **Search** | `twitter search "query" --json` | `--type top\|latest\|photos\|videos`, `--from USER`, `--since YYYY-MM-DD`, `--min-likes N`, `--has media\|images\|videos`, `--exclude retweets\|replies`, `-n MAX` |
| **User Posts** | `twitter user-posts HANDLE --max 10 --json` | `-o file.json`, `--full-text` |
| **User Profile** | `twitter user HANDLE --json` | -- |
| **Tweet + Replies** | `twitter tweet TWEET_ID --json` | `-n MAX` replies |
| **Bookmarks** | `twitter bookmarks --json` | -- |
| **Likes** | `twitter likes HANDLE --json` | -- |

### Compact Mode
Add `-c` (or `--compact`) to any fetch command to reduce JSON output size -- useful for saving context tokens when processing large result sets.

## Posting & Replying

```bash
# Standard post (text only)
twitter post "Post text here" --json

# Post with media (up to 4 images)
twitter post "Post text here" --image /path/to/media.jpg --json
twitter post "Gallery" -i a.png -i b.png -i c.jpg --json

# Reply to a tweet
twitter reply TWEET_ID "Reply text" --json

# Reply with media
twitter reply TWEET_ID "Reply text" --image /path/to/screenshot.png --json

# Quote tweet
twitter quote TWEET_ID "Commentary text" --json

# Quote with media
twitter quote TWEET_ID "Commentary" --image /path/to/img.png --json

# Delete a tweet
twitter delete TWEET_ID
```

## Engagement Actions

```bash
twitter like TWEET_ID
twitter unlike TWEET_ID
twitter retweet TWEET_ID
twitter unretweet TWEET_ID
twitter bookmark TWEET_ID
twitter unbookmark TWEET_ID
twitter follow HANDLE
twitter unfollow HANDLE
```

## Advanced Search Examples

```bash
# Posts from a specific user about a topic
twitter search "topic" --from username --json

# High-engagement posts in niche
twitter search "niche topic" -t Top --min-likes 50 --json

# Recent posts with media
twitter search "topic" -t Latest --has media -n 20 --json

# Posts since a specific date
twitter search "topic" --since 2026-01-01 --json

# Lead hunting (adapt queries to your niche)
twitter search "looking for" "your service" -t Latest -n 15 --json
twitter search "need a" "your role" -t Latest -n 15 --json
twitter search "hiring" "your skill" -t Latest -n 15 --json
```

## Output Formats
- `--json` -- JSON output (recommended for parsing)
- `--yaml` -- YAML output
- `--full-text` -- Show full tweet text in table mode

## Media Attachment Rules
- The `--image` / `-i` flag supports image files (JPG, PNG, GIF)
- Up to 4 images per post/reply/quote
- Videos are attached via the same `--image` flag (MP4 format)
- Media paths must be absolute or relative to current directory
