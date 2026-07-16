package com.furlpay.guardian.domain.usecase

import com.furlpay.guardian.domain.GuardianResult
import com.furlpay.guardian.domain.model.WalletOverview
import com.furlpay.guardian.domain.repository.WalletRepository

/**
 * Wallet list → the aggregate the tile/complication renders. Total and order
 * are computed HERE (deterministically), not trusted from any AI summary — the
 * same numbers-are-computed rule GenerateBriefingUseCase follows.
 */
class GetWalletOverviewUseCase(private val repository: WalletRepository) {

    suspend operator fun invoke(): GuardianResult<WalletOverview> =
        when (val result = repository.wallets()) {
            is GuardianResult.Err -> result
            is GuardianResult.Ok -> GuardianResult.Ok(
                WalletOverview(
                    totalUsd = result.value.sumOf { it.usdValue },
                    wallets = result.value.sortedByDescending { it.usdValue },
                ),
            )
        }
}
