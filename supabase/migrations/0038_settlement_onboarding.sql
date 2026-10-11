-- Business onboarding state for the settlement workspace (one row per user)
-- and the private bucket that holds KYB/KYC documents. Both are reached only
-- through the service-role API (apps/web/src/app/api/settlement/onboarding).
-- Review decisions (documents approved/rejected) and activation are written by
-- the server; the client never writes this table directly.
create table if not exists public.settlement_onboarding (
  owner_id text primary key,
  state jsonb not null check (jsonb_typeof(state) = 'object'),
  updated_at timestamptz not null default now(),
  constraint settlement_onboarding_size check (octet_length(state::text) <= 262144)
);
alter table public.settlement_onboarding enable row level security;
revoke all on public.settlement_onboarding from anon, authenticated;
grant select, insert, update on public.settlement_onboarding to service_role;
comment on table public.settlement_onboarding is 'Per-user business onboarding state; service-role API only.';

-- Private: no public URLs, no anon/authenticated policies. 10 MB, PDF/PNG/JPEG.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('kyb-documents', 'kyb-documents', false, 10485760, array['application/pdf', 'image/png', 'image/jpeg'])
on conflict (id) do nothing;
