-- Recurring payroll schedules. Apply after 0050. Service-role access only.
--
-- A schedule is an employer's standing instruction to PREPARE a payroll batch
-- every week, fortnight or month. It never pays anyone: payroll stays
-- non-custodial (0042), so each run creates an ordinary DRAFT batch through
-- payroll_batch_create — recipients screened, fees quoted — which the employer
-- reviews, submits and signs line by line exactly as for a batch made by hand.
--
-- The batch id of a run is derived from (schedule id, run date) in the
-- application (lib/payroll/schedule.ts), and payroll_batch_create returns an
-- existing batch for an existing id, so a run that is retried, or picked up by
-- two runners at once, creates one batch, never two.
--
-- `lines` is the roster selection: [{ "contractorId": uuid, "amount"?: "123.45" }].
-- Recipients and default amounts are read from payroll_contractors at run
-- time, so a contractor who changed their verified payout address is paid at
-- the new one and a deactivated contractor fails the run visibly.
begin;

create table payroll_schedules (
  id uuid primary key,
  merchant_id uuid not null,
  name text not null check (char_length(name) between 1 and 120),
  chain text not null check (chain in ('arbitrum','arc','base','polygon')),
  cadence text not null check (cadence in ('weekly','biweekly','monthly')),
  -- Monthly schedules run on this day of the month. 1-28 only, so every month has it.
  day_of_month smallint check (day_of_month between 1 and 28),
  lines jsonb not null check (jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) between 1 and 100),
  active boolean not null default true,
  next_run_on date not null,
  last_run_on date,
  last_batch_id uuid references payroll_batches(id) on delete set null,
  last_status text check (last_status in ('created','failed')),
  last_error text check (char_length(last_error) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((cadence = 'monthly') = (day_of_month is not null))
);
create index payroll_schedules_merchant on payroll_schedules(merchant_id, created_at desc);
-- The runner's query: active schedules that are due.
create index payroll_schedules_due on payroll_schedules(next_run_on) where active;

alter table payroll_schedules enable row level security;
revoke all on payroll_schedules from anon, authenticated;
grant all on payroll_schedules to service_role;

commit;
