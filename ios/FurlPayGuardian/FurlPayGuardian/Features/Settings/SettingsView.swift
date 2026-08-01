//
//  SettingsView.swift
//
//  Port of native-app/app/(tabs)/settings.tsx.
//
//  One rule carried over from lib/biometrics.ts and worth restating: the
//  "Biometric approvals" toggle governs APPROVALS — confirming a send, a swap,
//  an order. It does NOT govern sensitive-data ACCESS. The document wallet, the
//  bank details and card PAN reveal stay gated whatever this is set to, which is
//  the same norm Google Wallet and Apple Wallet follow.
//
//  If that distinction is ever collapsed into one switch, someone will turn it
//  off for convenience and unknowingly unlock their passport.
//

import SwiftUI

struct SettingsView: View {
    @Environment(ServiceContainer.self) private var container

    @State private var profile: UserProfile?
    @State private var displayName = ""
    @State private var saving = false
    @State private var confirmingSignOut = false

    private var preferences: GuardianPreferences { container.preferences }

    var body: some View {
        List {
            profileSection
            securitySection
            moneySection
            notificationsSection
            watchSection
            aboutSection
            dangerSection
        }
        .scrollContentBackground(.hidden)
        .background(GuardianColors.background.ignoresSafeArea())
        .navigationTitle("Settings")
        .navigationBarTitleDisplayMode(.inline)
        .task { await loadProfile() }
        .refreshable { await loadProfile() }
        .confirmationDialog(
            "Sign out?", isPresented: $confirmingSignOut, titleVisibility: .visible
        ) {
            Button("Sign out", role: .destructive) {
                Task { await container.signOut() }
            }
        } message: {
            Text("You'll need your email code or a passkey to sign back in.")
        }
    }

    // MARK: Sections

    private var profileSection: some View {
        Section("Profile") {
            if let profile {
                HStack {
                    Text("Email").foregroundStyle(GuardianColors.textSecondary)
                    Spacer()
                    Text(profile.email).foregroundStyle(GuardianColors.textPrimary)
                    if profile.emailVerified {
                        Image(systemName: "checkmark.seal.fill")
                            .foregroundStyle(GuardianColors.positive)
                            .accessibilityLabel("Verified")
                    }
                }
                if let uid = profile.uid {
                    LabeledContent("FurlPay UID") {
                        Text(uid).font(.caption.monospaced())
                    }
                }
            }
            TextField("Display name", text: $displayName)
                .onSubmit { save() }
            if saving { ProgressView().controlSize(.small) }
        }
        .listRowBackground(GuardianColors.surface)
    }

    private var securitySection: some View {
        Section("Security") {
            NavigationLink("Security overview") { SecurityView() }
            NavigationLink("Manage passkeys") { PasskeysView() }
            NavigationLink("Identity verification") { VerifyIdentityView() }

            Toggle("Biometric approvals", isOn: Binding(
                get: { profile?.security?.biometricEnabled ?? true },
                set: { enabled in
                    Task { await setBiometricApprovals(enabled) }
                }
            ))
            Text("Confirms payments and card changes with Face ID. Your documents and bank details are always protected, whatever this is set to.")
                .font(.caption2)
                .foregroundStyle(GuardianColors.textTertiary)
        }
        .listRowBackground(GuardianColors.surface)
    }

    private var moneySection: some View {
        Section("Money") {
            NavigationLink("Banking") { BankingView() }
            NavigationLink("Bills") { BillsView() }
            NavigationLink("Earn") { EarnView() }
            NavigationLink("Credit") { CreditView() }
        }
        .listRowBackground(GuardianColors.surface)
    }

    private var notificationsSection: some View {
        Section("Notifications") {
            NavigationLink("Inbox") { NotificationsView() }
            Toggle("Price alerts", isOn: notificationBinding(\.priceAlerts))
            Toggle("Product updates", isOn: notificationBinding(\.productUpdates))
            Toggle("Login alerts", isOn: notificationBinding(\.loginAlerts))
        }
        .listRowBackground(GuardianColors.surface)
    }

    private var watchSection: some View {
        Section("FurlPay Watch") {
            LabeledContent("Paired", value: container.sync.isPaired ? "Yes" : "No")
            Toggle("Haptics", isOn: Binding(
                get: { preferences.hapticsEnabled },
                set: { preferences.hapticsEnabled = $0 }
            ))
            Button("Sync now") {
                Task { await container.sync.pushAllSnapshots(from: container) }
            }
            LabeledContent("Alarms") {
                Text(container.alarms.usingRealAlarms ? "System alarms" : "Notifications")
                    .foregroundStyle(GuardianColors.textSecondary)
            }
        }
        .listRowBackground(GuardianColors.surface)
    }

    private var aboutSection: some View {
        Section("About") {
            LabeledContent("App version", value: Self.appVersion)
            Link("Privacy policy", destination: URL(string: "https://furlpay.com/privacy")!)
            Link("Terms", destination: URL(string: "https://furlpay.com/terms")!)
        }
        .listRowBackground(GuardianColors.surface)
    }

    private var dangerSection: some View {
        Section {
            Button("Sign out") { confirmingSignOut = true }
            NavigationLink { DeleteAccountView() } label: {
                Text("Delete account").foregroundStyle(GuardianColors.negative)
            }
        }
        .listRowBackground(GuardianColors.surface)
    }

    // MARK: Plumbing

    private func notificationBinding(
        _ key: WritableKeyPath<NotificationPreferences, Bool?>
    ) -> Binding<Bool> {
        Binding(
            get: { profile?.notifications?[keyPath: key] ?? true },
            set: { value in
                var prefs = profile?.notifications ?? NotificationPreferences()
                prefs[keyPath: key] = value
                Task { await savePreferences(prefs) }
            }
        )
    }

    private func loadProfile() async {
        profile = try? await container.api.fetchProfile()
        if displayName.isEmpty { displayName = profile?.displayName ?? "" }
    }

    private func save() {
        saving = true
        Task {
            profile = try? await container.api.updateProfile(
                displayName: displayName, notifications: nil
            )
            saving = false
        }
    }

    private func savePreferences(_ prefs: NotificationPreferences) async {
        profile = try? await container.api.updateProfile(
            displayName: nil, notifications: prefs
        )
    }

    /// Routed through the profile so the preference actually takes effect.
    ///
    /// The RN app had a bug worth not repeating: the toggle wrote the profile
    /// but every screen called LocalAuthentication directly, so flipping it
    /// changed nothing. Here the single gate reads this value.
    private func setBiometricApprovals(_ enabled: Bool) async {
        // Turning the gate OFF is itself a security-relevant change, so it is
        // confirmed with the gate being turned off. Turning it on is not.
        if !enabled {
            guard await container.biometrics.authenticate(
                reason: "Turn off biometric approvals"
            ).isAuthenticated else { return }
        }
        container.preferences.biometricApprovals = enabled
        await loadProfile()
    }

    static var appVersion: String {
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0.0"
        let build = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "1"
        return "\(version) (\(build))"
    }
}
