// ---------------------------------------------------------------------------
// Google Cloud MPC v1beta REST client.
//
// PROPOSED INTEGRATION — Google Cloud MPC is in private preview (Oct 2026).
// This client is built from the publicly described API surface. The actual
// endpoint paths, request/response schemas, and authentication flows may
// differ when the API becomes generally available in early 2027.
//
// The client uses native fetch() (Node 20+) and node:crypto. Zero runtime
// dependencies.
//
// Authentication: Google Cloud service account → JWT → access token exchange
// via the OAuth2 token endpoint (https://oauth2.googleapis.com/token).
// ---------------------------------------------------------------------------

import crypto from "node:crypto";
import type {
  GoogleMpcConfig,
  ServiceAccountKey,
  KeyCircle,
  CreateKeyCircleRequest,
  SignRequest,
  SignResult,
  TransactionPolicy,
  CreatePolicyRequest,
} from "./types.js";

// ── JWT / OAuth2 ────────────────────────────────────────────────────────────

const TOKEN_URI = "https://oauth2.googleapis.com/token";
const MPC_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const JWT_LIFETIME_SECS = 3600;

interface AccessTokenEntry {
  token: string;
  expiresAt: number;
}

/**
 * Create a signed JWT for service account authentication.
 *
 * The JWT is signed with the service account's RSA private key and exchanged
 * for an access token at the OAuth2 token endpoint.
 */
function createServiceAccountJwt(sa: ServiceAccountKey): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: sa.client_email,
    scope: MPC_SCOPE,
    aud: TOKEN_URI,
    iat: now,
    exp: now + JWT_LIFETIME_SECS,
  };

  const b64Header = Buffer.from(JSON.stringify(header)).toString("base64url");
  const b64Payload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const unsigned = `${b64Header}.${b64Payload}`;

  const signature = crypto
    .createSign("RSA-SHA256")
    .update(unsigned)
    .sign(sa.private_key, "base64url");

  return `${unsigned}.${signature}`;
}

/** Exchange a service-account JWT for an access token. */
async function exchangeJwtForToken(jwt: string): Promise<AccessTokenEntry> {
  const res = await fetch(TOKEN_URI, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${text}`);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  return {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000 - 60_000, // 1 min buffer
  };
}

// ── Retry helper ────────────────────────────────────────────────────────────

const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  maxRetries: number,
  timeoutMs: number
): Promise<Response> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timer);

      if (res.ok || !RETRYABLE_STATUSES.has(res.status)) return res;

      lastError = new Error(`HTTP ${res.status}: ${await res.text()}`);
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
    }

    if (attempt < maxRetries) {
      // Exponential backoff: 200ms, 400ms, 800ms, ...
      const delay = 200 * Math.pow(2, attempt) + Math.random() * 100;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError ?? new Error("Request failed after retries");
}

// ── Client ──────────────────────────────────────────────────────────────────

/**
 * Google Cloud MPC v1beta REST client.
 *
 * Provides typed methods for key circle management, threshold signing, and
 * Cedar transaction policy administration. All methods throw on API errors
 * with descriptive messages.
 *
 * PROPOSED INTEGRATION — the API is in private preview and the endpoint
 * paths may change before general availability.
 */
export class GoogleMpcClient {
  private readonly config: Required<
    Pick<GoogleMpcConfig, "projectId" | "location" | "timeoutMs" | "maxRetries">
  > & Pick<GoogleMpcConfig, "serviceAccountKey" | "accessToken" | "baseUrl">;

  private cachedToken: AccessTokenEntry | null = null;

  constructor(config: GoogleMpcConfig) {
    this.config = {
      projectId: config.projectId,
      location: config.location,
      serviceAccountKey: config.serviceAccountKey,
      accessToken: config.accessToken,
      baseUrl: config.baseUrl ?? "https://mpc.googleapis.com",
      timeoutMs: config.timeoutMs ?? 30_000,
      maxRetries: config.maxRetries ?? 3,
    };
  }

  /** The resource parent for this project + location. */
  private get parent(): string {
    return `projects/${this.config.projectId}/locations/${this.config.location}`;
  }

  /** Resolve a valid access token (from config or by exchanging a SA JWT). */
  private async getAccessToken(): Promise<string> {
    // Direct token takes precedence
    if (this.config.accessToken) return this.config.accessToken;

    // Check cached token
    if (this.cachedToken && Date.now() < this.cachedToken.expiresAt) {
      return this.cachedToken.token;
    }

    // Exchange service account JWT
    if (!this.config.serviceAccountKey) {
      throw new Error(
        "GoogleMpcClient: no accessToken or serviceAccountKey provided. " +
        "Set GOOGLE_MPC_ACCESS_TOKEN or GOOGLE_MPC_SERVICE_ACCOUNT_KEY."
      );
    }

    const jwt = createServiceAccountJwt(this.config.serviceAccountKey);
    this.cachedToken = await exchangeJwtForToken(jwt);
    return this.cachedToken.token;
  }

  /** Make an authenticated request to the MPC API. */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const token = await this.getAccessToken();
    const url = `${this.config.baseUrl}/v1beta/${path}`;

    const init: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-Goog-User-Project": this.config.projectId,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    };

    const res = await fetchWithRetry(url, init, this.config.maxRetries, this.config.timeoutMs);

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Google MPC API error (${res.status} ${method} ${path}): ${text}`);
    }

    // 204 No Content
    if (res.status === 204) return undefined as T;

    return (await res.json()) as T;
  }

  // ── Key Circles ───────────────────────────────────────────────────────

  /**
   * Create a new key circle with the specified threshold and share holders.
   *
   * For FurlPay's 2-of-3 model:
   * ```
   * await client.createKeyCircle({
   *   parent: "projects/my-project/locations/us-central1",
   *   keyCircleId: "furlpay-treasury-001",
   *   displayName: "FurlPay Treasury Key",
   *   algorithm: "ECDSA_SECP256K1",
   *   threshold: 2,
   *   shareHolders: ["GOOGLE_CLOUD", "CUSTOMER", "CUSTODIAN"],
   * });
   * ```
   */
  async createKeyCircle(req: CreateKeyCircleRequest): Promise<KeyCircle> {
    return this.request<KeyCircle>("POST", `${req.parent}/keyCircles`, {
      keyCircleId: req.keyCircleId,
      displayName: req.displayName,
      algorithm: req.algorithm,
      threshold: req.threshold,
      shareHolders: req.shareHolders,
      labels: req.labels,
    });
  }

  /** Get a key circle by resource name. */
  async getKeyCircle(name: string): Promise<KeyCircle> {
    return this.request<KeyCircle>("GET", name);
  }

  /** List key circles in this project/location. */
  async listKeyCircles(opts?: { pageSize?: number; pageToken?: string }): Promise<{
    keyCircles: KeyCircle[];
    nextPageToken?: string;
  }> {
    const params = new URLSearchParams();
    if (opts?.pageSize) params.set("pageSize", String(opts.pageSize));
    if (opts?.pageToken) params.set("pageToken", opts.pageToken);
    const qs = params.toString();
    return this.request("GET", `${this.parent}/keyCircles${qs ? "?" + qs : ""}`);
  }

  /** Delete (destroy) a key circle. This is irreversible. */
  async deleteKeyCircle(name: string): Promise<void> {
    await this.request<void>("DELETE", name);
  }

  // ── Signing ───────────────────────────────────────────────────────────

  /**
   * Initiate a threshold-signing operation.
   *
   * The signing operation may complete immediately or transition to
   * AWAITING_APPROVAL if policies require human approval. Poll with
   * getSignOperation() until the state is COMPLETED or FAILED.
   */
  async sign(req: SignRequest): Promise<SignResult> {
    return this.request<SignResult>("POST", `${req.keyCircleName}:sign`, {
      payload: req.payload,
      payloadType: req.payloadType,
      chain: req.chain,
      transactionMetadata: req.transactionMetadata,
      requestId: req.requestId,
    });
  }

  /** Poll a signing operation by its resource name. */
  async getSignOperation(operationName: string): Promise<SignResult> {
    return this.request<SignResult>("GET", operationName);
  }

  /**
   * Poll a signing operation until it reaches a terminal state.
   *
   * @param operationName - The operation resource name from sign().
   * @param pollIntervalMs - How often to poll. Default 1000ms.
   * @param maxWaitMs - Maximum time to wait. Default 120000ms (2 min).
   * @returns The final sign result.
   * @throws If the operation fails or times out.
   */
  async waitForSignature(
    operationName: string,
    pollIntervalMs = 1000,
    maxWaitMs = 120_000
  ): Promise<SignResult> {
    const deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline) {
      const result = await this.getSignOperation(operationName);
      if (result.state === "COMPLETED" || result.state === "FAILED" || result.state === "CANCELLED") {
        if (result.state === "FAILED") {
          throw new Error(`Signing operation failed: ${result.error ?? "unknown error"}`);
        }
        if (result.state === "CANCELLED") {
          throw new Error("Signing operation was cancelled");
        }
        return result;
      }
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }
    throw new Error(`Signing operation timed out after ${maxWaitMs}ms`);
  }

  // ── Policies ──────────────────────────────────────────────────────────

  /** Create a Cedar transaction policy on a key circle. */
  async createPolicy(req: CreatePolicyRequest): Promise<TransactionPolicy> {
    return this.request<TransactionPolicy>(
      "POST",
      `${req.keyCircleName}/policies`,
      {
        policyId: req.policyId,
        displayName: req.displayName,
        cedarPolicy: req.cedarPolicy,
        effect: req.effect,
        enabled: req.enabled ?? true,
      }
    );
  }

  /** Get a policy by resource name. */
  async getPolicy(name: string): Promise<TransactionPolicy> {
    return this.request<TransactionPolicy>("GET", name);
  }

  /** List policies for a key circle. */
  async listPolicies(keyCircleName: string): Promise<{ policies: TransactionPolicy[] }> {
    return this.request("GET", `${keyCircleName}/policies`);
  }

  /** Update a policy (partial update — only provided fields are changed). */
  async updatePolicy(
    name: string,
    update: Partial<Pick<TransactionPolicy, "displayName" | "cedarPolicy" | "effect" | "enabled">>
  ): Promise<TransactionPolicy> {
    const fields = Object.keys(update).join(",");
    return this.request<TransactionPolicy>("PATCH", `${name}?updateMask=${fields}`, update);
  }

  /** Delete a policy. */
  async deletePolicy(name: string): Promise<void> {
    await this.request<void>("DELETE", name);
  }
}
