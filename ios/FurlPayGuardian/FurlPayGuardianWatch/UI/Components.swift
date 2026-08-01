//
//  Components.swift
//
//  Port of wear/ui/Components.kt — InfoCard, SkeletonAmount, animatedUsd.
//

import SwiftUI

/// Card-look surface WITHOUT button semantics.
///
/// The Wear original exists because Material's `Card` always announces itself
/// as actionable to TalkBack, which is an accessibility lie for a row that does
/// nothing. SwiftUI has the same trap the other way round: wrapping display
/// rows in a `Button` for the styling. This is the plain surface.
public struct InfoCard<Content: View>: View {
    private let content: Content

    public init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 4) { content }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(GuardianColors.surface)
            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
    }
}

/// Breathing placeholder for a not-yet-loaded amount.
///
/// Breathe, never strobe — the same rhythm as the voice screen's listening
/// ring. Replaces a bare "…" so loading reads as "coming" rather than "broken",
/// which on a watch is the difference between waiting and giving up.
public struct SkeletonAmount: View {
    var width: CGFloat = 96
    var height: CGFloat = 30

    @State private var breathing = false

    public init(width: CGFloat = 96, height: CGFloat = 30) {
        self.width = width
        self.height = height
    }

    public var body: some View {
        Capsule()
            .fill(GuardianColors.surfaceElevated)
            .frame(width: width, height: height)
            .opacity(breathing ? 0.7 : 0.35)
            .animation(
                .easeInOut(duration: 0.7).repeatForever(autoreverses: true),
                value: breathing
            )
            .frame(maxWidth: .infinity)
            .onAppear { breathing = true }
            .accessibilityLabel("Loading")
    }
}

public extension View {
    /// Rolls digits instead of popping them when a figure changes.
    ///
    /// The Wear build animates the number itself; SwiftUI does it with a
    /// content transition, which is both cheaper and respects Reduce Motion
    /// without any extra code.
    func animatedUsd<V: Equatable>(_ value: V) -> some View {
        contentTransition(.numericText())
            .animation(.snappy(duration: 0.25), value: value)
    }
}
