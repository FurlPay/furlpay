-- Liveness alerts for merchant collection. Apply after 0045.
--
-- 0042's reconciliation checks that what was CREDITED is right. Nothing noticed
-- what was NOT happening: a payment stuck confirming, a scanner that stopped
-- (RPC outage, cron not running), or a held payment nobody reviewed. These are
-- alerts only; nothing here changes an intent or the ledger.
begin;

alter table merchant_reconciliation_alerts drop constraint merchant_reconciliation_alerts_kind_check;
alter table merchant_reconciliation_alerts add constraint merchant_reconciliation_alerts_kind_check check (kind in (
  'missing_receipt','amount_mismatch','receipt_failed','missing_ledger','unbalanced_ledger','rpc_unavailable',
  'confirmation_delayed','verification_stale','review_overdue'));

create function merchant_liveness(p_now timestamptz default now())
returns integer language plpgsql security definer set search_path=public as $$
declare r record; n integer := 0;
begin
  -- Seen on-chain but still short of the deposit policy an hour later.
  for r in select id, chain, confirmations from merchant_payment_intents
           where status='confirming' and created_at < p_now - interval '1 hour' loop
    if merchant_reconciliation_alert(r.id,'confirmation_delayed','Still confirming on '||r.chain||' after 1 hour ('||r.confirmations||' confirmations)','medium') then n:=n+1; end if;
  end loop;
  -- Open checkouts the scanner has not looked at for 10 minutes (it normally runs every 2).
  for r in select id, chain, last_checked_at from merchant_payment_intents
           where status in ('awaiting_payment','confirming','underpaid') and expires_at > p_now
             and created_at < p_now - interval '10 minutes' and last_checked_at < p_now - interval '10 minutes' loop
    if merchant_reconciliation_alert(r.id,'verification_stale','Not checked on '||r.chain||' since '||to_char(r.last_checked_at,'YYYY-MM-DD HH24:MI')||' UTC: scanner or RPC down?','high') then n:=n+1; end if;
  end loop;
  -- Held for review for a day with no operator decision recorded.
  for r in select i.id from merchant_payment_intents i
           where i.status='review' and i.created_at < p_now - interval '24 hours'
             and not exists (select 1 from merchant_review_notes x where x.intent_id=i.id) loop
    if merchant_reconciliation_alert(r.id,'review_overdue','Held for review for over 24 hours with no decision recorded','high') then n:=n+1; end if;
  end loop;
  return n;
end $$;
revoke all on function merchant_liveness(timestamptz) from public,anon,authenticated;
grant execute on function merchant_liveness(timestamptz) to service_role;
commit;
