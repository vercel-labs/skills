---
name: trustless-work
description: Integrate Trustless Work Escrow-as-a-Service (EaaS) on Stellar/Soroban. Use when the user asks to "set up escrow", "integrate escrow payments", "build a milestone payment flow", "add USDC escrow", "use Trustless Work", or "write a Trustless Work integration". Covers REST API, @trustless-work/escrow SDK, @trustless-work/blocks UI components, XDR signing patterns, escrow lifecycle, roles, and trustlines.
metadata:
  author: trustless-work
  version: "1.2.0"
---

# Trustless Work

> Source of truth: https://docs.trustlesswork.com/trustless-work/
> Always consult this skill before writing or reviewing any Trustless Work integration.

---

## Scope of This Skill

This skill is exclusively for **Trustless Work integration review and assistance**. When reviewing a codebase:

- ✅ Flag issues related to Trustless Work: XDR signing patterns, role assignments, trustline setup, API usage, provider configuration, escrow lifecycle, etc.
- ❌ Do **NOT** flag or suggest fixes for general programming logic errors, UI bugs, type issues, or code quality problems that are unrelated to Trustless Work.
- ❌ Do **NOT** suggest refactors or improvements beyond what is necessary for a correct Trustless Work integration.

If a code problem is not caused by how Trustless Work is being used, leave it out of the review.

---

## What Is Trustless Work?

Trustless Work is **Escrow-as-a-Service (EaaS)** built on **Stellar's Soroban** smart contract platform. It enables non-custodial payment flows with milestones, approvals, and dispute resolution — without writing your own smart contracts.

**Three integration paths:**
- **API** — REST endpoints, usable from any backend or frontend
- **SDK** (`@trustless-work/escrow`) — React/Next.js hooks that wrap the API
- **Blocks** (`@trustless-work/blocks`) — Pre-built React UI components (forms, tables, dialogs)

---

## Escrow Types

| Type | Milestones | Releases | Best For |
|------|------------|----------|----------|
| **Single-Release** | Multiple | One payout for all milestones | Simple jobs, deposits, one-off payments |
| **Multi-Release** | Multiple | One payout per milestone | Grants, projects, milestone billing |

Choose the type at deployment time. It cannot be changed after the escrow is created.

---

## Roles (9 total)

Every escrow has a `roles` object. Each role is a **Stellar public address (G…)**. Signing authority follows the role — not the platform.

| Role | Capabilities | Notes |
|------|-------------|-------|
| **Issuer** | Deploys the escrow | Indexed only — no fund control |
| **Funder** | Deposits funds | Cannot move funds once deposited |
| **Service Provider** | Updates milestone `status` text; can raise disputes | Cannot approve or release |
| **Approver** | Sets `approved: true` on milestones; can raise disputes | Required for fund release |
| **Release Signer** | Executes payout once all milestones approved | Two modes: Payout (platform sends) or Claim (receiver self-signs) |
| **Receiver** | Receives released funds | In multi-release, each milestone can have its own receiver |
| **Platform Address** | Updates metadata before funding; collects platform fees automatically | Can optionally serve as Dispute Resolver or Release Signer |
| **Dispute Resolver** | Arbitrates conflicts; re-routes funds | Decisions are final and on-chain |
| **Observer** | Read-only; no lifecycle involvement | Coming soon |

**Principle of Least Privilege:** No single party controls the full fund flow alone.

---

## Escrow Lifecycle (6 Phases)

```
1. Initiation
   └─ Platform/Issuer deploys contract with roles, milestones, token, fees
   └─ Returns: unsigned XDR → sign as Issuer → submit

2. Funding
   └─ Funder deposits capital into the escrow contract
   └─ Returns: unsigned XDR → sign as Funder → submit
   └─ PREREQUISITE: Funder must have a trustline for the escrow asset

3. Change Milestone Status
   └─ Service Provider updates the milestone status text (free-form string)
   └─ Example statuses: "In Progress", "Under Review", "Delivered"
   └─ Returns: unsigned XDR → sign as Service Provider → submit

4. Approval
   └─ Approver sets approved: true on a milestone
   └─ IRREVERSIBLE — no undo on-chain
   └─ Returns: unsigned XDR → sign as Approver → submit
   └─ Alternatively: Approver raises a dispute instead of approving

5. Release
   └─ Release Signer executes payout once all required milestones are approved
   └─ Returns: unsigned XDR → sign as Release Signer → submit
   └─ For multi-release: specify milestoneIndex

6. Dispute Resolution (if needed)
   └─ Dispute Resolver arbitrates
   └─ Can re-route funds between Approver and Service Provider
   └─ Returns: unsigned XDR → sign as Dispute Resolver → submit
```

---

## Escrow Schema — Full Data Models

> These schemas represent the stored escrow object returned by the API. Use them as the reference for all payloads and form field types.

### Single-Release Escrow

```typescript
{
  engagementId:  string;   // Your internal ID linking the escrow to your records
  title:         string;
  description:   string;
  amount:        number;   // ✅ 1000   ❌ "1000" — ALWAYS a number
  platformFee:   number;   // ✅ 2      ❌ "2"    — ALWAYS a number

  roles: {
    approver:        string;  // G… Stellar address
    serviceProvider: string;  // G… Stellar address
    platformAddress: string;  // G… Stellar address
    releaseSigner:   string;  // G… Stellar address
    disputeResolver: string;  // G… Stellar address
    receiver:        string;  // G… Stellar address — only in Single-Release
  };

  milestones: Array<{
    title:       string;
    description: string;
    status:      string;   // Free-form text set by Service Provider (default: "Pending")
    approved:    boolean;  // Set to true by Approver. IRREVERSIBLE.
    evidence?:   string;   // Optional — work documentation link
  }>;

  flags: {
    disputed: boolean;
    released: boolean;
    resolved: boolean;
  };

  trustline: {
    address: string;  // G… Stellar ISSUER address of the asset (e.g. USDC issuer)
    symbol:  string;  // Asset ticker (e.g. "USDC", "EURC")
  };
}
```

### Multi-Release Escrow

```typescript
{
  engagementId:  string;
  title:         string;
  description:   string;
  // ⚠️ No top-level `amount` — amount is defined per-milestone
  platformFee:   number;   // ✅ 2  ❌ "2"

  roles: {
    approver:        string;  // G… Stellar address
    serviceProvider: string;  // G… Stellar address
    platformAddress: string;  // G… Stellar address
    releaseSigner:   string;  // G… Stellar address
    disputeResolver: string;  // G… Stellar address
    // ⚠️ No `receiver` here — each milestone defines its own receiver
  };

  milestones: Array<{
    title:       string;
    description: string;
    status:      string;
    amount:      number;  // ✅ 500  ❌ "500" — ALWAYS a number, per milestone
    receiver:    string;  // G… Stellar address — defined per milestone (not in roles)
    evidence?:   string;  // Optional
    flags: {
      disputed: boolean;
      released: boolean;
      resolved: boolean;
      approved: boolean;  // Per-milestone in Multi-Release (vs top-level flags in Single)
    };
  }>;

  trustline: {
    address: string;  // G… Stellar ISSUER address of the asset
    symbol:  string;  // "USDC", "EURC", etc.
  };
}
```

### Key Schema Differences: Single vs Multi-Release

| Field | Single-Release | Multi-Release |
|-------|---------------|---------------|
| `amount` | Top-level, `number` | Per-milestone, `number` |
| `receiver` | In `roles` object | Per-milestone in `milestones[]` |
| `flags` | Single top-level object | Per-milestone `flags` object |
| `approved` | In each milestone object | Inside per-milestone `flags` |

### Type Rules — Critical for Forms and Payloads

| Field | Type | Notes |
|-------|------|-------|
| `amount` (deploy) | `number` | ✅ `1000` ❌ `"1000"` |
| `amount` (fund-escrow) | `string` | ✅ `"1000"` ❌ `1000` — exception |
| `platformFee` | `number` | ✅ `2` ❌ `"2"` |
| Milestone `amount` (multi-release) | `number` | ✅ `500` ❌ `"500"` |
| `milestoneIndex` | `string` | ✅ `"0"` ❌ `0` (operation params only) |
| `distributions[].amount` | `number` | Amount per recipient in resolve-dispute |
| All addresses | `string` | G… (wallets) or C… (contracts) |
| `engagementId`, `title`, `description` | `string` | — |
| `trustline.address` | `string` | Must be G… issuer address, NOT C… contract |
| `trustline.symbol` | `string` | e.g. `"USDC"` |

> 🔴 **Form validation rule:** `amount` in deploy and `platformFee` use `z.number()`. `milestoneIndex` uses `z.string()`. `amount` in fund-escrow uses `z.string()`. Use the table above as the reference — do not assume all amounts share the same type.

---

## Milestone Data Model

```typescript
// Single-Release milestone
{
  title:       string;
  description: string;
  status:      string;   // Free-form text, updated by Service Provider (default: "Pending")
  approved:    boolean;  // Set to true by Approver. IRREVERSIBLE.
  evidence?:   string;   // Optional — work documentation
}

// Multi-Release milestone (adds amount, receiver, flags)
{
  title:       string;
  description: string;
  status:      string;
  amount:      number;   // Payout for this milestone — number, not string
  receiver:    string;   // G… address — defined here, not in roles
  evidence?:   string;
  flags: {
    disputed: boolean;
    released: boolean;
    resolved: boolean;
    approved: boolean;
  };
}
```

**status** and **approved** are independent fields:
- Service Provider updates `status` to communicate progress
- Approver sets `approved: true` when satisfied (regardless of status text)
- Once `approved: true`, there is **no unapprove**

---

## Trustlines (Stellar-Specific — Critical)

On Stellar, every account must explicitly opt in to hold an asset by establishing a **trustline** before receiving or holding tokens (USDC, EURC, etc.).

**ALL escrow participants must have a trustline for the escrow asset before any transaction can succeed.**

Common trustline errors produce cryptic Soroban errors. Always check/establish trustlines early in your onboarding flow.

> ⚠️ **The `/helper/set-trustline` endpoint no longer exists.**

Each participant must add the trustline directly from their own wallet:

```
Setup flow:
1. Open your Stellar wallet (e.g. Freighter, LOBSTR, xBull)
2. Go to "Add Asset" or "Add Trustline"
3. Search for the asset by name (e.g. USDC) or find it manually in the wallet
4. Confirm the trustline addition in your wallet
```

> 🔴 **CRITICAL — `trustline` is an object, not a string:**
> The `trustline` field in the escrow payload is an **object** with two fields:
> ```json
> "trustline": {
>   "address": "G…",   // G… Stellar ISSUER address of the asset — NOT the C… contract address
>   "symbol": "USDC"   // Asset ticker symbol
> }
> ```
> **Do NOT** pass a plain string. **Do NOT** use the **C… Soroban contract address** in `trustline.address`. Using the C… address there is one of the most common mistakes and will cause escrow failures.

---

## THE XDR SIGNING PATTERN (Critical — Read This First)

This is the most important concept in Trustless Work. **Every write operation follows this exact 3-step pattern:**

```
Step 1: Call API/SDK  →  receive { unsignedTransaction: "AAAA..." }
Step 2: Sign XDR client-side with the CORRECT ROLE wallet
Step 3: POST /helper/send-transaction { signedXdr }  (or useSendTransaction hook)
```

**Why?** Trustless Work never holds your private keys. The API constructs the transaction but you sign it — fully non-custodial.

**Which wallet signs?** The wallet that holds the **role** required for that operation:

| Operation | Must be signed by |
|-----------|-------------------|
| Deploy escrow | Issuer |
| Fund escrow | Funder |
| Change milestone status | Service Provider |
| Approve milestone | Approver |
| Release funds | Release Signer |
| Raise dispute | Approver or Service Provider |
| Resolve dispute | Dispute Resolver |
| Set trustline | The account establishing the trustline (done from the wallet directly — no API endpoint) |

**Common XDR mistakes:**
- ❌ Calling a write endpoint and ignoring the returned `unsignedTransaction`
- ❌ Signing with the wrong role wallet
- ❌ Signing but never submitting (nothing happens on-chain)
- ❌ Submitting on behalf of a user role from the server (never do this)

---

## Authentication

- **Method:** HTTP header `x-api-key: <your-api-key>`
- **Read operations:** No API key required
- **Write operations:** API key required → 401 if missing or invalid
- **Rate limit:** 50 requests / 60 seconds per client → 429 if exceeded

**Getting an API key:**
1. Connect Stellar wallet at https://dapp.trustlesswork.com
2. Sign the authentication message (creates your profile)
3. Go to Settings (click wallet address, bottom-left)
4. Generate and copy your API key

---

## Environment Variables

```bash
# .env.local (Next.js — client-side SDK)
NEXT_PUBLIC_API_KEY=your_trustless_work_api_key

# .env (Node.js backend — server-side only)
TW_API_KEY=your_trustless_work_api_key

# Never commit these to git.
# For Next.js: NEXT_PUBLIC_ prefix exposes the var to the browser bundle.
# Consider proxying API calls through Route Handlers to avoid exposing the key.
```

---

## API Environments

| Environment | Base URL |
|------------|----------|
| **Development (Testnet)** | `https://dev.api.trustlesswork.com` |
| **Production (Mainnet)** | `https://api.trustlesswork.com` |
| **Swagger UI** | `https://dev.api.trustlesswork.com/docs` |

Always start on testnet. Switch to mainnet for production.

---

## Error Handling

| HTTP Status | Meaning | Action |
|-------------|---------|--------|
| 400 | Bad Request — malformed payload | Check required fields, types, and values |
| 401 | Unauthorized — missing/invalid API key | Verify `x-api-key` header |
| 429 | Rate limit exceeded | Implement exponential backoff |
| 500 | Server error | Retry with backoff; report if persistent |

**Retry pattern:**
```javascript
async function withRetry(fn, maxAttempts = 3) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return await fn();
    } catch (err) {
      if (err.status === 429 && i < maxAttempts - 1) {
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, i)));
        continue;
      }
      throw err;
    }
  }
}
```

---

## Security Rules (Always Apply)

1. **Never log or print API keys, private keys, or secrets**
2. **Never sign on behalf of a user role from your server** — only sign platform-owned roles server-side
3. **Never expose `TW_API_KEY` without `NEXT_PUBLIC_` prefix** in client bundles (prefer Route Handler proxy)
4. **Validate all role addresses** before deploying escrows — wrong addresses cannot be changed
5. **Add confirmation dialogs** before irreversible on-chain actions (approval, release, dispute)

---

## General Integration Checklist

- [ ] All participants have trustlines for the escrow asset
- [ ] API key configured in environment (not hardcoded)
- [ ] XDR signing flow implemented: get → sign → submit
- [ ] Correct role wallet signs each operation
- [ ] Error handling for 400, 401, 429, 500
- [ ] `engagementId` used to link escrows to internal records
- [ ] Testnet integration tested end-to-end before mainnet
- [ ] Confirmation dialogs on irreversible actions (approve, release)
- [ ] Logging does not print secrets or private keys

---

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| 401 on write calls | Missing or invalid API key | Check `x-api-key` header / env var |
| Transaction fails on submit | Wrong signer role | Re-check which role must sign the operation |
| "No trustline" error | Participant missing trustline | Each participant must add the trustline from their own wallet (Add Asset). Use the G… issuer address — NOT the C… contract address |
| "No QueryClient set" | Wrong provider order | `QueryClientProvider` must wrap `TrustlessWorkConfig` |
| Hooks return nothing | Missing provider or Server Component | Ensure `TrustlessWorkConfig` is in a client component |
| 429 Too Many Requests | Rate limit hit | Add exponential backoff; batch reads |
| XDR signed but nothing happens | Forgot to submit | Call `sendTransaction` after signing |
| Approval reverted | Trying to un-approve | Approvals are immutable — add UX confirmation first |

---

## Reference Files

Deep-dive documentation for each integration path:

- `references/api.md` — Complete REST API endpoint reference, auth, error codes, Node.js examples
- `references/sdk.md` — @trustless-work/escrow React SDK: all hooks, provider setup, TypeScript types
- `references/blocks.md` — @trustless-work/blocks UI components: provider order, wallet kit, context pattern
- `references/checklist.md` — Pre-production integration checklist (per product)
- `references/examples.md` — Full code examples: API (Node.js), SDK (React/Next.js), Blocks (Next.js layout)
