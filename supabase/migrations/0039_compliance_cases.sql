-- Unified compliance case management (apps/web/src/lib/compliance/caseStore.ts).
-- One row per case. `source_key` names the underlying event (an onboarding
-- review, a screening hit, a monitoring alert) and is UNIQUE, so re-deriving
-- cases from the same event can never open a duplicate. The case body,
-- including its bounded event timeline, is `data`; the columns beside it are
-- the queue's filter and sort keys. Writes are optimistic on `version`.
-- Reached only through the service-role API: RLS on, no anon/authenticated
-- grants, no DELETE grant (cases are closed, never removed).
create table if not exists public.compliance_cases (
  id uuid primary key,
  source_key text not null unique check (length(source_key) between 3 and 300),
  case_type text not null check (case_type in ('kyc_review','kyb_review','sanctions_match','pep_match','adverse_media','fraud','monitoring_alert','travel_rule','wallet_screening','settlement_hold')),
  status text not null check (status in ('OPEN','TRIAGED','ASSIGNED','INVESTIGATING','ESCALATED','DECISION_PENDING','RESOLVED','CLOSED')),
  severity text not null check (severity in ('low','medium','high','critical')),
  subject_id text not null,
  assignee text,
  sla_due_at timestamptz not null,
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version >= 1),
  constraint compliance_cases_data_size check (octet_length(data::text) <= 262144)
);
create index if not exists compliance_cases_queue on public.compliance_cases (status, sla_due_at);
create index if not exists compliance_cases_subject on public.compliance_cases (subject_id, created_at desc);
create index if not exists compliance_cases_assignee on public.compliance_cases (assignee, status) where assignee is not null;
create index if not exists compliance_cases_type on public.compliance_cases (case_type, created_at desc);
alter table public.compliance_cases enable row level security;
revoke all on public.compliance_cases from anon, authenticated;
grant select, insert, update on public.compliance_cases to service_role;
comment on table public.compliance_cases is 'Compliance cases (reviews, screening hits, monitoring alerts); service-role API only; never deleted.';
