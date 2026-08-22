//
//  TripsViews.swift
//
//  Drawing primitives for the Trips surface: the route graphics, the
//  boarding-pass barcode and the USDC mark.
//
//  They live in Shared/UI because BOTH the app and the Live Activity extension
//  draw them, and an extension cannot reach the app's bundle for an asset —
//  every one of these has to be vector code compiled into each target.
//

import SwiftUI

// MARK: - Route graphics

/// Flat dashed run with the aircraft at its head. Progress is DRAWN, never
/// animated: an animation inside a Live Activity keeps the widget process
/// awake, and the position only changes when a new state is pushed anyway.
public struct RouteTrack: View {
    private let progress: Double

    public init(progress: Double) {
        self.progress = min(1, max(0, progress))
    }

    public var body: some View {
        GeometryReader { geo in
            let w = geo.size.width
            let y = geo.size.height / 2
            let planeX = max(10, min(w - 10, w * (0.12 + 0.76 * progress)))

            ZStack {
                Path { p in
                    p.move(to: CGPoint(x: 2, y: y))
                    p.addLine(to: CGPoint(x: w - 2, y: y))
                }
                .stroke(
                    TripsPalette.green.opacity(0.55),
                    style: StrokeStyle(lineWidth: 1.6, lineCap: .round, dash: [3, 5])
                )

                if progress > 0 {
                    Path { p in
                        p.move(to: CGPoint(x: 2, y: y))
                        p.addLine(to: CGPoint(x: planeX, y: y))
                    }
                    .stroke(
                        TripsPalette.greenBright,
                        style: StrokeStyle(lineWidth: 1.8, lineCap: .round)
                    )
                }

                Image(systemName: "airplane")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(.white)
                    .position(x: planeX, y: y)
            }
        }
        .accessibilityHidden(true)
    }
}

/// The trajectory on the flight status card: a long shallow climb that flattens
/// out under the aircraft. The bead sits at `progress` along the curve, and the
/// flown portion is solid against a dashed remainder — the convention every
/// airline map already uses, so it needs no legend.
public struct RouteArc: View {
    private let progress: Double

    public init(progress: Double) {
        self.progress = min(1, max(0, progress))
    }

    // Quadratic control points in a 250x66 design space, scaled to the frame.
    private static let p0 = CGPoint(x: 2, y: 58)
    private static let p1 = CGPoint(x: 140, y: 4)
    private static let p2 = CGPoint(x: 232, y: 10)
    private static let design = CGSize(width: 250, height: 66)

    private static func point(at t: CGFloat, in size: CGSize) -> CGPoint {
        let a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, c = t * t
        let x = a * p0.x + b * p1.x + c * p2.x
        let y = a * p0.y + b * p1.y + c * p2.y
        return CGPoint(x: x / design.width * size.width, y: y / design.height * size.height)
    }

    public var body: some View {
        GeometryReader { geo in
            let size = geo.size
            let bead = Self.point(at: progress, in: size)

            ZStack {
                ArcShape().stroke(
                    Color(red: 0.247, green: 0.796, blue: 0.533),
                    style: StrokeStyle(lineWidth: 2, lineCap: .round, dash: [5, 7])
                )

                if progress > 0 {
                    ArcShape()
                        .trim(from: 0, to: progress)
                        .stroke(
                            TripsPalette.greenBright,
                            style: StrokeStyle(lineWidth: 2.4, lineCap: .round)
                        )
                }

                Circle()
                    .fill(Color(red: 0.784, green: 0.984, blue: 0.871))
                    .frame(width: 8, height: 8)
                    .position(bead)

                Image(systemName: "airplane")
                    .font(.system(size: 22, weight: .medium))
                    .foregroundStyle(Color(red: 0.373, green: 0.890, blue: 0.627))
                    .position(Self.point(at: 1, in: size))
            }
        }
        .accessibilityHidden(true)
    }

    private struct ArcShape: Shape {
        func path(in rect: CGRect) -> Path {
            var p = Path()
            let s = rect.size
            p.move(to: RouteArc.point(at: 0, in: s))
            p.addQuadCurve(
                to: RouteArc.point(at: 1, in: s),
                control: CGPoint(
                    x: RouteArc.p1.x / RouteArc.design.width * s.width,
                    y: RouteArc.p1.y / RouteArc.design.height * s.height
                )
            )
            return p
        }
    }
}

// MARK: - Barcode

/// Bar widths for the boarding-pass barcode.
///
/// The SAME algorithm as apps/web/src/lib/trips/barcode.ts and
/// native-app/lib/barcode.ts — deliberately duplicated across the three
/// codebases (there is no shared runtime) and pinned by a test in each, so a
/// passenger's pass draws identically wherever they open it.
///
/// This encodes nothing. It is a visual stand-in with a real barcode's rhythm:
/// guard bars at each end, narrow/wide alternation between them. Replace it
/// with the carrier's actual PDF417 when Duffel returns one.
public func boardingPassBars(_ value: String) -> [Int] {
    var seed: UInt32 = 0x811c_9dc5
    for byte in Array(value.utf8) {
        seed ^= UInt32(byte)
        seed = seed &* 0x0100_0193
    }
    var bars: [Int] = [3, 2, 1, 3]
    for _ in 0..<108 {
        seed = seed &* 1_664_525 &+ 1_013_904_223
        bars.append(1 + Int(Double(seed) / 4_294_967_296.0 * 4))
    }
    bars.append(contentsOf: [3, 2, 1, 4])
    return bars
}

public struct BarcodeStrip: View {
    private let bars: [Int]
    private let total: Int
    private let height: CGFloat
    private let label: String

    public init(value: String, height: CGFloat = 46) {
        self.bars = boardingPassBars(value)
        self.total = self.bars.reduce(0, +)
        self.height = height
        self.label = value
    }

    public var body: some View {
        GeometryReader { geo in
            let unit = geo.size.width / CGFloat(total)
            Canvas { context, _ in
                var x: CGFloat = 0
                for (index, width) in bars.enumerated() {
                    let w = CGFloat(width) * unit
                    // Even indices are bars, odd indices the gaps between them.
                    if index.isMultiple(of: 2) {
                        context.fill(
                            Path(CGRect(x: x, y: 0, width: w, height: height)),
                            with: .color(Color(red: 0.039, green: 0.039, blue: 0.039))
                        )
                    }
                    x += w
                }
            }
        }
        .frame(height: height)
        .accessibilityLabel("Boarding pass barcode for \(label)")
    }
}

// MARK: - USDC

/// Blue disc, white ring, white dollar glyph — the USDC mark, drawn rather than
/// fetched so it renders offline at a gate.
public struct UsdcCoin: View {
    private let size: CGFloat

    public init(size: CGFloat = 30) { self.size = size }

    public var body: some View {
        ZStack {
            Circle().fill(Color(red: 0.153, green: 0.459, blue: 0.792))
            Circle()
                .stroke(.white, lineWidth: size * 0.047)
                .padding(size * 0.1375)
            Text("$")
                .font(.system(size: size * 0.5, weight: .semibold))
                .foregroundStyle(.white)
        }
        .frame(width: size, height: size)
        .accessibilityLabel("USD Coin")
    }
}
