import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { kvGet, kvSet } from "@/lib/kv";

// ---------------------------------------------------------------------------
// Per-partner ramp configuration.
//
// A partner is a FurlPay merchant account (the owner of the API keys it
// embeds). Ramp access is NOT a key scope: publishable keys may hold only
// `:read` scopes (apiKeyScopeSemantics.spec), and opening checkouts is not a
// read. So it is a separate switch, off by default, that only an ops admin can
// turn on (POST /api/ops/ramp-partners) — a merchant cannot grant itself the
// ability to open provider checkouts under FurlPay's provider account.
//
// The merchant controls its own callback: a webhook URL and a signing secret
// FurlPay generates, shows once, and stores encrypted (AES-256-GCM, key
// FURLPAY_PARTNER_WEBHOOK_KEY). HMAC signing needs the secret itself, so it
// cannot be hashed; with no key configured nothing is stored.
//
// KV: ramp:partner:{partnerId}:config
// ---------------------------------------------------------------------------

export interface PartnerRampConfig {
  partnerId: string;
  rampEnabled: boolean;
  enabledBy?: string;
  enabledAt?: string;
  disabledReason?: string;
  webhookUrl?: string;
  webhookSecretEnc?: string;
  webhookSecretLast4?: string;
  updatedAt: string;
}

const key = (partnerId: string) => `ramp:partner:${partnerId}:config`;

export class PartnerWebhookKeyUnavailable extends Error {
  constructor() {
    super("FURLPAY_PARTNER_WEBHOOK_KEY is not set to a base64 32-byte key.");
    this.name = "PartnerWebhookKeyUnavailable";
  }
}

function encKey(): Buffer {
  const raw = (process.env.FURLPAY_PARTNER_WEBHOOK_KEY ?? "").trim();
  const k = raw ? Buffer.from(raw, "base64") : Buffer.alloc(0);
  if (k.length !== 32) throw new PartnerWebhookKeyUnavailable();
  return k;
}

function seal(secret: string, partnerId: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", encKey(), iv);
  c.setAAD(Buffer.from(partnerId, "utf8"));
  const ct = Buffer.concat([c.update(secret, "utf8"), c.final()]);
  return "v1:" + Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
}

export function openWebhookSecret(cfg: PartnerRampConfig): string | null {
  if (!cfg.webhookSecretEnc?.startsWith("v1:")) return null;
  const buf = Buffer.from(cfg.webhookSecretEnc.slice(3), "base64");
  const d = createDecipheriv("aes-256-gcm", encKey(), buf.subarray(0, 12));
  d.setAAD(Buffer.from(cfg.partnerId, "utf8"));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8");
}

export async function getPartnerConfig(partnerId: string): Promise<PartnerRampConfig> {
  return (
    (await kvGet<PartnerRampConfig>(key(partnerId))) ?? {
      partnerId,
      rampEnabled: false,
      updatedAt: new Date(0).toISOString(),
    }
  );
}

/** Ops only (the route checks the role). */
export async function setRampEnabled(
  partnerId: string,
  enabled: boolean,
  actor: string,
  reason: string
): Promise<PartnerRampConfig> {
  const cfg = await getPartnerConfig(partnerId);
  const now = new Date().toISOString();
  const next: PartnerRampConfig = enabled
    ? { ...cfg, rampEnabled: true, enabledBy: actor, enabledAt: now, disabledReason: undefined, updatedAt: now }
    : { ...cfg, rampEnabled: false, disabledReason: reason, updatedAt: now };
  await kvSet(key(partnerId), next);
  return next;
}

/** Set the callback URL and mint a fresh signing secret. Returns the secret ONCE. */
export async function setPartnerWebhook(
  partnerId: string,
  webhookUrl: string
): Promise<{ config: PartnerRampConfig; secret: string }> {
  const secret = `whsec_${randomBytes(24).toString("base64url")}`;
  const cfg = await getPartnerConfig(partnerId);
  const next: PartnerRampConfig = {
    ...cfg,
    webhookUrl,
    webhookSecretEnc: seal(secret, partnerId),
    webhookSecretLast4: secret.slice(-4),
    updatedAt: new Date().toISOString(),
  };
  await kvSet(key(partnerId), next);
  return { config: next, secret };
}

export async function clearPartnerWebhook(partnerId: string): Promise<PartnerRampConfig> {
  const cfg = await getPartnerConfig(partnerId);
  const next: PartnerRampConfig = {
    ...cfg,
    webhookUrl: undefined,
    webhookSecretEnc: undefined,
    webhookSecretLast4: undefined,
    updatedAt: new Date().toISOString(),
  };
  await kvSet(key(partnerId), next);
  return next;
}

/** Wire-safe view: never the secret, sealed or not. */
export function publicPartnerConfig(cfg: PartnerRampConfig) {
  return {
    partnerId: cfg.partnerId,
    rampEnabled: cfg.rampEnabled,
    enabledAt: cfg.enabledAt ?? null,
    webhookUrl: cfg.webhookUrl ?? null,
    webhookSecretLast4: cfg.webhookSecretLast4 ?? null,
    updatedAt: cfg.updatedAt,
  };
}
