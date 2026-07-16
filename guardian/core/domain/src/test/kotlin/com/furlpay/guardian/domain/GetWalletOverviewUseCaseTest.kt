package com.furlpay.guardian.domain

import com.furlpay.guardian.domain.model.Wallet
import com.furlpay.guardian.domain.repository.WalletRepository
import com.furlpay.guardian.domain.usecase.GetWalletOverviewUseCase
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlinx.coroutines.test.runTest

class GetWalletOverviewUseCaseTest {

    private class FakeRepo(private val result: GuardianResult<List<Wallet>>) : WalletRepository {
        override suspend fun wallets() = result
    }

    @Test
    fun `total is summed and wallets sort largest-first`() = runTest {
        val repo = FakeRepo(
            GuardianResult.Ok(
                listOf(
                    Wallet("w1", "SOL", 12.5, usdValue = 2_000.0, chain = "solana"),
                    Wallet("w2", "USDC", 1_234.56, usdValue = 1_234.56, chain = "arbitrum"),
                    Wallet("w3", "ETH", 2.15, usdValue = 5_230.0, chain = "ethereum"),
                ),
            ),
        )
        val overview = assertIs<GuardianResult.Ok<com.furlpay.guardian.domain.model.WalletOverview>>(
            GetWalletOverviewUseCase(repo)(),
        ).value
        assertEquals(8_464.56, overview.totalUsd, absoluteTolerance = 1e-9)
        assertEquals(listOf("ETH", "SOL", "USDC"), overview.wallets.map { it.currency })
    }

    @Test
    fun `repository failure passes through untouched`() = runTest {
        val repo = FakeRepo(GuardianResult.Err("offline"))
        val result = GetWalletOverviewUseCase(repo)()
        assertIs<GuardianResult.Err>(result)
    }
}
