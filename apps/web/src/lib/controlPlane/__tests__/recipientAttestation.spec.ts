import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PgHarness } from "./pgHarness";

// ---------------------------------------------------------------------------
// The attested-recipient store, attacked.
//
// WHY THIS SUBSYSTEM EXISTS. Until migration 0021 the recipient verifier
// returned `recipient_unknown` unconditionally. That failed closed, which was
// right, but it also meant no recipient-bound payment could be authorized at
// all. The store is the smallest thing that makes the already-tested
// `verifyRecipient()` usable without inventing an attestation provider.
//
// THE THREAT THIS IS REALLY ABOUT. An attacker who can influence the
// destination address of an authorized payment does not need to defeat the
// mandate, the delegation chain, the drift engine or the signature. They need
// the money to land somewhere else. Every test below is a different way of
// asking "can the address be changed to one the organization did not vouch
// for?" — and each must answer no.
//
// Runs against a real PostgreSQL engine through the real store code. The
// harness translates the store's real PostgREST query strings into SQL, so a
// query that loses its tenant filter makes these reads start succeeding.
// ---------------------------------------------------------------------------

let pg: PgHarness;
let store: typeof import("../recipientStore");

const ORG_A = "org_recip_a";
const ORG_B = "org_recip_b";

// Deliberately mixed case: EIP-55 checksum form. Every lookup must still match.
const ADDR = "0xAbCdEf0123456789AbCdEf0123456789AbCdEf01";
const ADDR_LOWER = ADDR.toLowerCase();
const ADDR_UPPER = "0xABCDEF0123456789ABCDEF0123456789ABCDEF01";

async function seedOrg(org: string, user: string) {
  await pg.sql(`insert into cp_organizations (id, name, owner_user_id) values ($1,$2,$3)`, [
    org,
    org,
    user,
  ]);
}

beforeAll(async () => {
  process.env.SUPABASE_URL = "http://pglite.local";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "harness-service-role";
  const { startPg } = await import("./pgHarness");
  pg = await startPg();
  store = await import("../recipientStore");
  await seedOrg(ORG_A, "user_recip_a");
  await seedOrg(ORG_B, "user_recip_b");
}, 120_000);

afterAll(async () => {
  pg?.restore();
  await pg?.db.close();
});

/** An ACTIVE recipient with one live attestation on Base for USDC. */
async function activeRecipient(org: string, id: string, address = ADDR) {
  await store.upsertRecipient({
    organizationId: org,
    recipientId: id,
    displayName: id,
    status: "ACTIVE",
  });
  await store.attestDestination({
    organizationId: org,
    recipientId: id,
    networkId: "base",
    asset: "USDC",
    address,
    method: "human_confirmed",
    provenance: "user:test",
  });
}

const check = (over: Partial<Parameters<typeof store.checkRecipient>[0]> = {}) =>
  store.checkRecipient({
    organizationId: ORG_A,
    recipientId: "rcp_main",
    destination: ADDR,
    networkId: "base",
    asset: "USDC",
    amountAtomic: "1000000",
    requireMainnet: false,
    ...over,
  });

// ───────────────────────────────────────────────────────────────────────────

describe("the control: a properly attested destination is payable", () => {
  beforeAll(async () => {
    await activeRecipient(ORG_A, "rcp_main");
  });

  it("accepts the attested address and returns the canonical form", async () => {
    const v = await check();
    expect(v.ok, v.detail).toBe(true);
    expect(v.canonicalDestination).toBe(ADDR_LOWER);
  });

  it("labels it as an enterprise allowlist entry, not a FurlPay verification", async () => {
    // The whole point of keeping three trust classes: an operator reading the
    // evidence must be able to tell that nobody independently checked this.
    const v = await check();
    expect(v.trustClass).toBe("enterprise_allowlisted");
    expect(v.attestation?.provenance).toBe("user:test");
  });

  it("reports firstUse, because no payment to it has ever settled", async () => {
    // Derived from SETTLED payments only. If it were derived from
    // authorizations, an attacker could launder a fresh destination into
    // "familiar" using requests that were all denied.
    const v = await check();
    expect(v.firstUse).toBe(true);
  });
});

describe("address canonicalisation cannot be used to smuggle a different address", () => {
  it("matches regardless of EIP-55 case on either side", async () => {
    // Same account on-chain. If one side lowercased and the other did not, a
    // legitimate payment would be refused — and worse, someone would 'fix' it
    // by relaxing the comparison.
    expect((await check({ destination: ADDR_LOWER })).ok).toBe(true);
    expect((await check({ destination: ADDR_UPPER })).ok).toBe(true);
    expect((await check({ destination: `  ${ADDR}  ` })).ok).toBe(true);
  });

  it("refuses an address that differs by one character", async () => {
    const off = ADDR.slice(0, -1) + "2";
    const v = await check({ destination: off });
    expect(v.ok).toBe(false);
    expect(v.reason).toBe("destination_not_attested");
  });

  it("refuses an address-poisoning lookalike sharing both ends", async () => {
    // The classic: same first and last four characters, different middle. A
    // human comparing a truncated address sees a match.
    const poisoned = ADDR.slice(0, 6) + "9999999999999999999999999999" + ADDR.slice(-4);
    const v = await check({ destination: poisoned });
    expect(v.ok).toBe(false);
  });

  it("refuses a malformed address outright", async () => {
    for (const bad of ["not-an-address", "0x", "0xZZZ", ADDR + "00", ""]) {
      const v = await check({ destination: bad });
      expect(v.ok, `accepted ${JSON.stringify(bad)}`).toBe(false);
    }
  });

  it("refuses a payment that names no destination at all", async () => {
    // A payment with no address cannot have had its address checked. Treating
    // "absent" as "nothing to verify, therefore fine" is the whole bug class.
    const v = await check({ destination: undefined });
    expect(v.ok).toBe(false);
    expect(v.reason).toBe("destination_not_attested");
  });
});

describe("an attestation is bound to its network and asset, never to the recipient alone", () => {
  it("refuses the same address on a different network", async () => {
    // The same string is a valid address on every EVM chain and can be a
    // completely unrelated account on each. "Their address" is not a fact
    // independent of the chain.
    const v = await check({ networkId: "arbitrum_one" });
    expect(v.ok).toBe(false);
    expect(v.reason).toBe("destination_attested_on_other_network");
    expect(v.detail).toMatch(/base/);
  });

  it("refuses the same address for a different asset", async () => {
    const v = await check({ asset: "USDT" });
    expect(v.ok).toBe(false);
    expect(v.reason).toBe("asset_not_attested");
  });

  it("refuses an unknown network rather than defaulting to a known one", async () => {
    const v = await check({ networkId: "not-a-real-chain" });
    expect(v.ok).toBe(false);
    expect(v.reason).toBe("network_unknown");
  });

  it("refuses a testnet when mainnet is required", async () => {
    await activeRecipient(ORG_A, "rcp_testnet");
    await store.attestDestination({
      organizationId: ORG_A,
      recipientId: "rcp_testnet",
      networkId: "base_sepolia",
      asset: "USDC",
      address: ADDR,
      method: "human_confirmed",
      provenance: "user:test",
    });
    const v = await check({
      recipientId: "rcp_testnet",
      networkId: "base_sepolia",
      requireMainnet: true,
    });
    expect(v.ok).toBe(false);
    expect(v.reason).toBe("network_not_mainnet");
  });
});

describe("status and staleness fail closed", () => {
  it("refuses a PENDING recipient, so creating one does not authorize anything", async () => {
    await store.upsertRecipient({
      organizationId: ORG_A,
      recipientId: "rcp_pending",
      displayName: "pending",
    }); // defaults to PENDING
    await store.attestDestination({
      organizationId: ORG_A,
      recipientId: "rcp_pending",
      networkId: "base",
      asset: "USDC",
      address: ADDR,
      method: "human_confirmed",
      provenance: "user:test",
    });
    const v = await check({ recipientId: "rcp_pending" });
    expect(v.ok).toBe(false);
    expect(v.reason).toBe("recipient_pending");
  });

  it("refuses a BLOCKED recipient", async () => {
    await activeRecipient(ORG_A, "rcp_blocked");
    await pg.sql(`update cp_recipients set status='BLOCKED' where id='rcp_blocked'`);
    const v = await check({ recipientId: "rcp_blocked" });
    expect(v.ok).toBe(false);
    expect(v.reason).toBe("recipient_blocked");
  });

  it("refuses an expired attestation", async () => {
    // Stale fails closed. An attestation made a year ago and never renewed is
    // not evidence about today.
    await activeRecipient(ORG_A, "rcp_expired");
    await pg.sql(
      `update cp_recipient_destinations set expires_at = now() - interval '1 day',
                                            attested_at = now() - interval '2 days'
        where recipient_id='rcp_expired'`
    );
    const v = await check({ recipientId: "rcp_expired" });
    expect(v.ok).toBe(false);
    expect(v.reason).toBe("attestation_expired");
  });

  it("refuses an unknown recipient", async () => {
    const v = await check({ recipientId: "rcp_never_created" });
    expect(v.ok).toBe(false);
    expect(v.reason).toBe("recipient_unknown");
  });
});

describe("revocation", () => {
  it("stops the destination being payable, and is not a delete", async () => {
    await activeRecipient(ORG_A, "rcp_revoke");
    expect((await check({ recipientId: "rcp_revoke" })).ok).toBe(true);

    const revoked = await store.revokeDestination({
      organizationId: ORG_A,
      recipientId: "rcp_revoke",
      networkId: "base",
      asset: "USDC",
      address: ADDR,
      reason: "address compromised",
      revokedBy: "user_recip_a",
    });
    expect(revoked).toBe(true);

    const after = await check({ recipientId: "rcp_revoke" });
    expect(after.ok).toBe(false);
    expect(after.reason).toBe("destination_not_attested");

    // The row survives, so "was this trusted when that payment was authorized?"
    // stays answerable. A DELETE would destroy exactly the record an incident
    // review needs.
    const rows = await pg.sql<{ revoked_reason: string }>(
      `select revoked_reason from cp_recipient_destinations where recipient_id='rcp_revoke'`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].revoked_reason).toBe("address compromised");
  });

  it("matches the revocation by canonical address, not by the caller's casing", async () => {
    await activeRecipient(ORG_A, "rcp_revoke_case");
    const revoked = await store.revokeDestination({
      organizationId: ORG_A,
      recipientId: "rcp_revoke_case",
      networkId: "base",
      asset: "USDC",
      // Upper case. If revocation canonicalised differently from lookup, this
      // would report success and leave the address payable — a revocation that
      // silently does nothing is worse than an error.
      address: ADDR_UPPER,
      reason: "case test",
      revokedBy: "user_recip_a",
    });
    expect(revoked).toBe(true);
    expect((await check({ recipientId: "rcp_revoke_case" })).ok).toBe(false);
  });

  it("revoking one destination leaves the recipient's others payable", async () => {
    const other = "0x1111111111111111111111111111111111111111";
    await activeRecipient(ORG_A, "rcp_multi");
    await store.attestDestination({
      organizationId: ORG_A,
      recipientId: "rcp_multi",
      networkId: "base",
      asset: "USDC",
      address: other,
      method: "human_confirmed",
      provenance: "user:test",
    });
    await store.revokeDestination({
      organizationId: ORG_A,
      recipientId: "rcp_multi",
      networkId: "base",
      asset: "USDC",
      address: ADDR,
      reason: "one of two",
      revokedBy: "user_recip_a",
    });
    expect((await check({ recipientId: "rcp_multi", destination: ADDR })).ok).toBe(false);
    expect((await check({ recipientId: "rcp_multi", destination: other })).ok).toBe(true);
  });
});

describe("cross-tenant", () => {
  it("one tenant's attestation does not make the address payable for another", async () => {
    await activeRecipient(ORG_A, "rcp_shared_id");
    // Tenant B has never attested anything, but uses the same recipient id and
    // the same address. If attestations were keyed on (recipient, address)
    // without the tenant, B would inherit A's allowlist.
    const v = await store.checkRecipient({
      organizationId: ORG_B,
      recipientId: "rcp_shared_id",
      destination: ADDR,
      networkId: "base",
      asset: "USDC",
      amountAtomic: "1",
      requireMainnet: false,
    });
    expect(v.ok).toBe(false);
    expect(v.reason).toBe("recipient_unknown");
  });

  it("two tenants may attest the same address independently", async () => {
    // And that must be two separate facts. Neither tenant's revocation may
    // affect the other's.
    await activeRecipient(ORG_B, "rcp_shared_id");
    const b = await store.checkRecipient({
      organizationId: ORG_B,
      recipientId: "rcp_shared_id",
      destination: ADDR,
      networkId: "base",
      asset: "USDC",
      amountAtomic: "1",
      requireMainnet: false,
    });
    expect(b.ok).toBe(true);

    await store.revokeDestination({
      organizationId: ORG_B,
      recipientId: "rcp_shared_id",
      networkId: "base",
      asset: "USDC",
      address: ADDR,
      reason: "B only",
      revokedBy: "user_recip_b",
    });
    expect((await check({ recipientId: "rcp_shared_id" })).ok).toBe(true); // A unaffected
  });

  it("a tenant cannot revoke another tenant's attestation", async () => {
    await activeRecipient(ORG_A, "rcp_cross_revoke");
    const revoked = await store.revokeDestination({
      organizationId: ORG_B, // attacker
      recipientId: "rcp_cross_revoke",
      networkId: "base",
      asset: "USDC",
      address: ADDR,
      reason: "cross-tenant attempt",
      revokedBy: "user_recip_b",
    });
    expect(revoked).toBe(false);
    expect((await check({ recipientId: "rcp_cross_revoke" })).ok).toBe(true);
  });
});

describe("a tenant cannot squat another tenant's recipient namespace", () => {
  it("both tenants can hold a recipient with the SAME caller-chosen id", async () => {
    // THE DEFECT THIS PINS. `cp_recipients.id` was a global primary key, so the
    // first tenant to create `rcp_acme` permanently prevented every other
    // tenant from using that id — and the 23505 they got back told them the id
    // was taken, which is an existence oracle over other tenants' counterparty
    // names. Recipient ids are deliberately caller-chosen (an enterprise uses
    // its own supplier numbers), so the tenant has to be in the key.
    //
    // Reverting the primary key to `id text primary key` fails this.
    const shared = "rcp_same_name_both_tenants";
    expect(
      await store.upsertRecipient({
        organizationId: ORG_A,
        recipientId: shared,
        displayName: "A's supplier",
        status: "ACTIVE",
      })
    ).toBe(true);
    expect(
      await store.upsertRecipient({
        organizationId: ORG_B,
        recipientId: shared,
        displayName: "B's unrelated supplier",
        status: "ACTIVE",
      })
    ).toBe(true);

    // Two rows, two tenants, and each reads only its own.
    const a = await store.loadRecipient(ORG_A, shared);
    const b = await store.loadRecipient(ORG_B, shared);
    expect(a!.record!.displayName).toBe("A's supplier");
    expect(b!.record!.displayName).toBe("B's unrelated supplier");
  });
});

describe("duplicate and poisoned metadata", () => {
  it("re-attesting the same identity is one fact, not two competing ones", async () => {
    await activeRecipient(ORG_A, "rcp_dupe");
    // A second insert of the same (org, recipient, network, asset, address)
    // must not create a second row: two rows for one fact means a revocation
    // can revoke one and leave the other live.
    const second = await store.attestDestination({
      organizationId: ORG_A,
      recipientId: "rcp_dupe",
      networkId: "base",
      asset: "USDC",
      // Different casing, same account. The identity index canonicalises, so
      // this is a refresh of the existing fact, not a competing claim.
      address: ADDR_UPPER,
      method: "human_confirmed",
      provenance: "user:test2",
    });
    expect(second).toBe(true);

    const rows = await pg.sql<{ n: number }>(
      `select count(*)::int as n from cp_recipient_destinations where recipient_id='rcp_dupe'`
    );
    expect(rows[0].n).toBe(1);
  });

  it("re-attesting a REVOKED destination does not silently un-revoke it", async () => {
    // Otherwise "attest again" is a revocation bypass available to anyone with
    // create permission — the operator revokes a compromised address, and the
    // next routine sync quietly restores it.
    await activeRecipient(ORG_A, "rcp_reattest");
    await store.revokeDestination({
      organizationId: ORG_A,
      recipientId: "rcp_reattest",
      networkId: "base",
      asset: "USDC",
      address: ADDR,
      reason: "compromised",
      revokedBy: "user_recip_a",
    });
    await store.attestDestination({
      organizationId: ORG_A,
      recipientId: "rcp_reattest",
      networkId: "base",
      asset: "USDC",
      address: ADDR,
      method: "human_confirmed",
      provenance: "user:test",
    });
    const v = await check({ recipientId: "rcp_reattest" });
    expect(v.ok, "a revoked destination became payable again by re-attesting").toBe(false);
  });

  it("a domain in the request is checked against the VERIFIED domain, not accepted", async () => {
    await activeRecipient(ORG_A, "rcp_domain");
    // No verified domain on the record. A payment claiming one must be refused
    // rather than having the claim adopted as the answer.
    const v = await check({ recipientId: "rcp_domain", domain: "attacker.example" });
    expect(v.ok).toBe(false);
    expect(v.reason).toBe("domain_mismatch");
  });

  it("a verified domain matches itself and its subdomains, and nothing else", async () => {
    await activeRecipient(ORG_A, "rcp_domain_ok");
    await pg.sql(
      `update cp_recipients set verified_domain='shop.example' where id='rcp_domain_ok'`
    );
    const ok1 = await check({ recipientId: "rcp_domain_ok", domain: "shop.example" });
    expect(ok1.ok, ok1.detail).toBe(true);
    const ok2 = await check({ recipientId: "rcp_domain_ok", domain: "eu.shop.example" });
    expect(ok2.ok).toBe(true);
    // The suffix trick: `evilshop.example` ends with `shop.example` as a STRING
    // but is a different domain. The check requires a dot boundary.
    const bad = await check({ recipientId: "rcp_domain_ok", domain: "evilshop.example" });
    expect(bad.ok).toBe(false);
    expect(bad.reason).toBe("domain_mismatch");
  });
});

describe("the schema enforces what the application assumes", () => {
  it("rejects an expiry that precedes the attestation", async () => {
    await expect(
      pg.sql(
        `insert into cp_recipient_destinations
           (organization_id, recipient_id, network_id, asset, address_canonical,
            address_display, method, attested_at, expires_at)
         values ($1,'rcp_main','base','USDC','0xdead','0xdead','human_confirmed',
                 now(), now() - interval '1 day')`,
        [ORG_A]
      )
    ).rejects.toThrow();
  });

  it("rejects an attestation method outside the known set", async () => {
    await expect(
      pg.sql(
        `insert into cp_recipient_destinations
           (organization_id, recipient_id, network_id, asset, address_canonical,
            address_display, method)
         values ($1,'rcp_main','base','USDC','0xbeef','0xbeef','totally_trusted')`,
        [ORG_A]
      )
    ).rejects.toThrow();
  });

  it("rejects a destination for a recipient that does not exist in that tenant", async () => {
    // The composite foreign key is (organization_id, recipient_id). Without the
    // tenant in the key, one tenant could attach a destination to another
    // tenant's recipient.
    await expect(
      pg.sql(
        `insert into cp_recipient_destinations
           (organization_id, recipient_id, network_id, asset, address_canonical,
            address_display, method)
         values ($1,'rcp_main','base','USDC','0xfeed','0xfeed','human_confirmed')`,
        [ORG_B] // rcp_main belongs to ORG_A
      )
    ).rejects.toThrow();
  });

  it("has RLS on with no policies", async () => {
    const rows = await pg.sql<{ relname: string; relrowsecurity: boolean; policies: number }>(
      `select c.relname, c.relrowsecurity,
              (select count(*)::int from pg_policy p where p.polrelid=c.oid) as policies
         from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where n.nspname='public' and c.relkind='r'
          and c.relname in ('cp_recipients','cp_recipient_destinations')`
    );
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.relrowsecurity, `${r.relname} RLS off`).toBe(true);
      expect(r.policies).toBe(0);
    }
  });
});
