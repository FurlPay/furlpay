//
//  PassportVaultView.swift
//
//  The document wallet. Port of native-app/app/passport.tsx and
//  components/PassportCard.tsx.
//
//  The screen is LOCKED until Face ID succeeds, and re-locks on background.
//  The RN app does not do this; see PassportRepository for why this port does.
//

import SwiftUI

struct PassportVaultView: View {
    @Environment(ServiceContainer.self) private var container
    @Environment(\.scenePhase) private var scenePhase

    @State private var selected: TravelDocument?
    @State private var showScanner = false
    @State private var unlockFailed = false

    private var repository: PassportRepository { container.passport }

    var body: some View {
        Group {
            if repository.isUnlocked {
                vault
            } else {
                LockedVaultView(failed: unlockFailed) { await attemptUnlock() }
            }
        }
        .background(GuardianColors.background.ignoresSafeArea())
        .navigationTitle("Documents")
        .navigationBarTitleDisplayMode(.inline)
        .task { await attemptUnlock() }
        // Re-arm on background. Someone who hands over an unlocked phone should
        // not be handing over a document wallet.
        .onChange(of: scenePhase) { _, phase in
            if phase != .active { repository.lock() }
        }
        .sheet(item: $selected) { document in
            DocumentDetailSheet(document: document)
        }
        .sheet(isPresented: $showScanner) {
            AddDocumentView()
        }
    }

    private func attemptUnlock() async {
        guard !repository.isUnlocked else { return }
        let ok = await repository.unlock()
        unlockFailed = !ok
        if ok { await repository.refresh() }
    }

    // MARK: Unlocked

    @ViewBuilder
    private var vault: some View {
        if repository.isLoading && repository.documents.isEmpty {
            ProgressView().tint(GuardianColors.primaryAccent)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let error = repository.loadError, repository.documents.isEmpty {
            ErrorState(message: error) { await repository.refresh() }
        } else if repository.documents.isEmpty {
            emptyState
        } else {
            ScrollView {
                VStack(spacing: 20) {
                    PassportCardStack(documents: repository.documents) { selected = $0 }
                        .padding(.top, 12)

                    Button("Add another document") { showScanner = true }
                        .buttonStyle(.bordered)
                        .tint(GuardianColors.primaryAccent)

                    footnote
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 32)
            }
            .refreshable { await repository.refresh() }
        }
    }

    private var emptyState: some View {
        VStack(spacing: 14) {
            Image(systemName: "globe")
                .font(.system(size: 48))
                .foregroundStyle(GuardianColors.primaryAccent)
            Text("Your document wallet")
                .font(.title3.weight(.semibold))
                .foregroundStyle(GuardianColors.textPrimary)
            Text("Add a passport or ID to speed up travel bookings and verification.")
                .font(.subheadline)
                .foregroundStyle(GuardianColors.textSecondary)
                .multilineTextAlignment(.center)
            Button("Add a document") { showScanner = true }
                .buttonStyle(.borderedProminent)
                .tint(GuardianColors.primaryAccent)
                .padding(.top, 4)
        }
        .padding(28)
        .frame(maxWidth: .infinity)
        .background(GuardianColors.surface)
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .padding(20)
    }

    private var footnote: some View {
        Text("Your documents are verified by our identity partner. FurlPay never stores a photo of your passport.")
            .font(.caption2)
            .foregroundStyle(GuardianColors.textTertiary)
            .multilineTextAlignment(.center)
            .padding(.top, 8)
    }
}

// MARK: - Locked

struct LockedVaultView: View {
    let failed: Bool
    let unlock: () async -> Void

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: failed ? "lock.trianglebadge.exclamationmark" : "lock.shield")
                .font(.system(size: 52))
                .foregroundStyle(failed ? GuardianColors.warning : GuardianColors.primaryAccent)

            Text(failed ? "Locked" : "Document wallet")
                .font(.title3.weight(.semibold))
                .foregroundStyle(GuardianColors.textPrimary)

            Text(failed
                 ? "Face ID is required to view your documents."
                 : "Unlock to view your travel documents.")
                .font(.subheadline)
                .foregroundStyle(GuardianColors.textSecondary)
                .multilineTextAlignment(.center)

            Button("Unlock") { Task { await unlock() } }
                .buttonStyle(.borderedProminent)
                .tint(GuardianColors.primaryAccent)
                .controlSize(.large)
                .padding(.top, 6)
        }
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Card

struct PassportCardView: View {
    let document: TravelDocument

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top) {
                HStack(spacing: 8) {
                    Text(document.flag).font(.title2)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(document.countryName)
                            .font(.subheadline.weight(.bold))
                            .foregroundStyle(GuardianColors.textPrimary)
                        Text(document.label ?? document.typeLabel)
                            .font(.caption2)
                            .foregroundStyle(GuardianColors.textSecondary)
                    }
                }
                Spacer()
                statusChip
            }

            Spacer()

            Text(document.documentNumberMasked)
                .font(.system(.title3, design: .monospaced).weight(.medium))
                .foregroundStyle(GuardianColors.textPrimary)
                .kerning(2)

            Spacer()

            HStack {
                VStack(alignment: .leading, spacing: 1) {
                    Text("EXPIRES").font(.system(size: 9, weight: .semibold))
                        .foregroundStyle(GuardianColors.textTertiary)
                    Text(document.expiresOn)
                        .font(.caption.weight(.medium))
                        .foregroundStyle(
                            document.expired ? GuardianColors.negative
                                : document.expiringSoon ? GuardianColors.warning
                                : GuardianColors.textSecondary
                        )
                }
                Spacer()
                if document.chipVerified {
                    Label("CHIP", systemImage: "wave.3.right")
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundStyle(GuardianColors.textTertiary)
                }
                if document.isPrimary {
                    Text("PRIMARY")
                        .font(.system(size: 9, weight: .bold))
                        .padding(.horizontal, 7).padding(.vertical, 3)
                        .background(GuardianColors.primaryAccent.opacity(0.18))
                        .foregroundStyle(GuardianColors.primaryAccent)
                        .clipShape(Capsule())
                }
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            LinearGradient(
                colors: [
                    Color(red: 0.06, green: 0.10, blue: 0.17),
                    Color(red: 0.04, green: 0.07, blue: 0.13),
                    Color(red: 0.02, green: 0.04, blue: 0.08),
                ],
                startPoint: .topLeading, endPoint: .bottomTrailing
            )
        }
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .strokeBorder(Color.white.opacity(0.07), lineWidth: 1)
        }
        // Saturating the whole card on failure would make it unreadable; the
        // status chip carries the signal instead. A failed document should not
        // look celebratory, but it still has to be legible.
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(document.accessibilityDescription)
    }

    private var statusChip: some View {
        Label(document.status.label, systemImage: document.status.icon)
            .font(.system(size: 9, weight: .bold))
            .padding(.horizontal, 8).padding(.vertical, 4)
            .background(statusColour.opacity(0.16))
            .foregroundStyle(statusColour)
            .clipShape(Capsule())
    }

    private var statusColour: Color {
        switch document.status {
        case .verified: GuardianColors.positive
        case .pending:  GuardianColors.warning
        case .failed, .expired: GuardianColors.negative
        }
    }
}

// MARK: - Detail

struct DocumentDetailSheet: View {
    @Environment(ServiceContainer.self) private var container
    @Environment(\.dismiss) private var dismiss
    let document: TravelDocument

    @State private var working = false
    @State private var error: String?
    @State private var confirmingDelete = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    row("Country", document.countryName)
                    row("Type", document.typeLabel)
                    row("Number", document.documentNumberMasked)
                    row("Expires", document.expiresOn)
                    row("Status", document.status.label.capitalized)
                    row("Chip verified", document.chipVerified ? "Yes" : "No")
                }

                Section {
                    if !document.isPrimary {
                        Button("Make primary") { perform { try await container.passport.setPrimary(document.id) } }
                    }
                    Button("Remove document", role: .destructive) { confirmingDelete = true }
                }

                if let error {
                    Section { Text(error).font(.footnote).foregroundStyle(GuardianColors.negative) }
                }
            }
            .scrollContentBackground(.hidden)
            .background(GuardianColors.background.ignoresSafeArea())
            .navigationTitle("Document details")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
            .disabled(working)
            .confirmationDialog(
                "Remove this document?",
                isPresented: $confirmingDelete, titleVisibility: .visible
            ) {
                Button("Remove", role: .destructive) {
                    // Face ID is requested again inside delete() — unlocking is
                    // permission to look, not to destroy.
                    perform {
                        try await container.passport.delete(document.id)
                        dismiss()
                    }
                }
            } message: {
                Text("You'll need to verify it again to add it back.")
            }
        }
        .preferredColorScheme(.dark)
    }

    private func row(_ key: String, _ value: String) -> some View {
        HStack {
            Text(key).foregroundStyle(GuardianColors.textSecondary)
            Spacer()
            Text(value).foregroundStyle(GuardianColors.textPrimary)
        }
        .font(.subheadline)
        .listRowBackground(GuardianColors.surface)
    }

    private func perform(_ work: @escaping () async throws -> Void) {
        working = true
        Task {
            do { try await work(); error = nil }
            catch { self.error = "That didn't work. Try again." }
            working = false
        }
    }
}

// MARK: - Shared bits

struct ErrorState: View {
    let message: String
    let retry: () async -> Void

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "icloud.slash")
                .font(.system(size: 40))
                .foregroundStyle(GuardianColors.textTertiary)
            Text(message)
                .font(.subheadline)
                .foregroundStyle(GuardianColors.textSecondary)
                .multilineTextAlignment(.center)
            Button("Try again") { Task { await retry() } }
                .buttonStyle(.bordered)
                .tint(GuardianColors.primaryAccent)
        }
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
