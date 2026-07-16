package com.furlpay.guardian.wear.viewmodel

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.furlpay.guardian.domain.GuardianResult
import com.furlpay.guardian.domain.model.Card
import com.furlpay.guardian.domain.usecase.ManageCardUseCase
import com.furlpay.guardian.wear.wearServices
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

/**
 * Card safety from the wrist. POLICY (see ARCHITECTURE.md): the watch may
 * FREEZE a card — the protective direction — after an explicit second tap.
 * UNFREEZING re-enables spending and stays phone-only behind the biometric.
 */
class CardsViewModel(app: Application) : AndroidViewModel(app) {

    data class UiState(
        val loading: Boolean = true,
        val cards: List<Card> = emptyList(),
        /** Card id awaiting the second (confirming) tap. */
        val pendingFreezeId: String? = null,
        val message: String? = null,
        /** One-shot haptic cue for the screen to play, then clear. */
        val haptic: HapticCue? = null,
    )

    /** What the last state change should FEEL like (design bible §7). */
    enum class HapticCue { CLICK, HEAVY, ERROR }

    private val services = app.wearServices
    private val manageCard = ManageCardUseCase(services.cardRepo)

    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state

    init {
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            when (val result = services.cardRepo.cards()) {
                is GuardianResult.Ok ->
                    _state.value = _state.value.copy(loading = false, cards = result.value)
                is GuardianResult.Err ->
                    _state.value = _state.value.copy(loading = false, message = result.message)
            }
        }
    }

    fun onCardTapped(card: Card) {
        if (card.frozen) {
            // Unfreeze = spending re-enabled → biometric → phone.
            _state.value = _state.value.copy(
                message = "Unfreeze from your phone (biometric).",
                haptic = HapticCue.ERROR,
            )
            return
        }
        val pending = _state.value.pendingFreezeId
        if (pending != card.id) {
            _state.value = _state.value.copy(
                pendingFreezeId = card.id,
                message = null,
                haptic = HapticCue.CLICK,
            )
            return
        }
        // Second tap on the same card = confirmed freeze.
        viewModelScope.launch {
            when (val result = manageCard.setFrozen(card.id, freeze = true)) {
                is GuardianResult.Ok -> {
                    _state.value = _state.value.copy(
                        pendingFreezeId = null,
                        message = "Card …${result.value.last4} frozen.",
                        // Financial state change committed → the strong pulse.
                        haptic = HapticCue.HEAVY,
                        cards = _state.value.cards.map {
                            if (it.id == card.id) result.value else it
                        },
                    )
                }
                is GuardianResult.Err ->
                    _state.value = _state.value.copy(
                        pendingFreezeId = null,
                        message = result.message,
                        haptic = HapticCue.ERROR,
                    )
            }
        }
    }

    /** Screen consumed the one-shot cue. */
    fun onHapticPlayed() {
        _state.value = _state.value.copy(haptic = null)
    }
}
