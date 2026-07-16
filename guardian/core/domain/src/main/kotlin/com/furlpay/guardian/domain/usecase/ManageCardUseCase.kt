package com.furlpay.guardian.domain.usecase

import com.furlpay.guardian.domain.GuardianResult
import com.furlpay.guardian.domain.model.Card
import com.furlpay.guardian.domain.repository.CardRepository

/**
 * Freeze/unfreeze with the domain-side validation the registry applies to the
 * co-pilot path: card ids must look like ids BEFORE they reach the network.
 * The biometric gate lives in the app layer (it needs an Activity); this use
 * case is the last line that runs either way.
 */
class ManageCardUseCase(private val repository: CardRepository) {

    suspend fun setFrozen(cardId: String, freeze: Boolean): GuardianResult<Card> {
        if (!CARD_ID.matches(cardId)) {
            return GuardianResult.Err("Invalid card id.")
        }
        return repository.setFrozen(cardId, freeze)
    }

    private companion object {
        // Same shape card_control enforces in GuardianActionRegistry.
        val CARD_ID = Regex("^[\\w-]{1,64}$")
    }
}
