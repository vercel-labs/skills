# Security Patterns

## False Positive Examples
```go
// NOT a secret — test fixture
const testAPIKey = "sk-test-abc123"

// NOT an injection — parameterized query
db.Query("SELECT * FROM users WHERE id = $1", userID)

// NOT dangerous — controlled use
import "os/exec"  // used only in CLI tool, not exposed
```

## Common Vulnerability Classes
| Class | Example | Detection |
|-------|---------|-----------|
| Hardcoded secrets | `apiKey = "sk-..."` | grep patterns |
| SQL injection | `fmt.Sprintf("WHERE id='%s'", input)` | grep concat queries |
| Command injection | `exec("rm " + filename)` | grep shell commands |
| Path traversal | `os.Open("/data/" + userInput)` | grep file ops |
| Insecure crypto | `md5.Sum()` | grep weak hashes |

## Output Template
```markdown
## Security Scan: {scope}
### Summary
- Secrets: 0 | Injection: 0 | Dangerous APIs: 1 (MEDIUM)
### Issues
# MEDIUM: exec() in cli/tool.go:42
- Pattern: `exec.Command("rm", "-rf", dir)` → Fix: use os.RemoveAll(dir) instead
```
