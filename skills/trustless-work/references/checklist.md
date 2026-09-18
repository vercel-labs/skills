# Trustless Work — Integration Checklist

Use this checklist before going to production. Each item maps to a verifiable signal in your codebase.

---

## Core (All Products)

- [ ] **Trustlines established** — Every participant wallet has added the trustline for the escrow asset (USDC/EURC) directly from their own wallet. The `/helper/set-trustline` endpoint no longer exists — users must find the asset in their wallet and add it manually. Verified before any escrow transaction.
- [ ] **Correct `trustline` object in deploy payload** — `trustline` is an object `{ address: "G…", symbol: "USDC" }`. The `address` must be the **G… Stellar issuer address** of the asset, NOT the C… Soroban contract address.
- [ ] **API key stored in env var** — `NEXT_PUBLIC_API_KEY` or `TW_API_KEY`, never hardcoded in source.
- [ ] **API key not in server-rendered output** — Either use `NEXT_PUBLIC_` only on client components, or proxy via Route Handlers.
- [ ] **XDR sign → submit pattern implemented** — Every write call: receive `unsignedTransaction` → `kit.signTransaction()` → `sendTransaction({ signedXdr })`.
- [ ] **Correct role signs each operation** — See SKILL.md role-to-operation table.
- [ ] **Error handling** — 400, 401, 429, 500 all handled with user feedback.
- [ ] **Rate limit backoff** — Exponential backoff for 429 responses.
- [ ] **`engagementId` used** — Links escrows to your internal records.
- [ ] **No secrets in logs** — API keys, private keys, and XDR never logged.
- [ ] **Testnet tested** — Full lifecycle tested on testnet before mainnet.
- [ ] **Environment toggle** — Base URL configurable between dev/prod via env var.
- [ ] **Confirmation dialogs** — On approve-milestone, release-funds, and resolve-dispute.

---

## API (REST)

- [ ] `x-api-key` header on all write requests
- [ ] `amount` (deploy) and `platformFee` sent as **numbers** (`1000`, not `"1000"`)
- [ ] `amount` in `fund-escrow` sent as **string** (`"1000"`, not `1000`) — exception to the rule
- [ ] Milestone `amount` (multi-release) sent as **number**
- [ ] `milestoneIndex` sent as **string** (e.g., `"0"` not `0`)
- [ ] `distributions` array used in resolve-dispute (not `approverFunds`/`receiverFunds`)
- [ ] All role addresses are valid G… Stellar public keys (56 chars)
- [ ] `trustline` object included in deploy payload: `{ address: "G…", symbol: "USDC" }` — `address` must be the G… Stellar **issuer** address, NOT the C… contract address
- [ ] Single-release: `receiver` is in `roles`; Multi-release: `receiver` is per-milestone (NOT in `roles`)
- [ ] `POST /helper/send-transaction` called after every write operation
- [ ] `GET` endpoints used for reads (no API key needed)
- [ ] `engagementId` provided in deploy payloads

---

## SDK (@trustless-work/escrow)

- [ ] `@trustless-work/escrow` in `dependencies`
- [ ] `@tanstack/react-query` in `dependencies`
- [ ] `@creit.tech/stellar-wallets-kit` in `dependencies`
- [ ] `TrustlessWorkConfig` is a client component (`"use client"` in Next.js)
- [ ] Provider order correct: `QueryClientProvider` → `TrustlessWorkConfig` → `WalletProvider`
- [ ] `NEXT_PUBLIC_API_KEY` in `.env.local` (Next.js) or `VITE_API_KEY` (Vite)
- [ ] `useSendTransaction` called after every write hook + signing
- [ ] `useInitializeEscrow` → `deployEscrow(payload, type)` — type matches your escrow type
- [ ] Single vs multi-release payloads used correctly (multi needs `milestoneIndex`)
- [ ] Write hooks only called inside `TrustlessWorkConfig` tree

---

## Blocks (@trustless-work/blocks)

- [ ] `@trustless-work/blocks` in `dependencies`
- [ ] All peer deps installed (react-query, react-query-table, escrow, wallets-kit, react-hook-form, zod)
- [ ] `QueryClient` instantiated **outside** the component (module scope)
- [ ] Provider nesting: `QueryClientProvider` → `TrustlessWorkConfig` → `WalletProvider`
- [ ] Provider file has `"use client"` (Next.js App Router)
- [ ] `StellarWalletsKit` network matches environment (`WalletNetwork.TESTNET` / `WalletNetwork.PUBLIC`)
- [ ] `setSelectedEscrow(escrow)` called before any operation component is used
- [ ] Confirmation dialog before `approveMilestone`
- [ ] Trustline guidance exists in onboarding — users are instructed to add the trustline from their wallet using the G… issuer address (not C… contract address)
- [ ] `ReactQueryDevtools` added (dev only) for debugging

---

## Security

- [ ] API keys only in `.env*` files (in `.gitignore`)
- [ ] No private keys in source code or env vars client-side
- [ ] No secrets in git history
- [ ] `NEXT_PUBLIC_API_KEY` reviewed — acceptable to expose? (Consider Route Handler proxy)
- [ ] Stellar addresses validated before escrow deployment

---

## Pre-Production Checklist

- [ ] End-to-end escrow lifecycle tested on **testnet**: deploy → fund → change status → approve → release
- [ ] Dispute resolution tested
- [ ] All error scenarios tested (missing trustline, wrong signer, rate limit)
- [ ] Switch base URL to `https://api.trustlesswork.com` for mainnet
- [ ] Switch `WalletNetwork.TESTNET` → `WalletNetwork.PUBLIC` for mainnet
- [ ] Real USDC/EURC token address used (not testnet placeholder)
- [ ] Rate limit monitoring in place for high-volume use cases
