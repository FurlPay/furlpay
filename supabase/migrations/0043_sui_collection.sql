-- Sui native USDC collection for merchant payments. Apply after 0042.
--
-- Widens 0040's chain checks to include 'sui' and accepts Sui addresses
-- (0x + 64 lowercase hex) for Sui destinations. Constraint names are the ones
-- Postgres generated for 0040 (verified on PGlite and Postgres 18).
-- Receipts need no change: a Sui receipt is (chain 'sui', tx digest, log 0),
-- one netted USDC credit per destination per transaction.
begin;

alter table merchant_payment_links drop constraint merchant_payment_links_chains_check;
alter table merchant_payment_links add constraint merchant_payment_links_chains_check
  check (cardinality(chains) between 1 and 9 and chains <@ array['arc','base','arbitrum','solana','polygon','ethereum','optimism','avalanche','sui']::text[]);

alter table merchant_payment_destinations drop constraint merchant_payment_destinations_chain_check;
alter table merchant_payment_destinations add constraint merchant_payment_destinations_chain_check
  check (chain in ('arc','base','arbitrum','solana','polygon','ethereum','optimism','avalanche','sui'));

alter table merchant_payment_destinations drop constraint merchant_payment_destinations_check;
alter table merchant_payment_destinations add constraint merchant_payment_destinations_check
  check (case
    when chain = 'solana' then address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'
    when chain = 'sui' then address ~ '^0x[0-9a-f]{64}$' and address !~ '^0x0{64}$'
    else address ~ '^0x[0-9a-fA-F]{40}$' and address <> '0x0000000000000000000000000000000000000000'
  end);

commit;
