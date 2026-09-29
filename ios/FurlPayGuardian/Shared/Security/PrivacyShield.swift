//
//  PrivacyShield.swift
//
//  Covers the app's content in the app switcher, and while the screen is being
//  recorded or mirrored.
//
//  WHY A WINDOW AND NOT THE SWIFTUI OVERLAY THAT ALREADY EXISTS
//
//  RootView already carries `.overlay { if scenePhase != .active { … } }`, and
//  that overlay is correct as far as it reaches. It cannot reach far enough, for
//  two structural reasons:
//
//  1. A `.sheet` or `.fullScreenCover` is presented ABOVE the view it is attached
//     to. The overlay lives inside RootView's content, so anything modally
//     presented sits on top of the shield rather than under it. That is not a
//     hypothetical gap — `BankAccountSheet` shows account and routing numbers,
//     `DocumentDetailSheet` shows passport data, and `AlarmView` is a
//     `fullScreenCover` at the root. With any of them open, the switcher snapshot
//     captured them in the clear.
//
//  2. `scenePhase` propagates through SwiftUI's update cycle. iOS takes the
//     snapshot when the app resigns active, and nothing guarantees a re-render
//     lands first. The sensitive screens also clear their own content on
//     `scenePhase != .active`, which has the same race — belt and braces, but
//     both braces are elastic.
//
//  A separate `UIWindow` above `.alert` level has neither problem: it is a
//  sibling of the presentation hierarchy rather than a descendant, so it covers
//  presented content, and it is shown SYNCHRONOUSLY inside the
//  `willResignActiveNotification` callback, which fires before the snapshot.
//
//  The existing SwiftUI overlay is deliberately left in place. It is harmless,
//  it animates the root nicely, and it is the fallback if this window is ever
//  failed to be installed. Two mechanisms here is a decision, not an accident.
//
//  WHAT THIS DOES NOT DO
//
//  It does not stop screenshots. iOS has no API for that — there is no
//  `FLAG_SECURE` equivalent, and any claim otherwise is wrong. What it does cover
//  is active CAPTURE: screen recording, AirPlay mirroring and QuickTime capture
//  all set `UIScreen.isCaptured`, and the shield goes up for as long as that
//  holds. A screenshot is one frame the holder of the phone already had on
//  screen; a recording is a channel to somewhere else.
//

/// Whether the shield should be up, as a pure function of the two things that
/// put it there.
///
/// Extracted from the window plumbing because the RULE is where the mistake
/// lives, and the rule can be tested while `UIWindow` cannot. The specific
/// mistake it prevents: treating "became active" as "take the shield down".
/// Coming back to the foreground during a screen recording is exactly when
/// content must stay covered, so the two reasons have to be tracked separately
/// and OR-ed — not collapsed into one flag that the later event overwrites.
///
/// Not gated on `#if os(iOS)`: it is pure logic with no UIKit in it, so the watch
/// target and the test target both see it.
public struct PrivacyShieldPolicy: Equatable, Sendable {

    /// The app is foreground-active. False covers `.inactive` as well as
    /// `.background` — `.inactive` is when the switcher snapshot is taken, so
    /// shielding only on `.background` would arrive after the photograph.
    public var isForegroundActive: Bool

    /// The screen is being recorded, mirrored or captured.
    public var isScreenCaptured: Bool

    public init(isForegroundActive: Bool = true, isScreenCaptured: Bool = false) {
        self.isForegroundActive = isForegroundActive
        self.isScreenCaptured = isScreenCaptured
    }

    /// Fails SAFE: anything other than "foreground and not being captured" is
    /// covered. The default for an unknown state is to shield, because the cost
    /// of an unnecessary shield is a grey square for a moment and the cost of a
    /// missing one is account data in the switcher or in someone's recording.
    public var shouldShield: Bool {
        !isForegroundActive || isScreenCaptured
    }
}

#if os(iOS)

import UIKit
import SwiftUI

@MainActor
public final class PrivacyShield: NSObject {

    public static let shared = PrivacyShield()

    /// One shield window per scene, keyed by the scene's identity.
    ///
    /// Keyed rather than a single stored window because a `UIWindow` belongs to
    /// exactly one `UIWindowScene`. Reusing one across scenes silently fails to
    /// show on all but the one it was created for.
    private var windows: [ObjectIdentifier: UIWindow] = [:]

    /// The two reasons, tracked separately. Collapsing them into one boolean is
    /// the bug `PrivacyShieldPolicy` exists to make unrepresentable.
    private var policy = PrivacyShieldPolicy()

    private var installed = false

    private override init() { super.init() }

    /// Starts observing. Idempotent — a second call is a no-op rather than a
    /// second set of observers firing the same handlers twice.
    public func activate() {
        guard !installed else { return }
        installed = true

        let center = NotificationCenter.default

        // Selector-based, NOT the block form with `queue: .main`. These
        // notifications are posted on the main thread and a selector observer is
        // invoked synchronously during the post, so the shield is on screen
        // before `didFinishResigningActive`. The block form hopping through a
        // queue — and certainly a `Task { @MainActor }` — can land after the
        // snapshot has already been taken, which is the entire bug.
        center.addObserver(
            self, selector: #selector(hostileMomentBegan),
            name: UIApplication.willResignActiveNotification, object: nil
        )
        center.addObserver(
            self, selector: #selector(hostileMomentEnded),
            name: UIApplication.didBecomeActiveNotification, object: nil
        )
        center.addObserver(
            self, selector: #selector(captureStateChanged(_:)),
            name: UIScreen.capturedDidChangeNotification, object: nil
        )

        // Seed BOTH reasons from reality rather than trusting the defaults. A
        // recording already running at launch posts no notification, so waiting
        // for one means the first screenful is unshielded.
        //
        // At `didFinishLaunching` the app is `.inactive`, so this raises the
        // shield immediately and `didBecomeActive` lowers it. That ordering is
        // deliberate: it fails safe, and it covers a cold launch straight into the
        // app switcher, where no `willResignActive` ever arrives.
        policy.isForegroundActive = UIApplication.shared.applicationState == .active
        refreshCaptureState()
    }

    // MARK: - Lifecycle

    @objc private func hostileMomentBegan() {
        policy.isForegroundActive = false
        apply()
    }

    @objc private func hostileMomentEnded() {
        // Sets only the lifecycle reason. Whether the shield actually comes down
        // is the policy's call — if a recording is still running it stays up.
        policy.isForegroundActive = true
        apply()
    }

    @objc private func captureStateChanged(_ note: Notification) {
        refreshCaptureState()
    }

    private func refreshCaptureState() {
        // Read from the connected scenes' own screens rather than `UIScreen.main`,
        // which is deprecated from iOS 26 and meaningless with more than one
        // scene. Any captured screen shields everything: we cannot know which
        // scene the recording is actually pointed at.
        policy.isScreenCaptured = UIApplication.shared.connectedScenes
            .compactMap { ($0 as? UIWindowScene)?.screen }
            .contains { $0.isCaptured }
        apply()
    }

    /// The single place the window's visibility is decided.
    private func apply() {
        if policy.shouldShield { show() } else { hide() }
    }

    // MARK: - The window

    private func show() {
        for scene in UIApplication.shared.connectedScenes {
            guard let windowScene = scene as? UIWindowScene else { continue }
            let key = ObjectIdentifier(windowScene)

            let window = windows[key] ?? makeWindow(for: windowScene)
            windows[key] = window
            window.isHidden = false
        }
    }

    private func hide() {
        for window in windows.values {
            window.isHidden = true
        }
    }

    private func makeWindow(for scene: UIWindowScene) -> UIWindow {
        let window = UIWindow(windowScene: scene)

        // Above `.alert` so it covers alerts and action sheets as well as
        // presented view controllers.
        window.windowLevel = .alert + 1

        // Never becomes key and never receives touches. A shield that could take
        // input would be an invisible tap target the moment it failed to hide,
        // and `makeKeyAndVisible()` would steal first-responder status from the
        // real UI — so this is shown with `isHidden` alone.
        window.isUserInteractionEnabled = false

        // A plain UIViewController, not a UIHostingController. SwiftUI hosting
        // costs a layout pass through the SwiftUI runtime at the exact moment
        // there is no time for one; UIKit lays this out synchronously.
        window.rootViewController = ShieldViewController()

        return window
    }
}

/// The shield's content. Mirrors RootView's overlay so the two never disagree
/// about what a covered app looks like.
private final class ShieldViewController: UIViewController {

    override func viewDidLoad() {
        super.viewDidLoad()

        // Derived from the SwiftUI token rather than re-typing the RGB literals,
        // so the shield cannot drift from the app's background the way a second
        // copy of the numbers would.
        view.backgroundColor = UIColor(GuardianColors.background)

        let glyph = UIImageView(
            image: UIImage(systemName: "shield.fill")?
                .withConfiguration(UIImage.SymbolConfiguration(pointSize: 44))
        )
        glyph.tintColor = .secondaryLabel
        glyph.translatesAutoresizingMaskIntoConstraints = false
        glyph.isAccessibilityElement = false

        view.addSubview(glyph)
        NSLayoutConstraint.activate([
            glyph.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            glyph.centerYAnchor.constraint(equalTo: view.centerYAnchor),
        ])
    }

    /// The shield must not rotate content into a mismatched frame mid-snapshot.
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask {
        .allButUpsideDown
    }
}

#endif
