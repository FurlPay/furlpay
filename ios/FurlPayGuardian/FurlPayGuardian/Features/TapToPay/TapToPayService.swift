//
//  TapToPayService.swift
//
//  Orchestrates Tap to Pay on iPhone. Owns everything that is PSP-independent;
//  the PSP supplies the reader session behind `TapToPayProviding`.
//
//  TWO THINGS HERE ARE APP REVIEW GATES, NOT POLISH:
//
//   1. Apple REQUIRES a "How to Tap" instructional overlay, presented through
//      ProximityReaderDiscovery, before the first payment. Submitting without
//      it gets the app rejected. It is `showHowToTap()` below.
//   2. The merchant must accept Apple's terms on-device before any charge.
//      Once per merchant identifier, not per device.
//
//  NEITHER CAN BE TESTED IN THE SIMULATOR. ProximityReader needs the physical
//  Secure Element, so CI can compile this and can exercise the gating logic,
//  but the tap itself only ever runs on a real iPhone XS or later.
//

import Foundation
import SwiftUI
#if canImport(ProximityReader)
import ProximityReader
#endif
#if canImport(UIKit)
import UIKit
#endif

@MainActor
@Observable
public final class TapToPayService {

    public enum Phase: Equatable {
        case idle
        case preparing
        /// Sheet is up; the customer has not tapped yet.
        case waitingForTap
        case authorising
        case succeeded(TapToPayResult)
        case failed(String, recoverable: Bool)
    }

    public private(set) var phase: Phase = .idle
    public private(set) var availability: TapToPayAvailability = .unavailable(.noProvider)

    private let provider: any TapToPayProviding
    private let container: ServiceContainer

    /// Remembered so the education overlay is shown once rather than before
    /// every sale. Apple requires it before the FIRST payment, not each one.
    @ObservationIgnored
    private var hasShownEducation: Bool {
        get { UserDefaults.standard.bool(forKey: "guardian.tapToPay.educationShown") }
        set { UserDefaults.standard.set(newValue, forKey: "guardian.tapToPay.educationShown") }
    }

    public init(container: ServiceContainer, provider: (any TapToPayProviding)? = nil) {
        self.container = container
        self.provider = provider ?? UnconfiguredTapToPayProvider()
    }

    // MARK: Availability

    /// Local gates first, then the PSP's.
    ///
    /// Ordered cheapest-and-most-permanent first: there is no point asking a
    /// PSP about a merchant whose iPhone can never do this anyway, and the
    /// answer the merchant needs is the one they can act on.
    public func refreshAvailability() async {
        if let local = localUnavailability() {
            availability = .unavailable(local)
            return
        }
        availability = await provider.availability()
    }

    /// Everything decidable without a network call.
    ///
    /// Note what is NOT here: a hardcoded list of supported countries. Apple's
    /// region list moves, and a stale copy would hide the feature from a
    /// merchant who could use it. The PSP knows; we ask.
    private func localUnavailability() -> TapToPayUnavailability? {
        #if !canImport(ProximityReader)
        return .deviceNotSupported
        #else
        guard #available(iOS 16.4, *) else { return .osTooOld }

        // Apple does not support Tap to Pay on beta iOS at all, so a merchant
        // on a beta gets a clear answer instead of a mystifying session error.
        if Self.isRunningBetaOS { return .osIsBeta }

        guard PaymentCardReader.isSupported else { return .deviceNotSupported }
        guard Self.hasEntitlement else { return .notEntitled }
        return nil
        #endif
    }

    /// Reads the entitlement out of the built binary rather than assuming it.
    ///
    /// A missing entitlement produces an opaque session failure at tap time,
    /// which is the worst possible moment to discover it — a customer is
    /// standing there holding a card.
    static var hasEntitlement: Bool {
        #if canImport(UIKit)
        // Present in the embedded provisioning profile only when Apple has
        // granted it, so this is a real check and not a manifest read.
        guard let task = SecTaskCreateFromSelf(nil) else { return false }
        let value = SecTaskCopyValueForEntitlement(
            task, "com.apple.developer.proximity-reader.payment.acceptance" as CFString, nil
        )
        return (value as? Bool) == true
        #else
        return false
        #endif
    }

    static var isRunningBetaOS: Bool {
        // No public API reports "beta". The build number's trailing letter is
        // the conventional signal, and being wrong here only costs a clearer
        // error message, never a failed payment.
        let build = ProcessInfo.processInfo.operatingSystemVersionString
        return build.lowercased().contains("beta")
    }

    // MARK: Apple's required merchant education

    /// Presents Apple's "How to Tap" overlay.
    ///
    /// REQUIRED BEFORE APP REVIEW. Not our copy and not our design — Apple
    /// supplies localised content through ProximityReaderDiscovery precisely so
    /// every merchant sees the same explanation.
    public func showHowToTapIfNeeded(force: Bool = false) async {
        guard force || !hasShownEducation else { return }
        #if canImport(ProximityReader) && canImport(UIKit)
        if #available(iOS 18.0, *) {
            guard let top = Self.topViewController() else { return }
            do {
                let discovery = ProximityReaderDiscovery()
                let content = try await discovery.content(for: .payment(.howToTap))
                discovery.presentContent(content, from: top)
                hasShownEducation = true
            } catch {
                // Do NOT mark it shown. If Apple's content could not load, the
                // merchant has not been educated, and the requirement stands.
            }
        } else {
            // iOS 16.4–17 has no ProximityReaderDiscovery. Apple's requirement
            // still applies, so the app must supply its own explanation — see
            // HowToTapFallbackView.
            hasShownEducation = await Self.presentFallbackEducation()
        }
        #endif
    }

    // MARK: Collecting

    public func collect(_ charge: TapToPayCharge) async {
        guard charge.isValid else {
            phase = .failed("Enter an amount between $0.01 and $10,000.", recoverable: true)
            return
        }

        phase = .preparing
        await refreshAvailability()
        guard case .available = availability else {
            if case .unavailable(let reason) = availability {
                phase = .failed(reason.detail, recoverable: reason.isRecoverable)
            }
            return
        }

        // Education, then terms, then the tap. This order is Apple's, not a
        // preference: a merchant must understand the gesture and accept the
        // terms before a customer is asked to present a card.
        await showHowToTapIfNeeded()

        do {
            try await provider.acceptTermsIfNeeded()
            phase = .waitingForTap
            let result = try await provider.collect(charge)
            phase = .succeeded(result)
            // The sale changes the balance; refreshing here means the merchant
            // sees it without pulling to refresh.
            await container.wallets.refresh()
            await container.transactions.refresh()
        } catch let error as TapToPayError {
            phase = .failed(Self.message(for: error), recoverable: !error.isCancellation)
        } catch {
            phase = .failed("That payment couldn't be completed.", recoverable: true)
        }
    }

    public func reset() { phase = .idle }

    /// Merchant-facing copy. A decline is deliberately not phrased as our
    /// failure — the merchant is standing in front of the customer, and
    /// "something went wrong" invites them to blame the app and retry a card
    /// the issuer has already refused.
    nonisolated static func message(for error: TapToPayError) -> String {
        switch error {
        case .unavailable(let reason):    reason.detail
        case .invalidAmount:              "Enter a valid amount."
        case .cardReadFailed:             "Card not read. Ask the customer to hold it closer, and hold still."
        case .declined(let reason):       reason ?? "The card was declined. Ask for another payment method."
        case .cancelled:                  "Payment cancelled."
        case .network:                    "No connection. The payment wasn't taken."
        case .providerFailure(let detail): detail
        }
    }

    #if canImport(UIKit)
    static func topViewController() -> UIViewController? {
        let scene = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first { $0.activationState == .foregroundActive }
        guard var top = scene?.keyWindow?.rootViewController else { return nil }
        while let presented = top.presentedViewController { top = presented }
        return top
    }

    /// Our own education for iOS 16.4–17, where Apple's content API does not
    /// exist. Returns whether it was actually shown.
    static func presentFallbackEducation() async -> Bool {
        await withCheckedContinuation { continuation in
            guard let top = topViewController() else {
                continuation.resume(returning: false)
                return
            }
            let host = UIHostingController(rootView: HowToTapFallbackView())
            host.modalPresentationStyle = .pageSheet
            top.present(host, animated: true) { continuation.resume(returning: true) }
        }
    }
    #endif
}
