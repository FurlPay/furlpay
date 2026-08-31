//
//  LiveVoiceView.swift
//
//  Port of LiveVoiceScreen.kt — push-to-talk with the pulsing ring.
//
//  Speech recognition runs on-device via SFSpeechRecognizer. The transcript is
//  answered locally from cached repository state; nothing here can mutate.
//  Wiring a model in later means replacing `answer(for:)` and routing any
//  proposed action through GuardianActionRegistry first — the model must never
//  reach the network directly.
//

import SwiftUI
import Speech
import AVFoundation

@MainActor
@Observable
final class LiveVoiceViewModel {
    enum State: Equatable { case idle, listening, thinking, speaking }

    var state: State = .idle
    var transcript = ""
    var response: String?
    var error: String?

    private let container: ServiceContainer
    private let recogniser = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private let engine = AVAudioEngine()

    init(container: ServiceContainer) { self.container = container }

    func requestPermissions() async -> Bool {
        let speech = await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { continuation.resume(returning: $0) }
        }
        guard speech == .authorized else {
            error = "Speech recognition permission was declined."
            return false
        }
        let mic = await AVAudioApplication.requestRecordPermission()
        if !mic { error = "Microphone permission was declined." }
        return mic
    }

    func startListening() async {
        guard await requestPermissions() else { return }
        guard let recogniser, recogniser.isAvailable else {
            error = "Speech recognition is unavailable right now."
            return
        }

        stop()
        transcript = ""
        response = nil
        error = nil

        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.record, mode: .measurement, options: .duckOthers)
            try session.setActive(true, options: .notifyOthersOnDeactivation)

            let request = SFSpeechAudioBufferRecognitionRequest()
            request.shouldReportPartialResults = true
            // Keep audio on device. A financial assistant should not ship voice
            // to Apple's servers when the on-device recogniser can do the job.
            request.requiresOnDeviceRecognition = recogniser.supportsOnDeviceRecognition
            self.request = request

            let input = engine.inputNode
            input.removeTap(onBus: 0)
            input.installTap(onBus: 0, bufferSize: 1024, format: input.outputFormat(forBus: 0)) { buffer, _ in
                request.append(buffer)
            }

            engine.prepare()
            try engine.start()
            state = .listening

            task = recogniser.recognitionTask(with: request) { [weak self] result, error in
                Task { @MainActor in
                    guard let self else { return }
                    if let result {
                        self.transcript = result.bestTranscription.formattedString
                        if result.isFinal { await self.finish() }
                    }
                    if error != nil { await self.finish() }
                }
            }
        } catch {
            self.error = error.localizedDescription
            stop()
        }
    }

    func finish() async {
        guard state == .listening else { return }
        stop()
        state = .thinking
        let question = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !question.isEmpty else { state = .idle; return }
        response = await answer(for: question)
        state = .idle
    }

    func stop() {
        engine.inputNode.removeTap(onBus: 0)
        if engine.isRunning { engine.stop() }
        request?.endAudio()
        task?.cancel()
        request = nil
        task = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    /// Rule first, model second.
    ///
    /// VoiceCommandParser resolves the tight schema ("what's my balance",
    /// "freeze my card ending 4521") with no network and no model. Only
    /// phrasing the rules do not cover would escalate — and since no model layer
    /// is wired yet, that case answers with what the app can actually do rather
    /// than pretending to think.
    ///
    /// Mutating tools still route through the executor's biometric gate; the
    /// parser recognising "freeze my card" is not authorisation to freeze it.
    private func answer(for question: String) async -> String {
        if let invocation = VoiceCommandParser.parse(question) {
            return await container.tools.execute(invocation).text
        }
        // Rules missed. Hand it to the on-device model, which can only reach
        // the same repositories through the same read tools.
        if let answer = await container.assistant.answer(question) {
            return answer
        }
        // No model on this device either. Say what the app CAN do rather than
        // apologising — the deterministic path still covers most questions.
        let reason = container.assistant.availability.userMessage
        let capability = "I can answer about your balance, spending, portfolio, "
            + "cards, trips and schedule."
        return reason.isEmpty ? capability : "\(capability) \(reason)"
    }
}

struct LiveVoiceView: View {
    @Environment(ServiceContainer.self) private var container
    @State private var model: LiveVoiceViewModel?

    var body: some View {
        ZStack {
            GuardianColors.background.ignoresSafeArea()

            if let model {
                VStack(spacing: 28) {
                    Spacer()

                    PulsingRing(active: model.state == .listening)
                        .frame(width: 160, height: 160)
                        .overlay {
                            Image(systemName: model.state == .listening ? "waveform" : "mic.fill")
                                .font(.system(size: 44, weight: .light))
                                .foregroundStyle(GuardianColors.primaryAccent)
                        }

                    Text(statusText(model))
                        .font(.subheadline)
                        .foregroundStyle(GuardianColors.textSecondary)

                    if !model.transcript.isEmpty {
                        Text(model.transcript)
                            .font(.title3)
                            .foregroundStyle(GuardianColors.textPrimary)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 28)
                    }

                    if let response = model.response {
                        Text(response)
                            .font(.body)
                            .foregroundStyle(GuardianColors.textPrimary)
                            .multilineTextAlignment(.center)
                            .padding(18)
                            .background(GuardianColors.surface)
                            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                            .padding(.horizontal, 24)
                    }

                    if let error = model.error {
                        Text(error)
                            .font(.footnote)
                            .foregroundStyle(GuardianColors.negative)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 28)
                    }

                    Spacer()

                    Button {
                        Task {
                            if model.state == .listening { await model.finish() }
                            else { await model.startListening() }
                        }
                    } label: {
                        Text(model.state == .listening ? "Stop" : "Hold to Ask")
                            .font(.headline)
                            .frame(maxWidth: .infinity)
                            .frame(height: 54)
                            .background(model.state == .listening
                                        ? GuardianColors.negative
                                        : GuardianColors.primaryAccent)
                            // The fill flips between a dark red and a light
                            // emerald, so the label has to flip with it — one
                            // fixed foreground is unreadable on one of them.
                            .foregroundStyle(model.state == .listening
                                             ? Color.white
                                             : GuardianColors.onPrimaryAccent)
                            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                    }
                    .padding(.horizontal, 24)
                    .padding(.bottom, 24)
                }
            }
        }
        .navigationTitle("Guardian")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { if model == nil { model = LiveVoiceViewModel(container: container) } }
        .onDisappear { model?.stop() }
    }

    private func statusText(_ model: LiveVoiceViewModel) -> String {
        switch model.state {
        case .idle: "Ask about your balance, spending or portfolio"
        case .listening: "Listening…"
        case .thinking: "Thinking…"
        case .speaking: "Speaking…"
        }
    }
}

/// The pulsing ring from LiveVoiceScreen.kt.
struct PulsingRing: View {
    let active: Bool
    @State private var animating = false

    var body: some View {
        ZStack {
            ForEach(0..<3, id: \.self) { index in
                Circle()
                    .stroke(GuardianColors.primaryAccent, lineWidth: 2)
                    .scaleEffect(animating ? 1.15 : 0.85)
                    .opacity(animating ? 0.0 : 0.5)
                    .animation(
                        active
                        ? .easeOut(duration: 1.6)
                            .repeatForever(autoreverses: false)
                            .delay(Double(index) * 0.5)
                        : .default,
                        value: animating
                    )
            }
            Circle()
                .fill(GuardianColors.primaryAccent.opacity(0.12))
                .scaleEffect(0.8)
        }
        .onChange(of: active) { _, isActive in animating = isActive }
        .onAppear { animating = active }
    }
}
