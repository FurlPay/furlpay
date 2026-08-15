-- ---------------------------------------------------------------------------
-- Address book (contacts).
--
-- "Save once, send by name." A saved contact is a SAFETY control before it is a
-- convenience: the failure mode it removes is pasting a 42-character address
-- that looks right and is not. Everything here therefore constrains what can be
-- stored, at the database level, so a bug in a route cannot persist a contact
-- whose address could never be paid.
--
-- ADDRESSES ARE JSONB, NOT A CHILD TABLE. A contact holds a handful of
-- addresses, they are always read and written as a whole, and nothing queries
-- across them. A `contact_addresses` table would be the schema's only
-- GRANDCHILD (users → contacts → addresses), which the embedded-select loader in
-- storeDb.ts does not model. Cards already persist `limits`/`channels`/`gradient`
-- as jsonb for the same reason, so this follows an established local pattern
-- rather than introducing a new shape.
--
-- WHAT IS *NOT* VALIDATED HERE: that an address is payable on its chain. The
-- per-chain rules (EIP-55 casing, base58 decoding to 32 bytes) live in
-- lib/addressValidation.ts, which the routes enforce. The CHECKs below are the
-- coarse structural floor that no code path can bypass — shape, size and count.
-- ---------------------------------------------------------------------------

create table contacts (
  -- Application-generated (crypto.randomUUID), matching cards/bills which are
  -- also text ids assigned by the app rather than database defaults.
  id           text primary key,
  user_id      uuid not null references users (id) on delete cascade,

  -- Display name. Bounded so a contact list cannot be used as blob storage, and
  -- non-empty after trimming so " " cannot become an unnameable contact.
  name         text not null check (length(btrim(name)) between 1 and 64),

  -- Avatar colour from the app's palette. Hex-constrained because it is
  -- interpolated into a style attribute; anything else is a rendering bug at
  -- best.
  avatar_color text not null check (avatar_color ~ '^#[0-9a-fA-F]{6}$'),

  -- [{ id, address, chain, label?, isDefault, lastUsedAt? }, …]
  -- Must be an ARRAY (not an object or scalar) and is capped: an unbounded list
  -- would make every account load unbounded too.
  addresses    jsonb not null default '[]'::jsonb
               check (jsonb_typeof(addresses) = 'array'
                      and jsonb_array_length(addresses) <= 20),

  is_favorite  boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Every read is "this user's contacts".
create index contacts_user_idx on contacts (user_id);

-- Two contacts named the same thing under one account is a UX trap: the send
-- sheet shows one name and the user cannot tell which address it carries.
-- Case-insensitive so "Dad" and "dad" collide as a user would expect.
create unique index contacts_user_name_key on contacts (user_id, lower(btrim(name)));

alter table contacts enable row level security; -- service-role only, like every table

-- ---------------------------------------------------------------------------
-- Extend the atomic child-write (migration 0004) to cover contacts.
--
-- The old function is DROPPED rather than overloaded: adding a parameter would
-- create a second function, and a 6-argument call would then be ambiguous
-- ("function is not unique") instead of resolving.
--
-- Both deploy orders are safe because storeDb.saveAccount() already treats a
-- missing function as SupabaseFunctionMissing and falls back to its
-- write-then-prune path:
--   migration first  → old code calls the 6-arg signature, misses, falls back
--   code first       → new code calls the 7-arg signature, misses, falls back
-- In neither case is a write lost; the fallback is simply not one transaction.
-- ---------------------------------------------------------------------------
drop function if exists save_account_children(uuid, jsonb, jsonb, jsonb, jsonb, jsonb);

create or replace function save_account_children(
  p_user_id        uuid,
  p_token_balances jsonb,
  p_fiat_balances  jsonb,
  p_holdings       jsonb,
  p_cards          jsonb,
  p_bills          jsonb,
  p_contacts       jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from token_balances where user_id = p_user_id;
  insert into token_balances (user_id, token, chain, amount, usd_value)
  select p_user_id, x.token, x.chain, x.amount, x.usd_value
  from jsonb_to_recordset(coalesce(p_token_balances, '[]'::jsonb))
    as x(token text, chain text, amount numeric, usd_value numeric);

  delete from fiat_balances where user_id = p_user_id;
  insert into fiat_balances (user_id, currency, amount, usd_value, local_details)
  select p_user_id, x.currency, x.amount, x.usd_value, x.local_details
  from jsonb_to_recordset(coalesce(p_fiat_balances, '[]'::jsonb))
    as x(currency text, amount numeric, usd_value numeric, local_details jsonb);

  delete from holdings where user_id = p_user_id;
  insert into holdings (user_id, symbol, name, shares, price, change_pct, market_value, cost_basis)
  select p_user_id, x.symbol, x.name, x.shares, x.price, x.change_pct, x.market_value, x.cost_basis
  from jsonb_to_recordset(coalesce(p_holdings, '[]'::jsonb))
    as x(symbol text, name text, shares numeric, price numeric,
         change_pct numeric, market_value numeric, cost_basis numeric);

  delete from cards where user_id = p_user_id;
  insert into cards (id, user_id, kind, label, last4, network, frozen, gradient, limits, channels, settlement_currency)
  select x.id, p_user_id, x.kind, x.label, x.last4, x.network, x.frozen, x.gradient, x.limits, x.channels, x.settlement_currency
  from jsonb_to_recordset(coalesce(p_cards, '[]'::jsonb))
    as x(id text, kind text, label text, last4 text, network text, frozen boolean,
         gradient jsonb, limits jsonb, channels jsonb, settlement_currency text);

  delete from bills where user_id = p_user_id;
  insert into bills (id, user_id, provider, category, balance_due, due_date, autopay)
  select x.id, p_user_id, x.provider, x.category, x.balance_due, x.due_date, x.autopay
  from jsonb_to_recordset(coalesce(p_bills, '[]'::jsonb))
    as x(id text, provider text, category text, balance_due numeric,
         due_date date, autopay boolean);

  delete from contacts where user_id = p_user_id;
  insert into contacts (id, user_id, name, avatar_color, addresses, is_favorite, created_at, updated_at)
  select x.id, p_user_id, x.name, x.avatar_color,
         coalesce(x.addresses, '[]'::jsonb), coalesce(x.is_favorite, false),
         coalesce(x.created_at, now()), coalesce(x.updated_at, now())
  from jsonb_to_recordset(coalesce(p_contacts, '[]'::jsonb))
    as x(id text, name text, avatar_color text, addresses jsonb,
         is_favorite boolean, created_at timestamptz, updated_at timestamptz);
end;
$$;

revoke all on function save_account_children(uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function save_account_children(uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb)
  to service_role;

-- ---------------------------------------------------------------------------
-- Rollback:
--   drop function if exists save_account_children(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb);
--   drop table if exists contacts;
--   -- then re-apply 0004 to restore the 6-argument function.
-- No other table references contacts, so this is clean and touches no balances.
-- ---------------------------------------------------------------------------
