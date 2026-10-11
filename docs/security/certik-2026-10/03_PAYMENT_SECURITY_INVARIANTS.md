# 03 — Payment security invariants

The general list lives in `docs/security/SECURITY-INVARIANTS.md`. This pass
adds or tightens the following, each with a test (see 08).

1. **A single-use AP2 mandate authorizes at most one cart, across every
   instance.** One Redis `SET NX` per nonce, retained until the mandate
   expires; mandates valid longer than the retention ceiling (30 days) are
   refused. (F-13)
2. **A refused cart consumes no nonce.** The claim runs after every check that
   can reject. (F-13)
3. **An unreachable replay store refuses the authorization (503).** It never
   falls back to per-instance memory in production. (F-12, F-13)
4. **AP2 amounts are compared exactly.** Integer atomic units at six decimals;
   the cart total equals the sum of its lines exactly and never exceeds the
   intent's cap; values finer than six places are refused, never rounded.
   (F-14)
5. **No request body is read beyond its cap**, including chunked bodies that
   declare no length. (F-10, F-38)
6. **x402 prices a non-USD asset only from an operator-configured, bounded
   rate.** (F-32)
7. **No mock signing model runs in production.** (F-21)
