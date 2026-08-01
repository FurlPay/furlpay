//
//  Money.swift
//
//  Port of native-app/lib/money.ts and lib/sendValidation.ts.
//
//  Authoritative money-amount parsing. Money never goes through floating point:
//  a user-typed string is parsed straight to atomic units or rejected.
//
//  `Double(x) > 0` is NOT a money check. "0.0000001" passes it and then
//  truncates to 0 atomic USDC, which would let someone Face-ID-sign a
//  zero-value authorisation. That is the bug this file exists to make
//  unrepresentable, and the reason every amount entry point goes through it.
//
//  Ported as-is rather than reimplemented with Decimal: the rejection rules are
//  the valuable part, and they are specific — scientific notation, locale
//  separators, more than six decimals REJECTED rather than silently truncated.
//  `Decimal(string:)` accepts several of those quietly.
//

import Foundation

public enum Money {

    public static let usdcDecimals = 6
    private static let atomicPerWhole: Int64 = 1_000_000

    /// Cap on a single mobile send: $999,999,999. A paste error, not a use
    /// case, is the only thing above it — the server's per-transfer quote limit
    /// is the real ceiling and is far lower.
    private static let maxWholeDigits = 9

    /// Carries a user-displayable message; callers show it verbatim.
    public struct AmountError: Error, Equatable, LocalizedError {
        public let message: String
        public var errorDescription: String? { message }
    }

    /// Parses a user-typed USDC amount into atomic units (6dp).
    ///
    /// Accepts exactly: optional surrounding whitespace around `digits` or
    /// `digits.1–6 digits`. Everything else throws with a message saying why.
    public static func parseUsdc(_ input: String) throws -> Int64 {
        let s = input.trimmingCharacters(in: .whitespacesAndNewlines)

        guard !s.isEmpty else {
            throw AmountError(message: "Enter an amount.")
        }
        guard !s.contains(where: { $0 == "e" || $0 == "E" }) else {
            throw AmountError(
                message: "Enter a plain amount like 12.50 — scientific notation isn't supported."
            )
        }
        guard !s.contains(where: { $0 == "," || $0 == "'" || $0.isWhitespace }) else {
            throw AmountError(message: "Remove separators — enter the amount like 1250.50.")
        }
        guard !s.hasPrefix("-") else {
            throw AmountError(message: "Amount must be positive.")
        }

        // One dot at most, digits either side. Anything else is malformed.
        let parts = s.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count <= 2,
              let whole = parts.first.map(String.init),
              !whole.isEmpty,
              whole.allSatisfy(\.isNumber)
        else {
            throw AmountError(message: "Enter a valid amount like 12.50.")
        }

        let frac = parts.count == 2 ? String(parts[1]) : ""
        guard frac.allSatisfy(\.isNumber) else {
            throw AmountError(message: "Enter a valid amount like 12.50.")
        }
        guard frac.count <= usdcDecimals else {
            throw AmountError(
                message: "USDC supports at most \(usdcDecimals) decimal places."
            )
        }

        // Leading zeros stripped before the length check, so "0000012" is 2
        // digits and not 7.
        let significant = whole.drop { $0 == "0" }
        guard significant.count <= maxWholeDigits else {
            throw AmountError(message: "That amount is above the supported maximum.")
        }

        let padded = frac.padding(toLength: usdcDecimals, withPad: "0", startingAt: 0)
        guard let wholeValue = Int64(significant.isEmpty ? "0" : String(significant)),
              let fracValue = Int64(padded.isEmpty ? "0" : padded)
        else {
            throw AmountError(message: "Enter a valid amount like 12.50.")
        }

        let atomic = wholeValue * atomicPerWhole + fracValue
        guard atomic != 0 else {
            throw AmountError(message: "Amount must be at least 0.000001 USDC.")
        }
        return atomic
    }

    /// Non-throwing variant, for live form validation where a half-typed
    /// amount should not produce an error message on every keystroke.
    public static func tryParseUsdc(_ input: String) -> Int64? {
        try? parseUsdc(input)
    }

    /// Atomic USDC → display string ("1234567" → "1.234567"), no float drift.
    public static func formatAtomic(_ atomic: Int64) -> String {
        let negative = atomic < 0
        let magnitude = abs(atomic)
        let whole = magnitude / atomicPerWhole
        var frac = String(magnitude % atomicPerWhole)
        frac = String(repeating: "0", count: usdcDecimals - frac.count) + frac
        while frac.hasSuffix("0") { frac.removeLast() }
        return "\(negative ? "-" : "")\(whole)\(frac.isEmpty ? "" : "." + frac)"
    }

    /// Atomic units as a `Decimal` for display and arithmetic.
    ///
    /// Int64 → Decimal is exact; this is not the float path the parser exists
    /// to avoid.
    public static func decimal(fromAtomic atomic: Int64) -> Decimal {
        Decimal(atomic) / Decimal(atomicPerWhole)
    }
}

// MARK: - Destination validation

public enum DestinationChain: String, Sendable {
    case solana, evm
}

public enum Destination {
    /// EVM: 0x followed by exactly 40 hex characters. Matches the rule in
    /// AGENTS.md, and the same one the web app enforces.
    private static let evmPattern = try! NSRegularExpression(
        pattern: "^0x[0-9a-fA-F]{40}$"
    )

    /// Base58 has no 0, O, I or l — a Solana address containing one is a typo,
    /// not an address, and catching it here saves a failed transaction.
    private static let base58 = Set("123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz")

    public static func isValid(_ raw: String, chain: DestinationChain) -> Bool {
        let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return false }

        switch chain {
        case .evm:
            let range = NSRange(value.startIndex..., in: value)
            return evmPattern.firstMatch(in: value, range: range) != nil
        case .solana:
            // Length range covers every real base58-encoded 32-byte key.
            return (32...44).contains(value.count)
                && value.allSatisfy(base58.contains)
        }
    }
}

// MARK: - Send validation

public enum SendCheck: Equatable {
    case invalid(String)
    case valid(amountUsd: Decimal, atomic: Int64)

    public var errorMessage: String? {
        if case .invalid(let message) = self { return message }
        return nil
    }
}

public enum SendValidator {

    /// Validates a send before anything irreversible happens.
    ///
    /// Two bugs the RN version closed, preserved here because they are easy to
    /// reintroduce:
    ///
    ///  1. `Double(amount) > 0` lets "0.0000001" through, which then truncates
    ///     to zero atomic units. The parse is authoritative instead.
    ///  2. The field is USD-denominated but was compared against the balance's
    ///     TOKEN amount — 2 SOL (~$350) against a $100 entry read as
    ///     "insufficient". The comparison belongs against `usdValue`.
    public static func validate(
        destination: String,
        amount: String,
        balance: Wallet?
    ) -> SendCheck {
        let recipient = destination.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !recipient.isEmpty else {
            return .invalid("Enter a recipient address.")
        }

        if let balance {
            let chain: DestinationChain =
                balance.chain?.lowercased() == "solana" ? .solana : .evm
            guard Destination.isValid(recipient, chain: chain) else {
                return .invalid(
                    chain == .solana
                        ? "Recipient must be a Solana (base58) address."
                        : "Recipient must be a 0x… EVM address."
                )
            }
        }

        let atomic: Int64
        do {
            atomic = try Money.parseUsdc(amount)
        } catch let error as Money.AmountError {
            return .invalid(error.message)
        } catch {
            return .invalid("Enter a valid amount like 12.50.")
        }

        guard let balance else {
            return .invalid("No balance to send from.")
        }

        let amountUsd = Money.decimal(fromAtomic: atomic)
        guard amountUsd <= balance.usdValue else {
            return .invalid("Insufficient \(balance.currency) balance.")
        }
        return .valid(amountUsd: amountUsd, atomic: atomic)
    }
}
