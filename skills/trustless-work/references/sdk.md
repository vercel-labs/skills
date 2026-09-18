# Trustless Work — SDK Reference (@trustless-work/escrow)

> Read SKILL.md first for core concepts (roles, lifecycle, XDR pattern).
> Ref: https://docs.trustlesswork.com/trustless-work/escrow-react-sdk/getting-started

---

## Installation

```bash
npm install @trustless-work/escrow
# Also required:
npm install @tanstack/react-query @creit.tech/stellar-wallets-kit
```

---

## Package Exports

```typescript
// Provider
import { TrustlessWorkConfig, development, mainNet } from '@trustless-work/escrow';

// Hooks (write)
import {
  useInitializeEscrow,
  useFundEscrow,
  useApproveMilestone,
  useChangeMilestoneStatus,
  useReleaseFunds,
  useStartDispute,
  useResolveDispute,
  useUpdateEscrow,
  useWithdrawRemainingFunds,
  useSendTransaction,
} from '@trustless-work/escrow/hooks';

// Hooks (read — no API key required)
import {
  useGetEscrowsFromIndexerBySigner,
  useGetEscrowsFromIndexerByRole,
  useGetEscrowFromIndexerByContractIds,
  useGetMultipleEscrowBalances,
} from '@trustless-work/escrow/hooks';

// Types
import {
  InitializeSingleReleaseEscrowPayload,
  InitializeMultiReleaseEscrowPayload,
  FundEscrowPayload,
  ApproveMilestonePayload,
  ChangeMilestoneStatusPayload,
  SingleReleaseReleaseFundsPayload,
  MultiReleaseReleaseFundsPayload,
  SingleReleaseResolveDisputePayload,
  MultiReleaseResolveDisputePayload,
  UpdateSingleReleaseEscrowPayload,
  UpdateMultiReleaseEscrowPayload,
} from '@trustless-work/escrow/types';
```

---

## Provider Setup (Required)

### Next.js App Router

```typescript
// providers/TrustlessWorkProvider.tsx
"use client";  // ← REQUIRED — TrustlessWorkConfig uses React Context
import { TrustlessWorkConfig, development, mainNet } from '@trustless-work/escrow';

export function TrustlessWorkProvider({ children }: { children: React.ReactNode }) {
  const isMainnet = process.env.NEXT_PUBLIC_USE_MAINNET === 'true';
  return (
    <TrustlessWorkConfig
      baseURL={isMainnet ? mainNet : development}
      apiKey={process.env.NEXT_PUBLIC_API_KEY ?? ''}
    >
      {children}
    </TrustlessWorkConfig>
  );
}
```

```typescript
// app/layout.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TrustlessWorkProvider } from '@/providers/TrustlessWorkProvider';
import { WalletProvider } from '@/providers/WalletProvider'; // your wallet context

const queryClient = new QueryClient();

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body>
        {/* PROVIDER ORDER IS CRITICAL — never change this nesting */}
        <QueryClientProvider client={queryClient}>
          <TrustlessWorkProvider>
            <WalletProvider>
              {children}
            </WalletProvider>
          </TrustlessWorkProvider>
        </QueryClientProvider>
      </body>
    </html>
  );
}
```

### React SPA (Vite / CRA)

```typescript
// src/main.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TrustlessWorkConfig, development } from '@trustless-work/escrow';

const queryClient = new QueryClient();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <TrustlessWorkConfig baseURL={development} apiKey={import.meta.env.VITE_API_KEY}>
      <WalletProvider>
        <App />
      </WalletProvider>
    </TrustlessWorkConfig>
  </QueryClientProvider>
);
```

**Provider order rule:** `QueryClientProvider` → `TrustlessWorkConfig` → `WalletProvider`

---

## Environment Variables

```bash
# .env.local (Next.js)
NEXT_PUBLIC_API_KEY=your_trustless_work_api_key
NEXT_PUBLIC_USE_MAINNET=false   # set to true for production

# .env (Vite)
VITE_API_KEY=your_trustless_work_api_key
```

---

## All Write Hooks

Every write hook returns `{ unsignedTransaction }`. You **must** sign and submit.

### `useInitializeEscrow` — Deploy an escrow

```typescript
const { deployEscrow } = useInitializeEscrow();

// ── Single-Release ──────────────────────────────────────────────────────────
const result = await deployEscrow(
  {
    signer: issuerAddress,
    engagementId: 'order-123',
    title: 'Website Project',
    description: 'Full redesign',
    amount: 1000,                // ✅ number  ❌ "1000"
    roles: {
      approver: approverAddress,
      serviceProvider: spAddress,
      releaseSigner: releaseSignerAddress,
      disputeResolver: drAddress,
      receiver: receiverAddress,      // only in single-release roles
      platformAddress: platformAddress,
    },
    platformFee: 2,              // ✅ number  ❌ "2"
    trustline: {
      address: USDC_ISSUER_ADDRESS,   // G… Stellar issuer address — NOT the C… contract
      symbol: 'USDC',
    },
    milestones: [
      { title: 'Mockups', description: 'Deliver Figma files' },
      { title: 'Dev', description: 'Implement in React' },
    ],
  } satisfies InitializeSingleReleaseEscrowPayload,
  'single-release'
);
// result.unsignedTransaction → sign → submit

// ── Multi-Release ────────────────────────────────────────────────────────────
// No top-level `amount`. Each milestone has its own `amount` (number) and `receiver`.
// No `receiver` in roles.
const result = await deployEscrow(
  {
    signer: issuerAddress,
    engagementId: 'order-123',
    title: 'Website Project',
    description: 'Full redesign',
    // ⚠️ No `amount` here for multi-release
    roles: {
      approver: approverAddress,
      serviceProvider: spAddress,
      releaseSigner: releaseSignerAddress,
      disputeResolver: drAddress,
      platformAddress: platformAddress,
      // ⚠️ No `receiver` in roles for multi-release
    },
    platformFee: 2,
    trustline: {
      address: USDC_ISSUER_ADDRESS,   // G… Stellar issuer address
      symbol: 'USDC',
    },
    milestones: [
      { title: 'Phase 1', description: 'Design', amount: 400, receiver: receiverAddress },
      { title: 'Phase 2', description: 'Dev',    amount: 600, receiver: receiverAddress },
    ],
  } satisfies InitializeMultiReleaseEscrowPayload,
  'multi-release'
);
// result.unsignedTransaction → sign → submit
```

### `useFundEscrow` — Fund an escrow

```typescript
const { fundEscrow } = useFundEscrow();

const result = await fundEscrow({
  contractId: 'CXXXXX...',
  signer: funderAddress,   // must be the Funder role address
  amount: '1000',          // string in fund-escrow (unlike deploy where amount is number)
} satisfies FundEscrowPayload);
```

### `useChangeMilestoneStatus` — Update milestone status text

```typescript
const { changeMilestoneStatus } = useChangeMilestoneStatus();

const result = await changeMilestoneStatus({
  contractId: 'CXXXXX...',
  serviceProvider: serviceProviderAddress,  // field is `serviceProvider`, not `signer`
  milestoneIndex: '0',                      // string, not number
  newStatus: 'Under Review',
  newEvidence: 'https://link-to-evidence.com',
} satisfies ChangeMilestoneStatusPayload);
```

### `useApproveMilestone` — Approve a milestone (irreversible)

```typescript
const { approveMilestone } = useApproveMilestone();

// ALWAYS show a confirmation dialog first — approval cannot be undone
const confirmed = confirm('Approve this milestone? This action cannot be reversed.');
if (!confirmed) return;

const result = await approveMilestone({
  contractId: 'CXXXXX...',
  approver: approverAddress,   // field is `approver`, not `signer`
  milestoneIndex: '0',         // string, not number
} satisfies ApproveMilestonePayload);
```

### `useReleaseFunds` — Release funds

```typescript
const { releaseFunds } = useReleaseFunds();

// Single-release
const result = await releaseFunds({
  contractId: 'CXXXXX...',
  releaseSigner: releaseSignerAddress,  // field is `releaseSigner`, not `signer`
} satisfies SingleReleaseReleaseFundsPayload);

// Multi-release (adds milestoneIndex)
const result = await releaseFunds({
  contractId: 'CXXXXX...',
  releaseSigner: releaseSignerAddress,
  milestoneIndex: '0',                  // string, not number
} satisfies MultiReleaseReleaseFundsPayload);
```

### `useStartDispute` — Raise a dispute

```typescript
const { startDispute } = useStartDispute();

// Single-release
const result = await startDispute({ contractId: 'CXXXXX...', signer: approverOrSpAddress });

// Multi-release (adds milestoneIndex)
const result = await startDispute({ contractId: 'CXXXXX...', signer: approverOrSpAddress, milestoneIndex: '0' });
```

### `useResolveDispute` — Resolve a dispute

```typescript
const { resolveDispute } = useResolveDispute();

// Single-release
const result = await resolveDispute({
  contractId: 'CXXXXX...',
  disputeResolver: disputeResolverAddress,
  distributions: [
    { address: approverAddress, amount: 300 },
    { address: receiverAddress, amount: 700 },
  ],
} satisfies SingleReleaseResolveDisputePayload);

// Multi-release (adds milestoneIndex)
const result = await resolveDispute({
  contractId: 'CXXXXX...',
  disputeResolver: disputeResolverAddress,
  milestoneIndex: '0',
  distributions: [
    { address: approverAddress, amount: 300 },
    { address: receiverAddress, amount: 700 },
  ],
} satisfies MultiReleaseResolveDisputePayload);
```

### `useUpdateEscrow` — Update escrow metadata

```typescript
const { updateEscrow } = useUpdateEscrow();
// Only works before funding. Signed by Platform Address.
const result = await updateEscrow({ contractId, signer: platformAddress, ...changes });
```

### `useSendTransaction` — Submit signed XDR (final step)

```typescript
const { sendTransaction } = useSendTransaction();
const result = await sendTransaction({ signedXdr: signedTxXdr });
```

---

## Complete XDR Sign + Submit Pattern

```typescript
"use client";
import { useInitializeEscrow, useSendTransaction } from '@trustless-work/escrow/hooks';
import { StellarWalletsKit, WalletNetwork } from '@creit.tech/stellar-wallets-kit';

// Assuming `kit` comes from your WalletProvider context
function CreateEscrowButton({ kit, issuerAddress }) {
  const { deployEscrow } = useInitializeEscrow();
  const { sendTransaction } = useSendTransaction();

  const handleCreate = async () => {
    try {
      // 1. Get unsigned XDR from Trustless Work API
      const { unsignedTransaction } = await deployEscrow(payload, 'single-release');

      // 2. Sign client-side with the ISSUER wallet
      const { signedTxXdr } = await kit.signTransaction(unsignedTransaction, {
        networkPassphrase: WalletNetwork.TESTNET,  // or WalletNetwork.PUBLIC for mainnet
        address: issuerAddress,
      });

      // 3. Submit to Stellar network
      await sendTransaction({ signedXdr: signedTxXdr });

      console.log('Escrow created on-chain!');
    } catch (error) {
      console.error('Failed:', error);
    }
  };

  return <button onClick={handleCreate}>Create Escrow</button>;
}
```

---

## Read Hooks (No API Key Required)

```typescript
// Get escrows by signer address
const { getEscrowsBySigner } = useGetEscrowsFromIndexerBySigner();
const escrows = await getEscrowsBySigner({ signer: 'GXXX...' });

// Get escrows by role
const { getEscrowsByRole } = useGetEscrowsFromIndexerByRole();
const escrows = await getEscrowsByRole({ role: 'approver', address: 'GXXX...' });

// Get escrows by contract IDs
const { getEscrowByContractIds } = useGetEscrowFromIndexerByContractIds();
const escrows = await getEscrowByContractIds({ contractIds: ['CXXX...', 'CYYY...'] });

// Get balances for multiple escrows
const { getMultipleEscrowBalances } = useGetMultipleEscrowBalances();
```

---

## Common Mistakes (SDK)

### ❌ 1. Missing "use client" on the provider (Next.js)
```typescript
// WRONG — will cause "createContext called on the server" error
export function TrustlessWorkProvider(...) { ... }

// CORRECT — first line of the file must be:
"use client";
export function TrustlessWorkProvider(...) { ... }
```

### ❌ 2. Wrong provider order
```typescript
// WRONG — TanStack Query won't be available inside TrustlessWorkConfig
<TrustlessWorkConfig>
  <QueryClientProvider>  {/* Too late */}
    <App />
  </QueryClientProvider>
</TrustlessWorkConfig>

// CORRECT
<QueryClientProvider>
  <TrustlessWorkConfig>
    <App />
  </TrustlessWorkConfig>
</QueryClientProvider>
```

### ❌ 3. Forgetting to call `sendTransaction` after signing
```typescript
// WRONG — escrow is never created on-chain
const { unsignedTransaction } = await deployEscrow(payload, 'single-release');
const { signedTxXdr } = await kit.signTransaction(unsignedTransaction, opts);
// MISSING: await sendTransaction({ signedXdr: signedTxXdr })
```

### ❌ 4. Single vs Multi-Release payload confusion
```typescript
// Multi-release needs milestoneIndex (string) on release and resolve
const result = await releaseFunds({
  contractId,
  releaseSigner,           // `releaseSigner`, not `signer`
  milestoneIndex: '0',     // string, REQUIRED for multi-release, omitted for single-release
});
```

### ❌ 5. engagementId omitted
```typescript
// Always include to link the escrow to your system's records
{ engagementId: `order-${order.id}`, ... }
```
