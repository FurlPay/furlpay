//
//  ApplePayTopUp.swift
//
//  Apple Pay top-up. This has NO Android counterpart — the Wear OS app has no
//  Google Pay integration, so this is new capability rather than a port.
//
//  SCOPE, STATED PLAINLY: Apple Pay hands back an encrypted PKPaymentToken. It
//  is not money until a payment processor decrypts and captures it, and that
//  happens server-side. This file collects authorization and posts the token;
//  it does not and cannot settle anything on its own. `/api/topup/apple-pay` is
//  the endpoint that must exist for this to be real, and it does not yet — see
//  `TopUpService.submit`.
//
//  Requires: the Apple Pay capability, a merchant ID in the developer portal,
//  and the payment processor's certificate registered against it.
//

import SwiftUI
import PassKit

// MARK: - Availability

public enum ApplePay {

    /// The merchant identifier. Must match the one in the entitlement and in
    /// App Store Connect, or `canMakePayments` succeeds and authorization then
    /// fails with an opaque error.
    public static let merchantIdentifier = "merchant.com.furlpay.guardian"

    public static let supportedNetworks: [PKPaymentNetwork] = [
        .visa, .masterCard, .amex, .discover,
    ]

    /// `.threeDSecure` only. `.emv` is for legacy China UnionPay flows and
    /// including it where it is not supported causes the sheet to refuse cards
    /// that would otherwise work.
    public static let merchantCapabilities: PKMerchantCapability = [.threeDSecure]

    /// Whether to show the button at all.
    ///
    /// Two different questions, and using the wrong one is the usual bug:
    /// `canMakePayments()` asks whether the DEVICE supports Apple Pay;
    /// `canMakePayments(usingNetworks:)` asks whether this user has a usable
    /// CARD. Showing a button that opens an empty sheet is worse than hiding it.
    public static var isAvailable: Bool {
        PKPaymentAuthorizationController.canMakePayments(
            usingNetworks: supportedNetworks,
            capabilities: merchantCapabilities
        )
    }

    /// True when the device supports Apple Pay but no card is set up — the case
    /// where `.setUp` is the honest button to show.
    public static var needsCardSetup: Bool {
        PKPaymentAuthorizationController.canMakePayments() && !isAvailable
    }

    static func request(amountUsd: Decimal) -> PKPaymentRequest {
        let request = PKPaymentRequest()
        request.merchantIdentifier = merchantIdentifier
        request.countryCode = "US"
        request.currencyCode = "USD"
        request.supportedNetworks = supportedNetworks
        request.merchantCapabilities = merchantCapabilities

        // The LAST item is the grand total and is what Apple shows in bold next
        // to the merchant name. Ordering here is not cosmetic.
        request.paymentSummaryItems = [
            PKPaymentSummaryItem(
                label: "Account top-up",
                amount: NSDecimalNumber(decimal: amountUsd),
                type: .final
            ),
            PKPaymentSummaryItem(
                label: "FurlPay",
                amount: NSDecimalNumber(decimal: amountUsd),
                type: .final
            ),
        ]
        return request
    }
}

// MARK: - Submission

@MainActor
@Observable
public final class TopUpService {

    public enum State: Equatable {
        case idle
        case submitting
        case succeeded(amount: Decimal)
        case failed(String)
    }

    public private(set) var state: State = .idle

    private let container: ServiceContainer

    public init(container: ServiceContainer) {
        self.container = container
    }

    /// Posts the authorized token to the backend for decryption and capture.
    ///
    /// The idempotency key is generated ONCE per attempt and reused across
    /// retries — the same rule the travel booking follows. Minting a fresh key
    /// per retry is how a flaky network turns one top-up into three.
    public func submit(
        payment: PKPayment,
        amountUsd: Decimal,
        idempotencyKey: String
    ) async -> PKPaymentAuthorizationResult {
        state = .submitting
        do {
            try await container.api.submitApplePayTopUp(
                tokenData: payment.token.paymentData,
                network: payment.token.paymentMethod.network?.rawValue,
                displayName: payment.token.paymentMethod.displayName,
                amountUsd: amountUsd,
                idempotencyKey: idempotencyKey
            )
            state = .succeeded(amount: amountUsd)
            await container.wallets.refresh()
            return PKPaymentAuthorizationResult(status: .success, errors: nil)
        } catch {
            let message = (error as? LocalizedError)?.errorDescription
                ?? "We couldn't complete that top-up."
            state = .failed(message)
            // Handing the error back means Apple's own sheet shows it, in place,
            // instead of the sheet succeeding and an alert contradicting it a
            // second later.
            return PKPaymentAuthorizationResult(status: .failure, errors: [error])
        }
    }
}

// MARK: - UI

public struct TopUpView: View {
    @Environment(ServiceContainer.self) private var container
    @Environment(\.dismiss) private var dismiss

    @State private var amount: Decimal = 50
    @State private var service: TopUpService?
    /// Generated once per sheet, deliberately NOT regenerated on retry.
    @State private var idempotencyKey = UUID().uuidString

    private let presets: [Decimal] = [25, 50, 100, 250]

    public init() {}

    public var body: some View {
        NavigationStack {
            VStack(spacing: 24) {
                amountDisplay
                presetRow
                Spacer()
                payButton
                statusLine
            }
            .padding(20)
            .background(GuardianColors.background.ignoresSafeArea())
            .navigationTitle("Add Funds")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
        .preferredColorScheme(.dark)
        .task { service = service ?? TopUpService(container: container) }
    }

    private var amountDisplay: some View {
        VStack(spacing: 4) {
            Text(amount.usd)
                .font(.system(size: 44, weight: .semibold, design: .rounded))
                .foregroundStyle(GuardianColors.textPrimary)
                .contentTransition(.numericText())
            Text("to your FurlPay balance")
                .font(.caption)
                .foregroundStyle(GuardianColors.textSecondary)
        }
        .padding(.top, 24)
    }

    private var presetRow: some View {
        HStack(spacing: 10) {
            ForEach(presets, id: \.self) { preset in
                Button {
                    withAnimation(.snappy) { amount = preset }
                } label: {
                    Text(preset.usdCompact)
                        .font(.callout.weight(.medium))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                }
                .background(
                    amount == preset
                        ? GuardianColors.primaryAccent.opacity(0.2)
                        : GuardianColors.surface
                )
                .foregroundStyle(
                    amount == preset ? GuardianColors.primaryAccent : GuardianColors.textSecondary
                )
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
        }
    }

    @ViewBuilder
    private var payButton: some View {
        if ApplePay.isAvailable {
            PayWithApplePayButton(.topUp, request: ApplePay.request(amountUsd: amount)) { phase in
                handle(phase)
            }
            .payWithApplePayButtonStyle(.white)
            .frame(height: 50)

        } else if ApplePay.needsCardSetup {
            // The device can pay; the user just has no card. `.setUp` opens
            // Wallet rather than pretending a payment is possible.
            PayWithApplePayButton(.setUp, request: ApplePay.request(amountUsd: amount)) { _ in }
            .payWithApplePayButtonStyle(.white)
            .frame(height: 50)

        } else {
            Text("Apple Pay isn't available on this device.")
                .font(.footnote)
                .foregroundStyle(GuardianColors.textSecondary)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 16)
        }
    }

    @ViewBuilder
    private var statusLine: some View {
        switch service?.state {
        case .submitting:
            ProgressView().tint(GuardianColors.primaryAccent)
        case .succeeded(let value):
            Label("\(value.usd) added", systemImage: "checkmark.circle.fill")
                .font(.footnote)
                .foregroundStyle(GuardianColors.positive)
        case .failed(let message):
            Label(message, systemImage: "exclamationmark.triangle.fill")
                .font(.footnote)
                .foregroundStyle(GuardianColors.negative)
                .multilineTextAlignment(.center)
        default:
            // Reserve the space so the button does not jump when a status
            // appears — movement under the thumb during payment reads as a bug.
            Color.clear.frame(height: 20)
        }
    }

    private func handle(_ phase: PayWithApplePayButtonPaymentAuthorizationPhase) {
        switch phase {
        case .willAuthorize:
            break
        case .didAuthorize(let payment, let completion):
            Task {
                guard let service else {
                    completion(PKPaymentAuthorizationResult(status: .failure, errors: nil))
                    return
                }
                let result = await service.submit(
                    payment: payment, amountUsd: amount, idempotencyKey: idempotencyKey
                )
                completion(result)
            }
        case .didFinish:
            if case .succeeded = service?.state {
                dismiss()
            } else {
                // A cancelled or failed attempt gets a NEW key. Reusing the old
                // one would let the server dedupe a genuinely second attempt
                // against the first.
                idempotencyKey = UUID().uuidString
            }
        @unknown default:
            break
        }
    }
}
