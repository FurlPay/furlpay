# 06 — Cryptography and signing (what actually runs)

| Mechanism | Where | Real or mock |
|---|---|---|
| Session tokens | HS256 (jose), algorithm pinned | Real |
| x402 quote binding | HMAC-SHA256 with `X402_QUOTE_SECRET`, `timingSafeEqual` | Real; no default secret |
| EIP-3009 / EIP-191 / EIP-712 verification | viem | Real |
| AP2 mandates | Ed25519 (Node crypto), canonical JSON | Real |
| Webhook signatures | HMAC-SHA256 over the raw text, constant time | Real |
| "MPC" (`packages/security/src/mpc.ts`) | HMAC digest padded to 65 bytes | **Mock.** Not MPC and not a signature; no callers; refuses to run in production (F-21). |
| Solana fee payer for cNFT mints | raw `SOLANA_PAYER_SECRET` | Real key, used only by flows refused in production (F-24). |

There is no production MPC or managed-key signing today. Describing the
platform as using MPC would be inaccurate until a provider is integrated.
