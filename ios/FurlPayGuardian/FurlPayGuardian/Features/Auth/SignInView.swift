//
//  SignInView.swift
//
//  Two-stage OTP sign-in, matching SignInScreen in the Android MainActivity:
//  phone number -> code -> token.
//

import SwiftUI

@MainActor
@Observable
final class SignInViewModel {
    enum Stage: Equatable { case phone, code }

    var stage: Stage = .phone
    var dialCode = "+852"
    var phoneNumber = ""
    var code = ""
    var isLoading = false
    var error: String?

    private let container: ServiceContainer

    init(container: ServiceContainer) { self.container = container }

    var fullPhone: String {
        dialCode + phoneNumber.filter(\.isNumber)
    }

    var canSendCode: Bool {
        // Deliberately loose: national numbering plans vary from 6 to 12 digits
        // and a strict client-side rule would lock out real users. The server
        // is the authority on whether a number is valid.
        phoneNumber.filter(\.isNumber).count >= 6 && !isLoading
    }

    var canVerify: Bool { code.filter(\.isNumber).count == 6 && !isLoading }

    func sendCode() async {
        isLoading = true
        error = nil
        defer { isLoading = false }
        do {
            try await container.api.otpStart(phone: fullPhone)
            stage = .code
        } catch {
            self.error = error.localizedDescription
        }
    }

    func verify() async {
        isLoading = true
        error = nil
        defer { isLoading = false }
        do {
            let token = try await container.api.otpCheck(phone: fullPhone, code: code)
            try await container.signIn(token: token)
        } catch {
            self.error = error.localizedDescription
            code = ""      // a rejected code is never worth resubmitting
        }
    }

    func startOver() {
        stage = .phone
        code = ""
        error = nil
    }
}

struct SignInView: View {
    @Environment(ServiceContainer.self) private var container
    @State private var model: SignInViewModel?
    @FocusState private var focused: Bool

    var body: some View {
        ZStack {
            GuardianColors.background.ignoresSafeArea()

            if let model {
                content(model)
            } else {
                ProgressView().tint(GuardianColors.primaryAccent)
            }
        }
        .onAppear {
            if model == nil { model = SignInViewModel(container: container) }
        }
    }

    @ViewBuilder
    private func content(_ model: SignInViewModel) -> some View {
        @Bindable var model = model

        VStack(spacing: 28) {
            Spacer()

            VStack(spacing: 10) {
                Image(systemName: "shield.lefthalf.filled")
                    .font(.system(size: 52, weight: .light))
                    .foregroundStyle(GuardianColors.primaryAccent)
                Text("FurlPay Guardian")
                    .font(.title2.weight(.semibold))
                    .foregroundStyle(GuardianColors.textPrimary)
                Text(model.stage == .phone
                     ? "Sign in with your phone number"
                     : "Enter the 6-digit code we sent to \(model.fullPhone)")
                    .font(.subheadline)
                    .foregroundStyle(GuardianColors.textSecondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
            }

            if model.stage == .phone {
                HStack(spacing: 10) {
                    TextField("+852", text: $model.dialCode)
                        .frame(width: 72)
                        .keyboardType(.phonePad)
                        .textFieldStyle(GuardianFieldStyle())

                    TextField("Phone number", text: $model.phoneNumber)
                        .keyboardType(.phonePad)
                        .textContentType(.telephoneNumber)
                        .focused($focused)
                        .textFieldStyle(GuardianFieldStyle())
                }
                .padding(.horizontal, 24)

                primaryButton("Send Verification Code", enabled: model.canSendCode, loading: model.isLoading) {
                    Task { await model.sendCode() }
                }
            } else {
                TextField("000000", text: $model.code)
                    .keyboardType(.numberPad)
                    .textContentType(.oneTimeCode)     // enables SMS autofill
                    .multilineTextAlignment(.center)
                    .font(.system(.title, design: .monospaced))
                    .focused($focused)
                    .textFieldStyle(GuardianFieldStyle())
                    .padding(.horizontal, 48)
                    .onChange(of: model.code) { _, new in
                        model.code = String(new.filter(\.isNumber).prefix(6))
                        if model.code.count == 6 { Task { await model.verify() } }
                    }

                primaryButton("Verify & Sign In", enabled: model.canVerify, loading: model.isLoading) {
                    Task { await model.verify() }
                }

                Button("Use a different number") { model.startOver() }
                    .font(.footnote)
                    .foregroundStyle(GuardianColors.textSecondary)
            }

            if let error = model.error {
                Text(error)
                    .font(.footnote)
                    .foregroundStyle(GuardianColors.negative)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
            }

            Spacer()
        }
        .animation(.easeInOut(duration: 0.2), value: model.stage)
        .onAppear { focused = true }
    }

    private func primaryButton(
        _ title: String, enabled: Bool, loading: Bool, action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            ZStack {
                if loading {
                    ProgressView().tint(.white)
                } else {
                    Text(title).font(.headline)
                }
            }
            .frame(maxWidth: .infinity)
            .frame(height: 52)
            .background(enabled ? GuardianColors.primaryAccent : GuardianColors.surfaceElevated)
            .foregroundStyle(enabled ? Color.white : GuardianColors.textTertiary)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
        .disabled(!enabled)
        .padding(.horizontal, 24)
    }
}

struct GuardianFieldStyle: TextFieldStyle {
    func _body(configuration: TextField<Self._Label>) -> some View {
        configuration
            .padding(.horizontal, 14)
            .frame(height: 52)
            .background(GuardianColors.surface)
            .foregroundStyle(GuardianColors.textPrimary)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}
