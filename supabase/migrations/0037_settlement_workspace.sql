-- Non-executable merchant instructions. All money-moving state stays in the
-- existing payment/ledger/control-plane services. No anonymous DB access.
create table if not exists public.settlement_workspace_records (
  owner_id text not null,
  id uuid not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  primary key (owner_id, id),
  constraint settlement_workspace_kind check (payload->>'kind' in ('invoice', 'link', 'payout', 'schedule', 'beneficiary', 'rule', 'checkout')),
  constraint settlement_workspace_payload_size check (octet_length(payload::text) <= 102400)
);
create index if not exists settlement_workspace_owner_date on public.settlement_workspace_records (owner_id, created_at desc, id desc);
alter table public.settlement_workspace_records enable row level security;
revoke all on public.settlement_workspace_records from anon, authenticated;
grant select, insert, update on public.settlement_workspace_records to service_role;
comment on table public.settlement_workspace_records is 'User-scoped, non-executable settlement workspace drafts; service-role API only.';
