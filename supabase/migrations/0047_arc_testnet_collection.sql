-- Arc testnet collection (ARC-P2-001). Apply after 0046.
--
-- Allows chain 'arc-testnet' (chain id 5042002, same 0x3600 USDC interface) on
-- links and destinations so a full payment can be rehearsed on testnet. The
-- application only collects on it when FURLPAY_TESTNET_COLLECTION=1 outside
-- production (lib/payments/merchant/registry.ts); testnet money books to its own
-- ledger accounts (mp:treasury:arc-testnet, USDC:arc-testnet:6) and can never mix
-- with mainnet balances.
begin;

alter table merchant_payment_links drop constraint merchant_payment_links_chains_check;
alter table merchant_payment_links add constraint merchant_payment_links_chains_check
  check (cardinality(chains) between 1 and 10 and chains <@ array['arc','base','arbitrum','solana','polygon','ethereum','optimism','avalanche','sui','arc-testnet']::text[]);

alter table merchant_payment_destinations drop constraint merchant_payment_destinations_chain_check;
alter table merchant_payment_destinations add constraint merchant_payment_destinations_chain_check
  check (chain in ('arc','base','arbitrum','solana','polygon','ethereum','optimism','avalanche','sui','arc-testnet'));

commit;
