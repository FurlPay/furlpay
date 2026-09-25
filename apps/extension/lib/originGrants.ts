// ---------------------------------------------------------------------------
// The wallet consent gate.
//
// WHY THIS FILE EXISTS, which is a testability argument rather than a structural
// one. These four functions are the extension's single most security-critical
// logic: they decide whether an arbitrary web page gets to learn the user's Safe
// address. The content script that relays a connect request runs on
// `https://*/*` — every HTTPS page on the internet — so this is the boundary
// between "a dapp the user chose to connect" and "any page that happens to be
// open".
//
// They lived as private functions inside entrypoints/background.ts, which meant
// they could not be imported and therefore had zero test coverage. The rest of
// lib/ is tested; the part that guards the wallet address was not. Extracting
// them changes no behaviour — the storage shape, the TTL, the cap and the
// eviction order are identical — and makes the guarantees assertable.
//
// THE THREAT MODEL, stated so the tests can be read against it:
//
//   * A hostile page must not be able to learn the Safe address without the user
//     having explicitly approved that origin.
//   * The origin must come from the BROWSER (`sender`), never from the page's own
//     message — a page can put anything in a postMessage payload, but it cannot
//     forge what Chrome reports as the sender's origin.
//   * A grant must EXPIRE. Domains change hands and dapps get compromised, so
//     yesterday's approval is not permanent permission.
//   * Storage must be bounded, or a page can grow it without limit by being
//     approved under endless subdomains.
// ---------------------------------------------------------------------------

export const ALLOWED_ORIGINS_KEY = "walletAllowedOrigins";

/**
 * Largest number of remembered origins.
 *
 * Bounds extension storage. Without it, an attacker who can get approvals under
 * many subdomains grows the record unboundedly; with it the oldest grant is
 * evicted, which also means an abusive pattern costs the attacker their own
 * earlier grants.
 */
export const MAX_ALLOWED_ORIGINS = 100;

/**
 * How long a granted origin stays remembered.
 *
 * A site the user connected to once is not a site they trust forever: domains
 * change hands and dapps get compromised, so a grant with no expiry means
 * yesterday's approval still hands out the Safe address today. Re-consent is one
 * click.
 */
export const ORIGIN_GRANT_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/** The slice of browser.storage.local this module needs, injected for tests. */
export interface OriginStore {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

/**
 * The page origin of a relayed connect request.
 *
 * THE SENDER IS THE AUTHORITY. Chrome populates `sender.origin` for
 * content-script messages and Firefox exposes only `sender.url`, so both are
 * handled — but both are set by the BROWSER. Nothing here reads the page's own
 * message payload, which is what makes the origin unforgeable by the page.
 *
 * `"null"` is rejected explicitly: that is the literal string Chrome uses for an
 * opaque origin (a sandboxed iframe, a `data:` URL). Treating it as an origin
 * would let every such context share one grant.
 */
export function senderOrigin(sender: { origin?: string; url?: string }): string | null {
  if (sender.origin && sender.origin !== "null") return sender.origin;
  try {
    return sender.url ? new URL(sender.url).origin : null;
  } catch {
    // An unparseable URL is not an origin. Returning null refuses the connect,
    // which is the safe direction.
    return null;
  }
}

/** The stored grant map, or an empty one if absent or malformed. */
export async function allowedOrigins(store: OriginStore): Promise<Record<string, number>> {
  const stored = await store.get(ALLOWED_ORIGINS_KEY);
  const val = stored[ALLOWED_ORIGINS_KEY];
  return val && typeof val === "object" ? (val as Record<string, number>) : {};
}

/**
 * Is this origin currently granted?
 *
 * An expired grant is treated as ABSENT and swept from storage, so the next
 * connect goes through the consent prompt rather than being silently honoured.
 */
export async function originGranted(
  store: OriginStore,
  origin: string,
  now: number = Date.now()
): Promise<boolean> {
  const allowed = await allowedOrigins(store);
  const grantedAt = allowed[origin];
  if (typeof grantedAt !== "number") return false;
  if (now - grantedAt <= ORIGIN_GRANT_TTL_MS) return true;

  // Expired. Sweep every expired entry while we are here, not just this one.
  const fresh = Object.fromEntries(
    Object.entries(allowed).filter(([, at]) => now - at <= ORIGIN_GRANT_TTL_MS)
  );
  await store.set({ [ALLOWED_ORIGINS_KEY]: fresh });
  return false;
}

/**
 * Record a grant, evicting the oldest if the cap is reached.
 *
 * Sorted ascending by grant time and sliced from the end, so the retained set is
 * the most RECENTLY granted — the ones a user is most likely to still be using.
 */
export async function rememberOrigin(
  store: OriginStore,
  origin: string,
  now: number = Date.now()
): Promise<void> {
  const allowed = await allowedOrigins(store);
  allowed[origin] = now;
  const entries = Object.entries(allowed)
    .sort((a, b) => a[1] - b[1])
    .slice(-MAX_ALLOWED_ORIGINS);
  await store.set({ [ALLOWED_ORIGINS_KEY]: Object.fromEntries(entries) });
}

/** Forget a single origin — the user revoking a site. */
export async function revokeOrigin(store: OriginStore, origin: string): Promise<boolean> {
  const allowed = await allowedOrigins(store);
  if (!(origin in allowed)) return false;
  delete allowed[origin];
  await store.set({ [ALLOWED_ORIGINS_KEY]: allowed });
  return true;
}
