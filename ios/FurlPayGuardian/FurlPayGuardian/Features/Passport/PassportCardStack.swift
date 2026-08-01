//
//  PassportCardStack.swift
//
//  Port of native-app/components/PassportCardStack.tsx — the Wallet-style
//  document stack.
//
//  THE MODEL IS CARRIED OVER EXACTLY, because it is the good part. One value,
//  `position`, holds the FRACTIONAL active index. Every card derives its
//  transform from (index - position), so a drag moves the whole stack coherently
//  rather than animating one card against a static backdrop — and there is no
//  per-card state to fall out of sync, so the stack cannot end up with two cards
//  believing they are on top.
//
//  WHAT CHANGED, AND WHY. The RN version uses PanResponder with a JS-side mirror
//  of the animated value, because Animated.Value cannot be read synchronously
//  inside the responder. SwiftUI's DragGesture hands us the translation
//  directly, so the mirror disappears — `position` is plain state and the drag
//  offset is applied on top of it. Same physics, less machinery.
//
//  The spring stays over-damped. A bouncy stack of identity documents reads as
//  a toy.
//

import SwiftUI

struct PassportCardStack: View {
    let documents: [TravelDocument]
    var onSelect: (TravelDocument) -> Void

    /// Whole-number index the stack has settled on.
    @State private var active = 0
    /// Live drag, in cards. Added to `active` to get the fractional position.
    @State private var dragCards: Double = 0

    private let cardHeight: CGFloat = 190
    /// Vertical peek of each card behind the active one.
    private let peek: CGFloat = 26
    /// Drag distance equal to one card of travel.
    private var step: CGFloat { cardHeight * 0.45 }
    /// Past this velocity a flick advances even from a short drag.
    private let flickVelocity: Double = 320
    /// Cards drawn behind the active one before they stop being rendered.
    private let visibleBehind = 3

    private var position: Double { Double(active) + dragCards }
    private var maxIndex: Int { max(documents.count - 1, 0) }

    var body: some View {
        ZStack {
            ForEach(Array(documents.enumerated()), id: \.element.id) { index, document in
                let distance = Double(index) - position
                // Cards further back than we draw are dropped entirely rather
                // than rendered at zero opacity — a 40-document wallet should
                // not cost 40 gradient layers per frame.
                if distance >= -1.2, distance <= Double(visibleBehind) + 1 {
                    PassportCardView(document: document)
                        .frame(height: cardHeight)
                        .scaleEffect(scale(for: distance))
                        .offset(y: offset(for: distance))
                        .opacity(opacity(for: distance))
                        // Nearest card on top. Without this the stack renders
                        // in array order and the active card hides behind its
                        // successors.
                        .zIndex(Double(documents.count) - abs(distance))
                        .onTapGesture {
                            if abs(distance) < 0.5 { onSelect(document) }
                        }
                        .accessibilityHidden(abs(distance) >= 0.5)
                }
            }
        }
        .frame(height: cardHeight + peek * CGFloat(min(maxIndex, visibleBehind)))
        .frame(maxWidth: .infinity)
        .contentShape(.rect)
        .gesture(documents.count > 1 ? drag : nil)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(
            "\(documents.count) travel \(documents.count == 1 ? "document" : "documents")"
        )
        // VoiceOver and Switch Control cannot flick a stack. Adjustable actions
        // give them the same navigation the gesture provides.
        .accessibilityAdjustableAction { direction in
            switch direction {
            case .increment: settle(active + 1)
            case .decrement: settle(active - 1)
            @unknown default: break
            }
        }
    }

    private var drag: some Gesture {
        DragGesture()
            .onChanged { value in
                // Dragging DOWN reveals earlier cards, so it decreases the index.
                var next = -Double(value.translation.height / step)
                // Rubber-band past both ends rather than clamping dead, so the
                // edge of the stack feels like a boundary and not a broken
                // gesture.
                let candidate = Double(active) + next
                if candidate < 0 {
                    next -= candidate * (2.0 / 3.0)
                } else if candidate > Double(maxIndex) {
                    next -= (candidate - Double(maxIndex)) * (2.0 / 3.0)
                }
                dragCards = next
            }
            .onEnded { value in
                // A flick advances exactly ONE card from wherever the drag
                // reached, so a fast gesture never skips past a document the
                // user wanted to see.
                if abs(value.predictedEndTranslation.height - value.translation.height) > 0,
                   abs(value.velocity.height) >= flickVelocity {
                    settle(active + (value.velocity.height < 0 ? 1 : -1))
                } else {
                    settle(Int(position.rounded()))
                }
            }
    }

    private func settle(_ next: Int) {
        let clamped = min(max(next, 0), maxIndex)
        if clamped != active {
            // The haptic is the confirmation that the stack moved — on a phone
            // held at arm's length the motion alone is easy to miss.
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
        }
        withAnimation(.interpolatingSpring(mass: 0.85, stiffness: 190, damping: 20)) {
            active = clamped
            dragCards = 0
        }
    }

    // MARK: Derived transforms
    //
    // Same curves as the RN interpolations: cards behind sink, shrink and fade;
    // a card dragged past the front lifts away.

    private func offset(for distance: Double) -> CGFloat {
        CGFloat(max(distance, -1)) * peek
    }

    private func scale(for distance: Double) -> CGFloat {
        1 - CGFloat(max(distance, 0)) * 0.045
    }

    private func opacity(for distance: Double) -> Double {
        if distance < 0 { return max(0, 1 + distance) }   // lifting away
        return max(0, 1 - distance / Double(visibleBehind + 1))
    }
}
