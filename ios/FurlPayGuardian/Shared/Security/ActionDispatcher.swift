//
//  ActionDispatcher.swift
//
//  Port of ActionDispatcher.kt — and a fix for something the first pass of this
//  port got wrong.
//
//  The Kotlin enforces the security order IN THE TYPE SYSTEM: `dispatch` takes
//  a `ResolvedConfirmation.Ok`, and the only way to obtain one is
//  `GuardianActionRegistry.resolve()`. An unvalidated model proposal therefore
//  cannot reach the network — not by convention, but because it will not
//  compile.
//
//  The Swift port had `executeResolvedAction(endpoint:method:body:)` taking
//  three loose strings. Same behaviour when used correctly, but the guarantee
//  was gone: any caller could pass any endpoint and any body and the compiler
//  would agree. `ApprovedAction` below restores it — the initialiser is private
//  to this file, so the registry is the only thing that can produce one.
//
//  The BIOMETRIC gate remains the caller's job. Every dispatch must already sit
//  behind it; see ServiceContainer.confirmAndDispatch.
//

import Foundation

/// A registry-validated action, ready to send.
///
/// There is no public initialiser. The only producer is
/// `ResolvedConfirmation.approved`, which exists only on the `.ok` case, which
/// only `GuardianActionRegistry.resolve` returns. That chain is the whole point
/// of the type.
public struct ApprovedAction: Sendable {
    public let actionId: String
    public let title: String
    public let endpoint: String
    public let method: String
    public let body: [String: JSONValue]
    /// The USD amount THAT WILL BE SENT, read back out of the validated body.
    ///
    /// Never `Confirmation.amountUsd`. That field is an untrusted display hint
    /// on a payload the model controls, and routing it here would let a
    /// confirmation claiming "$5.00" put that figure above a Face ID sheet
    /// while the body it authorises carries $25,000.
    public let amountUsd: Double?
    /// Registry-derived, field-by-field description of the request. The
    /// confirmation UI renders THIS, not the server's free-form `summary`.
    public let details: [ConfirmationDetail]

    fileprivate init(
        actionId: String, title: String, endpoint: String, method: String,
        body: [String: JSONValue], amountUsd: Double?, details: [ConfirmationDetail]
    ) {
        self.actionId = actionId
        self.title = title
        self.endpoint = endpoint
        self.method = method
        self.body = body
        self.amountUsd = amountUsd
        self.details = details
    }
}

public extension ResolvedConfirmation {
    /// The sendable form of a resolved action, or nil if it was rejected.
    ///
    /// Everything here comes from the REGISTRY copy — `spec.endpoint`, not the
    /// endpoint the server proposed, even though `resolve` already checked they
    /// matched. Two checks are cheap; a mismatch reaching the wire is not.
    var approved: ApprovedAction? {
        guard case .ok(let spec, _, let method, let body, let details, let amountUsd) = self else {
            return nil
        }
        return ApprovedAction(
            actionId: spec.id,
            title: spec.title,
            endpoint: spec.endpoint,
            method: method,
            body: body,
            amountUsd: amountUsd,
            details: details
        )
    }
}

/// Executes registry-validated actions. Nothing else can be passed to it.
public struct GuardianActionDispatcher: Sendable {

    private let api: FurlPayAPIClient

    public init(api: FurlPayAPIClient) {
        self.api = api
    }

    @discardableResult
    public func dispatch(_ action: ApprovedAction) async throws -> JSONValue {
        try await api.executeResolvedAction(
            endpoint: action.endpoint,
            method: action.method,
            body: action.body
        )
    }
}
