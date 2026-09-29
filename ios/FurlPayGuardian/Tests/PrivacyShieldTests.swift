//
//  PrivacyShieldTests.swift
//
//  WHAT IS AND IS NOT TESTED HERE
//
//  `PrivacyShield` itself needs a live `UIWindowScene` to install its window into,
//  so its plumbing cannot be asserted from a unit test bundle without depending on
//  whether the host app happened to have an attached scene — a test that passes or
//  fails for reasons unrelated to the code. That part is verified by building and
//  running; it is listed as a manual check in the remediation report rather than
//  faked here.
//
//  What IS tested is the rule, which is where the mistake actually lives.
//  `PrivacyShieldPolicy` exists precisely so this is possible: the interesting
//  behaviour is not "can a UIWindow be shown" but "when must it be", and the
//  subtle case — returning to the foreground while a screen recording is still
//  running — is a one-line mistake that a UI test would be unlikely to catch and
//  that leaks account data to a recording when wrong.
//

import Testing
@testable import FurlPayGuardian

@Suite("Privacy shield policy")
struct PrivacyShieldPolicyTests {

    @Test("foreground and not captured is the only uncovered state")
    func onlyActiveAndUncapturedIsClear() {
        let clear = PrivacyShieldPolicy(isForegroundActive: true, isScreenCaptured: false)
        #expect(clear.shouldShield == false)
    }

    @Test("leaving the foreground raises the shield")
    func inactiveShields() {
        // `.inactive` and `.background` both arrive here as false. The switcher
        // snapshot is taken on resign-active, so covering only the background case
        // would arrive after the photograph was already taken.
        let inactive = PrivacyShieldPolicy(isForegroundActive: false, isScreenCaptured: false)
        #expect(inactive.shouldShield)
    }

    @Test("a screen recording raises the shield even in the foreground")
    func capturingWhileActiveShields() {
        // The case a single boolean gets wrong. The app is active and visible and
        // everything looks normal — but the frames are going somewhere else.
        let capturing = PrivacyShieldPolicy(isForegroundActive: true, isScreenCaptured: true)
        #expect(capturing.shouldShield)
    }

    @Test("returning to the foreground does NOT lower the shield while capturing")
    func becomingActiveDuringCaptureKeepsShield() {
        // THE REGRESSION THIS FILE IS FOR.
        //
        // The natural implementation is one flag: resign-active sets it, become-
        // active clears it. Then a user who starts a recording, switches away and
        // switches back has the shield taken down by the become-active event while
        // the recording is still running — and everything from that moment on is in
        // the recording.
        //
        // Modelling the two reasons separately and OR-ing them makes that
        // sequence safe by construction. Replayed here as the actual sequence.
        var policy = PrivacyShieldPolicy(isForegroundActive: true, isScreenCaptured: false)
        #expect(policy.shouldShield == false)

        policy.isScreenCaptured = true          // recording starts
        #expect(policy.shouldShield)

        policy.isForegroundActive = false       // user switches away
        #expect(policy.shouldShield)

        policy.isForegroundActive = true        // user switches back — recording STILL running
        #expect(policy.shouldShield, "the shield came down while the screen was still being recorded")

        policy.isScreenCaptured = false         // recording stops
        #expect(policy.shouldShield == false)
    }

    @Test("the shield stays up while backgrounded after a recording ends")
    func captureEndingWhileBackgroundedKeepsShield() {
        // The mirror image: a recording ending must not clear the LIFECYCLE
        // reason. Stopping a recording while the app sits in the switcher cannot
        // be allowed to uncover the snapshot.
        var policy = PrivacyShieldPolicy(isForegroundActive: false, isScreenCaptured: true)
        #expect(policy.shouldShield)

        policy.isScreenCaptured = false
        #expect(policy.shouldShield, "the shield came down while the app was still backgrounded")
    }

    @Test("every combination is decided, and three of four are covered")
    func exhaustive() {
        // Four states, enumerated rather than reasoned about. Exactly one is clear;
        // the default posture is to cover.
        var shielded = 0
        for active in [true, false] {
            for captured in [true, false] {
                let policy = PrivacyShieldPolicy(isForegroundActive: active, isScreenCaptured: captured)
                #expect(policy.shouldShield == (!active || captured))
                if policy.shouldShield { shielded += 1 }
            }
        }
        #expect(shielded == 3)
    }

    @Test("the default is the clear state")
    func defaultsAreClear() {
        // A freshly constructed policy must not shield, or the app launches behind
        // a grey square that never lifts. `activate()` immediately overwrites both
        // fields from the real application state — this only pins the default so a
        // future field added with a shielding default is a visible decision.
        #expect(PrivacyShieldPolicy().shouldShield == false)
    }

    @Test("the policy is a value, not a reference")
    func isValueType() {
        // The shield holds one of these and mutates it field by field. If it were a
        // reference type an observer could retain a stale copy and re-apply an old
        // decision; as a value, each mutation is total.
        let original = PrivacyShieldPolicy(isForegroundActive: true, isScreenCaptured: false)
        var copy = original
        copy.isScreenCaptured = true
        #expect(original.shouldShield == false)
        #expect(copy.shouldShield)
        #expect(original != copy)
    }
}
