//
//  FurlPayMark.swift
//
//  The FurlPay mark — two stacked hooks that read as an `F` — plus the palette
//  the Trips surface uses.
//
//  The geometry is the SAME traced outline the web app ships in
//  components/trips/FurlPayLogo.tsx and the Expo app in
//  components/trips/FurlPayMark.tsx, expressed here as a `Shape` so it stays
//  sharp at every size and needs no asset catalogue entry (the widget extension
//  cannot reach the app's bundle).
//
//  Path coordinates are in the traced 54x55 glyph box and are scaled to the
//  rect the shape is given, so callers only ever pick a frame.
//

import SwiftUI

public struct FurlPayMark: View {
    private let size: CGFloat
    private let upper: Color
    private let lower: Color

    /// Two flat greens rather than a gradient: it reproduces the sheen the
    /// artwork has, and a gradient at 16pt in the Dynamic Island is invisible
    /// detail that still costs a shader.
    public init(size: CGFloat = 24, tint: Color? = nil) {
        self.size = size
        self.upper = tint ?? Color(red: 0.40, green: 0.87, blue: 0.61)
        self.lower = tint ?? Color(red: 0.45, green: 0.91, blue: 0.675)
    }

    public var body: some View {
        ZStack {
            MarkHook(.upper).fill(upper)
            MarkHook(.lower).fill(lower)
        }
        .frame(width: size * (54.0 / 55.0), height: size)
        .accessibilityHidden(true)
    }
}

/// One of the two hooks, drawn in the traced glyph's own coordinate space.
private struct MarkHook: Shape {
    enum Half { case upper, lower }
    let half: Half

    init(_ half: Half) { self.half = half }

    // The traced glyph occupies x 5...59, y 5...60 of the original outline.
    private static let origin = CGPoint(x: 5, y: 5)
    private static let box = CGSize(width: 54, height: 55)

    func path(in rect: CGRect) -> Path {
        let sx = rect.width / Self.box.width
        let sy = rect.height / Self.box.height
        var p = Path()

        /// Glyph-space coordinate to the frame we were handed.
        func point(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
            CGPoint(x: rect.minX + (x - Self.origin.x) * sx, y: rect.minY + (y - Self.origin.y) * sy)
        }
        func move(_ x: CGFloat, _ y: CGFloat) { p.move(to: point(x, y)) }
        func line(_ x: CGFloat, _ y: CGFloat) { p.addLine(to: point(x, y)) }
        func curve(_ x: CGFloat, _ y: CGFloat, _ c1x: CGFloat, _ c1y: CGFloat, _ c2x: CGFloat, _ c2y: CGFloat) {
            p.addCurve(to: point(x, y), control1: point(c1x, c1y), control2: point(c2x, c2y))
        }
        /// Quarter-ellipse corner, as the cubic approximation an SVG arc command
        /// would produce. `k` is the standard circle-to-bezier ratio; `c` is the
        /// corner the arc turns around.
        func corner(from: CGPoint, to: CGPoint, cx: CGFloat, cy: CGFloat) {
            let k: CGFloat = 0.5522847498
            let c = point(cx, cy)
            let c1 = CGPoint(x: from.x + (c.x - from.x) * k, y: from.y + (c.y - from.y) * k)
            let c2 = CGPoint(x: to.x + (c.x - to.x) * k, y: to.y + (c.y - to.y) * k)
            p.addCurve(to: to, control1: c1, control2: c2)
        }

        switch half {
        case .upper:
            // M18 5 H59 V9 A10,11 -> 49,20 H20 C.. 5,29 V18 A13,13 -> 18,5
            move(18, 5)
            line(59, 5)
            line(59, 9)
            corner(from: point(59, 9), to: point(49, 20), cx: 59, cy: 20)
            line(20, 20)
            curve(5, 29, 15, 23, 10, 26)
            line(5, 18)
            corner(from: point(5, 18), to: point(18, 5), cx: 5, cy: 5)
            p.closeSubpath()

        case .lower:
            // M18 27 H43 V35 A7,7 -> 36,42 H20 C.. 18,47.6 V50 C.. 5,60 V37 A13,10 -> 18,27
            move(18, 27)
            line(43, 27)
            line(43, 35)
            corner(from: point(43, 35), to: point(36, 42), cx: 43, cy: 42)
            line(20, 42)
            curve(18, 47.6, 18.5, 43.9, 18, 45.5)
            line(18, 50)
            curve(5, 60, 18, 55.6, 13.4, 60)
            line(5, 37)
            corner(from: point(5, 37), to: point(18, 27), cx: 5, cy: 27)
            p.closeSubpath()
        }

        return p
    }
}

/// The Trips surface palette.
///
/// `GuardianColors` is the app's AMOLED blue-accented scale. The Trips design
/// is a warmer, near-black EMERALD register, and the boarding pass itself is a
/// LIGHT card. Kept as its own small scale so the rest of the app cannot drift
/// onto these values, and so `GuardianColors` keeps meaning what it means today.
public enum TripsPalette {
    /// Live Activity card — near-black emerald, as on the Lock Screen.
    public static let liveTop = Color(red: 0.024, green: 0.090, blue: 0.059)
    public static let liveBottom = Color(red: 0.008, green: 0.039, blue: 0.027)

    /// Trip hero header.
    public static let heroTop = Color(red: 0.114, green: 0.443, blue: 0.314)
    public static let heroBottom = Color(red: 0.118, green: 0.478, blue: 0.345)

    /// Accent as it reads on a DARK surface.
    public static let green = Color(red: 0.373, green: 0.863, blue: 0.627)
    public static let greenBright = Color(red: 0.553, green: 0.941, blue: 0.737)
    public static let greenDim = Color(red: 0.290, green: 0.871, blue: 0.588)

    /// Accent on the LIGHT pass. Never use `green` there — it fails contrast on
    /// white by a wide margin.
    public static let ink = Color(red: 0.106, green: 0.478, blue: 0.306)

    public static let passInk = Color(red: 0.067, green: 0.067, blue: 0.075)
    public static let passInkDim = Color(red: 0.431, green: 0.431, blue: 0.451)
    public static let passChip = Color(red: 0.910, green: 0.910, blue: 0.918)
    public static let passRule = Color(red: 0.863, green: 0.863, blue: 0.871)
    public static let passInset = Color(red: 0.957, green: 0.957, blue: 0.965)

    public static let subText = Color(red: 0.714, green: 0.769, blue: 0.745)
    public static let cardBorder = Color(red: 0.471, green: 0.839, blue: 0.659).opacity(0.26)
    public static let tile = Color.white.opacity(0.05)
    public static let tileBorder = Color.white.opacity(0.08)
}
