//
//  FoundationModelsAssistant.swift
//
//  Replaces GeminiTextAssistant.kt and GeminiLiveAssistant.kt.
//
//  WHY THIS IS NOT A GEMINI PORT. The Kotlin talks to a hosted model: an API
//  key, a network round trip, and the user's balances leaving the device to be
//  phrased. iOS 26 ships a ~3B model on-device at SystemLanguageModel.default —
//  no key, no network in the call path, and nothing to leak. For an app whose
//  entire subject matter is the user's money, that is not a nicety.
//
//  ARCHITECTURE, WHICH IS THE IMPORTANT PART:
//
//    VoiceCommandParser (rules)  ─── hit ──▶  RepositoryToolExecutor ──▶ answer
//             │
//             └─ miss ──▶  this file  ──▶ tools ──▶ RepositoryToolExecutor
//
//  The model is the FALLBACK, not the front door. Everything it can do, it does
//  by calling the same tools the parser calls, which read the same repositories.
//  It never sees a balance it did not fetch through a tool, and it cannot
//  execute a mutating tool — those return a refusal and require Face ID through
//  the executor's own gate.
//

import Foundation
#if canImport(FoundationModels)
import FoundationModels
#endif

/// Why the on-device model cannot answer, in terms a user can act on.
public enum AssistantAvailability: Equatable, Sendable {
    case available
    /// The OS is too old — iOS 25 or earlier.
    case unsupportedOS
    /// A13 or earlier; Apple Intelligence will never run here.
    case deviceNotEligible
    /// Off in Settings. The one case the user can actually fix.
    case notEnabled
    /// Still downloading.
    case modelNotReady
    case unknown

    public var userMessage: String {
        switch self {
        case .available:         ""
        case .unsupportedOS:     "Conversational answers need iOS 26 or later."
        case .deviceNotEligible: "This iPhone can't run on-device intelligence."
        case .notEnabled:        "Turn on Apple Intelligence in Settings to ask follow-up questions."
        case .modelNotReady:     "The on-device model is still downloading."
        case .unknown:           "On-device intelligence isn't available right now."
        }
    }
}

@MainActor
@Observable
public final class FoundationModelsAssistant {

    private let container: ServiceContainer
    private let instructions: String

    #if canImport(FoundationModels)
    @available(iOS 26.0, *)
    private var session: LanguageModelSession? {
        get { _session as? LanguageModelSession }
        set { _session = newValue }
    }
    private var _session: Any?
    #endif

    public init(container: ServiceContainer, instructions: String = GuardianSystemPrompt.text) {
        self.container = container
        self.instructions = instructions
    }

    // MARK: Availability

    public var availability: AssistantAvailability {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            switch SystemLanguageModel.default.availability {
            case .available:
                return .available
            case .unavailable(.deviceNotEligible):
                return .deviceNotEligible
            case .unavailable(.appleIntelligenceNotEnabled):
                return .notEnabled
            case .unavailable(.modelNotReady):
                return .modelNotReady
            @unknown default:
                // Apple has added reasons since this shipped. Reporting
                // "unknown" is honest; guessing `.available` would put the app
                // into a path that then fails at respond().
                return .unknown
            }
        }
        #endif
        return .unsupportedOS
    }

    public var isAvailable: Bool { availability == .available }

    // MARK: Asking

    /// Answers a question the deterministic parser could not classify.
    ///
    /// Returns nil when the model is unavailable, so the caller keeps its own
    /// fallback copy rather than this file inventing an apology.
    public func answer(_ question: String) async -> String? {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *), isAvailable {
            do {
                let session = try activeSession()
                let response = try await session.respond(to: question)
                return response.content
            } catch {
                // A refusal from the model's own guardrails, a context overflow,
                // or the model going away mid-answer. None of these are worth
                // surfacing verbatim to someone asking about their balance.
                return nil
            }
        }
        #endif
        return nil
    }

    #if canImport(FoundationModels)
    @available(iOS 26.0, *)
    private func activeSession() throws -> LanguageModelSession {
        if let session { return session }
        // Sessions carry transcript, so one is kept per assistant rather than
        // per question — otherwise every follow-up would start cold.
        let created = LanguageModelSession(
            tools: GuardianModelTools.all(container: container),
            instructions: instructions
        )
        session = created
        return created
    }
    #endif

    /// Drops the conversation. Called on sign-out: the transcript can contain
    /// balances and card digits, and it must not survive into another session.
    public func reset() {
        #if canImport(FoundationModels)
        _session = nil
        #endif
    }
}
