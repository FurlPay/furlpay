// One parser for `*_RPC_URL` values (ARC-P3-002). They may hold a comma-separated
// failover list; the merchant reader, x402 settlement, the chain registry and the
// Arc rail all read the same variables and must agree on what they mean.
// Only https (or plain http to a local node) counts as an endpoint.
export function rpcEndpointList(value: string | undefined | null): string[] {
  const urls = (value ?? "").split(",").map(u => u.trim())
    .filter(u => /^https:\/\//.test(u) || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(u + "/"));
  return [...new Set(urls)];
}

/** The first configured endpoint, for single-endpoint readers. */
export function firstRpcUrl(value: string | undefined | null): string | undefined {
  return rpcEndpointList(value)[0];
}
