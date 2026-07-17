package com.furlpay.guardian.wear.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.wear.compose.foundation.lazy.TransformingLazyColumn
import androidx.wear.compose.foundation.lazy.rememberTransformingLazyColumnState
import androidx.wear.compose.material3.Button
import androidx.wear.compose.material3.Card
import androidx.wear.compose.material3.CircularProgressIndicator
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.OutlinedButton
import androidx.wear.compose.material3.ScreenScaffold
import androidx.wear.compose.material3.Text
import com.furlpay.guardian.domain.model.FlightOffer
import com.furlpay.guardian.domain.model.TravelDeal
import com.furlpay.guardian.domain.model.TripSummary
import com.furlpay.guardian.wear.viewmodel.TravelViewModel
import com.furlpay.guardian.wear.ui.theme.FurlPayColors

/**
 * Travel: My Trips (amount + method + status), live flight offers with
 * airline marks, and flash deals bookable-and-payable from the wrist. The
 * pay step is a separate explicit confirm with the server-owned pricing
 * model (identifiers + idempotency key only).
 */
@Composable
fun TravelScreen(viewModel: TravelViewModel = viewModel()) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val columnState = rememberTransformingLazyColumnState()
    val haptics = rememberHaptics()

    when (val book = state.book) {
        is TravelViewModel.BookFlow.Idle -> Unit
        is TravelViewModel.BookFlow.Resolving,
        is TravelViewModel.BookFlow.Booking,
        -> {
            ScreenScaffold {
                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator()
                }
            }
            return
        }
        is TravelViewModel.BookFlow.Confirm -> {
            BookConfirmFace(book, haptics, viewModel)
            return
        }
        is TravelViewModel.BookFlow.Booked -> {
            BookResultFace(
                title = "Booked — ${usd(book.amountUsd)}",
                subtitle = "Ref ${book.reference}. Itinerary on your phone.",
                color = FurlPayColors.MoneyPositive,
                onDone = viewModel::dismissBooking,
            )
            return
        }
        is TravelViewModel.BookFlow.Failed -> {
            BookResultFace(
                title = "Not booked",
                subtitle = book.message,
                color = MaterialTheme.colorScheme.error,
                onDone = viewModel::dismissBooking,
            )
            return
        }
    }

    ScreenScaffold(scrollState = columnState) { contentPadding ->
        TransformingLazyColumn(state = columnState, contentPadding = contentPadding) {
            item {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.Center,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    GlyphIcon(GuardianGlyph.Plane)
                    Spacer(modifier = Modifier.width(6.dp))
                    Text("Travel", style = MaterialTheme.typography.titleMedium)
                }
            }
            if (state.loading) {
                item { CircularProgressIndicator() }
            }
            state.error?.let { error ->
                item {
                    Text(
                        text = error,
                        color = MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.labelSmall,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }

            if (state.trips.isNotEmpty()) {
                item { SectionLabel("My trips") }
                items(state.trips.size) { i -> TripRow(state.trips[i]) }
            }

            if (state.flights.isNotEmpty()) {
                item { SectionLabel("Flights " + (state.flightsRoute ?: "")) }
                items(state.flights.size) { i -> FlightRow(state.flights[i]) }
            }

            if (state.deals.isNotEmpty()) {
                item { SectionLabel("Flash deals") }
                items(state.deals.size) { i ->
                    DealRow(state.deals[i]) {
                        haptics.click()
                        viewModel.beginBooking(state.deals[i])
                    }
                }
            }
        }
    }
}

@Composable
private fun SectionLabel(text: String) {
    Text(
        text = text,
        style = MaterialTheme.typography.labelSmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        textAlign = TextAlign.Center,
        modifier = Modifier.fillMaxWidth().padding(top = 6.dp),
    )
}

@Composable
private fun TripRow(trip: TripSummary) {
    Card(onClick = {}, modifier = Modifier.fillMaxWidth()) {
        Column {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = trip.name,
                    style = MaterialTheme.typography.labelMedium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                Text(
                    text = usd(trip.amountUsd),
                    style = MaterialTheme.typography.labelMedium,
                    color = FurlPayColors.Primary,
                )
            }
            Text(
                text = listOf(
                    trip.city,
                    "${trip.checkIn} to ${trip.checkOut}",
                    trip.method,
                    trip.status,
                ).filter { it.isNotBlank() }.joinToString(" · "),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
private fun FlightRow(flight: FlightOffer) {
    Card(onClick = {}, modifier = Modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            // Airline mark from the Duffel CDN when live; carrier-code
            // monogram always underneath (never a blank/broken box).
            AssetLogo(symbol = flight.carrierCode, logoPath = flight.logoUrl, size = 26.dp)
            Spacer(modifier = Modifier.width(8.dp))
            Column(modifier = Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = flight.carrier,
                        style = MaterialTheme.typography.labelMedium,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f),
                    )
                    Text(
                        text = usd(flight.priceUsd),
                        style = MaterialTheme.typography.labelMedium,
                        color = FurlPayColors.Primary,
                    )
                }
                Text(
                    text = "${flight.departTime} to ${flight.arriveTime} · " +
                        "${flight.durationMin / 60}h ${flight.durationMin % 60}m · " +
                        (if (flight.stops == 0) "nonstop" else "${flight.stops} stop") +
                        " · ${flight.cabin}",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

@Composable
private fun DealRow(deal: TravelDeal, onBook: () -> Unit) {
    Card(onClick = onBook, modifier = Modifier.fillMaxWidth()) {
        Column {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = deal.name,
                    style = MaterialTheme.typography.labelMedium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                Text(
                    text = "-${deal.discountPct}%",
                    style = MaterialTheme.typography.labelMedium,
                    color = FurlPayColors.MoneyPositive,
                )
            }
            Text(
                text = "${deal.city} · ${usd(deal.nightlyUsd)}/night · pay in ${deal.payToken}",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = "Tap to book and pay",
                style = MaterialTheme.typography.labelSmall,
                color = FurlPayColors.Primary,
            )
        }
    }
}

@Composable
private fun BookConfirmFace(
    confirm: TravelViewModel.BookFlow.Confirm,
    haptics: Haptics,
    viewModel: TravelViewModel,
) {
    ScreenScaffold {
        Column(
            modifier = Modifier.fillMaxSize().padding(horizontal = 20.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterVertically),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                text = confirm.stay.name,
                style = MaterialTheme.typography.titleMedium,
                textAlign = TextAlign.Center,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = "${confirm.stay.city} · ${confirm.nights} nights\n" +
                    "${confirm.checkIn} to ${confirm.checkOut}\n" +
                    "${usd(confirm.stay.nightlyUsd)}/night + taxes",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
            Text(
                text = "Server sets the final total.",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Button(
                onClick = { haptics.heavyClick(); viewModel.confirmBooking() },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text("Book and pay", modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center)
            }
            OutlinedButton(onClick = viewModel::dismissBooking, modifier = Modifier.fillMaxWidth()) {
                Text("Cancel", modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center)
            }
        }
    }
}

@Composable
private fun BookResultFace(
    title: String,
    subtitle: String,
    color: androidx.compose.ui.graphics.Color,
    onDone: () -> Unit,
) {
    ScreenScaffold {
        Column(
            modifier = Modifier.fillMaxSize().padding(horizontal = 20.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterVertically),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                text = title,
                style = MaterialTheme.typography.titleMedium,
                color = color,
                textAlign = TextAlign.Center,
            )
            Text(
                text = subtitle,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
            Button(onClick = onDone, modifier = Modifier.fillMaxWidth()) {
                Text("Done", modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center)
            }
        }
    }
}
