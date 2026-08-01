//
//  SecurityScreens.swift
//
//  Ports of native-app/app/security.tsx, passkeys.tsx, verify-identity.tsx,
//  delete-account.tsx and notifications.tsx.
//

import SwiftUI

// MARK: - Security overview

struct SecurityView: View {
    @Environment(ServiceContainer.self) private var container

    @State private var profile: UserProfile?
    @State private var passkeyCount = 0

    /// Derived from real account signals, never a hardcoded grade. A security
    /// page that always reads "Strong" teaches the user their account is fine
    /// when it may not be.
    private var signals: SecuritySignals {
        SecuritySignals(
            passkey: passkeyCount > 0,
            emailVerified: profile?.emailVerified ?? false,
            biometric: container.biometrics.isAvailable
                && (profile?.security?.biometricEnabled ?? true)
        )
    }

    private var level: SecurityLevel { SecurityPosture.level(signals) }

    var body: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 8) {
                    Text(level.label)
                        .font(.system(size: 34, weight: .semibold, design: .rounded))
                        .foregroundStyle(colour)
                    Text(level.blurb)
                        .font(.subheadline)
                        .foregroundStyle(GuardianColors.textSecondary)
                }
                .padding(.vertical, 8)
            }
            .listRowBackground(GuardianColors.surface)

            let gaps = SecurityPosture.gaps(signals)
            if !gaps.isEmpty {
                Section("Finish setting up") {
                    ForEach(gaps, id: \.self) { gap in
                        Label(gap, systemImage: "circle")
                            .font(.subheadline)
                            .foregroundStyle(GuardianColors.warning)
                    }
                }
                .listRowBackground(GuardianColors.surface)
            }

            Section("Protections") {
                signalRow("Verified email", signals.emailVerified)
                signalRow("Passkey", signals.passkey)
                signalRow("App lock", signals.biometric)
                if profile?.security?.totpEnabled == true {
                    signalRow("Authenticator app (TOTP)", true)
                }
            }
            .listRowBackground(GuardianColors.surface)

            Section {
                NavigationLink("Manage passkeys") { PasskeysView() }
                NavigationLink("Identity verification") { VerifyIdentityView() }
                NavigationLink("Documents") { PassportVaultView() }
            }
            .listRowBackground(GuardianColors.surface)
        }
        .scrollContentBackground(.hidden)
        .background(GuardianColors.background.ignoresSafeArea())
        .navigationTitle("Security")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable { await load() }
    }

    private func signalRow(_ label: String, _ on: Bool) -> some View {
        HStack {
            Image(systemName: on ? "checkmark.circle.fill" : "circle")
                .foregroundStyle(on ? GuardianColors.positive : GuardianColors.textTertiary)
            Text(label).foregroundStyle(GuardianColors.textPrimary)
            Spacer()
        }
        .font(.subheadline)
    }

    private var colour: Color {
        switch level {
        case .strong: GuardianColors.positive
        case .medium: GuardianColors.warning
        case .weak:   GuardianColors.negative
        }
    }

    private func load() async {
        profile = try? await container.api.fetchProfile()
        passkeyCount = (try? await container.api.fetchPasskeys().count) ?? 0
    }
}

// MARK: - Passkeys

struct PasskeysView: View {
    @Environment(ServiceContainer.self) private var container

    @State private var credentials: [PasskeyCredential] = []
    @State private var working = false
    @State private var error: String?

    private var service: PasskeyService { container.passkeys }

    var body: some View {
        List {
            Section {
                Text("Passkeys sign you in with Face ID instead of a code. The key is generated on this iPhone and never leaves it.")
                    .font(.caption)
                    .foregroundStyle(GuardianColors.textSecondary)
            }
            .listRowBackground(GuardianColors.surface)

            if credentials.isEmpty {
                Section {
                    Text("No passkeys yet.")
                        .foregroundStyle(GuardianColors.textSecondary)
                }
                .listRowBackground(GuardianColors.surface)
            } else {
                Section("Your passkeys") {
                    ForEach(credentials) { credential in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(credential.label ?? credential.deviceName ?? "Passkey")
                                .font(.subheadline)
                                .foregroundStyle(GuardianColors.textPrimary)
                            if let used = credential.lastUsedAt {
                                Text("Last used \(used.relativeDescription)")
                                    .font(.caption2)
                                    .foregroundStyle(GuardianColors.textTertiary)
                            }
                        }
                    }
                    .onDelete { offsets in
                        for index in offsets { revoke(credentials[index]) }
                    }
                }
                .listRowBackground(GuardianColors.surface)
            }

            if let error {
                Section { Text(error).font(.footnote).foregroundStyle(GuardianColors.negative) }
                    .listRowBackground(GuardianColors.surface)
            }

            Section {
                Button("Add a passkey") { add() }
                    .disabled(working)
            }
            .listRowBackground(GuardianColors.surface)
        }
        .scrollContentBackground(.hidden)
        .background(GuardianColors.background.ignoresSafeArea())
        .navigationTitle("Passkeys")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func load() async {
        credentials = (try? await service.credentials()) ?? []
    }

    private func add() {
        working = true
        error = nil
        Task {
            do {
                _ = try await service.register(
                    displayName: UIDevice.current.name
                )
                await load()
            } catch PasskeyError.cancelled {
                // Not an error worth an alert — the user changed their mind.
            } catch {
                self.error = error.localizedDescription
            }
            working = false
        }
    }

    private func revoke(_ credential: PasskeyCredential) {
        Task {
            // Removing a passkey weakens the account, so it is confirmed.
            guard await container.biometrics.authenticate(
                reason: "Remove this passkey"
            ).isAuthenticated else { return }
            try? await service.revoke(id: credential.id)
            await load()
        }
    }
}

// MARK: - Identity verification

struct VerifyIdentityView: View {
    @Environment(ServiceContainer.self) private var container

    @State private var profile: UserProfile?
    @State private var showScan = false

    var body: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 8) {
                    Label(statusLabel, systemImage: statusIcon)
                        .font(.headline)
                        .foregroundStyle(statusColour)
                    Text(statusBlurb)
                        .font(.subheadline)
                        .foregroundStyle(GuardianColors.textSecondary)
                }
                .padding(.vertical, 6)
            }
            .listRowBackground(GuardianColors.surface)

            Section {
                Button("Verify a document") { showScan = true }
                NavigationLink("Your documents") { PassportVaultView() }
            }
            .listRowBackground(GuardianColors.surface)

            Section {
                Text("Verification runs with our identity partner in Safari. FurlPay never sees or stores a photo of your document.")
                    .font(.caption2)
                    .foregroundStyle(GuardianColors.textTertiary)
            }
            .listRowBackground(GuardianColors.surface)
        }
        .scrollContentBackground(.hidden)
        .background(GuardianColors.background.ignoresSafeArea())
        .navigationTitle("Identity")
        .navigationBarTitleDisplayMode(.inline)
        .task { profile = try? await container.api.fetchProfile() }
        .sheet(isPresented: $showScan) { AddDocumentView() }
    }

    private var status: String { profile?.kycStatus?.lowercased() ?? "unverified" }

    private var statusLabel: String {
        switch status {
        case "approved", "verified": "Verified"
        case "pending", "review":    "In review"
        case "rejected", "failed":   "Couldn't verify"
        default:                     "Not verified"
        }
    }

    private var statusIcon: String {
        switch status {
        case "approved", "verified": "checkmark.seal.fill"
        case "pending", "review":    "clock"
        case "rejected", "failed":   "xmark.seal.fill"
        default:                     "person.crop.circle.badge.questionmark"
        }
    }

    private var statusColour: Color {
        switch status {
        case "approved", "verified": GuardianColors.positive
        case "pending", "review":    GuardianColors.warning
        case "rejected", "failed":   GuardianColors.negative
        default:                     GuardianColors.textSecondary
        }
    }

    private var statusBlurb: String {
        switch status {
        case "approved", "verified":
            "Higher limits and faster payouts are unlocked."
        case "pending", "review":
            "We'll update you as soon as our partner finishes checking."
        case "rejected", "failed":
            "Something didn't match. Try again with a clearer photo."
        default:
            "Verify your identity to raise limits and enable payouts."
        }
    }
}

// MARK: - Delete account

struct DeleteAccountView: View {
    @Environment(ServiceContainer.self) private var container
    @Environment(\.dismiss) private var dismiss

    @State private var typed = ""
    @State private var working = false
    @State private var error: String?

    private let phrase = "DELETE"

    var body: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 10) {
                    Label("This cannot be undone", systemImage: "exclamationmark.triangle.fill")
                        .font(.headline)
                        .foregroundStyle(GuardianColors.negative)
                    Text("Your balances, cards, documents and history are permanently removed. Withdraw any remaining funds first — we cannot recover them afterwards.")
                        .font(.subheadline)
                        .foregroundStyle(GuardianColors.textSecondary)
                }
                .padding(.vertical, 6)
            }
            .listRowBackground(GuardianColors.surface)

            Section("Type \(phrase) to confirm") {
                TextField(phrase, text: $typed)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                    .font(.system(.body, design: .monospaced))
            }
            .listRowBackground(GuardianColors.surface)

            if let error {
                Section { Text(error).font(.footnote).foregroundStyle(GuardianColors.negative) }
                    .listRowBackground(GuardianColors.surface)
            }

            Section {
                Button(role: .destructive) {
                    deleteAccount()
                } label: {
                    HStack {
                        Spacer()
                        if working { ProgressView() } else { Text("Delete my account") }
                        Spacer()
                    }
                }
                // Typed phrase AND a biometric. Either alone is too easy to do
                // by accident or on someone else's unlocked phone.
                .disabled(typed != phrase || working)
            }
            .listRowBackground(GuardianColors.surface)
        }
        .scrollContentBackground(.hidden)
        .background(GuardianColors.background.ignoresSafeArea())
        .navigationTitle("Delete account")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func deleteAccount() {
        working = true
        Task {
            guard await container.biometrics.authenticate(
                reason: "Confirm deleting your FurlPay account"
            ).isAuthenticated else {
                working = false
                error = "Not confirmed."
                return
            }
            do {
                // The typed phrase is a local guard on the button; the route
                // (DELETE /api/account) takes no body.
                try await container.api.deleteAccount()
                await container.signOut()
            } catch {
                self.error = "We couldn't delete your account. Contact support."
            }
            working = false
        }
    }
}

// MARK: - Notifications inbox

struct NotificationsView: View {
    @Environment(ServiceContainer.self) private var container

    var body: some View {
        List {
            if container.prioritisedEvents.isEmpty {
                Section {
                    Text("Nothing new.")
                        .foregroundStyle(GuardianColors.textSecondary)
                }
                .listRowBackground(GuardianColors.surface)
            } else {
                Section("Recent") {
                    ForEach(container.prioritisedEvents) { event in
                        VStack(alignment: .leading, spacing: 3) {
                            Text(event.title)
                                .font(.subheadline)
                                .foregroundStyle(GuardianColors.textPrimary)
                            if let detail = event.detail {
                                Text(detail)
                                    .font(.caption)
                                    .foregroundStyle(GuardianColors.textSecondary)
                            }
                            Text(event.startAt.relativeDescription)
                                .font(.caption2)
                                .foregroundStyle(GuardianColors.textTertiary)
                        }
                        .swipeActions {
                            Button("Done") { container.events.acknowledge(event.id) }
                                .tint(GuardianColors.positive)
                        }
                    }
                }
                .listRowBackground(GuardianColors.surface)
            }
        }
        .scrollContentBackground(.hidden)
        .background(GuardianColors.background.ignoresSafeArea())
        .navigationTitle("Notifications")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await container.refreshAll() }
    }
}
