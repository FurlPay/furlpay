-- Merchant refunds with ledger reservation and on-chain-verified completion.
-- Apply after 0044. Service-role access only.
--
-- FurlPay does not hold the keys of collection addresses (the custody provider
-- does), so FurlPay never broadcasts a refund. The workflow is:
--
--   requested                  merchant asks; the amount is RESERVED at once by a
--                              balanced journal into mp:refunds:<chain> (a liability
--                              owed to the payer), so it can be refunded only once
--   pending_external_execution FurlPay operations approved; the custody provider
--                              must now send the USDC
--   completed                  the transfer was READ ON-CHAIN (collection address ->
--                              refund address, exact amount, at depth) and the
--                              liability is settled against the treasury
--   cancelled                  before execution only; the reservation is reversed
--                              by a compensating journal (ledger_transactions.reverses)
--
-- Sources, in order: whatever is unallocated in mp:hold:<intent> (underpaid or
-- overpaid excess), then the merchant's net for this payment. The processing fee
-- is not returned. A refund may only go to an address that PAID this intent.
begin;

create table merchant_refunds (
  id uuid primary key,
  intent_id uuid not null references merchant_payment_intents(id),
  merchant_id uuid not null,
  chain text not null,
  amount_units bigint not null check (amount_units > 0),
  from_hold_units bigint not null check (from_hold_units >= 0),
  from_merchant_units bigint not null check (from_merchant_units >= 0),
  to_address text not null,
  reason text not null check (char_length(reason) between 3 and 500),
  status text not null check (status in ('requested','pending_external_execution','completed','cancelled')),
  requested_by text not null, approved_by text, approved_at timestamptz,
  tx_hash text, log_index integer, completed_at timestamptz, cancelled_at timestamptz,
  reserve_tx text not null references ledger_transactions(id),
  settle_tx text references ledger_transactions(id),
  created_at timestamptz not null default now(),
  check (amount_units = from_hold_units + from_merchant_units),
  check ((status = 'completed') = (tx_hash is not null and settle_tx is not null and completed_at is not null)),
  check ((approved_at is null) = (approved_by is null))
);
create index merchant_refunds_intent on merchant_refunds(intent_id);
create index merchant_refunds_merchant on merchant_refunds(merchant_id, created_at desc);
-- A chain transfer can settle at most one refund, and never one that was also a payment receipt.
create unique index merchant_refunds_tx on merchant_refunds(chain, tx_hash, log_index) where tx_hash is not null;

create function merchant_refund_request(p_id uuid, p_merchant uuid, p_intent uuid, p_amount bigint, p_to text, p_reason text, p_actor text)
returns merchant_refunds language plpgsql security definer set search_path=public as $$
declare r merchant_refunds; i merchant_payment_intents; hold bigint; payable bigint; merchant_used bigint; from_hold bigint; from_merchant bigint;
  merchant_left bigint; cur text; txn text; legs jsonb := '[]'::jsonb;
begin
  select * into r from merchant_refunds where id=p_id;
  if found then
    if r.merchant_id<>p_merchant or r.intent_id<>p_intent then raise exception 'request_conflict'; end if;
    return r;
  end if;
  -- Serializes refunds of one intent (and against its own receipts).
  select * into i from merchant_payment_intents where id=p_intent and merchant_id=p_merchant for update;
  if not found then raise exception 'intent_missing'; end if;
  if i.status not in ('underpaid','paid','overpaid') then raise exception 'not_refundable'; end if;
  if p_amount <= 0 then raise exception 'invalid_amount'; end if;
  if not exists (select 1 from merchant_payment_receipts where intent_id=i.id and payer=p_to) then raise exception 'refund_address_not_payer'; end if;

  hold := ledger_account_balance('mp:hold:'||i.id);
  select coalesce(sum(from_merchant_units),0) into merchant_used from merchant_refunds where intent_id=i.id and status<>'cancelled';
  merchant_left := case when i.paid_at is not null then greatest(i.net_units::bigint - merchant_used, 0) else 0 end;
  payable := ledger_account_balance('mp:merchant:'||i.merchant_id||':'||i.chain);
  merchant_left := least(merchant_left, greatest(payable, 0));
  if p_amount > hold + merchant_left then raise exception 'exceeds_refundable'; end if;
  from_hold := least(p_amount, hold);
  from_merchant := p_amount - from_hold;

  cur := 'USDC:'||i.chain||':6';
  insert into ledger_accounts(id,code,name,type,currency) values
    ('mp:refunds:'||i.chain,'mp:refunds:'||i.chain,'Merchant refunds owed to payers (USDC micro-units)','liability',cur)
    on conflict(id) do nothing;
  if from_hold > 0 then legs := legs || jsonb_build_array(jsonb_build_object('account_id','mp:hold:'||i.id,'side','debit','amount',from_hold)); end if;
  if from_merchant > 0 then legs := legs || jsonb_build_array(jsonb_build_object('account_id','mp:merchant:'||i.merchant_id||':'||i.chain,'side','debit','amount',from_merchant)); end if;
  legs := legs || jsonb_build_array(jsonb_build_object('account_id','mp:refunds:'||i.chain,'side','credit','amount',p_amount));
  txn := 'mp:refund:'||p_id||':reserve';
  perform ledger_post(txn,'Refund reserved for payment '||i.id,legs);

  insert into merchant_refunds(id,intent_id,merchant_id,chain,amount_units,from_hold_units,from_merchant_units,to_address,reason,status,requested_by,reserve_tx)
    values(p_id,i.id,i.merchant_id,i.chain,p_amount,from_hold,from_merchant,p_to,p_reason,'requested',p_actor,txn) returning * into r;
  insert into merchant_payment_events(intent_id,status,detail) values(i.id,i.status,'Refund of '||p_amount||' units requested; amount reserved.');
  return r;
end $$;

create function merchant_refund_cancel(p_id uuid, p_merchant uuid)
returns merchant_refunds language plpgsql security definer set search_path=public as $$
declare r merchant_refunds; legs jsonb;
begin
  select * into r from merchant_refunds where id=p_id and merchant_id=p_merchant for update;
  if not found then raise exception 'refund_missing'; end if;
  if r.status='cancelled' then return r; end if;
  -- Once operations approved it, the custody provider may already be sending: only operations can stop it.
  if r.status<>'requested' then raise exception 'not_cancellable'; end if;
  select jsonb_agg(jsonb_build_object('account_id',account_id,'side',case when side='debit' then 'credit' else 'debit' end,'amount',amount))
    into legs from ledger_postings where transaction_id=r.reserve_tx;
  perform ledger_post('mp:refund:'||r.id||':cancel','Refund cancelled for payment '||r.intent_id,legs,r.reserve_tx);
  update merchant_refunds set status='cancelled', cancelled_at=now() where id=r.id returning * into r;
  insert into merchant_payment_events(intent_id,status,detail) select r.intent_id,i.status,'Refund cancelled; reservation reversed.' from merchant_payment_intents i where i.id=r.intent_id;
  return r;
end $$;

create function merchant_refund_approve(p_id uuid, p_actor text)
returns merchant_refunds language plpgsql security definer set search_path=public as $$
declare r merchant_refunds;
begin
  update merchant_refunds set status='pending_external_execution', approved_by=p_actor, approved_at=now()
    where id=p_id and status='requested' returning * into r;
  if not found then raise exception 'not_approvable'; end if;
  return r;
end $$;

-- Called ONLY after the caller read the transfer from the chain. Re-checks every
-- field against the refund row and settles the liability against the treasury.
create function merchant_refund_complete(p_id uuid, p_tx text, p_log integer, p_amount bigint, p_from text, p_to text, p_block text, p_time timestamptz)
returns merchant_refunds language plpgsql security definer set search_path=public as $$
declare r merchant_refunds; i merchant_payment_intents; txn text;
begin
  select * into r from merchant_refunds where id=p_id for update;
  if not found then raise exception 'refund_missing'; end if;
  if r.status='completed' then
    if r.tx_hash<>p_tx or r.log_index<>p_log then raise exception 'already_completed'; end if;
    return r;
  end if;
  if r.status<>'pending_external_execution' then raise exception 'not_approved'; end if;
  select * into i from merchant_payment_intents where id=r.intent_id;
  if p_amount<>r.amount_units then raise exception 'amount_mismatch'; end if;
  -- Base58 (Solana) is case-sensitive: lower() would equate different addresses there.
  if (r.chain='solana' and (p_from<>i.recipient or p_to<>r.to_address))
     or (r.chain<>'solana' and (lower(p_from)<>lower(i.recipient) or lower(p_to)<>lower(r.to_address))) then raise exception 'party_mismatch'; end if;
  if p_time < r.created_at then raise exception 'transfer_predates_refund'; end if;
  if exists(select 1 from merchant_payment_receipts where chain=r.chain and tx_hash=p_tx and log_index=p_log) then raise exception 'transfer_is_a_payment'; end if;
  txn := 'mp:refund:'||r.id||':settle';
  perform ledger_post(txn,'Refund sent on-chain for payment '||r.intent_id||' ('||p_tx||')',jsonb_build_array(
    jsonb_build_object('account_id','mp:refunds:'||r.chain,'side','debit','amount',r.amount_units),
    jsonb_build_object('account_id','mp:treasury:'||r.chain,'side','credit','amount',r.amount_units)));
  update merchant_refunds set status='completed', tx_hash=p_tx, log_index=p_log, completed_at=now(), settle_tx=txn where id=r.id returning * into r;
  insert into merchant_payment_events(intent_id,status,detail) values(r.intent_id,i.status,'Refund of '||r.amount_units||' units verified on-chain ('||p_tx||', block '||p_block||').');
  return r;
end $$;

alter table merchant_refunds enable row level security;
revoke all on merchant_refunds from anon,authenticated;
grant all on merchant_refunds to service_role;
revoke all on function merchant_refund_request(uuid,uuid,uuid,bigint,text,text,text), merchant_refund_cancel(uuid,uuid), merchant_refund_approve(uuid,text),
  merchant_refund_complete(uuid,text,integer,bigint,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function merchant_refund_request(uuid,uuid,uuid,bigint,text,text,text), merchant_refund_cancel(uuid,uuid), merchant_refund_approve(uuid,text),
  merchant_refund_complete(uuid,text,integer,bigint,text,text,text,timestamptz) to service_role;
commit;
