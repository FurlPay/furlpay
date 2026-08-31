//
//  QRCode.swift
//
//  A QR encoder that does not depend on Core Image.
//
//  Why this exists: the watch app's QuickPay screen rendered nothing. It called
//  `QRRenderer.image(from:)`, which compiled the whole Core Image path out
//  under `!os(watchOS)` and returned nil unconditionally — and the call site
//  was `if let image = ...` with no else branch, so "Receive" on Apple Watch
//  drew an empty container. The comment there claimed callers "show their
//  existing fallback"; there was no fallback.
//
//  Core Image genuinely is not available on watchOS (CIContext is absent), so
//  the compile-out was correct and the missing piece is an encoder. This is
//  that: byte mode, error-correction level M, versions 1–10, which covers any
//  payment URI or wallet identifier this app puts on screen (213 bytes at V10).
//
//  Model 2 QR, per ISO/IEC 18004. Deliberately not general-purpose — no
//  alphanumeric or kanji mode, no levels L/Q/H, no versions past 10. Every
//  table below is only as wide as the cases actually reachable, because a table
//  with unreachable rows is a table nothing verifies.
//

import Foundation

/// A square grid of black/white modules, plus the quiet zone rules for drawing
/// it. Rendering is the caller's job — see `QRCodeView`.
public struct QRCode: Sendable, Equatable {
    /// Side length in modules, excluding the quiet zone.
    public let size: Int
    /// Row-major, `true` where a module is dark.
    public let modules: [Bool]

    public subscript(row: Int, column: Int) -> Bool {
        modules[row * size + column]
    }

    public enum EncodeError: Error, Equatable {
        /// The payload does not fit in version 10 at level M (213 bytes).
        case tooLong(bytes: Int, maximum: Int)
    }

    /// Encodes `text` as UTF-8 in byte mode at error-correction level M.
    ///
    /// Level M (~15% recovery) rather than L: a watch face is small, dim and
    /// often held at an angle, and the extra redundancy costs a version or two
    /// of module density that the screen can still resolve.
    public static func encode(_ text: String) throws -> QRCode {
        let data = Array(Array(text.utf8))
        guard let version = Version.smallest(forByteCount: data.count) else {
            throw EncodeError.tooLong(bytes: data.count, maximum: Version.all.last!.byteCapacity)
        }

        let codewords = interleave(payload(bits: bitstream(for: data, version: version),
                                           version: version),
                                   version: version)

        // Draw the function patterns once, then evaluate all eight data masks
        // against a fresh copy. Picking a mask by penalty score is what keeps a
        // payload whose bits happen to stripe from producing a symbol scanners
        // struggle to lock onto.
        var best: (grid: Grid, penalty: Int)?
        for mask in 0..<8 {
            var grid = Grid(version: version)
            grid.placeFunctionPatterns()
            grid.placeData(codewords)
            grid.applyMask(mask)
            grid.placeFormatInformation(mask: mask)
            let penalty = grid.penalty()
            if best == nil || penalty < best!.penalty {
                best = (grid, penalty)
            }
        }

        let grid = best!.grid
        return QRCode(size: grid.size, modules: grid.modules)
    }

    // MARK: - Versions

    /// One row per supported version at level M.
    ///
    /// `group1`/`group2` are (blockCount, dataCodewordsPerBlock). Versions 1–7
    /// at this level have a single group; 8–10 have two, which is why the
    /// interleaver cannot assume uniform block sizes.
    struct Version: Sendable {
        let number: Int
        let ecCodewordsPerBlock: Int
        let group1: (blocks: Int, dataCodewords: Int)
        let group2: (blocks: Int, dataCodewords: Int)
        /// Centres of the alignment patterns, empty for version 1.
        let alignmentCentres: [Int]

        var size: Int { 17 + 4 * number }

        var totalDataCodewords: Int {
            group1.blocks * group1.dataCodewords + group2.blocks * group2.dataCodewords
        }

        var totalBlocks: Int { group1.blocks + group2.blocks }

        /// Bits the character-count indicator occupies in byte mode. Widens at
        /// version 10 — encoding a version-10 symbol with the 8-bit indicator
        /// produces a symbol that decodes to garbage rather than failing.
        var characterCountBits: Int { number <= 9 ? 8 : 16 }

        /// Payload bytes that fit after the 4-bit mode and the count indicator.
        var byteCapacity: Int {
            (totalDataCodewords * 8 - 4 - characterCountBits) / 8
        }

        static let all: [Version] = [
            Version(number: 1, ecCodewordsPerBlock: 10, group1: (1, 16), group2: (0, 0),
                    alignmentCentres: []),
            Version(number: 2, ecCodewordsPerBlock: 16, group1: (1, 28), group2: (0, 0),
                    alignmentCentres: [6, 18]),
            Version(number: 3, ecCodewordsPerBlock: 26, group1: (1, 44), group2: (0, 0),
                    alignmentCentres: [6, 22]),
            Version(number: 4, ecCodewordsPerBlock: 18, group1: (2, 32), group2: (0, 0),
                    alignmentCentres: [6, 26]),
            Version(number: 5, ecCodewordsPerBlock: 24, group1: (2, 43), group2: (0, 0),
                    alignmentCentres: [6, 30]),
            Version(number: 6, ecCodewordsPerBlock: 16, group1: (4, 27), group2: (0, 0),
                    alignmentCentres: [6, 34]),
            Version(number: 7, ecCodewordsPerBlock: 18, group1: (4, 31), group2: (0, 0),
                    alignmentCentres: [6, 22, 38]),
            Version(number: 8, ecCodewordsPerBlock: 22, group1: (2, 38), group2: (2, 39),
                    alignmentCentres: [6, 24, 42]),
            Version(number: 9, ecCodewordsPerBlock: 22, group1: (3, 36), group2: (2, 37),
                    alignmentCentres: [6, 26, 46]),
            Version(number: 10, ecCodewordsPerBlock: 26, group1: (4, 43), group2: (1, 44),
                    alignmentCentres: [6, 28, 50]),
        ]

        static func smallest(forByteCount count: Int) -> Version? {
            all.first { count <= $0.byteCapacity }
        }
    }

    // MARK: - Bitstream

    /// Mode indicator + character count + payload + terminator, padded to the
    /// version's data capacity with the specified alternating pad bytes.
    private static func bitstream(for data: [UInt8], version: Version) -> [UInt8] {
        var bits = BitBuffer()
        bits.append(0b0100, width: 4)                                  // byte mode
        bits.append(UInt32(data.count), width: version.characterCountBits)
        for byte in data { bits.append(UInt32(byte), width: 8) }

        let capacityBits = version.totalDataCodewords * 8
        // Terminator: up to four zero bits, fewer if the symbol is nearly full.
        bits.append(0, width: min(4, capacityBits - bits.count))
        // Pad to a byte boundary.
        if bits.count % 8 != 0 { bits.append(0, width: 8 - bits.count % 8) }

        var codewords = bits.bytes
        // 0xEC / 0x11 alternating, from the specification. Not arbitrary
        // filler: decoders rely on the pattern to distinguish padding from data
        // when the terminator is truncated.
        var padAlternate = false
        while codewords.count < version.totalDataCodewords {
            codewords.append(padAlternate ? 0x11 : 0xEC)
            padAlternate.toggle()
        }
        return codewords
    }

    /// Splits the data codewords into blocks and computes each block's
    /// Reed-Solomon remainder.
    private static func payload(bits codewords: [UInt8], version: Version)
        -> (data: [[UInt8]], ec: [[UInt8]])
    {
        var dataBlocks: [[UInt8]] = []
        var ecBlocks: [[UInt8]] = []
        var offset = 0
        let generator = ReedSolomon.generator(degree: version.ecCodewordsPerBlock)

        for group in [version.group1, version.group2] where group.blocks > 0 {
            for _ in 0..<group.blocks {
                let block = Array(codewords[offset..<(offset + group.dataCodewords)])
                offset += group.dataCodewords
                dataBlocks.append(block)
                ecBlocks.append(ReedSolomon.remainder(block, generator: generator))
            }
        }
        return (dataBlocks, ecBlocks)
    }

    /// Column-wise interleave: the i-th codeword of every block, then the i-th
    /// EC codeword of every block. Spreading each block across the symbol is
    /// what makes a localised smudge recoverable instead of destroying one
    /// block outright.
    private static func interleave(
        _ blocks: (data: [[UInt8]], ec: [[UInt8]]),
        version: Version
    ) -> [UInt8] {
        var result: [UInt8] = []
        let maxData = max(version.group1.dataCodewords, version.group2.dataCodewords)
        for i in 0..<maxData {
            for block in blocks.data where i < block.count { result.append(block[i]) }
        }
        for i in 0..<version.ecCodewordsPerBlock {
            for block in blocks.ec { result.append(block[i]) }
        }
        return result
    }
}

// MARK: - Bit buffer

private struct BitBuffer {
    private(set) var bytes: [UInt8] = []
    private(set) var count = 0

    mutating func append(_ value: UInt32, width: Int) {
        guard width > 0 else { return }
        for shift in stride(from: width - 1, through: 0, by: -1) {
            let bit = (value >> UInt32(shift)) & 1
            if count % 8 == 0 { bytes.append(0) }
            if bit == 1 { bytes[bytes.count - 1] |= UInt8(1 << (7 - count % 8)) }
            count += 1
        }
    }
}

// MARK: - Reed-Solomon over GF(256)

/// GF(256) with the QR primitive polynomial 0x11D. Log/antilog tables are built
/// once; the alternative is a multiply loop per coefficient, which on a watch
/// is the difference between a code that appears instantly and one that hitches.
enum ReedSolomon {
    private static let tables: (exp: [UInt8], log: [UInt8]) = {
        var exp = [UInt8](repeating: 0, count: 512)
        var log = [UInt8](repeating: 0, count: 256)
        var x = 1
        for i in 0..<255 {
            exp[i] = UInt8(x)
            log[x] = UInt8(i)
            x <<= 1
            if x & 0x100 != 0 { x ^= 0x11D }
        }
        for i in 255..<512 { exp[i] = exp[i - 255] }
        return (exp, log)
    }()

    private static func multiply(_ a: UInt8, _ b: UInt8) -> UInt8 {
        guard a != 0, b != 0 else { return 0 }
        return tables.exp[Int(tables.log[Int(a)]) + Int(tables.log[Int(b)])]
    }

    /// The generator polynomial for `degree` EC codewords: ∏(x - α^i).
    static func generator(degree: Int) -> [UInt8] {
        var poly: [UInt8] = [1]
        for i in 0..<degree {
            let root = tables.exp[i]
            var next = [UInt8](repeating: 0, count: poly.count + 1)
            for (j, coefficient) in poly.enumerated() {
                next[j] ^= coefficient
                next[j + 1] ^= multiply(coefficient, root)
            }
            poly = next
        }
        return poly
    }

    /// Polynomial long division remainder — the EC codewords for one block.
    static func remainder(_ data: [UInt8], generator: [UInt8]) -> [UInt8] {
        var residue = [UInt8](repeating: 0, count: generator.count - 1)
        for byte in data {
            let factor = byte ^ residue[0]
            residue.removeFirst()
            residue.append(0)
            for (i, coefficient) in generator.dropFirst().enumerated() {
                residue[i] ^= multiply(coefficient, factor)
            }
        }
        return residue
    }
}

// MARK: - Module grid

private struct Grid {
    let version: QRCode.Version
    let size: Int
    var modules: [Bool]
    /// Function patterns and format/version areas, which the data placer skips
    /// and the mask must not flip.
    var reserved: [Bool]

    init(version: QRCode.Version) {
        self.version = version
        self.size = version.size
        self.modules = [Bool](repeating: false, count: size * size)
        self.reserved = [Bool](repeating: false, count: size * size)
    }

    private func index(_ row: Int, _ column: Int) -> Int { row * size + column }

    private mutating func set(_ row: Int, _ column: Int, _ dark: Bool, reserve: Bool = true) {
        modules[index(row, column)] = dark
        if reserve { reserved[index(row, column)] = true }
    }

    // MARK: Function patterns

    mutating func placeFunctionPatterns() {
        for origin in [(0, 0), (0, size - 7), (size - 7, 0)] {
            placeFinder(row: origin.0, column: origin.1)
        }
        placeSeparators()
        placeTiming()
        placeAlignment()

        // The dark module — fixed, always set, and not part of format info.
        set(size - 8, 8, true)

        reserveFormatAreas()
        placeVersionInformation()
    }

    private mutating func placeFinder(row: Int, column: Int) {
        for r in 0..<7 {
            for c in 0..<7 {
                let onRing = r == 0 || r == 6 || c == 0 || c == 6
                let inCore = (2...4).contains(r) && (2...4).contains(c)
                set(row + r, column + c, onRing || inCore)
            }
        }
    }

    private mutating func placeSeparators() {
        for i in 0..<8 {
            set(7, i, false); set(i, 7, false)
            set(7, size - 1 - i, false); set(i, size - 8, false)
            set(size - 8, i, false); set(size - 1 - i, 7, false)
        }
    }

    private mutating func placeTiming() {
        for i in 8..<(size - 8) {
            let dark = i % 2 == 0
            set(6, i, dark)
            set(i, 6, dark)
        }
    }

    private mutating func placeAlignment() {
        let centres = version.alignmentCentres
        for row in centres {
            for column in centres {
                // The three corners are occupied by finder patterns.
                let atFinder = (row == 6 && column == 6)
                    || (row == 6 && column == size - 7)
                    || (row == size - 7 && column == 6)
                if atFinder { continue }
                for r in -2...2 {
                    for c in -2...2 {
                        let onRing = abs(r) == 2 || abs(c) == 2
                        set(row + r, column + c, onRing || (r == 0 && c == 0))
                    }
                }
            }
        }
    }

    /// Reserves the format-information modules — both copies — so the data
    /// placer skips them and the mask never flips them.
    ///
    /// Written blank here and filled by `placeFormatInformation` once the mask
    /// is chosen. Row 6 and column 6 are absent on purpose: those are timing
    /// modules, not format ones, which is why the first copy jumps over them.
    private mutating func reserveFormatAreas() {
        for column in 0...5 { set(8, column, false) }
        set(8, 7, false)
        set(8, 8, false)
        set(7, 8, false)
        for row in 0...5 { set(row, 8, false) }

        for i in 0..<8 { set(size - 1 - i, 8, false) }
        for i in 8..<15 { set(8, size - 15 + i, false) }
    }

    /// The 18-bit version block, present only from version 7. Omitting it on a
    /// version-7-or-larger symbol is a decode failure on strict readers.
    private mutating func placeVersionInformation() {
        guard version.number >= 7 else { return }
        let bits: UInt32
        switch version.number {
        case 7:  bits = 0x07C94
        case 8:  bits = 0x085BC
        case 9:  bits = 0x09A99
        default: bits = 0x0A4D3   // version 10
        }
        for i in 0..<18 {
            let dark = (bits >> UInt32(i)) & 1 == 1
            let row = i / 3
            let column = size - 11 + i % 3
            set(row, column, dark)
            set(column, row, dark)
        }
    }

    /// The 15-bit format string for level M and the chosen mask, written twice.
    ///
    /// Two copies is not redundancy for its own sake: a scanner that cannot
    /// read the block by the top-left finder falls back to the one split across
    /// the other two corners, so a symbol survives damage to either.
    mutating func placeFormatInformation(mask: Int) {
        // Level M (format bits 00) with each mask, already run through the
        // BCH(15,5) code and XORed with the specification's 0x5412 mask. A
        // symbol whose format block is wrong does not degrade — it fails to
        // decode entirely, so these are pinned by QRCodeTests rather than
        // recomputed at runtime.
        let formats: [UInt32] = [
            0x5412, 0x5125, 0x5E7C, 0x5B4B, 0x45F9, 0x40CE, 0x4F97, 0x4AA0,
        ]
        let bits = formats[mask]
        func bit(_ i: Int) -> Bool { (bits >> UInt32(i)) & 1 == 1 }

        // Copy one, wrapping the top-left finder and stepping over the timing
        // modules at (8, 6) and (6, 8).
        for i in 0...5 { set(8, i, bit(i)) }
        set(8, 7, bit(6))
        set(8, 8, bit(7))
        set(7, 8, bit(8))
        for i in 9..<15 { set(14 - i, 8, bit(i)) }

        // Copy two, split between the bottom-left and top-right finders.
        for i in 0..<8 { set(size - 1 - i, 8, bit(i)) }
        for i in 8..<15 { set(8, size - 15 + i, bit(i)) }

        // The dark module sits inside copy two's run and is not format data —
        // it is always set, whatever the format bits say.
        set(size - 8, 8, true)
    }

    // MARK: Data

    /// Zigzag placement: two-module-wide columns from the right edge, upward
    /// then downward, skipping the vertical timing column.
    mutating func placeData(_ codewords: [UInt8]) {
        var bitIndex = 0
        var upward = true
        var column = size - 1

        while column > 0 {
            if column == 6 { column -= 1 }   // vertical timing pattern
            for i in 0..<size {
                let row = upward ? size - 1 - i : i
                for offset in 0..<2 {
                    let c = column - offset
                    if reserved[index(row, c)] { continue }
                    let byte = bitIndex / 8
                    var dark = false
                    if byte < codewords.count {
                        dark = (codewords[byte] >> UInt8(7 - bitIndex % 8)) & 1 == 1
                    }
                    // Past the codewords lie the remainder bits, which are
                    // zeros — written, not skipped, or the mask would leave
                    // them at whatever the grid was initialised to.
                    modules[index(row, c)] = dark
                    bitIndex += 1
                }
            }
            upward.toggle()
            column -= 2
        }
    }

    mutating func applyMask(_ mask: Int) {
        for row in 0..<size {
            for column in 0..<size where !reserved[index(row, column)] {
                if Grid.maskCondition(mask, row: row, column: column) {
                    modules[index(row, column)].toggle()
                }
            }
        }
    }

    static func maskCondition(_ mask: Int, row: Int, column: Int) -> Bool {
        switch mask {
        case 0: return (row + column) % 2 == 0
        case 1: return row % 2 == 0
        case 2: return column % 3 == 0
        case 3: return (row + column) % 3 == 0
        case 4: return (row / 2 + column / 3) % 2 == 0
        case 5: return (row * column) % 2 + (row * column) % 3 == 0
        case 6: return ((row * column) % 2 + (row * column) % 3) % 2 == 0
        default: return ((row + column) % 2 + (row * column) % 3) % 2 == 0
        }
    }

    // MARK: Penalty

    /// The four penalty rules from the specification. Lower is better; the
    /// encoder keeps the lowest-scoring mask.
    func penalty() -> Int {
        rule1() + rule2() + rule3() + rule4()
    }

    /// Runs of five or more same-coloured modules in a row or column.
    private func rule1() -> Int {
        var score = 0
        for line in 0..<size {
            for horizontal in [true, false] {
                var runColour = false
                var runLength = 0
                for i in 0..<size {
                    let dark = horizontal
                        ? modules[index(line, i)]
                        : modules[index(i, line)]
                    if dark == runColour {
                        runLength += 1
                    } else {
                        if runLength >= 5 { score += runLength - 2 }
                        runColour = dark
                        runLength = 1
                    }
                }
                if runLength >= 5 { score += runLength - 2 }
            }
        }
        return score
    }

    /// Solid 2×2 blocks.
    private func rule2() -> Int {
        var score = 0
        for row in 0..<(size - 1) {
            for column in 0..<(size - 1) {
                let first = modules[index(row, column)]
                if modules[index(row, column + 1)] == first,
                   modules[index(row + 1, column)] == first,
                   modules[index(row + 1, column + 1)] == first {
                    score += 3
                }
            }
        }
        return score
    }

    /// The 1:1:3:1:1 finder-like pattern with four light modules on one side —
    /// the sequence a scanner mistakes for a finder.
    private func rule3() -> Int {
        let pattern: [Bool] = [true, false, true, true, true, false, true]
        let light = [Bool](repeating: false, count: 4)
        let forward = pattern + light
        let backward = light + pattern

        var score = 0
        for line in 0..<size {
            for horizontal in [true, false] {
                let modulesInLine = (0..<size).map { i in
                    horizontal ? modules[index(line, i)] : modules[index(i, line)]
                }
                for start in 0...(size - forward.count) {
                    let window = Array(modulesInLine[start..<(start + forward.count)])
                    if window == forward || window == backward { score += 40 }
                }
            }
        }
        return score
    }

    /// Deviation from an even split of dark and light modules.
    private func rule4() -> Int {
        let dark = modules.reduce(0) { $0 + ($1 ? 1 : 0) }
        let percent = dark * 100 / modules.count
        let deviation = abs(percent - 50)
        return (deviation / 5) * 10
    }
}
