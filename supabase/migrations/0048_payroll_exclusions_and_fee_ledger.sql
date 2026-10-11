-- Payroll: isolate flagged recipients, and journal the fee FurlPay receives.
-- Apply after 0047.
--
-- 1. Excluding flagged lines. Until now one recipient that failed screening
--    (or could not be screened) left the whole batch `blocked`, and a blocked
--    batch could only be cancelled — one flagged contractor stopped payroll for
--    everyone else. The employer may now explicitly exclude the lines that did
--    not clear. They are copied to payroll_batch_exclusions (who, when, why, and
--    the screening result) and removed from the batch, which is repriced from
--    the remaining lines and returns to `draft`. A blocked batch has never been
--    submitted, so no excluded line has a signing payload or an intent. Nothing
--    is ever cleared: an excluded recipient is simply not paid by this batch.
--
-- 2. The fee journal. FurlPayRouter moves the contractor's pay straight from the
--    employer's wallet to the contractor; FurlPay never holds it, so it is NOT
--    booked as an escrow or a payable here (doing so would claim custody that
--    does not exist). What FurlPay does receive is the per-line fee, sent by the
--    router to its fee treasury. When a line's execution is verified on-chain
--    the line is recorded and that fee is journaled in the SAME transaction:
--      DR payroll:fee_treasury:<chain>  (asset, the router's feeTreasury)
--      CR payroll:fees:<chain>          (revenue)
--    keyed by chain + tx + payment id, so a retry posts nothing twice. The fee
--    must equal the fee in the employer's signed payload, and the batch is
--    marked completed here, under its row lock, when no line is outstanding.
--
-- 3. payroll_fee_reconcile(since): read-only check that journals and executed
--    lines agree. A reorg or a reverted execution is NOT auto-corrected; the app
--    raises an alert and a reversal is an operator decision (ledger_post with
--    p_reverses), the same policy as merchant reconciliation.
--
-- Recovery: everything is additive. To back out before any payroll executes,
-- drop the three functions and payroll_batch_exclusions; executed_* columns
-- and ledger rows written through these functions are append-only records and
-- are corrected forward by reversal, never by deletion.
begin;

create table payroll_batch_exclusions (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references payroll_batches(id),
  line_id uuid not null unique,
  contractor_id uuid, name text not null, recipient text not null,
  amount_units bigint not null check (amount_units > 0),
  screening text not null check (screening in ('blocked','unavailable')),
  excluded_by text not null, note text not null check (length(note) between 3 and 500),
  excluded_at timestamptz not null default now()
);
create index payroll_batch_exclusions_batch on payroll_batch_exclusions(batch_id);
alter table payroll_batch_exclusions enable row level security;

create function payroll_batch_exclude_unscreened(p_batch uuid, p_merchant uuid, p_actor text, p_note text,
  p_batch_bps integer, p_batch_min_units bigint)
returns payroll_batches language plpgsql security definer set search_path=public as $$
declare b payroll_batches; n integer; gross bigint; fee bigint;
begin
  if p_batch_bps not between 0 and 1000 or p_batch_min_units not between 0 and 100000000 then raise exception 'invalid_pricing'; end if;
  if p_note is null or length(trim(p_note)) < 3 then raise exception 'note_required'; end if;
  select * into b from payroll_batches where id=p_batch for update;
  if not found or b.merchant_id<>p_merchant then raise exception 'batch_missing'; end if;
  if b.status<>'blocked' then raise exception 'batch_not_blocked'; end if;
  insert into payroll_batch_exclusions(batch_id,line_id,contractor_id,name,recipient,amount_units,screening,excluded_by,note)
    select batch_id,id,contractor_id,name,recipient,amount_units,screening,p_actor,trim(p_note)
    from payroll_batch_lines where batch_id=p_batch and screening<>'clear';
  delete from payroll_batch_lines where batch_id=p_batch and screening<>'clear';
  select count(*), coalesce(sum(amount_units),0) into n, gross from payroll_batch_lines where batch_id=p_batch;
  if n = 0 then
    update payroll_batches set status='cancelled' where id=p_batch returning * into b;
    return b;
  end if;
  fee := greatest(gross * p_batch_bps / 10000, p_batch_min_units);
  update payroll_batches set status='draft', headcount=n, gross_units=gross, batch_fee_units=fee,
    total_quote_units=gross+fee+seat_fee_units where id=p_batch returning * into b;
  return b;
end $$;

create function payroll_line_executed(p_batch uuid, p_line uuid, p_tx text, p_block bigint, p_payment_id text, p_fee bigint, p_at timestamptz)
returns boolean language plpgsql security definer set search_path=public as $$
declare b payroll_batches; l payroll_batch_lines; cur text; treasury text; revenue text;
begin
  if p_tx !~ '^0x[0-9a-f]{64}$' or p_block < 0 or p_fee < 0 or p_payment_id is null then raise exception 'invalid_execution'; end if;
  -- Batch first, then line: the same lock order as every other writer.
  select * into b from payroll_batches where id=p_batch for update;
  if not found then raise exception 'batch_missing'; end if;
  if b.status not in ('submitted','completed') then raise exception 'batch_not_submitted'; end if;
  select * into l from payroll_batch_lines where id=p_line and batch_id=p_batch for update;
  if not found then raise exception 'line_missing'; end if;
  -- Recorded once: a retry, or a concurrent request that lost the race, changes nothing.
  if l.executed_tx is not null or l.payment_id is distinct from p_payment_id then return false; end if;
  if l.signature is null then raise exception 'line_unsigned'; end if;
  -- The fee journaled is the fee the employer SIGNED, not whatever the caller says.
  if (l.sign_data->'message'->>'fee') is distinct from p_fee::text then raise exception 'fee_mismatch'; end if;
  update payroll_batch_lines set executed_tx=p_tx, executed_block=p_block, executed_at=p_at where id=l.id;
  if p_fee > 0 then
    cur:='USDC:'||b.chain||':6'; treasury:='payroll:fee_treasury:'||b.chain; revenue:='payroll:fees:'||b.chain;
    insert into ledger_accounts(id,code,name,type,currency) values
      (treasury,treasury,'Payroll fees received by FurlPayRouter feeTreasury (USDC micro-units)','asset',cur),
      (revenue,revenue,'Payroll batch fee revenue (USDC micro-units)','revenue',cur)
      on conflict(id) do nothing;
    perform ledger_post('payroll:'||b.chain||':'||p_tx||':'||p_payment_id, 'Verified payroll fee, batch '||b.id,
      jsonb_build_array(jsonb_build_object('account_id',treasury,'side','debit','amount',p_fee),
                        jsonb_build_object('account_id',revenue,'side','credit','amount',p_fee)));
  end if;
  -- Completion is decided here, under the batch lock, so two requests recording
  -- different lines at once cannot both miss the last one. Partial stays submitted.
  if b.status='submitted' and not exists(select 1 from payroll_batch_lines where batch_id=p_batch and executed_tx is null) then
    update payroll_batches set status='completed' where id=p_batch;
  end if;
  return true;
end $$;

-- Fee journal vs executed lines (read-only). Every executed line with a fee must
-- have exactly its signed fee journaled under its key, and every payroll fee
-- journal must belong to an executed line. Findings are alerted by the app.
create function payroll_fee_reconcile(p_since timestamptz)
returns table(batch_id uuid, line_id uuid, problem text) language sql stable security definer set search_path=public as $$
  with lines as (
    select l.batch_id, l.id line_id, 'payroll:'||b.chain||':'||l.executed_tx||':'||l.payment_id txn,
           coalesce((l.sign_data->'message'->>'fee')::bigint,0) fee
    from payroll_batch_lines l join payroll_batches b on b.id=l.batch_id
    where l.executed_tx is not null and l.executed_at >= p_since
  ), posted as (
    select p.transaction_id txn, sum(case when p.side='debit' then p.amount else 0 end) debit
    from ledger_postings p join ledger_transactions t on t.id=p.transaction_id
    where t.id like 'payroll:%' and t.ts >= p_since - interval '1 day'
    group by p.transaction_id
  )
  select l.batch_id, l.line_id, case when p.txn is null then 'fee_journal_missing' else 'fee_journal_amount_mismatch' end
    from lines l left join posted p on p.txn=l.txn
    where l.fee > 0 and (p.txn is null or p.debit <> l.fee)
  union all
  select null::uuid, null::uuid, 'fee_journal_without_execution: '||p.txn
    from posted p where not exists (select 1 from lines l where l.txn=p.txn)
      and not exists (select 1 from payroll_batch_lines x join payroll_batches y on y.id=x.batch_id
                      where 'payroll:'||y.chain||':'||x.executed_tx||':'||x.payment_id = p.txn);
$$;

revoke all on function payroll_batch_exclude_unscreened(uuid,uuid,text,text,integer,bigint) from public,anon,authenticated;
grant execute on function payroll_batch_exclude_unscreened(uuid,uuid,text,text,integer,bigint) to service_role;
revoke all on function payroll_line_executed(uuid,uuid,text,bigint,text,bigint,timestamptz) from public,anon,authenticated;
grant execute on function payroll_line_executed(uuid,uuid,text,bigint,text,bigint,timestamptz) to service_role;
revoke all on function payroll_fee_reconcile(timestamptz) from public,anon,authenticated;
grant execute on function payroll_fee_reconcile(timestamptz) to service_role;
revoke all on table payroll_batch_exclusions from public,anon,authenticated;
grant select, insert on table payroll_batch_exclusions to service_role;
commit;
