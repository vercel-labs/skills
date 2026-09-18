# Trustless Work — Blocks Reference (@trustless-work/blocks)

> Read SKILL.md first for core concepts. Read references/sdk.md for SDK setup.
> Ref: https://docs.trustlesswork.com/trustless-work/escrow-blocks-sdk/getting-started

---

## What Are Blocks?

`@trustless-work/blocks` is a **production-ready React component library** with pre-built UI for the full escrow lifecycle: forms, tables, dialogs, wallet connect, and operation buttons. Target: go from zero to MVP in under an hour.

---

## Installation

### Option A: npm (manual setup)

```bash
npm install @trustless-work/blocks
```

### Option B: CLI (recommended for Next.js — auto-wires providers)

```bash
npx trustless-work init
```

The CLI:
1. Installs shadcn/ui (interactive prompts)
2. Installs all peer dependencies
3. Creates `.twblocks.json` config
4. Optionally wires providers into `app/layout.tsx`

### Add specific blocks

```bash
npx trustless-work add wallet-kit
npx trustless-work escrows   # installs escrow blocks under /escrows directory
```

---

## Required Peer Dependencies

```bash
npm install \
  @tanstack/react-query \
  @tanstack/react-query-devtools \
  @tanstack/react-table \
  @trustless-work/escrow \
  @creit.tech/stellar-wallets-kit \
  @hookform/resolvers \
  react-hook-form \
  zod \
  axios
```

---

## Provider Setup (Critical — Order Matters)

**Required nesting order:** `QueryClientProvider` → `TrustlessWorkConfig` → `WalletProvider`

Wrong order causes runtime errors. This is the most common mistake.

```typescript
// app/layout.tsx  (or src/App.tsx for React SPA)
"use client";

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { TrustlessWorkConfig, development, mainNet } from '@trustless-work/escrow';
import { WalletProvider } from '@/providers/WalletProvider'; // your wallet context

// Create queryClient OUTSIDE the component to avoid recreating on each render
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000, // 1 minute
      retry: 2,
    },
  },
});

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const isMainnet = process.env.NEXT_PUBLIC_USE_MAINNET === 'true';

  return (
    <html lang="en">
      <body>
        {/* 1. QueryClientProvider — OUTERMOST */}
        <QueryClientProvider client={queryClient}>

          {/* 2. TrustlessWorkConfig — handles API key + base URL */}
          <TrustlessWorkConfig
            baseURL={isMainnet ? mainNet : development}
            apiKey={process.env.NEXT_PUBLIC_API_KEY ?? ''}
          >

            {/* 3. WalletProvider — your Stellar Wallets Kit context */}
            <WalletProvider>
              {children}
            </WalletProvider>

          </TrustlessWorkConfig>

          {/* DevTools: only in development */}
          {process.env.NODE_ENV === 'development' && (
            <ReactQueryDevtools initialIsOpen={false} />
          )}

        </QueryClientProvider>
      </body>
    </html>
  );
}
```

---

## Stellar Wallets Kit Setup

```typescript
// providers/WalletProvider.tsx
"use client";

import { createContext, useContext, useState } from 'react';
import {
  StellarWalletsKit,
  WalletNetwork,
  FREIGHTER_ID,
  FreighterModule,
  AlbedoModule,
  xBullModule,
} from '@creit.tech/stellar-wallets-kit';

const kit = new StellarWalletsKit({
  network: process.env.NEXT_PUBLIC_USE_MAINNET === 'true'
    ? WalletNetwork.PUBLIC
    : WalletNetwork.TESTNET,
  selectedWalletId: FREIGHTER_ID,
  modules: [
    new FreighterModule(),
    new AlbedoModule(),
    new xBullModule(),
  ],
});

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);

  const connect = async () => {
    await kit.openModal({
      onWalletSelected: async (option) => {
        kit.setWallet(option.id);
        const { address } = await kit.getAddress();
        setAddress(address);
      },
    });
  };

  return (
    <WalletContext.Provider value={{ kit, address, connect, disconnect: () => setAddress(null) }}>
      {children}
    </WalletContext.Provider>
  );
}
```

---

## Environment Variables

```bash
# .env.local
NEXT_PUBLIC_API_KEY=your_trustless_work_api_key
NEXT_PUBLIC_USE_MAINNET=false   # true for production
```

---

## Available UI Components

| Component | Description |
|-----------|-------------|
| `WalletButton` | Connect/disconnect wallet UI |
| `EscrowsByRole` | List escrows filtered by role |
| `EscrowsBySigner` | List escrows for a given signer address |
| `InitializeEscrowForm` | Form for creating new escrows |
| `ApproveMilestone` | Dialog for approving milestones |
| `ChangeMilestoneStatus` | Form for updating milestone status |
| `ReleaseEscrow` | UI for releasing funds |
| `UpdateEscrow` | Form for editing escrow metadata |
| `DisputeEscrow` | UI for raising a dispute |
| `ResolveDispute` | UI for resolving disputes |

Explore all at: https://blocks.trustlesswork.com

---

## Context Pattern: `setSelectedEscrow`

The Blocks library uses a shared context. When a user selects an escrow, call `setSelectedEscrow(escrow)` — all operation hooks and components then read `contractId` and `roles` from this context automatically:

```typescript
import { useEscrowContext } from '@trustless-work/blocks';

function EscrowList({ escrows }) {
  const { setSelectedEscrow } = useEscrowContext();

  return escrows.map(escrow => (
    <div
      key={escrow.contractId}
      onClick={() => setSelectedEscrow(escrow)}  // sets global context
    >
      {escrow.title}
    </div>
  ));
}

// Elsewhere — ApproveMilestone reads selectedEscrow from context automatically
function ApprovePanel() {
  const { approveMilestone } = useApproveMilestone();
  // contractId is read from the shared EscrowContext — no prop drilling needed
}
```

---

## Signing Pattern with Blocks

```typescript
"use client";
import { useInitializeEscrow, useSendTransaction } from '@trustless-work/escrow/hooks';
import { useWallet } from '@/providers/WalletProvider';
import { WalletNetwork } from '@creit.tech/stellar-wallets-kit';

export function CreateEscrowBlock() {
  const { deployEscrow } = useInitializeEscrow();
  const { sendTransaction } = useSendTransaction();
  const { kit, address } = useWallet();

  const handleSubmit = async (formData: FormData) => {
    // 1. Build unsigned transaction
    const { unsignedTransaction } = await deployEscrow(
      buildPayload(formData),
      'single-release'
    );

    // 2. Sign with issuer wallet client-side
    const { signedTxXdr } = await kit.signTransaction(unsignedTransaction, {
      networkPassphrase: WalletNetwork.TESTNET,
      address: address!,
    });

    // 3. Submit
    await sendTransaction({ signedXdr: signedTxXdr });
  };

  return <form onSubmit={handleSubmit}>...</form>;
}
```

---

## Common Mistakes (Blocks)

### ❌ 1. Wrong provider order
```typescript
// WRONG — causes "No QueryClient set" or context errors
<TrustlessWorkConfig>
  <QueryClientProvider>  {/* must be OUTSIDE TrustlessWorkConfig */}
    ...
  </QueryClientProvider>
</TrustlessWorkConfig>
```

### ❌ 2. Creating QueryClient inside the component
```typescript
// WRONG — new QueryClient on every render, loses cache
function Layout() {
  const queryClient = new QueryClient(); // ← inside component

// CORRECT — create outside component (module scope)
const queryClient = new QueryClient();
function Layout() { ... }
```

### ❌ 3. Missing "use client" on layout with providers (Next.js)
Providers that use React Context (`QueryClientProvider`, `TrustlessWorkConfig`, `WalletProvider`) must be in client components. Create a dedicated `Providers.tsx` file with `"use client"`.

### ❌ 4. Wrong WalletNetwork for environment
```typescript
// WRONG — testnet passphrase on mainnet (signing will fail)
const kit = new StellarWalletsKit({ network: WalletNetwork.TESTNET });

// CORRECT — match network to environment
const network = isMainnet ? WalletNetwork.PUBLIC : WalletNetwork.TESTNET;
```

### ❌ 5. Not calling setSelectedEscrow before operations
All operation components (Approve, Release, etc.) read from the shared escrow context. If `setSelectedEscrow` was never called, they operate on `null` and fail silently.

### ❌ 6. Approving without confirmation
```typescript
// WRONG — approval is irreversible, no confirmation
const handleApprove = () => approveMilestone(payload);

// CORRECT — always confirm irreversible actions
const handleApprove = async () => {
  if (!confirm('Approve milestone? This cannot be undone.')) return;
  await approveMilestone(payload);
};
```

### ❌ 7. Forgetting trustlines in the onboarding flow
When a new user connects their wallet, check and establish trustlines before they can participate in any escrow. Use `POST /helper/set-trustline` and sign/submit the returned XDR.

---

## `.twblocks.json` Configuration

Created by `npx trustless-work init`:

```json
{
  "version": "1.0.0",
  "network": "testnet",
  "apiKey": "NEXT_PUBLIC_API_KEY",
  "components": []
}
```

---

## Key URLs

| Resource | URL |
|----------|-----|
| Blocks showcase | https://blocks.trustlesswork.com |
| GitHub (blocks) | https://github.com/Trustless-Work/react-library-trustless-work-blocks |
| Docs | https://docs.trustlesswork.com/trustless-work/escrow-blocks-sdk/getting-started |
