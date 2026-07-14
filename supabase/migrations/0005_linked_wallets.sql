-- ---------------------------------------------------------------------------
-- Durable self-custodial wallet links (Phase 1 hardening).
--
-- Enforces the invariant at the DATABASE level (not application code):
--   one active normalized EVM wallet address belongs to at most one account.
--
-- Uniqueness is a Postgres UNIQUE constraint on the lowercased address, so the
-- guarantee holds across all serverless instances concurrently — two instances
-- racing to link the same address cannot both win: one insert succeeds, the
-- other hits unique_violation and is resolved to a conflict.
--
-- The in-memory store (store.ts, supabaseBackend="none") keeps its own
-- best-effort check for demo mode; production correctness rests on THIS table.
-- ---------------------------------------------------------------------------

create table linked_wallets (
  -- The normalized (lowercased) EVM address IS the uniqueness key. Casing can
  -- never bypass it because callers pass the lowercased form; the CHECK also
  -- rejects empty strings, non-hex, wrong-length and the zero address at the
  -- database level, so even a direct service-role insert cannot corrupt it.
  address_norm text primary key
               check (address_norm ~ '^0x[0-9a-f]{40}$'
                      and address_norm <> '0x0000000000000000000000000000000000000000'),
  user_id      uuid not null references users (id) on delete cascade,
  address      text not null check (address ~ '^0x[0-9a-fA-F]{40}$'), -- EIP-55 display
  chain_family text not null default 'evm' check (chain_family in ('evm')),
  method       text not null default 'eip191' check (method in ('eip191')),
  proof_nonce  text not null,                 -- the signed challenge nonce (audit; not a secret)
  status       text not null default 'active' check (status in ('active')),
  linked_at    timestamptz not null default now()
);

-- One active wallet per account in Phase 1 (a user cannot silently accumulate
-- links). Re-linking a DIFFERENT address is a future explicit unlink flow.
create unique index linked_wallets_user_key on linked_wallets (user_id);

alter table linked_wallets enable row level security; -- service-role only, like every table

-- Atomic link with explicit conflict semantics. Returns one of:
--   'linked'                  first successful link
--   'idempotent'              same user + same address already linked
--   'conflict_address'        address already linked to a DIFFERENT account
--   'conflict_user_has_wallet' this user already linked a DIFFERENT address
-- The unique_violation handler makes the whole thing race-safe: if a concurrent
-- instance inserts the same address between our SELECT and INSERT, we catch the
-- violation and re-resolve to the correct conflict/idempotent outcome.
create or replace function link_wallet(
  p_user_id      uuid,
  p_address_norm text,
  p_address      text,
  p_nonce        text
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing_user uuid;
  v_user_addr     text;
begin
  select user_id into v_existing_user from linked_wallets where address_norm = p_address_norm;
  if found then
    if v_existing_user = p_user_id then return 'idempotent'; else return 'conflict_address'; end if;
  end if;

  select address_norm into v_user_addr from linked_wallets where user_id = p_user_id;
  if found and v_user_addr <> p_address_norm then return 'conflict_user_has_wallet'; end if;

  insert into linked_wallets (address_norm, user_id, address, proof_nonce)
  values (p_address_norm, p_user_id, p_address, p_nonce);
  return 'linked';
exception
  when unique_violation then
    -- Lost a concurrent race — re-resolve against the row that won.
    select user_id into v_existing_user from linked_wallets where address_norm = p_address_norm;
    if v_existing_user = p_user_id then return 'idempotent'; else return 'conflict_address'; end if;
end $$;

revoke all on function link_wallet(uuid, text, text, text) from public, anon, authenticated;
grant execute on function link_wallet(uuid, text, text, text) to service_role;

-- Read a user's current link (for cold-instance hydration of GET /wallet/link).
create or replace function get_linked_wallet(p_user_id uuid)
returns setof linked_wallets
language sql
security definer
set search_path = public
as $$ select * from linked_wallets where user_id = p_user_id limit 1 $$;

revoke all on function get_linked_wallet(uuid) from public, anon, authenticated;
grant execute on function get_linked_wallet(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Preflight duplicate check (run BEFORE this migration in any environment that
-- already has ad-hoc link data — this repo's users table has none, since
-- linkedWallet never persisted before now). This query must return zero rows;
-- if it returns any, resolve them manually (do NOT auto-merge accounts):
--
--   -- (nothing to run: no prior linked_wallets table existed)
--
-- Rollback: `drop function get_linked_wallet(uuid); drop function
-- link_wallet(uuid,text,text,text); drop table linked_wallets;` — no other
-- table references it, so rollback is clean and non-destructive to accounts.
-- ---------------------------------------------------------------------------
