package com.furlpay.guardian.ai

import com.furlpay.guardian.domain.GuardianResult
import com.furlpay.guardian.domain.ai.GuardianTools
import com.furlpay.guardian.domain.ai.ToolInvocation
import com.furlpay.guardian.domain.model.Card
import com.furlpay.guardian.domain.model.GuardianEvent
import com.furlpay.guardian.domain.model.Portfolio
import com.furlpay.guardian.domain.model.SpendingPeriod
import com.furlpay.guardian.domain.model.SpendingSummary
import com.furlpay.guardian.domain.model.Transaction
import com.furlpay.guardian.domain.model.TravelBooking
import com.furlpay.guardian.domain.model.Wallet
import com.furlpay.guardian.domain.repository.CardRepository
import com.furlpay.guardian.domain.repository.EventRepository
import com.furlpay.guardian.domain.repository.PortfolioRepository
import com.furlpay.guardian.domain.repository.TransactionRepository
import com.furlpay.guardian.domain.repository.TravelRepository
import com.furlpay.guardian.domain.repository.WalletRepository
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertTrue
import kotlinx.coroutines.test.runTest

class RepositoryToolExecutorTest {

    private class Fakes : WalletRepository, CardRepository, TransactionRepository,
        PortfolioRepository, TravelRepository, EventRepository {

        var frozenCalls = mutableListOf<Pair<String, Boolean>>()

        override suspend fun wallets() = GuardianResult.Ok(
            listOf(
                Wallet("w1", "USDC", 1234.56, 1234.56, "base"),
                Wallet("w2", "ETH", 2.0, 5000.0, "ethereum"),
            ),
        )

        override suspend fun cards() = GuardianResult.Ok(
            listOf(Card(id = "card_1", last4 = "4521", kind = "virtual", frozen = false)),
        )

        override suspend fun setFrozen(cardId: String, freeze: Boolean): GuardianResult<Card> {
            frozenCalls += cardId to freeze
            return GuardianResult.Ok(Card(id = cardId, last4 = "4521", kind = "virtual", frozen = freeze))
        }

        override suspend fun recent(limit: Int) = GuardianResult.Ok(emptyList<Transaction>())

        override suspend fun spendingSummary(period: SpendingPeriod) = GuardianResult.Ok(
            SpendingSummary(period, totalUsd = 87.30, transactionCount = 4),
        )

        override suspend fun overview() = GuardianResult.Ok(
            Portfolio(totalUsd = 12_400.0, dayChangeUsd = 42.30, dayChangePct = 1.2, positions = emptyList()),
        )

        override suspend fun upcoming() = GuardianResult.Ok(emptyList<TravelBooking>())

        override suspend fun activeEvents() = GuardianResult.Ok(emptyList<GuardianEvent>())
        override suspend fun upsert(events: List<GuardianEvent>) = GuardianResult.Ok(Unit)
        override suspend fun acknowledge(eventId: String) = GuardianResult.Ok(Unit)
    }

    private fun executor(fakes: Fakes, confirm: Boolean) = RepositoryToolExecutor(
        wallets = fakes, cards = fakes, transactions = fakes,
        portfolio = fakes, travel = fakes, events = fakes,
        confirmMutating = { confirm },
    )

    private fun invocation(tool: String, args: Map<String, String> = emptyMap()) =
        ToolInvocation(GuardianTools.byName(tool)!!, args)

    @Test
    fun `mutating tool without confirmation is refused and never reaches the repo`() = runTest {
        val fakes = Fakes()
        val reply = assertIs<GuardianResult.Ok<com.furlpay.guardian.domain.ai.ToolReply>>(
            executor(fakes, confirm = false)
                .execute(invocation("freezeCard", mapOf("last4" to "4521", "freeze" to "true"))),
        ).value

        assertEquals("error", reply.kind)
        assertTrue(fakes.frozenCalls.isEmpty(), "setFrozen must not be called without confirmation")
    }

    @Test
    fun `confirmed freeze resolves last4 to the card id`() = runTest {
        val fakes = Fakes()
        val reply = assertIs<GuardianResult.Ok<com.furlpay.guardian.domain.ai.ToolReply>>(
            executor(fakes, confirm = true)
                .execute(invocation("freezeCard", mapOf("last4" to "4521", "freeze" to "true"))),
        ).value

        assertEquals(listOf("card_1" to true), fakes.frozenCalls)
        assertTrue("frozen" in reply.text)
    }

    @Test
    fun `read-only tools run without confirmation`() = runTest {
        val executor = executor(Fakes(), confirm = false)

        val balance = assertIs<GuardianResult.Ok<com.furlpay.guardian.domain.ai.ToolReply>>(
            executor.execute(invocation("checkBalance", mapOf("currency" to "USDC"))),
        ).value
        assertTrue("1,234.56" in balance.text, balance.text)

        val spending = assertIs<GuardianResult.Ok<com.furlpay.guardian.domain.ai.ToolReply>>(
            executor.execute(invocation("getSpending", mapOf("period" to "today"))),
        ).value
        assertTrue("$87.30" in spending.text, spending.text)
        assertTrue("4 transactions" in spending.text, spending.text)

        val portfolio = assertIs<GuardianResult.Ok<com.furlpay.guardian.domain.ai.ToolReply>>(
            executor.execute(invocation("getPortfolio")),
        ).value
        assertTrue("+1.2%" in portfolio.text, portfolio.text)
        assertFalse("Top mover" in portfolio.text) // no positions in fake
    }
}
