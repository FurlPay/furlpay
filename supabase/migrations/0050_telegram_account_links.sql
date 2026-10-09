-- Identity links only: accounts, sessions and financial ledgers remain shared.
create table if not exists public.telegram_account_links (
  telegram_id bigint primary key check (telegram_id > 0 and telegram_id <= 4503599627370495),
  user_id uuid not null unique references public.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.telegram_account_links enable row level security;
revoke all on public.telegram_account_links from anon, authenticated;
grant select, insert, delete on public.telegram_account_links to service_role;
comment on table public.telegram_account_links is 'Server-verified Telegram identity linked with explicit consent and recent FurlPay authentication. Never matched by username or display name.';
