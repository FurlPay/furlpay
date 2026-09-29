-- ===========================================================================
-- 0021 — Attested recipients.
--
-- WHY THIS EXISTS. Until now `verifyRecipientForRequest` returned
-- `recipient_unknown` unconditionally, so every authorization naming a
-- recipient was refused. That was correct — returning `ok: true` would have
-- recorded a destination check that never happened — but it also meant no
-- recipient-bound payment could be authorized at all. This is the smallest
-- store that makes the existing, already-tested `verifyRecipient()` usable.
--
-- THE CENTRAL DESIGN RULE: an attestation is about (recipient, NETWORK, ASSET,
-- ADDRESS) as one unit, never about a recipient alone. The same string is a
-- valid address on every EVM chain and means a different, possibly
-- unrelated, account on each. So the address lives on a child row carrying its
-- own network and asset, and a payment matches only when all of them line up.
-- There is deliberately NO way to express "this recipient's address, on any
-- chain" — that sentence is how funds get sent to a contract the recipient does
-- not control on a chain they never deployed to.
--
-- WHO SAID SO IS PART OF THE RECORD. `method` says how, and the application
-- derives a trust class from it — FurlPay verified it / a provider asserted it /
-- an enterprise admin allowlisted it. Those are three different claims with
-- three different liabilities, and collapsing them into "attested = true" is how
-- this kind of store becomes theatre. `provenance` names the actual source.
--
-- ADDRESSES ARE STORED CANONICALLY AND COMPARED CANONICALLY. `address_canonical`
-- is what the uniqueness constraint and every lookup use; `address_display` keeps
-- whatever the attester wrote, including EIP-55 checksum case, because throwing
-- that away makes an operator reading the row unable to compare it to anything.
-- Two rows differing only in case are the SAME attestation, not two.
--
-- REVOCATION IS NOT DELETION. A revoked attestation keeps its row and its
-- history; `revoked_at` is what the check reads. Deleting it would destroy the
-- ability to answer "was this address trusted at the time that payment was
-- authorized?", which is exactly the question an incident asks.
-- ===========================================================================

-- ── Recipients ─────────────────────────────────────────────────────────────
create table if not exists cp_recipients (
  -- CHOSEN BY THE TENANT, so the primary key MUST be composite.
  --
  -- This started as `id text primary key` and an integration test caught it:
  -- with a global key, the first tenant to create `rcp_acme` permanently
  -- prevents every other tenant from using that id, and the 23505 they receive
  -- tells them the id is taken. That is two defects in one — a cross-tenant
  -- namespace squat and an existence oracle over other tenants' recipient names
  -- — in a table whose entire purpose is tenant-scoped trust.
  --
  -- Server-generated ids (`cpm_<uuid>`, as `cp_mandates` uses) would also avoid
  -- it, but recipient ids are deliberately caller-chosen so an enterprise can
  -- use its own supplier numbers. Given that, the tenant belongs in the key.
  id                text not null,
  organization_id   text not null references cp_organizations(id) on delete cascade,
  display_name      text not null,
  -- The domain FurlPay PROVED control of, never one copied from a request. Null
  -- is the honest value for a recipient whose domain was never verified, and
  -- `verifyRecipient` denies a domain-bearing payment against a null.
  verified_domain   text,
  status            text not null default 'PENDING'
                      check (status in ('ACTIVE', 'BLOCKED', 'PENDING')),
  mcc               text,
  jurisdiction      text check (jurisdiction is null or jurisdiction ~ '^[A-Z]{2}$'),
  first_seen_at     timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- Tenant first: it is the leading column of every lookup, and it is what
  -- makes two tenants' identically-named recipients two different rows.
  primary key (organization_id, id)
);

create index if not exists cp_recipients_org_idx on cp_recipients (organization_id);
create index if not exists cp_recipients_domain_idx
  on cp_recipients (organization_id, verified_domain)
  where verified_domain is not null;

-- ── Attested destinations ──────────────────────────────────────────────────
create table if not exists cp_recipient_destinations (
  id                 bigserial primary key,
  organization_id    text not null references cp_organizations(id) on delete cascade,
  recipient_id       text not null,
  network_id         text not null,
  asset              text not null,
  -- Lowercased/normalised form. Every comparison uses this column.
  address_canonical  text not null,
  -- As the attester wrote it (EIP-55 case preserved). Display only.
  address_display    text not null,
  method             text not null check (method in
                       ('domain_signature', 'well_known', 'human_confirmed',
                        'penny_drop', 'provider_supplied')),
  -- Who actually made the claim: the signing domain, the provider name, the
  -- user id that confirmed it. "Attested" with no source is not checkable.
  provenance         text,
  attested_at        timestamptz not null default now(),
  -- Absent = no expiry. Present and past = the check denies; a stale attestation
  -- fails closed rather than coasting on a check made a year ago.
  expires_at         timestamptz,
  revoked_at         timestamptz,
  revoked_reason     text,
  revoked_by         text,
  created_at         timestamptz not null default now(),

  constraint cp_dest_recipient_fk
    foreign key (organization_id, recipient_id)
    references cp_recipients (organization_id, id) on delete cascade,
  -- An expiry before the attestation was made describes nothing.
  constraint cp_dest_expiry_after_attest
    check (expires_at is null or expires_at > attested_at)
);

-- The identity of an attestation. The same address, on the same network, for the
-- same asset, for the same recipient, in the same tenant, is ONE fact — a second
-- insert is an update to it, not a competing claim. Note `organization_id` leads:
-- another tenant attesting the same address is a completely separate row, and
-- must be, or one tenant's allowlist would silently populate another's.
create unique index if not exists cp_dest_identity_uniq
  on cp_recipient_destinations
     (organization_id, recipient_id, network_id, asset, address_canonical);

create index if not exists cp_dest_lookup_idx
  on cp_recipient_destinations (organization_id, recipient_id)
  where revoked_at is null;

-- ── Settlement memory, for first-use detection ─────────────────────────────
--
-- `verifyRecipient` reports `firstUse` so the policy engine can route a
-- never-paid-before destination to a human. It must be derived from money that
-- ACTUALLY MOVED, not from authorizations: counting authorizations would let an
-- attacker launder a destination into "seen before" by making requests that were
-- all denied.
create or replace view cp_recipient_settled as
  select organization_id, recipient_id, count(*) as settled_count,
         max(decided_at) as last_settled_at
    from cp_authorizations
   where phase = 'SETTLED'
   group by organization_id, recipient_id;

-- ── RLS: deny by default, same as 0020 ─────────────────────────────────────
alter table cp_recipients enable row level security;
alter table cp_recipient_destinations enable row level security;
