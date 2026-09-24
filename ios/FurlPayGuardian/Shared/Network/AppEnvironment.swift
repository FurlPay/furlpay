//
//  AppEnvironment.swift
//
//  Which backend this build talks to, resolved from the build configuration.
//
//  Before this existed, FurlPayAPIClient's `baseURL` defaulted to
//  https://furlpay.com/api/ and nothing could override it in a shipped build —
//  so a Debug build on a developer's Mac and a TestFlight build in a tester's
//  hands both moved production money. The value now comes from
//  Config/{Dev,Staging,Prod}.xcconfig via Info.plist substitution, alongside
//  the bundle suffix and APNs environment those files also set, so the three
//  cannot drift apart.
//
//  Read from Info.plist rather than a generated Swift file: a code-generation
//  build phase would have to run under ENABLE_USER_SCRIPT_SANDBOXING, and
//  Info.plist substitution needs no phase at all.
//

import Foundation

public enum AppEnvironment: String, Sendable, CaseIterable {
    case dev
    case staging
    case prod

    /// The environment this binary was built for.
    ///
    /// FAILS LOUDLY rather than defaulting. A missing or unrecognised key means
    /// the xcconfig was not applied to this target — and the safe-looking
    /// fallback (`.prod`) would be the worst possible one: a misconfigured dev
    /// build silently pointed at production. A `preconditionFailure` here
    /// surfaces on the first launch of a broken build, which is when it is
    /// cheapest to fix.
    public static let current: AppEnvironment = {
        let raw = Bundle.main.object(forInfoDictionaryKey: "FurlPayEnvironment") as? String
        guard let raw, let env = AppEnvironment(rawValue: raw) else {
            preconditionFailure(
                """
                FurlPayEnvironment is missing or invalid in Info.plist (got \
                \(String(describing: Bundle.main.object(forInfoDictionaryKey: "FurlPayEnvironment")))).
                The target is not picking up Config/*.xcconfig — re-run `xcodegen generate`.
                """
            )
        }
        return env
    }()

    /// API host for this build, e.g. `api-staging.furlpay.com`.
    public static let apiHost: String = {
        guard let host = Bundle.main.object(forInfoDictionaryKey: "FurlPayAPIHost") as? String,
              !host.isEmpty else {
            preconditionFailure("FurlPayAPIHost is missing from Info.plist — re-run `xcodegen generate`.")
        }
        return host
    }()

    /// Base URL the API client mounts under. Built from the host rather than
    /// stored whole because xcconfig treats `//` as a comment.
    public static let apiBaseURL: URL = {
        guard let url = URL(string: "https://\(apiHost)/api/") else {
            preconditionFailure("FurlPayAPIHost '\(apiHost)' does not form a valid URL.")
        }
        return url
    }()

    /// True for anything that is not the production backend. The UI uses this
    /// to paint an environment ribbon — a tester holding three near-identical
    /// apps needs to be able to tell, at a glance, which one is about to move
    /// real money.
    public static var isNonProduction: Bool { current != .prod }

    /// Short badge text, or nil in production where no badge should render.
    public static var badge: String? {
        switch current {
        case .dev: "DEV"
        case .staging: "STAGING"
        case .prod: nil
        }
    }
}
