# Trustless Work — API Reference

> Read SKILL.md first for core concepts (roles, lifecycle, XDR pattern).
> Ref: https://docs.trustlesswork.com/trustless-work/api-reference

---

## Base URLs

| Environment | URL |
|------------|-----|
| Development (Testnet) | `https://dev.api.trustlesswork.com` |
| Production (Mainnet) | `https://api.trustlesswork.com` |
| Swagger UI | `https://dev.api.trustlesswork.com/docs` |

---

## Authentication

All write requests require the `x-api-key` header:

```http
POST /deployer/single-release HTTP/1.1
Host: dev.api.trustlesswork.com
Content-Type: application/json
x-api-key: your_api_key_here
```

Read-only endpoints (GET) work without the header.

---

## Endpoint Reference

### Deployer

| Method | Path | Signer Role | Returns |
|--------|------|-------------|---------|
| POST | `/deployer/single-release` | Issuer | `{ unsignedTransaction }` |
| POST | `/deployer/multi-release` | Issuer | `{ unsignedTransaction }` |

**Deploy payload (single-release):**
```json
{
  "signer": "GISSUER_ADDRESS",
  "engagementId": "invoice-2024-001",
  "title": "Website Redesign",
  "description": "Complete redesign of marketing site",
  "amount": 1000,
  "roles": {
    "approver": "GAPPROVER_ADDRESS",
    "serviceProvider": "GSERVICE_PROVIDER_ADDRESS",
    "releaseSigner": "GRELEASE_SIGNER_ADDRESS",
    "disputeResolver": "GDISPUTE_RESOLVER_ADDRESS",
    "receiver": "GRECEIVER_ADDRESS",
    "platformAddress": "GPLATFORM_ADDRESS"
  },
  "platformFee": 2,
  "trustline": {
    "address": "GUSDC_ISSUER_STELLAR_ADDRESS",
    "symbol": "USDC"
  },
  "milestones": [
    {
      "title": "Design Mockups",
      "description": "Deliver Figma mockups for all pages"
    },
    {
      "title": "Development",
      "description": "Implement designs in React"
    }
  ]
}
```

> ⚠️ **Type rules for this payload:**
> - `amount` and `platformFee` are **numbers** (`1000`, `2`) — not strings
> - `trustline.address` is the **G… Stellar issuer address** of the asset — NOT the C… Soroban contract address
> - All role addresses are G… Stellar public keys

**Deploy payload (multi-release):** No top-level `amount`. Each milestone has its own `amount` (number) and `receiver` (G… address). No `receiver` in `roles`.
```json
{
  "signer": "GISSUER_ADDRESS",
  "engagementId": "invoice-2024-001",
  "title": "Website Redesign",
  "description": "Complete redesign of marketing site",
  "roles": {
    "approver": "GAPPROVER_ADDRESS",
    "serviceProvider": "GSERVICE_PROVIDER_ADDRESS",
    "releaseSigner": "GRELEASE_SIGNER_ADDRESS",
    "disputeResolver": "GDISPUTE_RESOLVER_ADDRESS",
    "platformAddress": "GPLATFORM_ADDRESS"
  },
  "platformFee": 2,
  "trustline": {
    "address": "GUSDC_ISSUER_STELLAR_ADDRESS",
    "symbol": "USDC"
  },
  "milestones": [
    { "title": "Phase 1", "description": "...", "amount": 400, "receiver": "GRECEIVER_ADDRESS" },
    { "title": "Phase 2", "description": "...", "amount": 600, "receiver": "GRECEIVER_ADDRESS" }
  ]
}
```

---

### Escrow Operations

All paths use `{type}` = `single-release` or `multi-release`.

| Method | Path | Signer Role | Returns |
|--------|------|-------------|---------|
| POST | `/escrow/{type}/fund-escrow` | Funder | `{ unsignedTransaction }` |
| POST | `/escrow/{type}/change-milestone-status` | Service Provider | `{ unsignedTransaction }` |
| POST | `/escrow/{type}/approve-milestone` | Approver | `{ unsignedTransaction }` |
| POST | `/escrow/{type}/release-funds` | Release Signer | `{ unsignedTransaction }` |
| POST | `/escrow/{type}/dispute-escrow` | Approver or Service Provider | `{ unsignedTransaction }` |
| POST | `/escrow/{type}/resolve-dispute` | Dispute Resolver | `{ unsignedTransaction }` |
| GET  | `/escrow/{type}/get-escrow` | — | Escrow object |
| POST | `/escrow/{type}/update-escrow` | Platform Address | `{ unsignedTransaction }` |

**Fund escrow (single-release and multi-release):**
```json
{
  "contractId": "CXXXXX...",
  "signer": "GFUNDER_ADDRESS",
  "amount": "1000"
}
```

**Change milestone status (single-release and multi-release):**
```json
{
  "contractId": "CXXXXX...",
  "serviceProvider": "GSERVICE_PROVIDER_ADDRESS",
  "milestoneIndex": "0",
  "newStatus": "Under Review",
  "newEvidence": "https://link-to-evidence.com"
}
```

**Approve milestone (single-release and multi-release):**
```json
{
  "contractId": "CXXXXX...",
  "approver": "GAPPROVER_ADDRESS",
  "milestoneIndex": "0"
}
```

**Release funds (single-release):**
```json
{ "contractId": "CXXXXX...", "releaseSigner": "GRELEASE_SIGNER_ADDRESS" }
```

**Release funds (multi-release):**
```json
{ "contractId": "CXXXXX...", "releaseSigner": "GRELEASE_SIGNER_ADDRESS", "milestoneIndex": "0" }
```

**Dispute escrow (single-release):**
```json
{ "contractId": "CXXXXX...", "signer": "GAPPROVER_OR_SP_ADDRESS" }
```

**Dispute milestone (multi-release):**
```json
{ "contractId": "CXXXXX...", "signer": "GAPPROVER_OR_SP_ADDRESS", "milestoneIndex": "0" }
```

**Resolve dispute (single-release):**
```json
{
  "contractId": "CXXXXX...",
  "disputeResolver": "GDISPUTE_RESOLVER_ADDRESS",
  "distributions": [
    { "address": "GAPPROVER_ADDRESS", "amount": 300 },
    { "address": "GRECEIVER_ADDRESS", "amount": 700 }
  ]
}
```

**Resolve dispute (multi-release):**
```json
{
  "contractId": "CXXXXX...",
  "disputeResolver": "GDISPUTE_RESOLVER_ADDRESS",
  "milestoneIndex": "0",
  "distributions": [
    { "address": "GAPPROVER_ADDRESS", "amount": 300 },
    { "address": "GRECEIVER_ADDRESS", "amount": 700 }
  ]
}
```

**Get escrow:**
```
GET /escrow/single-release/get-escrow?contractId=CXXXXX...
```

---

### Helpers

| Method | Path | Description | Returns |
|--------|------|-------------|---------|
| POST | `/helper/send-transaction` | Submit signed XDR to Stellar | Transaction result |
| GET  | `/helper/get-escrows-by-signer` | Query escrows by signer | Escrow list |
| GET  | `/helper/get-escrows-by-role` | Query escrows by role | Escrow list |
| GET  | `/helper/get-escrow-by-contract-ids` | Query by contract IDs | Escrow list |
| GET  | `/helper/get-multiple-escrow-balance` | Batch balance query | Balances |

> ⚠️ **Trustlines:** The `/helper/set-trustline` endpoint no longer exists. Each participant must find the asset in their own wallet (e.g. Freighter → Add Asset / Add Trustline) and add it manually.

**Send transaction (final step of every write flow):**
```json
{ "signedXdr": "AAAAAgAAAAB..." }
```

---

### Indexer

| Method | Path | Description |
|--------|------|-------------|
| POST | `/indexer/update-from-tx-hash` | Sync indexer state from a transaction hash |

---

## Complete Write Flow (Node.js / fetch)

```javascript
const BASE_URL = process.env.NODE_ENV === 'production'
  ? 'https://api.trustlesswork.com'
  : 'https://dev.api.trustlesswork.com';

const HEADERS = {
  'Content-Type': 'application/json',
  'x-api-key': process.env.TW_API_KEY,
};

// Step 1: Get unsigned XDR
async function deployEscrow(payload) {
  const res = await fetch(`${BASE_URL}/deployer/single-release`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Deploy failed: ${res.status} ${await res.text()}`);
  return res.json(); // { unsignedTransaction: "AAAA..." }
}

// Step 3: Submit
async function sendTransaction(signedXdr) {
  const res = await fetch(`${BASE_URL}/helper/send-transaction`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ signedXdr }),
  });
  if (!res.ok) throw new Error(`Submit failed: ${res.status} ${await res.text()}`);
  return res.json();
}
```

---

## Error Codes

| Code | Meaning | Action |
|------|---------|--------|
| 400 | Malformed payload | Check required fields, numeric amounts, trustline object, valid G… addresses |
| 401 | Bad API key | Verify `x-api-key` header; regenerate key if needed |
| 429 | Rate limit (50 req/60s) | Implement exponential backoff |
| 500 | Server error | Retry 2-3x with backoff |

---

## Common Mistakes (API)

### ❌ 1. Ignoring the unsigned XDR
```javascript
// WRONG — escrow is never created on-chain
await fetch('/deployer/single-release', { method: 'POST', body: ... });
// Nothing happens without signing and submitting the returned XDR
```

### ❌ 2. Signing with the wrong wallet
Every operation has a required signer role. Signing `approve-milestone` with the Service Provider wallet will produce an on-chain auth error.

### ❌ 3. Amounts as strings instead of numbers
```json
// WRONG — will cause a 400 error
{ "amount": "1000", "platformFee": "2" }

// CORRECT
{ "amount": 1000, "platformFee": 2 }
```
Same rule applies to milestone `amount` in multi-release payloads. Note: `fund-escrow`'s `amount` is a **string** (exception to the rule).

### ❌ 4. Missing `trustline` object or using wrong address type
```json
// WRONG — trustline missing entirely
{ "amount": 1000, "roles": {...} }

// WRONG — trustline as plain string
{ "trustline": "GXXX..." }

// WRONG — using C… Soroban contract address in trustline.address
{ "trustline": { "address": "CXXX...", "symbol": "USDC" } }

// CORRECT — G… Stellar issuer address in trustline.address
{ "trustline": { "address": "GXXX...", "symbol": "USDC" } }
```
`trustline.address` must be the G… Stellar issuer address — not the C… Soroban contract address.

### ❌ 5. Missing required role addresses
Single-release: all six roles (approver, serviceProvider, releaseSigner, disputeResolver, receiver, platformAddress) must be valid G… Stellar addresses.
Multi-release: same but **no `receiver` in roles** — receiver is defined per-milestone inside `milestones[]`.

### ❌ 6. Calling write endpoints without API key
```javascript
// WRONG — will return 401
const headers = { 'Content-Type': 'application/json' };
```

### ❌ 7. Using production URL on testnet wallets
Testnet accounts only exist on testnet. Using `api.trustlesswork.com` (mainnet) with testnet accounts will fail.

### ❌ 8. Not guiding participants to add trustlines before transacting
If any participant hasn't added the trustline for the escrow asset, the transaction will fail. The `/helper/set-trustline` endpoint no longer exists — each participant must add the trustline directly from their wallet using the G… issuer address.

---

## Security Best Practices

- **Server-side only:** Keep `TW_API_KEY` in server env vars, never in client bundles
- **Proxy pattern:** Use Next.js Route Handlers to proxy API calls (hides API key from browser)
- **Validate addresses:** Verify all role addresses are valid Stellar public keys (G…, 56 chars) before calling deploy
- **Log without secrets:** Never log the `x-api-key` header value or any private key material
