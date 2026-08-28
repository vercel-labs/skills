# Trustless Work — Code Examples

Full working examples for each integration path.
Read SKILL.md for XDR signing concepts before using these.

---

## Example 1 — REST API (Node.js)

Full escrow lifecycle: deploy → fund → change status → approve → release.

> **Note:** Server-side signing shown here is only valid for **platform-owned roles**.
> Never sign on behalf of user roles (Approver, Service Provider) from the server.

```javascript
import { Keypair, Transaction, Networks } from '@stellar/stellar-sdk';

const BASE_URL = process.env.NODE_ENV === 'production'
  ? 'https://api.trustlesswork.com'
  : 'https://dev.api.trustlesswork.com';

const HEADERS = {
  'Content-Type': 'application/json',
  'x-api-key': process.env.TW_API_KEY,
};

// ── Utilities ─────────────────────────────────────────────────────────────

async function callApi(path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API ${path} failed (${res.status}): ${await res.text()}`);
  return res.json();
}

function signXdr(unsignedTransaction, secretKey) {
  const network = process.env.NODE_ENV === 'production' ? Networks.PUBLIC : Networks.TESTNET;
  const keypair = Keypair.fromSecret(secretKey);
  const tx = new Transaction(unsignedTransaction, network);
  tx.sign(keypair);
  return tx.toEnvelope().toXDR('base64');
}

async function sendTransaction(signedXdr) {
  const res = await fetch(`${BASE_URL}/helper/send-transaction`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ signedXdr }),
  });
  if (!res.ok) throw new Error(`send-transaction failed (${res.status})`);
  return res.json();
}

async function withRetry(fn, maxAttempts = 3) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return await fn();
    } catch (err) {
      if (err.message.includes('429') && i < maxAttempts - 1) {
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, i)));
        continue;
      }
      throw err;
    }
  }
}

// ── Step 1: Deploy Escrow ─────────────────────────────────────────────────

async function deployEscrow() {
  const { unsignedTransaction } = await withRetry(() =>
    callApi('/deployer/single-release', {
      signer: process.env.PLATFORM_ADDRESS,
      engagementId: `order-${Date.now()}`,
      title: 'Website Redesign Project',
      description: 'Full redesign of marketing website',
      amount: 1000,                             // ✅ number, not string
      roles: {
        approver: process.env.APPROVER_ADDRESS,
        serviceProvider: process.env.SERVICE_PROVIDER_ADDRESS,
        releaseSigner: process.env.PLATFORM_ADDRESS,
        disputeResolver: process.env.PLATFORM_ADDRESS,
        receiver: process.env.SERVICE_PROVIDER_ADDRESS,  // only in single-release
        platformAddress: process.env.PLATFORM_ADDRESS,
      },
      platformFee: 2,                           // ✅ number, not string
      trustline: {
        address: process.env.USDC_ISSUER_ADDRESS,  // G… Stellar issuer address
        symbol: 'USDC',
      },
      milestones: [
        { title: 'Design Phase', description: 'Deliver Figma mockups' },
        { title: 'Dev Phase', description: 'Implement in React' },
      ],
    })
  );

  const signedXdr = signXdr(unsignedTransaction, process.env.PLATFORM_SECRET_KEY);
  const result = await sendTransaction(signedXdr);
  return result; // contains contractId
}

// ── Step 2: Fund Escrow ───────────────────────────────────────────────────

async function fundEscrow(contractId) {
  const { unsignedTransaction } = await callApi('/escrow/single-release/fund-escrow', {
    contractId,
    signer: process.env.FUNDER_ADDRESS,
    amount: '1000',   // string in fund-escrow (unlike deploy where amount is number)
  });
  const signedXdr = signXdr(unsignedTransaction, process.env.FUNDER_SECRET_KEY);
  return sendTransaction(signedXdr);
}

// ── Step 3: Change Milestone Status ──────────────────────────────────────

async function changeMilestoneStatus(contractId, milestoneIndex, newStatus, newEvidence) {
  const { unsignedTransaction } = await callApi(
    '/escrow/single-release/change-milestone-status',
    {
      contractId,
      serviceProvider: process.env.SERVICE_PROVIDER_ADDRESS,  // `serviceProvider`, not `signer`
      milestoneIndex,   // string e.g. '0'
      newStatus,
      newEvidence,
    }
  );
  const signedXdr = signXdr(unsignedTransaction, process.env.SERVICE_PROVIDER_SECRET);
  return sendTransaction(signedXdr);
}

// ── Step 4: Approve Milestone (IRREVERSIBLE) ──────────────────────────────

async function approveMilestone(contractId, milestoneIndex) {
  const { unsignedTransaction } = await callApi(
    '/escrow/single-release/approve-milestone',
    {
      contractId,
      approver: process.env.APPROVER_ADDRESS,  // `approver`, not `signer`
      milestoneIndex,   // string e.g. '0'
    }
  );
  const signedXdr = signXdr(unsignedTransaction, process.env.APPROVER_SECRET);
  return sendTransaction(signedXdr);
}

// ── Step 5: Release Funds ─────────────────────────────────────────────────

async function releaseFunds(contractId) {
  const { unsignedTransaction } = await callApi('/escrow/single-release/release-funds', {
    contractId,
    releaseSigner: process.env.PLATFORM_ADDRESS,  // `releaseSigner`, not `signer`
  });
  const signedXdr = signXdr(unsignedTransaction, process.env.PLATFORM_SECRET_KEY);
  return sendTransaction(signedXdr);
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const { contractId } = await deployEscrow();
  await fundEscrow(contractId);
  await changeMilestoneStatus(contractId, '0', 'Under Review', 'https://evidence.com');
  await approveMilestone(contractId, '0');
  await approveMilestone(contractId, '1');
  await releaseFunds(contractId);
  console.log('Escrow lifecycle complete! Contract:', contractId);
}

main().catch(console.error);
```

---

## Example 2 — SDK (React / Next.js App Router)

Provider setup + create escrow + approve milestone + read escrows.

```tsx
// ── 1. Providers (components/Providers.tsx) ───────────────────────────────
"use client"; // ← REQUIRED

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TrustlessWorkConfig, development, mainNet } from "@trustless-work/escrow";
import { StellarWalletsKit, WalletNetwork, FREIGHTER_ID, FreighterModule } from "@creit.tech/stellar-wallets-kit";
import { createContext, useContext, useState, type ReactNode } from "react";

// Create OUTSIDE component — never inside
const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 60_000 } } });
const isMainnet = process.env.NEXT_PUBLIC_USE_MAINNET === "true";

const kit = new StellarWalletsKit({
  network: isMainnet ? WalletNetwork.PUBLIC : WalletNetwork.TESTNET,
  selectedWalletId: FREIGHTER_ID,
  modules: [new FreighterModule()],
});

// Wallet context
const WalletContext = createContext<{ kit: typeof kit; address: string | null; connect: () => Promise<void> } | null>(null);

function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const connect = async () => {
    await kit.openModal({ onWalletSelected: async (opt) => {
      kit.setWallet(opt.id);
      const { address } = await kit.getAddress();
      setAddress(address);
    }});
  };
  return <WalletContext.Provider value={{ kit, address, connect }}>{children}</WalletContext.Provider>;
}

export const useWallet = () => {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be inside WalletProvider");
  return ctx;
};

// ORDER IS CRITICAL: QueryClientProvider → TrustlessWorkConfig → WalletProvider
export function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <TrustlessWorkConfig baseURL={isMainnet ? mainNet : development} apiKey={process.env.NEXT_PUBLIC_API_KEY ?? ""}>
        <WalletProvider>{children}</WalletProvider>
      </TrustlessWorkConfig>
    </QueryClientProvider>
  );
}

// ── 2. Create Escrow Component ─────────────────────────────────────────────
"use client";
import { useInitializeEscrow, useSendTransaction } from "@trustless-work/escrow/hooks";

export function CreateEscrowForm() {
  const { deployEscrow } = useInitializeEscrow();
  const { sendTransaction } = useSendTransaction();
  const { kit, address } = useWallet();

  const handleCreate = async () => {
    if (!address) return;

    // Step 1: Get unsigned XDR
    const { unsignedTransaction } = await deployEscrow({
      signer: address,
      engagementId: `order-${Date.now()}`,
      title: "Website Redesign",
      description: "Full redesign",
      amount: 1000,                             // ✅ number, not string
      roles: {
        approver: process.env.NEXT_PUBLIC_APPROVER_ADDRESS ?? "",
        serviceProvider: address,
        releaseSigner: process.env.NEXT_PUBLIC_PLATFORM_ADDRESS ?? "",
        disputeResolver: process.env.NEXT_PUBLIC_PLATFORM_ADDRESS ?? "",
        receiver: address,                      // only for single-release
        platformAddress: process.env.NEXT_PUBLIC_PLATFORM_ADDRESS ?? "",
      },
      platformFee: 2,                           // ✅ number, not string
      trustline: {
        address: process.env.NEXT_PUBLIC_USDC_ISSUER_ADDRESS ?? "",  // G… issuer
        symbol: "USDC",
      },
      milestones: [
        { title: "Mockups", description: "Figma mockups" },
        { title: "Dev", description: "React implementation" },
      ],
    }, "single-release");

    // Step 2: Sign with Issuer wallet
    const { signedTxXdr } = await kit.signTransaction(unsignedTransaction, {
      networkPassphrase: isMainnet ? WalletNetwork.PUBLIC : WalletNetwork.TESTNET,
      address,
    });

    // Step 3: Submit
    await sendTransaction({ signedXdr: signedTxXdr });
  };

  return <button onClick={handleCreate}>Create Escrow</button>;
}

// ── 3. Approve Milestone (Approver role only) ──────────────────────────────
"use client";
import { useApproveMilestone, useSendTransaction } from "@trustless-work/escrow/hooks";

export function ApproveMilestoneButton({ contractId, milestoneIndex }: { contractId: string; milestoneIndex: string }) {
  const { approveMilestone } = useApproveMilestone();
  const { sendTransaction } = useSendTransaction();
  const { kit, address } = useWallet();

  const handleApprove = async () => {
    // ALWAYS confirm — approval is irreversible on-chain
    if (!confirm("Approve this milestone? This cannot be undone.")) return;

    const { unsignedTransaction } = await approveMilestone({
      contractId,
      approver: address!,      // field is `approver`, not `signer`
      milestoneIndex,           // string e.g. '0'
    });

    const { signedTxXdr } = await kit.signTransaction(unsignedTransaction, {
      networkPassphrase: isMainnet ? WalletNetwork.PUBLIC : WalletNetwork.TESTNET,
      address: address!,
    });

    await sendTransaction({ signedXdr: signedTxXdr });
  };

  return <button onClick={handleApprove}>Approve Milestone {Number(milestoneIndex) + 1}</button>;
}

// ── 4. Read Escrows (no API key needed) ───────────────────────────────────
"use client";
import { useGetEscrowsFromIndexerBySigner } from "@trustless-work/escrow/hooks";
import { useEffect, useState } from "react";

export function EscrowList() {
  const { getEscrowsBySigner } = useGetEscrowsFromIndexerBySigner();
  const { address } = useWallet();
  const [escrows, setEscrows] = useState<any[]>([]);

  useEffect(() => {
    if (address) getEscrowsBySigner({ signer: address }).then(setEscrows);
  }, [address]);

  return (
    <ul>
      {escrows.map((e) => (
        <li key={e.contractId}>{e.title} — {e.contractId}</li>
      ))}
    </ul>
  );
}
```

---

## Example 3 — Blocks (Next.js App Router full layout)

Correct provider setup with all three providers in the right order.

```tsx
// ── app/layout.tsx (Server Component — no "use client") ───────────────────
import { type ReactNode } from "react";
import { Providers } from "@/components/Providers";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body><Providers>{children}</Providers></body>
    </html>
  );
}

// ── components/Providers.tsx ───────────────────────────────────────────────
"use client"; // ← REQUIRED — all providers use React Context

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { TrustlessWorkConfig, development, mainNet } from "@trustless-work/escrow";
import { WalletProvider } from "@/providers/WalletProvider";

// OUTSIDE component — avoid recreation on every render
const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000, retry: 2, refetchOnWindowFocus: false } },
});

export function Providers({ children }: { children: React.ReactNode }) {
  const isMainnet = process.env.NEXT_PUBLIC_USE_MAINNET === "true";
  return (
    // ── PROVIDER ORDER IS CRITICAL ─────────────────────────────────────
    // 1. QueryClientProvider   (outermost)
    // 2. TrustlessWorkConfig   (middle)
    // 3. WalletProvider        (inner)
    // ──────────────────────────────────────────────────────────────────
    <QueryClientProvider client={queryClient}>
      <TrustlessWorkConfig
        baseURL={isMainnet ? mainNet : development}
        apiKey={process.env.NEXT_PUBLIC_API_KEY ?? ""}
      >
        <WalletProvider>{children}</WalletProvider>
      </TrustlessWorkConfig>
      {process.env.NODE_ENV === "development" && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  );
}

// ── providers/WalletProvider.tsx ──────────────────────────────────────────
"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { StellarWalletsKit, WalletNetwork, FREIGHTER_ID, FreighterModule, AlbedoModule, xBullModule } from "@creit.tech/stellar-wallets-kit";

const isMainnet = process.env.NEXT_PUBLIC_USE_MAINNET === "true";

// Create kit at module scope
const kit = new StellarWalletsKit({
  network: isMainnet ? WalletNetwork.PUBLIC : WalletNetwork.TESTNET,
  selectedWalletId: FREIGHTER_ID,
  modules: [new FreighterModule(), new AlbedoModule(), new xBullModule()],
});

const WalletContext = createContext<{ kit: typeof kit; address: string | null; isConnected: boolean; connect: () => Promise<void>; disconnect: () => void } | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const connect = async () => {
    await kit.openModal({ onWalletSelected: async (opt) => {
      kit.setWallet(opt.id);
      const { address } = await kit.getAddress();
      setAddress(address);
    }});
  };
  return (
    <WalletContext.Provider value={{ kit, address, isConnected: !!address, connect, disconnect: () => setAddress(null) }}>
      {children}
    </WalletContext.Provider>
  );
}

export const useWallet = () => {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be inside WalletProvider");
  return ctx;
};
```
