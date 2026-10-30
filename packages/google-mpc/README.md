# @furlpay/google-mpc

<p align="center">
  <img src="https://img.shields.io/badge/Google_Cloud-4285F4?style=for-the-badge&logo=google-cloud&logoColor=white" alt="Google Cloud" />
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/MPC-Threshold_Signing-FF6F00?style=for-the-badge" alt="MPC" />
  <img src="https://img.shields.io/badge/Cedar-Policy_Engine-232F3E?style=for-the-badge" alt="Cedar" />
  <img src="https://img.shields.io/badge/Solana-9945FF?style=for-the-badge&logo=solana&logoColor=white" alt="Solana" />
  <img src="https://img.shields.io/badge/Ethereum-3C3C3D?style=for-the-badge&logo=ethereum&logoColor=white" alt="Ethereum" />
</p>

> **Google Cloud Multi-Party Compute (MPC) v1beta client for FurlPay's 2-of-3 threshold signing architecture.**

> [!IMPORTANT]
> Google Cloud MPC is in **private preview** (announced Oct 28, 2026). This package is an integration-ready client built from the publicly described API surface. Endpoint paths and schemas may change before GA (early 2027).

## Architecture

```mermaid
flowchart TD
    subgraph KC["2-of-3 Threshold MPC Key Circle"]
        direction LR
        A["Share A\nGoogle Cloud\nConfidential Space\n(TEE: AMD SEV-SNP)"]
        B["Share B\nFurlPay\nSovereign\nInfrastructure"]
        C["Share C\nCustomer HSM /\nInstitutional\nCustodian"]
    end

    subgraph PE["Cedar Policy Engine"]
        P1["Max Txn Amount"]
        P2["Allowed Recipients"]
        P3["Velocity Limits"]
        P4["Sanctions Check"]
        P5["Human Approval"]
    end

    TX["Transaction Request"] --> PE
    PE -->|"All Policies Pass"| KC
    PE -->|"Any Policy Forbids"| DENY["Signing Denied"]

    A -->|"Partial Sig"| COMBINE["Combine\n(any 2 of 3)"]
    B -->|"Partial Sig"| COMBINE
    C -->|"Partial Sig"| COMBINE

    COMBINE --> SIG["Valid ECDSA / EdDSA\nSignature"]
    SIG --> CHAIN["Broadcast to\nEthereum - Solana\nArbitrum - Base"]

    style A fill:#4285F4,color:#fff
    style B fill:#FF6F00,color:#fff
    style C fill:#7B1FA2,color:#fff
    style DENY fill:#D32F2F,color:#fff
    style SIG fill:#2E7D32,color:#fff
    style COMBINE fill:#1565C0,color:#fff
```

The full private key is **never reconstructed**. Each share holder produces a partial signature, and any 2-of-3 partials combine into a valid ECDSA/EdDSA signature indistinguishable from a single-signer output.

## Signing Flow

```mermaid
sequenceDiagram
    participant App as FurlPay App
    participant Risk as Risk Engine
    participant Seam as GoogleMpcSigner
    participant Cedar as Cedar Policies
    participant MPC as Google Cloud MPC
    participant Chain as Blockchain

    App->>Risk: Evaluate transaction
    Risk-->>App: Approved

    App->>Seam: sign(txHash, metadata, policy)
    Seam->>Cedar: Evaluate policies
    Cedar-->>Seam: All PERMIT, no FORBID

    Seam->>MPC: POST /keyCircles/{id}:sign
    MPC-->>MPC: Threshold signing (2-of-3)
    MPC-->>Seam: signature, state: COMPLETED

    Seam-->>App: MpcSignResult
    App->>Chain: Broadcast signed transaction
    Chain-->>App: Transaction hash
```

## Features

| Feature | Description |
|:--------|:------------|
| **Key Circle Management** | Create, list, get, delete key circles with configurable threshold (T-of-N) |
| **Threshold Signing** | Initiate signing operations, poll for completion, wait for async approvals |
| **Cedar Transaction Policies** | Build, validate, and manage Cedar policy rules for transaction authorization |
| **Confidential Space Attestation** | Verify TEE attestation tokens (AMD SEV-SNP / Intel TDX) |
| **Integration Seam** | Drop-in replacement for `@furlpay/security`'s mock MPC signer |
| **Zero Dependencies** | Uses native `fetch()` and `node:crypto` only |

## Installation

```bash
npm install @furlpay/google-mpc
```

## Quick Start

```typescript
import { GoogleMpcSigner } from "@furlpay/google-mpc";

// Auto-configures from environment variables
const signer = GoogleMpcSigner.fromEnv();

// Sign a transaction hash (mock in dev, real MPC in production)
const result = await signer.sign(transactionHash, {
  chain: "ethereum",
  to: "0x...",
  value: "1000000",
  tokenContract: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  tokenSymbol: "USDC",
});

console.log(result.signature); // 0x...
console.log(result.cosigned);  // true
console.log(result.shares);    // ["A", "B"]
```

### Cedar Transaction Policies

```typescript
import {
  maxTransactionAmount,
  allowedRecipients,
  velocityLimit,
  sanctionsCheck,
  allowedChains,
} from "@furlpay/google-mpc/cedar";

const policies = [
  maxTransactionAmount(50_000),                    // Forbid txns > $50K
  allowedRecipients(["0xABC...", "0xDEF..."]),     // Only known addresses
  velocityLimit(200_000, 86400),                   // Max $200K/day
  sanctionsCheck(),                                // Block sanctioned addresses
  allowedChains(["ethereum", "solana"]),            // Only these chains
];
```

### Direct API Client

```typescript
import { GoogleMpcClient } from "@furlpay/google-mpc";

const client = new GoogleMpcClient({
  projectId: "my-project",
  location: "us-central1",
  serviceAccountKey: JSON.parse(process.env.GOOGLE_MPC_SERVICE_ACCOUNT_KEY!),
});

// Create a 2-of-3 key circle
const keyCircle = await client.createKeyCircle({
  parent: "projects/my-project/locations/us-central1",
  keyCircleId: "treasury-001",
  displayName: "FurlPay Treasury",
  algorithm: "ECDSA_SECP256K1",
  threshold: 2,
  shareHolders: ["GOOGLE_CLOUD", "CUSTOMER", "CUSTODIAN"],
});

// Sign with policy enforcement
const signResult = await client.sign({
  keyCircleName: keyCircle.name,
  payload: txHash,
  payloadType: "TRANSACTION_HASH",
  chain: "ethereum",
  transactionMetadata: { chain: "ethereum", to: "0x...", value: "0" },
});

const finalResult = await client.waitForSignature(signResult.operationName);
```

## Environment Variables

| Variable | Required | Description |
|:---------|:---------|:------------|
| `GOOGLE_MPC_PROJECT_ID` | Yes (prod) | Google Cloud project ID |
| `GOOGLE_MPC_LOCATION` | Yes (prod) | Google Cloud region (e.g. `us-central1`) |
| `GOOGLE_MPC_KEY_CIRCLE` | Yes (prod) | Key circle resource name for signing |
| `GOOGLE_MPC_SERVICE_ACCOUNT_KEY` | Yes (prod) | Service account key JSON |
| `GOOGLE_MPC_ACCESS_TOKEN` | Optional | Pre-obtained access token (overrides SA key) |
| `GOOGLE_MPC_BASE_URL` | Optional | Override API base URL (testing) |

## Module Structure

```
packages/google-mpc/
├── src/
│   ├── types.ts              # Core type definitions
│   ├── client.ts             # Google MPC REST API client
│   ├── cedar.ts              # Cedar policy builder helpers
│   ├── confidential-space.ts # TEE attestation verification
│   └── seam.ts               # Drop-in replacement for mock MPC
├── tests/
│   └── google-mpc.test.ts    # 20 tests (node:test)
├── index.ts                  # Barrel exports
├── package.json
├── tsconfig.json
└── LICENSE
```

## License

MIT - FurlPay
