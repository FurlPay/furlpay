-- ---------------------------------------------------------------------------
-- 0029: account usernames.
--
-- A username is a public, unique, renameable account name shown on the profile.
-- It is NOT a payment route: @handle payment resolution stays on FurlPay Wallet
-- handles (lib/walletHandles.ts, lib/nameResolution.ts), so renaming a username
-- can never redirect money. The app refuses a username that someone else holds
-- as a wallet handle, so the two cannot be used to impersonate each other.
--
-- Rules (identical to lib/walletHandles.ts normalizeHandle, which the app
-- applies first; the CHECK is the backstop):
--   stored lowercase; 3-32 characters; [a-z0-9-]; no leading/trailing hyphen.
-- Reserved names are enforced in the application (one list, shared with
-- wallet handles).
--
-- Uniqueness: a unique index on the column. NULL (no username) is allowed for
-- any number of accounts, so every existing account keeps working unchanged.
--
-- Writes go ONLY through set_username(): the general account save
-- (lib/storeDb.ts userToRow) never includes this column, so a clash can never
-- fail an unrelated save and a stale in-memory copy can never overwrite it.
--
-- Locking: `users` is small; the index build is brief. Re-runnable.
-- ---------------------------------------------------------------------------

alter table users add column if not exists username text;

alter table users drop constraint if exists users_username_format;
alter table users add constraint users_username_format check (
  username is null or (
    length(username) between 3 and 32
    and username ~ '^[a-z0-9-]+$'
    and username !~ '^-' and username !~ '-$'
  )
);

create unique index if not exists users_username_key on users (username);

-- Sets (or clears, with NULL) the caller's username atomically.
-- Returns 'ok' | 'taken' | 'invalid' | 'no_account'. The unique index decides
-- races: two users claiming the same name at once → exactly one 'ok'.
-- The API passes the SESSION user id; nothing here trusts a client-supplied id.
create or replace function set_username(p_user uuid, p_username text)
returns text
language plpgsql
volatile
set search_path = public, pg_catalog
as $$
begin
  update users set username = p_username, updated_at = now() where id = p_user;
  if not found then
    return 'no_account';
  end if;
  return 'ok';
exception
  when unique_violation then
    return 'taken';
  when check_violation then
    return 'invalid';
end;
$$;

revoke all on function set_username(uuid, text) from public, anon, authenticated;
grant execute on function set_username(uuid, text) to service_role;
