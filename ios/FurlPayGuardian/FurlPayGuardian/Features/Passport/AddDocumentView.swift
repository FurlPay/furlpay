//
//  AddDocumentView.swift
//
//  Port of native-app/app/passport-scan.tsx.
//
//  There is no camera on this screen and there must never be one. The user
//  picks a country and a document type; everything after that happens inside
//  the provider's hosted flow, in Safari's process, out of this app's reach.
//  See PassportVerificationFlow.
//

import SwiftUI

struct AddDocumentView: View {
    @Environment(ServiceContainer.self) private var container
    @Environment(\.dismiss) private var dismiss

    @State private var country = Locale.current.region?.identifier ?? "US"
    @State private var documentType = "passport"
    @State private var phase: Phase = .choosing
    @State private var flow = PassportVerificationFlow()

    private enum Phase: Equatable {
        case choosing
        case opening
        /// The flow closed and the server has been told. The provider decides
        /// the outcome asynchronously, so this is NOT "verified".
        case submitted
        case dismissed
        case failed(String)
    }

    private let types = [
        ("passport", "Passport"),
        ("national_id", "National ID"),
        ("drivers_license", "Driver's licence"),
        ("residence_permit", "Residence permit"),
    ]

    var body: some View {
        NavigationStack {
            Group {
                switch phase {
                case .choosing:  chooser
                case .opening:   busy("Opening secure verification…")
                case .submitted: outcome(
                    icon: "checkmark.circle.fill", tint: GuardianColors.positive,
                    title: "Submitted",
                    // Precise on purpose. Saying "Verified" here would be a lie
                    // the user would act on.
                    detail: "We'll update your wallet as soon as our identity partner confirms it. This usually takes a minute."
                )
                case .dismissed: outcome(
                    icon: "xmark.circle", tint: GuardianColors.textSecondary,
                    title: "Not finished",
                    detail: "You closed verification before it completed. Nothing was saved."
                )
                case .failed(let message): outcome(
                    icon: "exclamationmark.triangle.fill", tint: GuardianColors.negative,
                    title: "Couldn't start", detail: message
                )
                }
            }
            .background(GuardianColors.background.ignoresSafeArea())
            .navigationTitle("Add document")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(phase == .choosing ? "Cancel" : "Done") { dismiss() }
                }
            }
        }
        .preferredColorScheme(.dark)
    }

    private var chooser: some View {
        VStack(spacing: 20) {
            Form {
                Section("Issuing country") {
                    // The system picker rather than a bundled country list:
                    // Locale already knows every region and its localised name.
                    Picker("Country", selection: $country) {
                        ForEach(Self.regions, id: \.0) { code, name in
                            Text(name).tag(code)
                        }
                    }
                }
                Section("Document type") {
                    Picker("Type", selection: $documentType) {
                        ForEach(types, id: \.0) { Text($0.1).tag($0.0) }
                    }
                    .pickerStyle(.inline)
                    .labelsHidden()
                }
                Section {
                    Text("Verification opens in Safari, run by our identity partner. FurlPay never sees or stores your document.")
                        .font(.caption)
                        .foregroundStyle(GuardianColors.textSecondary)
                }
            }
            .scrollContentBackground(.hidden)

            Button("Start verification") { start() }
                .buttonStyle(.borderedProminent)
                .tint(GuardianColors.primaryAccent)
                .controlSize(.large)
                .padding(.horizontal, 20)
                .padding(.bottom, 20)
        }
    }

    private func busy(_ text: String) -> some View {
        VStack(spacing: 14) {
            ProgressView().tint(GuardianColors.primaryAccent)
            Text(text).font(.subheadline).foregroundStyle(GuardianColors.textSecondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func outcome(icon: String, tint: Color, title: String, detail: String) -> some View {
        VStack(spacing: 14) {
            Image(systemName: icon).font(.system(size: 50)).foregroundStyle(tint)
            Text(title).font(.title3.weight(.semibold))
                .foregroundStyle(GuardianColors.textPrimary)
            Text(detail).font(.subheadline)
                .foregroundStyle(GuardianColors.textSecondary)
                .multilineTextAlignment(.center)
        }
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func start() {
        phase = .opening
        Task {
            do {
                let session = try await container.passport.beginScan(
                    issuingCountry: country, documentType: documentType
                )
                switch await flow.run(session) {
                case .submitted(let sessionId):
                    // Tell the server the flow finished. It asks the provider
                    // for the real outcome; we are not asserting a pass.
                    _ = try? await container.passport.completeVerification(sessionId: sessionId)
                    phase = .submitted
                case .dismissed:
                    phase = .dismissed
                case .unavailable(let reason):
                    phase = .failed(reason)
                }
            } catch {
                phase = .failed("We couldn't start verification. Try again shortly.")
            }
        }
    }

    /// Every region the OS knows, localised. Beats a hardcoded list that goes
    /// stale and cannot be translated.
    static let regions: [(String, String)] = {
        Locale.Region.isoRegions
            .filter { $0.subRegions.isEmpty }          // drop continents
            .compactMap { region in
                Locale.current.localizedString(forRegionCode: region.identifier)
                    .map { (region.identifier, $0) }
            }
            .sorted { $0.1 < $1.1 }
    }()
}
