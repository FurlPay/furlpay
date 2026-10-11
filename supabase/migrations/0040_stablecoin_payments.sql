-- Merchant collection subledger. Apply after 0009. No keys or wallet seeds here.
-- Each destination must be provisioned by operations, controlled by the platform,
-- approved for collection and NEVER reused. Public callers cannot supply one.
-- Ledger accounts use currency USDC:<chain>:6 and MICRO-UNITS, isolated from USD
-- cent accounts. Arc gas/native balances are not booked as an additional asset.
begin;
create table merchant_payment_links (
  id uuid primary key, merchant_id uuid not null, merchant_name text not null,
  slug text unique not null, title text not null, description text not null default '',
  amount_units text not null check (amount_units ~ '^[1-9][0-9]*$' and amount_units::numeric <= 1000000000000),
  processing_bps integer not null default 75 check(processing_bps between 0 and 1000),
  fee_payer text not null check(fee_payer in ('merchant','customer')),
  chains text[] not null check(cardinality(chains) between 1 and 8 and chains <@ array['arc','base','arbitrum','solana','polygon','ethereum','optimism','avalanche']::text[]),
  reusable boolean not null, active boolean not null default true,
  kind text not null check(kind in ('link','invoice','terminal')),
  reference text not null default '', lines jsonb not null default '[]',
  expires_at timestamptz, created_at timestamptz not null default now(),
  check(kind = 'link' or not reusable)
);
create index on merchant_payment_links(merchant_id,created_at desc);
create table merchant_payment_destinations (
  id uuid primary key default gen_random_uuid(), merchant_id uuid not null, chain text not null,
  address text not null, custody_reference text not null, approved_at timestamptz not null,
  assigned_intent uuid unique, created_at timestamptz not null default now(),
  check(chain in ('arc','base','arbitrum','solana','polygon','ethereum','optimism','avalanche')),
  check(case when chain = 'solana' then address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' else address ~ '^0x[0-9a-fA-F]{40}$' and address <> '0x0000000000000000000000000000000000000000' end)
);
create unique index on merchant_payment_destinations(chain,(case when chain = 'solana' then address else lower(address) end));
create table merchant_payment_intents (
  id uuid primary key, link_id uuid not null references merchant_payment_links(id), merchant_id uuid not null,
  chain text not null, recipient text not null, reference text not null,
  status text not null default 'awaiting_payment' check(status in ('awaiting_payment','confirming','underpaid','paid','overpaid','expired','review')),
  gross_units text not null, fee_units text not null, charge_units text not null, net_units text not null,
  received_units text not null default '0', start_block text not null, scan_block text not null,
  expires_at timestamptz not null, created_at timestamptz not null default now(), last_checked_at timestamptz not null default 'epoch', paid_at timestamptz,
  transaction_hash text, confirmations integer not null default 0, ledger_tx_id text references ledger_transactions(id),
  check(gross_units::numeric > 0 and fee_units::numeric >= 0 and net_units::numeric > 0 and charge_units::numeric = fee_units::numeric + net_units::numeric),
  check(received_units::numeric >= 0)
);
create index on merchant_payment_intents(merchant_id,created_at desc);
create index on merchant_payment_intents(status,created_at);
create table merchant_payment_receipts (
  chain text not null, tx_hash text not null, log_index integer not null,
  intent_id uuid not null references merchant_payment_intents(id), amount_units text not null,
  payer text not null, block_number text not null, block_hash text not null, observed_at timestamptz not null,
  created_at timestamptz not null default now(), primary key(chain,tx_hash,log_index),
  check(amount_units ~ '^[1-9][0-9]*$')
);
create table merchant_payment_events (
  id bigserial primary key, intent_id uuid not null references merchant_payment_intents(id),
  status text not null, detail text not null, created_at timestamptz not null default now()
);
create table merchant_payment_outbox (
  id uuid primary key default gen_random_uuid(), merchant_id uuid not null, intent_id uuid not null,
  type text not null, payload jsonb not null, created_at timestamptz not null default now(),
  unique(intent_id,type)
);

-- A session reserves a destination atomically. Address exhaustion is a 503, never
-- a fallback to a shared merchant wallet or a fabricated payment address.
create function merchant_checkout_reserve(p_id uuid, p_slug text, p_chain text, p_reference text, p_start_block text)
returns merchant_payment_intents language plpgsql security definer set search_path=public as $$
declare l merchant_payment_links; i merchant_payment_intents; d merchant_payment_destinations; f bigint; g bigint;
begin
  select * into l from merchant_payment_links where slug=p_slug for update;
  if not found then raise exception 'link_unavailable'; end if;
  select * into i from merchant_payment_intents where id=p_id;
  if found then
    if i.link_id<>l.id or i.chain<>p_chain then raise exception 'request_conflict'; end if;
    return i;
  end if;
  if not l.active or (l.expires_at is not null and l.expires_at<=now()) or not(p_chain=any(l.chains)) then raise exception 'link_unavailable'; end if;
  if not l.reusable and exists(select 1 from merchant_payment_intents where link_id=l.id and (paid_at is not null or status='review' or expires_at>now())) then raise exception 'checkout_in_progress'; end if;
  select * into d from merchant_payment_destinations where chain=p_chain and merchant_id=l.merchant_id and assigned_intent is null order by created_at for update skip locked limit 1;
  if not found then raise exception 'rail_unavailable'; end if;
  g:=l.amount_units::bigint; f:=g*l.processing_bps/10000;
  insert into merchant_payment_intents(id,link_id,merchant_id,chain,recipient,reference,gross_units,fee_units,charge_units,net_units,start_block,scan_block,expires_at)
    values(p_id,l.id,l.merchant_id,p_chain,d.address,p_reference,g::text,f::text,
      (case when l.fee_payer='customer' then g+f else g end)::text,
      (case when l.fee_payer='merchant' then g-f else g end)::text,p_start_block,p_start_block,
      least(now()+interval '30 minutes',coalesce(l.expires_at,now()+interval '30 minutes'))) returning * into i;
  update merchant_payment_destinations set assigned_intent=i.id where id=d.id;
  insert into merchant_payment_events(intent_id,status,detail) values(i.id,i.status,'Checkout opened; a dedicated collection address was reserved.');
  return i;
end $$;

-- Called ONLY after independent RPC verification and screening. Serializes all
-- transfers for the intent and all consumers of a chain/transaction/log tuple.
-- Receipt claim, balanced journal, status, invoice completion and event outbox
-- commit together; a crash cannot acknowledge a payment with missing postings.
create function merchant_payment_receive(p_id uuid,p_tx text,p_log integer,p_amount text,p_payer text,p_block text,p_block_hash text,p_time timestamptz,p_confirmations integer)
returns merchant_payment_intents language plpgsql security definer set search_path=public as $$
declare i merchant_payment_intents; l merchant_payment_links; n bigint; total bigint; txn text; cur text; treasury text; hold text; payable text; revenue text; legs jsonb;
begin
  select * into i from merchant_payment_intents where id=p_id for update;
  if not found then raise exception 'intent_missing'; end if;
  if p_amount !~ '^[1-9][0-9]*$' or p_amount::numeric>100000000000000000 or p_log<0 or p_confirmations<1 then raise exception 'invalid_receipt'; end if;
  if p_time<i.created_at-interval '5 seconds' or p_time>i.expires_at or i.status='review' then raise exception 'receipt_outside_window'; end if;
  perform pg_advisory_xact_lock(hashtextextended(i.chain||':'||p_tx||':'||p_log,0));
  if exists(select 1 from merchant_payment_receipts where chain=i.chain and tx_hash=p_tx and log_index=p_log) then
    if not exists(select 1 from merchant_payment_receipts where chain=i.chain and tx_hash=p_tx and log_index=p_log and intent_id=i.id) then raise exception 'receipt_already_claimed'; end if;
    return i;
  end if;
  n:=p_amount::bigint; total:=i.received_units::bigint+n;
  cur:='USDC:'||i.chain||':6'; treasury:='mp:treasury:'||i.chain; hold:='mp:hold:'||i.id; payable:='mp:merchant:'||i.merchant_id||':'||i.chain; revenue:='mp:fees:'||i.chain;
  insert into ledger_accounts(id,code,name,type,currency) values
    (treasury,treasury,'Merchant collection treasury (USDC micro-units)','asset',cur),
    (hold,hold,'Unallocated customer payment (USDC micro-units)','liability',cur),
    (payable,payable,'Merchant payable (USDC micro-units)','liability',cur),
    (revenue,revenue,'Merchant processing revenue (USDC micro-units)','revenue',cur)
    on conflict(id) do nothing;
  txn:='mp:'||i.chain||':'||p_tx||':'||p_log;
  legs:=jsonb_build_array(jsonb_build_object('account_id',treasury,'side','debit','amount',n),jsonb_build_object('account_id',hold,'side','credit','amount',n));
  if i.paid_at is null and total>=i.charge_units::bigint then
    legs:=legs||jsonb_build_array(jsonb_build_object('account_id',hold,'side','debit','amount',i.charge_units::bigint),jsonb_build_object('account_id',payable,'side','credit','amount',i.net_units::bigint));
    if i.fee_units::bigint>0 then legs:=legs||jsonb_build_array(jsonb_build_object('account_id',revenue,'side','credit','amount',i.fee_units::bigint)); end if;
  end if;
  perform ledger_post(txn,'Verified merchant USDC collection '||i.id,legs);
  insert into merchant_payment_receipts(chain,tx_hash,log_index,intent_id,amount_units,payer,block_number,block_hash,observed_at)
    values(i.chain,p_tx,p_log,i.id,p_amount,p_payer,p_block,p_block_hash,p_time);
  update merchant_payment_intents set received_units=total::text,transaction_hash=p_tx,confirmations=p_confirmations,
    status=case when total<charge_units::bigint then 'underpaid' when total=charge_units::bigint then 'paid' else 'overpaid' end,
    paid_at=case when total>=charge_units::bigint then coalesce(paid_at,now()) else null end, ledger_tx_id=txn
    where id=i.id returning * into i;
  insert into merchant_payment_events(intent_id,status,detail) values(i.id,i.status,'Verified native USDC transfer; balanced journal recorded.');
  if i.paid_at is not null then
    insert into merchant_payment_outbox(merchant_id,intent_id,type,payload) values(i.merchant_id,i.id,'payment.succeeded',jsonb_build_object('id',i.id,'chain',i.chain,'gross_units',i.gross_units,'fee_units',i.fee_units,'net_units',i.net_units,'transaction_hash',p_tx)) on conflict do nothing;
    select * into l from merchant_payment_links where id=i.link_id;
    if l.kind='invoice' then insert into merchant_payment_outbox(merchant_id,intent_id,type,payload) values(i.merchant_id,i.id,'invoice.paid',jsonb_build_object('invoice',l.id,'payment_intent',i.id)) on conflict do nothing; end if;
  end if;
  return i;
end $$;

-- All access is through session-scoped server queries or the service-only RPCs.
alter table merchant_payment_links enable row level security;
alter table merchant_payment_destinations enable row level security;
alter table merchant_payment_intents enable row level security;
alter table merchant_payment_receipts enable row level security;
alter table merchant_payment_events enable row level security;
alter table merchant_payment_outbox enable row level security;
revoke all on merchant_payment_links,merchant_payment_destinations,merchant_payment_intents,merchant_payment_receipts,merchant_payment_events,merchant_payment_outbox from anon,authenticated;
revoke all on function merchant_checkout_reserve(uuid,text,text,text,text),merchant_payment_receive(uuid,text,integer,text,text,text,text,timestamptz,integer) from public,anon,authenticated;
grant execute on function merchant_checkout_reserve(uuid,text,text,text,text),merchant_payment_receive(uuid,text,integer,text,text,text,text,timestamptz,integer) to service_role;
grant all on merchant_payment_links,merchant_payment_destinations,merchant_payment_intents,merchant_payment_receipts,merchant_payment_events,merchant_payment_outbox to service_role;
grant usage,select on sequence merchant_payment_events_id_seq to service_role;
create function merchant_receipts_immutable() returns trigger language plpgsql as $$ begin raise exception 'Merchant payment evidence is append-only'; end $$;
create trigger merchant_receipt_immutable before update or delete on merchant_payment_receipts for each row execute function merchant_receipts_immutable();
create trigger merchant_event_immutable before update or delete on merchant_payment_events for each row execute function merchant_receipts_immutable();
commit;
