-- Partnership inquiries (the /partners "Let's build together" form). Apply after 0048.
--
-- Replaces nothing: /api/contact keeps its own (in-memory) lead path. This table
-- is the durable record the partnership form promises — a submission is only
-- acknowledged after the row commits.
--
-- Access: service role only. RLS is on with no policies, and anon/authenticated
-- have no grants, so contact details are never readable through the public API;
-- staff read them through the admin route, which checks the admin role.
--
-- Duplicates: the same work email asking about the same partnership type on the
-- same UTC day is ONE inquiry (a double click, a retry after a timeout). The
-- submit function returns the existing id with duplicate = true.
--
-- Retention: partnership_inquiry_purge(before) deletes declined/closed inquiries
-- last updated before a date, with their activity. It is NOT scheduled here:
-- the retention period is a policy decision (see the remediation report).
begin;

create table partnership_inquiries (
  id uuid primary key default gen_random_uuid(),
  company_name text not null check (char_length(company_name) between 2 and 120),
  work_email text not null check (char_length(work_email) <= 254 and work_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]{2,}$' and work_email = lower(work_email)),
  contact_method text not null check (contact_method in ('telegram','whatsapp','email','linkedin','discord','other')),
  contact_detail text not null check (char_length(contact_detail) between 2 and 300),
  full_name text check (char_length(full_name) <= 120),
  job_title text check (char_length(job_title) <= 120),
  website text check (website is null or (char_length(website) <= 300 and website ~ '^https?://')),
  partnership_interest text not null check (partnership_interest in (
    'stablecoin-infrastructure','banking-infrastructure','card-issuing','wallet-custody','travel-commerce','ai-agent-payments',
    'merchant-integrations','cross-border-settlement','developer-api','security-compliance','ecosystem-technology','strategic-business')),
  additional_information text check (char_length(additional_information) <= 4000),
  status text not null default 'new' check (status in ('new','reviewing','contacted','qualified','in_discussion','accepted','declined','closed')),
  source_page text not null default 'direct' check (char_length(source_page) <= 60),
  -- Whether the internal team was told: 'not_configured' means no email provider, never "sent".
  notification_state text not null default 'pending' check (notification_state in ('pending','sent','not_configured','failed')),
  notified_at timestamptz,
  submitted_day date not null default (now() at time zone 'utc')::date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index partnership_inquiries_dedupe on partnership_inquiries (work_email, partnership_interest, submitted_day);
create index partnership_inquiries_status on partnership_inquiries (status, created_at desc);

-- Notes and status changes, append-only: who did what to an inquiry, when.
create table partnership_inquiry_activity (
  id bigint generated always as identity primary key,
  inquiry_id uuid not null references partnership_inquiries(id) on delete cascade,
  kind text not null check (kind in ('note','status')),
  from_status text, to_status text,
  note text check (char_length(note) between 1 and 2000),
  actor text not null,
  created_at timestamptz not null default now(),
  check ((kind = 'status') = (to_status is not null)),
  check (kind <> 'note' or note is not null)
);
create index partnership_inquiry_activity_inquiry on partnership_inquiry_activity (inquiry_id, created_at);

alter table partnership_inquiries enable row level security;
alter table partnership_inquiry_activity enable row level security;
revoke all on table partnership_inquiries, partnership_inquiry_activity from public, anon, authenticated;
grant select, insert, update, delete on table partnership_inquiries to service_role;
grant select, insert, delete on table partnership_inquiry_activity to service_role;

create function partnership_inquiry_submit(p jsonb)
returns table (id uuid, duplicate boolean) language plpgsql security definer set search_path=public as $$
declare new_id uuid;
begin
  insert into partnership_inquiries (company_name, work_email, contact_method, contact_detail, full_name, job_title, website,
    partnership_interest, additional_information, source_page)
  values (p->>'company_name', lower(p->>'work_email'), p->>'contact_method', p->>'contact_detail', nullif(p->>'full_name',''),
    nullif(p->>'job_title',''), nullif(p->>'website',''), p->>'partnership_interest', nullif(p->>'additional_information',''),
    coalesce(nullif(p->>'source_page',''),'direct'))
  on conflict (work_email, partnership_interest, submitted_day) do nothing
  returning partnership_inquiries.id into new_id;
  if new_id is not null then return query select new_id, false; return; end if;
  return query select i.id, true from partnership_inquiries i
    where i.work_email = lower(p->>'work_email') and i.partnership_interest = p->>'partnership_interest'
      and i.submitted_day = (now() at time zone 'utc')::date;
end $$;

-- Status change + its activity row in one transaction. Compare-and-set on the
-- status the operator saw, so two people working the same inquiry cannot
-- silently overwrite each other.
create function partnership_inquiry_set_status(p_id uuid, p_from text, p_to text, p_actor text, p_note text)
returns boolean language plpgsql security definer set search_path=public as $$
declare changed int;
begin
  update partnership_inquiries set status = p_to, updated_at = now() where id = p_id and status = p_from and p_from <> p_to;
  get diagnostics changed = row_count;
  if changed = 0 then return false; end if;
  insert into partnership_inquiry_activity (inquiry_id, kind, from_status, to_status, note, actor)
    values (p_id, 'status', p_from, p_to, nullif(trim(coalesce(p_note,'')),''), p_actor);
  return true;
end $$;

create function partnership_inquiry_purge(p_before timestamptz)
returns integer language plpgsql security definer set search_path=public as $$
declare n int;
begin
  if p_before > now() - interval '30 days' then raise exception 'purge_window_too_recent'; end if;
  delete from partnership_inquiries where status in ('declined','closed') and updated_at < p_before;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function partnership_inquiry_submit(jsonb), partnership_inquiry_set_status(uuid,text,text,text,text), partnership_inquiry_purge(timestamptz) from public, anon, authenticated;
grant execute on function partnership_inquiry_submit(jsonb), partnership_inquiry_set_status(uuid,text,text,text,text), partnership_inquiry_purge(timestamptz) to service_role;
commit;
