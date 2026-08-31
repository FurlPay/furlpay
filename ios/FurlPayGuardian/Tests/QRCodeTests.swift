//
//  QRCodeTests.swift
//
//  The watch cannot use Core Image, so this project carries its own QR encoder
//  (Shared/Domain/QRCode.swift). A wrong symbol does not degrade — a scanner
//  either locks on or it does not — so the structural invariants a decoder
//  depends on are pinned here rather than left to a device check.
//
//  What these DO cover: version selection, the function patterns a scanner
//  locates the symbol by, format-block placement, mask determinism, and the
//  Reed-Solomon generator polynomials (against the published constants).
//
//  What they do NOT cover: that a real scanner reads the result. That needs a
//  physical Apple Watch and is on the manual QA list — these tests make it very
//  unlikely to fail, not impossible.
//

import Testing
import Foundation
@testable import FurlPayGuardian

@Suite("QR encoder")
struct QRCodeTests {

    // MARK: Version selection

    @Test("The symbol is the smallest version the payload fits in")
    func versionSelection() throws {
        // Level M byte capacities at the version boundaries. One byte over a
        // boundary must step up a version, never overflow into a symbol that
        // silently truncates the payload.
        let boundaries: [(bytes: Int, side: Int)] = [
            (1, 21),     // v1
            (14, 21),    // v1 full
            (15, 25),    // v2
            (26, 25),    // v2 full
            (27, 29),    // v3
            (42, 29),    // v3 full
            (43, 33),    // v4
            (62, 33),    // v4 full
            (63, 37),    // v5
        ]
        for (bytes, side) in boundaries {
            let code = try QRCode.encode(String(repeating: "A", count: bytes))
            #expect(code.size == side, "\(bytes) bytes should produce a \(side)-module symbol")
            #expect(code.modules.count == side * side)
        }
    }

    @Test("A payload past version 10 is refused, not truncated")
    func oversizePayloadThrows() {
        // 213 bytes is the level-M byte-mode capacity of version 10, the
        // largest this encoder builds. Silently dropping the tail would produce
        // a scannable code carrying the wrong address.
        #expect(throws: QRCode.EncodeError.self) {
            _ = try QRCode.encode(String(repeating: "A", count: 214))
        }
        #expect(throws: Never.self) {
            _ = try QRCode.encode(String(repeating: "A", count: 213))
        }
    }

    @Test("Multi-byte UTF-8 is measured in bytes, not characters")
    func utf8IsMeasuredInBytes() throws {
        // 80 three-byte characters is 240 bytes — over capacity even though it
        // is well under 213 *characters*. Counting characters here would build
        // a symbol too small for its own data.
        #expect(throws: QRCode.EncodeError.self) {
            _ = try QRCode.encode(String(repeating: "\u{4E16}", count: 80))
        }
    }

    // MARK: Function patterns

    @Test("All three finder patterns are drawn")
    func finderPatterns() throws {
        let code = try QRCode.encode("furlpay:0x00")
        let origins = [(0, 0), (0, code.size - 7), (code.size - 7, 0)]
        for (row, column) in origins {
            for r in 0..<7 {
                for c in 0..<7 {
                    let onRing = r == 0 || r == 6 || c == 0 || c == 6
                    let inCore = (2...4).contains(r) && (2...4).contains(c)
                    #expect(
                        code[row + r, column + c] == (onRing || inCore),
                        "finder at (\(row), \(column)) is wrong at (\(r), \(c))"
                    )
                }
            }
        }
    }

    @Test("Finder separators are light on all three sides")
    func separators() throws {
        let code = try QRCode.encode("furlpay:0x00")
        let size = code.size
        for i in 0..<8 {
            #expect(!code[7, i]);            #expect(!code[i, 7])
            #expect(!code[7, size - 1 - i]); #expect(!code[i, size - 8])
            #expect(!code[size - 8, i]);     #expect(!code[size - 1 - i, 7])
        }
    }

    @Test("Timing patterns alternate along row and column 6")
    func timingPatterns() throws {
        let code = try QRCode.encode("furlpay:0x00")
        for i in 8..<(code.size - 8) {
            #expect(code[6, i] == (i % 2 == 0), "horizontal timing wrong at \(i)")
            #expect(code[i, 6] == (i % 2 == 0), "vertical timing wrong at \(i)")
        }
    }

    @Test("The dark module is set")
    func darkModule() throws {
        // Fixed by the specification and never masked. A light module here is a
        // symbol most decoders reject outright.
        for payload in ["a", String(repeating: "b", count: 60)] {
            let code = try QRCode.encode(payload)
            #expect(code[code.size - 8, 8])
        }
    }

    @Test("Alignment patterns are drawn away from the finders")
    func alignmentPatterns() throws {
        // Version 2 has one alignment pattern, centred at (18, 18).
        let code = try QRCode.encode(String(repeating: "A", count: 20))
        #expect(code.size == 25)
        for r in -2...2 {
            for c in -2...2 {
                let expected = abs(r) == 2 || abs(c) == 2 || (r == 0 && c == 0)
                #expect(code[18 + r, 18 + c] == expected, "alignment wrong at (\(r), \(c))")
            }
        }
    }

    @Test("Version 1 has no alignment pattern")
    func versionOneHasNoAlignment() throws {
        let code = try QRCode.encode("hi")
        #expect(code.size == 21)
        // (18, 18) on a version-1 symbol is ordinary data territory; the
        // ring-and-centre shape must not be there.
        let ring = [(16, 16), (16, 20), (20, 16), (20, 20)]
        #expect(!ring.allSatisfy { code[$0.0, $0.1] })
    }

    // MARK: Format information

    @Test("Both format copies carry the same bits")
    func formatCopiesAgree() throws {
        let code = try QRCode.encode("furlpay:0x00")
        let size = code.size

        // Copy one, wrapping the top-left finder and stepping over timing.
        var first: [Bool] = []
        for i in 0...5 { first.append(code[8, i]) }
        first.append(code[8, 7])
        first.append(code[8, 8])
        first.append(code[7, 8])
        for i in 9..<15 { first.append(code[14 - i, 8]) }

        // Copy two, split across the other two finders. Index 7 lands on the
        // dark module, which is not format data — hence the skip.
        var second: [Bool] = []
        for i in 0..<8 { second.append(code[size - 1 - i, 8]) }
        for i in 8..<15 { second.append(code[8, size - 15 + i]) }

        #expect(first.count == 15 && second.count == 15)
        for i in 0..<15 where i != 7 {
            #expect(first[i] == second[i], "format bit \(i) differs between copies")
        }
    }

    @Test("The format block names error-correction level M and a real mask")
    func formatBlockIsWellFormed() throws {
        // The eight level-M format strings. If the encoder writes anything
        // else, the symbol either claims the wrong EC level (so the decoder
        // reads the wrong number of codewords) or an out-of-range mask.
        let levelM: Set<UInt32> = [
            0x5412, 0x5125, 0x5E7C, 0x5B4B, 0x45F9, 0x40CE, 0x4F97, 0x4AA0,
        ]
        for payload in ["a", "furlpay:0x00", String(repeating: "z", count: 90)] {
            let code = try QRCode.encode(payload)
            var bits: UInt32 = 0
            var read: [Bool] = []
            for i in 0...5 { read.append(code[8, i]) }
            read.append(code[8, 7])
            read.append(code[8, 8])
            read.append(code[7, 8])
            for i in 9..<15 { read.append(code[14 - i, 8]) }
            for (i, bit) in read.enumerated() where bit { bits |= 1 << UInt32(i) }
            #expect(levelM.contains(bits), "'\(payload)' wrote format bits 0x\(String(bits, radix: 16))")
        }
    }

    @Test("Version information is present from version 7 and absent below it")
    func versionInformation() throws {
        // Below version 7 the block does not exist, and drawing it would
        // overwrite data modules. From 7 up, omitting it fails strict decoders.
        let small = try QRCode.encode(String(repeating: "A", count: 100))   // v6
        #expect(small.size == 41)

        let large = try QRCode.encode(String(repeating: "A", count: 120))   // v7
        #expect(large.size == 45)

        // Version 7's block is 0x07C94. Read all 18 modules back rather than
        // spot-checking one: a transposed or reversed block still lights up
        // roughly the right area while decoding to the wrong version.
        var bits: UInt32 = 0
        for i in 0..<18 where large[i / 3, large.size - 11 + i % 3] {
            bits |= 1 << UInt32(i)
        }
        #expect(bits == 0x07C94, "version block is 0x\(String(bits, radix: 16))")

        // The same block is written transposed near the bottom-left finder.
        var mirrored: UInt32 = 0
        for i in 0..<18 where large[large.size - 11 + i % 3, i / 3] {
            mirrored |= 1 << UInt32(i)
        }
        #expect(mirrored == 0x07C94)
    }

    // MARK: Determinism

    @Test("Encoding is deterministic")
    func deterministic() throws {
        // Mask choice is a minimum over penalty scores. A tie broken by
        // iteration order is fine; a tie broken by anything else would make the
        // symbol vary between renders of the same address.
        let payload = "furlpay:0x52908400098527886E0F7030069857D2E4169EE7"
        let first = try QRCode.encode(payload)
        for _ in 0..<3 {
            let again = try QRCode.encode(payload)
            #expect(again == first)
        }
    }

    @Test("Different payloads produce different symbols")
    func distinctPayloads() throws {
        let a = try QRCode.encode("furlpay:0xAAAA")
        let b = try QRCode.encode("furlpay:0xAAAB")
        #expect(a.size == b.size)
        #expect(a.modules != b.modules)
    }

    @Test("The symbol is neither blank nor solid")
    func plausibleModuleBalance() throws {
        // Rule 4 of the mask penalty pushes towards an even split. A symbol far
        // outside this band means data placement wrote nothing, or wrote
        // everywhere — both of which the pattern tests above can miss.
        let code = try QRCode.encode("furlpay:0x52908400098527886E0F7030069857D2E4169EE7")
        let dark = code.modules.reduce(0) { $0 + ($1 ? 1 : 0) }
        let ratio = Double(dark) / Double(code.modules.count)
        #expect(ratio > 0.3 && ratio < 0.7, "dark ratio \(ratio) is implausible")
    }

    // MARK: Real payloads

    @Test("The payloads this app actually encodes land in the expected versions")
    func realPaymentPayloads() throws {
        // Sized against what the QuickPay screens really put on screen, so a
        // capacity-table slip shows up as a version change rather than as a
        // code that stops scanning on someone's watch.
        let cases: [(payload: String, side: Int, note: String)] = [
            // A payment intent id — the short end.
            ("pay_a1b2c3d4", 21, "v1"),
            // A bare EVM Safe address: 42 characters, exactly v3's level-M
            // byte capacity. One byte more steps to v4.
            ("0x52908400098527886E0F7030069857D2E4169EE7", 29, "v3 boundary"),
            // The same address as an EIP-681 URI, which a scanner may hand back
            // instead of the bare address.
            ("ethereum:0x52908400098527886E0F7030069857D2E4169EE7@42161", 33, "v4"),
            // A Solana address — base58, 44 characters.
            ("5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1", 33, "v4"),
        ]
        for (payload, side, note) in cases {
            let code = try QRCode.encode(payload)
            #expect(code.size == side, "\(note): '\(payload)' produced \(code.size) modules")
        }
    }

    @Test("A watch-sized payload stays coarse enough to scan off a small screen")
    func watchPayloadModuleCount() throws {
        // A 45mm Apple Watch gives the code roughly 140pt. At v3 (29 modules
        // plus an 8-module quiet zone) that is ~3.8pt per module — readable.
        // If a payload ever pushed this past v6 the modules would fall under
        // 2.5pt and stop resolving, so the ceiling is worth pinning.
        let code = try QRCode.encode("0x52908400098527886E0F7030069857D2E4169EE7")
        let modulesAcross = code.size + 8   // the view's 4-module quiet zone, both sides
        #expect(140.0 / Double(modulesAcross) > 3.0, "modules would be too fine to scan")
    }

    // MARK: Reed-Solomon

    @Test("Generator polynomials match the published constants")
    func generatorPolynomials() {
        // From ISO/IEC 18004 Annex A. These are the degrees this encoder uses
        // at level M (10 for v1, 16 for v2/v6, 18 for v4/v7, 26 for v3/v10).
        let expected: [Int: [UInt8]] = [
            10: [1, 216, 194, 159, 111, 199, 94, 95, 113, 157, 193],
            16: [1, 59, 13, 104, 189, 68, 209, 30, 8, 163, 65, 41, 229, 98, 50, 36, 59],
            18: [1, 215, 234, 158, 94, 184, 97, 118, 170, 79, 187, 152, 148, 252, 179,
                 5, 98, 96, 153],
        ]
        for (degree, coefficients) in expected {
            #expect(
                ReedSolomon.generator(degree: degree) == coefficients,
                "generator polynomial of degree \(degree) is wrong"
            )
        }
    }

    @Test("Every supported version's block layout adds up")
    func versionTablesAreConsistent() {
        for version in QRCode.Version.all {
            // Data + EC codewords must exactly fill the symbol's codeword
            // budget. A row that does not balance produces a symbol whose
            // trailing modules are garbage.
            let total = version.totalDataCodewords
                + version.totalBlocks * version.ecCodewordsPerBlock
            #expect(total == QRCodeTests.totalCodewords[version.number],
                    "version \(version.number) codeword count is \(total)")
            #expect(version.byteCapacity > 0)
            #expect(version.size == 17 + 4 * version.number)
        }
    }

    /// Total codewords per version, from the specification's capacity table.
    private static let totalCodewords: [Int: Int] = [
        1: 26, 2: 44, 3: 70, 4: 100, 5: 134,
        6: 172, 7: 196, 8: 242, 9: 292, 10: 346,
    ]
}
