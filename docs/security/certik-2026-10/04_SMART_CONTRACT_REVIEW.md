# 04 — Smart contract review

No FurlPay EVM contract is deployed: `packages/contracts/deployment.yaml` holds
no addresses. Source changes therefore need no migration.

| Contract | Finding | Result |
|---|---|---|
| PolicyManager | F-6 unbounded checks | `MAX_CHECKS = 16`, duplicates refused, 4 new tests including a gas bound. |
| FurlPayRouter | F-1 mutable treasury | Accepted: immediate rotation is the documented incident response; the owner must be a multisig. |
| FurlPayRouter | F-2, F-34 | Informational; confirmed. |
| FurlPayEscrow | F-3 oracle | Accepted with a multisig oracle; a compromised oracle can only release early, to the recorded provider. |
| FurlPayEscrow | F-4 | Product decision. |
| X402Facilitator | F-5 | False positive: `uint64` seconds do not overflow in 2106. |
| ComplianceEscrow | F-35 | Not a vulnerability; the event carries the value, and 0 = disabled is documented. |

Hardhat: 72 passing, 2 pending. Slither, fuzzing and formal verification were
not run in this pass and are recommended for the CertiK engagement.
