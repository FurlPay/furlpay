package com.furlpay.guardian.mobile.ui.trips

import android.content.Intent
import android.view.WindowManager
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.furlpay.guardian.domain.model.BoardingPass
import com.furlpay.guardian.domain.model.BoardingPassPayment
import com.furlpay.guardian.domain.model.FlightStatus
import com.furlpay.guardian.domain.model.routeProgressAt
import com.furlpay.guardian.domain.model.statusAt
import com.furlpay.guardian.domain.model.statusLine
import com.furlpay.guardian.mobile.R
import com.furlpay.guardian.mobile.viewmodel.TripsViewModel
import kotlinx.coroutines.delay
import kotlinx.datetime.Clock
import kotlinx.datetime.Instant

/**
 * The FurlPay Trips screen: live flight status, the trip, the pass, and what it
 * cost — the order a traveller needs them in on the day.
 *
 * The Android counterpart of
 * ios/FurlPayGuardian/FurlPayGuardian/Features/Travel/BoardingPassView.swift,
 * rendering the same GET /api/travel/boarding-passes payload. The two are kept
 * deliberately close: a passenger with the phone app and the watch is holding
 * one document, not two designs.
 *
 * The pass itself is LIGHT on a dark app, deliberately. A gate scanner reads a
 * dark barcode on a light ground, and inverting it to match the app's theme
 * would trade a working pass for a consistent one. Apple Wallet makes the same
 * call, and so does the SwiftUI build.
 *
 * NOTE ON WALLET: the reference design labels the wide button "Add to Apple
 * Wallet"; the Android equivalent would be Google Wallet. Nothing in FurlPay
 * issues a signed pass — no pass class, no issuer account, no endpoint — so
 * this screen does not offer one. It does the thing it can genuinely deliver:
 * put the barcode under a scanner. When a pass-signing endpoint lands, the
 * primary button here is what changes.
 */
@Composable
fun TripsScreen(
    onClose: () -> Unit,
    viewModel: TripsViewModel = viewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()

    // Ticks once a second so the countdown crosses "2 min" to "1 min" while
    // someone is looking at it, and stops the moment the screen leaves
    // composition. The Lock Screen / notification surface would need no ticking
    // at all — this exists purely for the labels on THIS screen.
    var now by remember { mutableStateOf(Clock.System.now()) }
    LaunchedEffect(Unit) {
        while (true) {
            delay(1_000)
            now = Clock.System.now()
        }
    }

    val pass = state.activePass(now)
    val error = state.error

    var expanded by rememberSaveable { mutableStateOf(false) }
    var showingGate by rememberSaveable { mutableStateOf(false) }

    if (showingGate && pass != null) {
        GateScreen(pass = pass, onDismiss = { showingGate = false })
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(TripsPalette.background),
    ) {
        TripsTopBar(
            refreshing = state.refreshing,
            onBack = onClose,
            onRefresh = viewModel::refresh,
        )

        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            when {
                state.loading -> LoadingState()
                pass != null -> {
                    LiveFlightCard(pass = pass, now = now)
                    // Hero and pass travel together: the pass overlaps the
                    // photo, so they are one block rather than two cards that
                    // happen to be adjacent.
                    Column {
                        TripHero(pass = pass)
                        BoardingPassCard(
                            pass = pass,
                            expanded = expanded,
                            onToggle = { expanded = !expanded },
                            modifier = Modifier.overlapPrevious(16.dp),
                        )
                    }
                    GateActionBar(
                        pass = pass,
                        onShowGate = { showingGate = true },
                        onToggleDetails = { expanded = !expanded },
                        expanded = expanded,
                    )
                    FlightStatusCard(pass = pass, now = now)
                    PaidWithCard(payment = pass.payment)
                }
                error != null -> ErrorState(message = error, onRetry = viewModel::refresh)
                else -> NoPassState()
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}

// MARK: - Chrome

@Composable
private fun TripsTopBar(
    refreshing: Boolean,
    onBack: () -> Unit,
    onRefresh: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 8.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        TextButton(onClick = onBack) {
            Text("Back", color = TripsPalette.green, fontSize = 16.sp)
        }
        Spacer(Modifier.weight(1f))
        Text(
            "Boarding pass",
            color = Color.White,
            fontSize = 17.sp,
            fontWeight = FontWeight.SemiBold,
        )
        Spacer(Modifier.weight(1f))
        if (refreshing) {
            CircularProgressIndicator(
                modifier = Modifier.size(18.dp).padding(end = 2.dp),
                color = TripsPalette.green,
                strokeWidth = 2.dp,
            )
            Spacer(Modifier.width(12.dp))
        } else {
            TextButton(onClick = onRefresh) {
                Text("Refresh", color = TripsPalette.green, fontSize = 16.sp)
            }
        }
    }
}

// MARK: - Live flight card

@Composable
private fun LiveFlightCard(pass: BoardingPass, now: Instant) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(TripsRadius.live))
            .background(
                Brush.linearGradient(listOf(TripsPalette.liveTop, TripsPalette.liveBottom)),
            )
            .padding(horizontal = 15.dp, vertical = 14.dp)
            .semantics(mergeDescendants = true) {
                contentDescription = "FurlPay flight ${pass.flight.number}, " +
                    "${pass.flight.originCity} to ${pass.flight.destinationCity}. " +
                    pass.statusLine(now)
            },
        verticalAlignment = Alignment.Top,
    ) {
        FurlPayMark(size = 34.dp, modifier = Modifier.padding(top = 16.dp))
        Spacer(Modifier.width(11.dp))

        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(7.dp),
        ) {
            Text("FurlPay", color = TripsPalette.greenDim, fontSize = 13.sp, fontWeight = FontWeight.Medium)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    pass.flight.originCode,
                    color = Color.White,
                    fontSize = 25.sp,
                    fontWeight = FontWeight.Bold,
                )
                Text(
                    "  →  ",
                    color = Color.White,
                    fontSize = 20.sp,
                    fontWeight = FontWeight.Bold,
                )
                Text(
                    pass.flight.destinationCode,
                    color = Color.White,
                    fontSize = 25.sp,
                    fontWeight = FontWeight.Bold,
                )
            }
            Text(
                pass.flight.number,
                color = Color.White.copy(alpha = 0.9f),
                fontSize = 15.sp,
                fontWeight = FontWeight.Medium,
            )
            Text(
                pass.statusLine(now),
                color = TripsPalette.green,
                fontSize = 15.sp,
                fontWeight = FontWeight.Medium,
            )
        }

        RouteTrack(
            progress = pass.routeProgressAt(now),
            modifier = Modifier.width(96.dp).padding(top = 28.dp),
        )
    }
}

/**
 * The FurlPay mark: stem plus two arms.
 *
 * Drawn rather than shipped as a raster so it stays crisp at any size and adds
 * no asset to the APK.
 */
@Composable
private fun FurlPayMark(size: Dp, modifier: Modifier = Modifier) {
    Canvas(modifier.size(size).clearAndSetSemantics { }) {
        val w = this.size.width
        val h = this.size.height
        val bar = w * 0.20f
        drawRect(TripsPalette.green, Offset(w * 0.30f, h * 0.06f), Size(bar, h * 0.88f))
        drawRect(TripsPalette.green, Offset(w * 0.30f, h * 0.06f), Size(w * 0.58f, bar))
        drawRect(TripsPalette.green, Offset(w * 0.30f, h * 0.44f), Size(w * 0.42f, bar))
    }
}

// MARK: - Trip hero + pass

@Composable
private fun TripHero(pass: BoardingPass) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(TripsRadius.hero))
            .background(Brush.verticalGradient(listOf(TripsPalette.heroTop, TripsPalette.heroBottom))),
    ) {
        Column(
            modifier = Modifier.padding(start = 21.dp, end = 21.dp, top = 16.dp, bottom = 13.dp),
            verticalArrangement = Arrangement.spacedBy(11.dp),
        ) {
            Text(pass.title, color = Color.White, fontSize = 26.sp, fontWeight = FontWeight.SemiBold)
            Text(pass.routeLabel, color = Color.White.copy(alpha = 0.9f), fontSize = 15.sp)
        }
        Image(
            painter = painterResource(R.drawable.furlpay_airways_a321),
            contentDescription = "FurlPay Airways Airbus A321 in flight above the clouds",
            contentScale = ContentScale.Crop,
            modifier = Modifier.fillMaxWidth().height(132.dp),
        )
    }
}

/**
 * Pulls a composable up over the one above it by [amount] AND reports the
 * reduced height, so the element that follows sits against this one's real
 * bottom edge.
 *
 * A plain `offset` would move the card without shrinking its slot, leaving a
 * 16dp hole underneath; a negative `Arrangement.spacedBy` would do the right
 * thing but leans on unvalidated behaviour. This states the intent exactly.
 */
private fun Modifier.overlapPrevious(amount: Dp) = this.layout { measurable, constraints ->
    val placeable = measurable.measure(constraints)
    val shift = amount.roundToPx()
    layout(placeable.width, (placeable.height - shift).coerceAtLeast(0)) {
        placeable.place(0, -shift)
    }
}

@Composable
private fun BoardingPassCard(
    pass: BoardingPass,
    expanded: Boolean,
    onToggle: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val flight = pass.flight
    val haptics = LocalHapticFeedback.current

    Column(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(TripsRadius.pass))
            .background(Color.White)
            .padding(start = 19.dp, end = 19.dp, top = 15.dp, bottom = 13.dp),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clickable {
                    haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                    onToggle()
                }
                .semantics {
                    contentDescription =
                        "${if (expanded) "Hide" else "Show"} full boarding pass for ${flight.number}"
                },
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                flight.number,
                color = TripsPalette.passInk,
                fontSize = 29.sp,
                fontWeight = FontWeight.SemiBold,
            )
            Spacer(Modifier.weight(1f))
            Text(
                flight.aircraft,
                color = TripsPalette.glyphGrey,
                fontSize = 15.sp,
                modifier = Modifier
                    .clip(CircleShape)
                    .background(TripsPalette.passChip)
                    .padding(horizontal = 12.dp, vertical = 6.dp),
            )
        }

        PassRule(Modifier.padding(top = 13.dp))

        Row(
            modifier = Modifier.fillMaxWidth().padding(top = 13.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.Top,
        ) {
            PassField("Boarding", flight.boardingTime, accent = true)
            PassField("Departs", flight.departureTime)
            PassField("Gate", flight.gate)
            PassField("Seat", flight.seat)
        }

        Box(Modifier.padding(top = 13.dp)) {
            PassField("Arrives", flight.arrivalTime)
        }

        if (expanded) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 14.dp)
                    .clip(RoundedCornerShape(TripsRadius.inset))
                    .background(TripsPalette.passInset)
                    .padding(14.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Row(Modifier.fillMaxWidth(), Arrangement.SpaceBetween, Alignment.Top) {
                    PassField("From", "${flight.originCity} (${flight.originCode})")
                    PassField("To", "${flight.destinationCity} (${flight.destinationCode})")
                }
                Row(Modifier.fillMaxWidth(), Arrangement.SpaceBetween, Alignment.Top) {
                    PassField("Aircraft", flight.aircraft)
                    PassField("Boarding gate", flight.gate)
                }
            }
        }

        PassRule(Modifier.padding(top = 15.dp))

        Row(
            modifier = Modifier.fillMaxWidth().padding(top = 13.dp),
            verticalAlignment = Alignment.Bottom,
        ) {
            PassField("Passenger", pass.passenger.name)
            Spacer(Modifier.weight(1f))
            if (pass.passenger.verified) {
                Box(
                    modifier = Modifier
                        .size(32.dp)
                        .clip(CircleShape)
                        .background(TripsPalette.ink)
                        .semantics { contentDescription = "Identity verified" },
                    contentAlignment = Alignment.Center,
                ) {
                    Text("✓", color = Color.White, fontSize = 17.sp, fontWeight = FontWeight.Bold)
                }
            }
        }

        PassRule(Modifier.padding(top = 13.dp))

        Box(Modifier.padding(top = 12.dp)) {
            BarcodeStrip(value = pass.id, height = if (expanded) 70.dp else 46.dp)
        }

        Text(
            "FURLPAY",
            color = TripsPalette.glyphGrey,
            fontSize = 10.sp,
            fontWeight = FontWeight.Bold,
            letterSpacing = 1.2.sp,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth().padding(top = 7.dp),
        )
    }
}

@Composable
private fun PassRule(modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth().height(1.dp).background(TripsPalette.passRule))
}

@Composable
private fun PassField(label: String, value: String, accent: Boolean = false) {
    Column(
        verticalArrangement = Arrangement.spacedBy(9.dp),
        modifier = Modifier.semantics(mergeDescendants = true) {
            contentDescription = "$label: $value"
        },
    ) {
        Text(label, color = TripsPalette.passInkDim, fontSize = 13.sp)
        Text(
            value,
            color = if (accent) TripsPalette.ink else TripsPalette.passInk,
            fontSize = 24.sp,
        )
    }
}

// MARK: - Actions

@Composable
private fun GateActionBar(
    pass: BoardingPass,
    expanded: Boolean,
    onShowGate: () -> Unit,
    onToggleDetails: () -> Unit,
) {
    val context = LocalContext.current
    val haptics = LocalHapticFeedback.current
    var menuOpen by remember { mutableStateOf(false) }

    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Button(
            onClick = {
                haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                onShowGate()
            },
            modifier = Modifier.weight(1f).height(56.dp),
            shape = CircleShape,
            colors = ButtonDefaults.buttonColors(
                containerColor = TripsPalette.trackBg,
                contentColor = Color.White,
            ),
        ) {
            Column(horizontalAlignment = Alignment.Start, modifier = Modifier.fillMaxWidth()) {
                Text("Show at", fontSize = 17.sp, fontWeight = FontWeight.Medium)
                Text("the gate", fontSize = 17.sp, fontWeight = FontWeight.Medium)
            }
        }

        Box {
            Box(
                modifier = Modifier
                    .size(48.dp)
                    .clip(CircleShape)
                    .background(TripsPalette.chipGrey)
                    .clickable { menuOpen = true }
                    .semantics { contentDescription = "More trip options" },
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    "•••",
                    color = TripsPalette.glyphGrey,
                    fontSize = 18.sp,
                    fontWeight = FontWeight.Bold,
                )
            }

            DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                DropdownMenuItem(
                    text = { Text(if (expanded) "Hide flight details" else "Flight details") },
                    onClick = {
                        menuOpen = false
                        onToggleDetails()
                    },
                )
                DropdownMenuItem(
                    text = { Text("Share pass") },
                    onClick = {
                        menuOpen = false
                        val send = Intent(Intent.ACTION_SEND).apply {
                            type = "text/plain"
                            putExtra(Intent.EXTRA_TEXT, shareText(pass))
                        }
                        context.startActivity(Intent.createChooser(send, "Share pass"))
                    },
                )
            }
        }
    }
}

private fun shareText(pass: BoardingPass): String = buildString {
    appendLine("${pass.flight.number} · ${pass.flight.originCode} → ${pass.flight.destinationCode}")
    appendLine("${pass.passenger.name} · Seat ${pass.flight.seat} · Gate ${pass.flight.gate}")
    append(
        "Boards ${pass.flight.boardingTime}, departs ${pass.flight.departureTime}, " +
            "arrives ${pass.flight.arrivalTime}",
    )
}

/**
 * Full-screen pass. White ground, barcode as wide as the display allows, screen
 * kept awake and brightness forced up: gate readers want contrast and quiet
 * zones, and a phone that dims mid-scan makes the passenger the problem.
 *
 * MainActivity sets FLAG_SECURE app-wide, which blocks screenshots but not the
 * physical screen — a reader still sees what is drawn here.
 */
@Composable
private fun GateScreen(pass: BoardingPass, onDismiss: () -> Unit) {
    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        val context = LocalContext.current
        val activity = remember(context) { context as? android.app.Activity }

        DisposableEffect(activity) {
            val window = activity?.window
            val previousBrightness = window?.attributes?.screenBrightness
            window?.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            window?.attributes = window?.attributes?.apply {
                screenBrightness = WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_FULL
            }
            onDispose {
                window?.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                // Restore rather than reset to a constant: the user may have
                // had an app-level brightness override of their own.
                window?.attributes = window?.attributes?.apply {
                    screenBrightness = previousBrightness
                        ?: WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE
                }
            }
        }

        Column(
            modifier = Modifier
                .fillMaxSize()
                .background(Color.White)
                .padding(24.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                pass.flight.number,
                color = TripsPalette.passInk,
                fontSize = 34.sp,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                "${pass.flight.originCode} → ${pass.flight.destinationCode}",
                color = TripsPalette.passInkDim,
                fontSize = 17.sp,
                modifier = Modifier.padding(top = 4.dp),
            )

            Spacer(Modifier.height(28.dp))

            Row(horizontalArrangement = Arrangement.spacedBy(32.dp)) {
                GateFact("Gate", pass.flight.gate)
                GateFact("Seat", pass.flight.seat)
                GateFact("Boards", pass.flight.boardingTime)
            }

            Spacer(Modifier.height(32.dp))

            BarcodeStrip(value = pass.id, height = 140.dp)

            // The strip is a visual stand-in, not a scannable symbology, so the
            // booking reference is printed where an agent can key it in.
            Text(
                pass.id,
                color = TripsPalette.passInkDim,
                fontSize = 12.sp,
                modifier = Modifier.padding(top = 10.dp),
            )
            Text(
                pass.passenger.name,
                color = TripsPalette.passInk,
                fontSize = 20.sp,
                modifier = Modifier.padding(top = 20.dp),
            )

            Spacer(Modifier.height(36.dp))

            TextButton(onClick = onDismiss) {
                Text("Done", color = TripsPalette.ink, fontSize = 17.sp)
            }
        }
    }
}

@Composable
private fun GateFact(label: String, value: String) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier.semantics(mergeDescendants = true) {
            contentDescription = "$label: $value"
        },
    ) {
        Text(label, color = TripsPalette.passInkDim, fontSize = 13.sp)
        Text(
            value,
            color = TripsPalette.passInk,
            fontSize = 22.sp,
            fontWeight = FontWeight.Medium,
            modifier = Modifier.padding(top = 4.dp),
        )
    }
}

// MARK: - Status + payment

@Composable
private fun FlightStatusCard(pass: BoardingPass, now: Instant) {
    val status = pass.statusAt(now)

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(TripsRadius.card))
            .background(TripsPalette.surface)
            .border(1.dp, TripsPalette.cardBorder, RoundedCornerShape(TripsRadius.card))
            .padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Flight status", color = Color.White, fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.weight(1f))
            Text(
                status.label,
                color = TripsPalette.green,
                fontSize = 13.sp,
                fontWeight = FontWeight.Medium,
                modifier = Modifier
                    .clip(CircleShape)
                    .background(TripsPalette.green.copy(alpha = 0.16f))
                    .padding(horizontal = 10.dp, vertical = 5.dp),
            )
        }

        RouteArc(
            progress = pass.routeProgressAt(now),
            modifier = Modifier.fillMaxWidth().height(66.dp),
        )

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            StatusTile(pass.flight.originCode, pass.flight.originCity, pass.flight.departureTime)
            StatusTile(
                pass.flight.destinationCode,
                pass.flight.destinationCity,
                pass.flight.arrivalTime,
                alignEnd = true,
            )
        }

        if (status == FlightStatus.SCHEDULED || status == FlightStatus.BOARDING_SOON) {
            Text(
                pass.statusLine(now),
                color = TripsPalette.subText,
                fontSize = 14.sp,
            )
        }
    }
}

@Composable
private fun StatusTile(code: String, city: String, time: String, alignEnd: Boolean = false) {
    Column(
        horizontalAlignment = if (alignEnd) Alignment.End else Alignment.Start,
        verticalArrangement = Arrangement.spacedBy(3.dp),
        modifier = Modifier.semantics(mergeDescendants = true) {
            contentDescription = "$city ($code) at $time"
        },
    ) {
        Text(code, color = Color.White, fontSize = 20.sp, fontWeight = FontWeight.SemiBold)
        Text(city, color = TripsPalette.subText, fontSize = 13.sp)
        Text(time, color = TripsPalette.green, fontSize = 15.sp, fontWeight = FontWeight.Medium)
    }
}

@Composable
private fun PaidWithCard(payment: BoardingPassPayment) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(TripsRadius.card))
            .background(TripsPalette.tile)
            .border(1.dp, TripsPalette.tileBorder, RoundedCornerShape(TripsRadius.card))
            .padding(18.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text("Paid with", color = TripsPalette.subText, fontSize = 13.sp)
            Text(
                payment.currency,
                color = Color.White,
                fontSize = 17.sp,
                fontWeight = FontWeight.SemiBold,
            )
        }
        Spacer(Modifier.weight(1f))
        Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(
                formatUsd(payment.amount),
                color = Color.White,
                fontSize = 20.sp,
                fontWeight = FontWeight.SemiBold,
            )
            if (payment.rewardsRate > 0) {
                Text(
                    "${trimZeros(payment.rewardsRate)}% back",
                    color = TripsPalette.green,
                    fontSize = 13.sp,
                )
            }
        }
    }
}

/**
 * Locale.US explicitly: the "$" prefix is hardcoded, so formatting the number
 * under a locale that uses a comma decimal separator would render "$486,20".
 */
private fun formatUsd(amount: Double): String =
    "$" + String.format(java.util.Locale.US, "%,.2f", amount)

private fun trimZeros(value: Double): String =
    if (value == value.toLong().toDouble()) value.toLong().toString() else value.toString()

// MARK: - Loading / empty / error

@Composable
private fun LoadingState() {
    // Skeleton rather than a spinner: the shapes below are exactly where the
    // live card, hero and pass land, so the screen does not jump when they do.
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        SkeletonBlock(height = 104.dp, radius = TripsRadius.live)
        SkeletonBlock(height = 210.dp, radius = TripsRadius.hero)
        SkeletonBlock(height = 260.dp, radius = TripsRadius.pass)
    }
}

@Composable
private fun SkeletonBlock(height: Dp, radius: Dp) {
    Box(
        Modifier
            .fillMaxWidth()
            .height(height)
            .clip(RoundedCornerShape(radius))
            .background(TripsPalette.surface),
    )
}

@Composable
private fun NoPassState() {
    Column(
        modifier = Modifier.fillMaxWidth().padding(top = 80.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text("No flight booked", color = Color.White, fontSize = 20.sp, fontWeight = FontWeight.SemiBold)
        Text(
            "Your boarding pass appears here once a flight is booked.",
            color = TripsPalette.subText,
            fontSize = 15.sp,
            textAlign = TextAlign.Center,
        )
    }
}

@Composable
private fun ErrorState(message: String, onRetry: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(top = 80.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(
            "Couldn't load your pass",
            color = Color.White,
            fontSize = 20.sp,
            fontWeight = FontWeight.SemiBold,
        )
        // Verbatim: on a boarding screen, the difference between "offline" and
        // "signed out" decides whether the passenger walks to the gate or to a
        // desk, and a generic apology tells them neither.
        Text(message, color = TripsPalette.subText, fontSize = 15.sp, textAlign = TextAlign.Center)
        Button(
            onClick = onRetry,
            shape = CircleShape,
            colors = ButtonDefaults.buttonColors(
                containerColor = TripsPalette.ink,
                contentColor = Color.White,
            ),
        ) {
            Text("Try again")
        }
    }
}
