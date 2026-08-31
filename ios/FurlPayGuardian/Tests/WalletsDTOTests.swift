//
//  WalletsDTOTests.swift
//
//  GET /api/wallets is the route the whole money surface hangs off: the
//  dashboard total, the Send screen's wallet picker, the watch snapshot, and
//  the QuickPay code. `WalletsResponse` decoded `{ wallets: [{ id, currency,
//  … }], totalUsd }` — a shape the route has never produced — with a
//  non-optional `wallets` key, so every call threw `keyNotFound` and all four
//  surfaces were blank at once. Nothing failed loudly; there was simply never
//  any data.
//
//  The fixture below is the route's ACTUAL response body (see
//  apps/web/src/app/api/wallets/route.ts). Pinning a DTO against a shape
//  someone wrote from memory is what produced the bug, so these decode the real
//  thing.
//

import Testing
import Foundation
@testable import FurlPayGuardian

@Suite("GET /api/wallets")
struct WalletsDTOTests {

    /// Byte-for-byte the shape apps/web/src/app/api/wallets/route.ts returns.
    /// Note `amount` is a STRING — the route serialises it with `.toFixed(2)`.
    private static let responseJSON = """
    {
      "safeAddress": "0x52908400098527886E0F7030069857D2E4169EE7",
      "modules": [
        { "name": "PolicyGuard", "type": "off-chain-cosigner", "enabled": true },
        { "name": "Escrow", "type": "pre-auth-hold", "enabled": true },
        { "name": "Paymaster", "type": "gas-sponsorship", "enabled": true, "feeToken": "USDC" },
        { "name": "Safe4337Module", "type": "erc-4337", "enabled": true }
      ],
      "balances": [
        { "token": "USDC", "amount": "1240.50", "chain": "base", "usdValue": 1240.50 },
        { "token": "EURC", "amount": "500.00", "chain": "base", "usdValue": 540.00 }
      ]
    }
    """

    private func decode() throws -> WalletsResponse {
        try JSONDecoder().decode(WalletsResponse.self, from: Data(Self.responseJSON.utf8))
    }

    @Test("decodes the route's real response")
    func decodesRealResponse() throws {
        let overview = try decode().toDomain()
        #expect(overview.wallets.count == 2)
        #expect(overview.safeAddress == "0x52908400098527886E0F7030069857D2E4169EE7")
    }

    @Test("reads the string amount as a number")
    func stringAmountsDecode() throws {
        let usdc = try #require(try decode().toDomain().wallets.first { $0.currency == "USDC" })
        // Decoding `amount` as a Decimal instead of a String throws; reading it
        // as a String and never parsing leaves every balance at zero.
        #expect(usdc.balance == Decimal(string: "1240.50"))
        #expect(usdc.usdValue == Decimal(string: "1240.50"))
    }

    @Test("keeps a non-dollar token's USD value distinct from its balance")
    func nonParTokenKeepsBothFigures() throws {
        let eurc = try #require(try decode().toDomain().wallets.first { $0.currency == "EURC" })
        // 500 EURC worth $540. Collapsing these two into one number is the same
        // class of bug as the transfer route's amount/amountUsd conflation.
        #expect(eurc.balance == Decimal(string: "500.00"))
        #expect(eurc.usdValue == Decimal(string: "540.00"))
    }

    @Test("sums the total itself, because the route sends none")
    func totalIsComputed() throws {
        #expect(try decode().toDomain().totalUsd == Decimal(string: "1780.50"))
    }

    @Test("ids are stable across decodes and unique per token+chain")
    func stableIdentity() throws {
        // No id exists on the wire, so one is derived. SwiftUI diffing and the
        // Send screen's Picker tag both depend on it not churning.
        let first = try decode().toDomain().wallets.map(\.id)
        let second = try decode().toDomain().wallets.map(\.id)
        #expect(first == second)
        #expect(Set(first).count == first.count)
    }

    @Test("a response with no balances decodes to an empty overview, not an error")
    func missingBalancesDegrade() throws {
        // Lenient parse: one absent key must not blank the dashboard, the Send
        // picker, the watch and QuickPay all at once — which is exactly what
        // the old non-optional `wallets` key did.
        let json = #"{ "safeAddress": "0xabc" }"#
        let overview = try JSONDecoder()
            .decode(WalletsResponse.self, from: Data(json.utf8))
            .toDomain()
        #expect(overview.wallets.isEmpty)
        #expect(overview.totalUsd == 0)
        #expect(overview.safeAddress == "0xabc")
    }

    @Test("the QuickPay payload is an address, and it fits a QR code")
    func quickPayPayloadEncodes() throws {
        // What both QuickPay screens now encode. A 42-character EVM address is
        // the realistic payload, and it must land inside the encoder's range.
        let address = try #require(try decode().toDomain().safeAddress)
        #expect(address.count == 42)
        #expect(address.hasPrefix("0x"))

        let code = try QRCode.encode(address)
        // 42 bytes is exactly version 3's level-M byte capacity — the boundary
        // case, so a capacity table off by one shows up here.
        #expect(code.size == 29)
    }
}
