//
//  SupportView.swift
//
//  Ports of native-app/app/support/index.tsx and support/[id].tsx.
//
//  Ticket creation goes through the action registry (`create_support_ticket`)
//  like every other server-mutating action, so there is one path and one set of
//  validation rules rather than a second, laxer one for "just support".
//

import SwiftUI

struct SupportView: View {
    @Environment(ServiceContainer.self) private var container

    @State private var tickets: [SupportTicket] = []
    @State private var loading = false
    @State private var composing = false

    var body: some View {
        List {
            Section {
                Text("Most questions are answered in the help centre. Open a ticket if you need a person.")
                    .font(.caption)
                    .foregroundStyle(GuardianColors.textSecondary)
                Link("Help centre", destination: URL(string: "https://furlpay.com/docs/help")!)
            }
            .listRowBackground(GuardianColors.surface)

            if tickets.isEmpty && !loading {
                Section {
                    Text("No tickets yet.").foregroundStyle(GuardianColors.textSecondary)
                }
                .listRowBackground(GuardianColors.surface)
            } else {
                Section("Your tickets") {
                    ForEach(tickets) { ticket in
                        NavigationLink { SupportThreadView(ticket: ticket) } label: {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(ticket.subject)
                                    .font(.subheadline)
                                    .foregroundStyle(GuardianColors.textPrimary)
                                    .lineLimit(1)
                                HStack(spacing: 6) {
                                    Text(ticket.status.capitalized)
                                        .foregroundStyle(statusTint(ticket.status))
                                    if let updated = ticket.updatedAt {
                                        Text("· \(updated.relativeDescription)")
                                    }
                                }
                                .font(.caption2)
                                .foregroundStyle(GuardianColors.textTertiary)
                            }
                        }
                    }
                }
                .listRowBackground(GuardianColors.surface)
            }

            Section {
                Button("New ticket") { composing = true }
            }
            .listRowBackground(GuardianColors.surface)
        }
        .scrollContentBackground(.hidden)
        .background(GuardianColors.background.ignoresSafeArea())
        .navigationTitle("Support")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable { await load() }
        .sheet(isPresented: $composing) {
            NewTicketSheet { await load() }
        }
    }

    private func statusTint(_ status: String) -> Color {
        switch status.lowercased() {
        case "open", "pending":   GuardianColors.warning
        case "resolved", "closed": GuardianColors.positive
        default:                   GuardianColors.textTertiary
        }
    }

    private func load() async {
        loading = true
        tickets = (try? await container.api.fetchSupportTickets()) ?? []
        loading = false
    }
}

struct SupportThreadView: View {
    @Environment(ServiceContainer.self) private var container
    let ticket: SupportTicket

    @State private var messages: [SupportMessage] = []
    @State private var reply = ""
    @State private var sending = false

    var body: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 10) {
                        ForEach(messages) { message in
                            MessageBubble(message: message).id(message.id)
                        }
                    }
                    .padding(16)
                }
                .onChange(of: messages.count) { _, _ in
                    // Land on the newest message rather than the top of a long
                    // thread — the reason someone opens a ticket is the reply.
                    withAnimation { proxy.scrollTo(messages.last?.id, anchor: .bottom) }
                }
            }

            HStack(spacing: 10) {
                TextField("Reply", text: $reply, axis: .vertical)
                    .lineLimit(1...4)
                    .padding(10)
                    .background(GuardianColors.surfaceElevated)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                Button {
                    send()
                } label: {
                    Image(systemName: "arrow.up.circle.fill").font(.title2)
                }
                .disabled(reply.trimmingCharacters(in: .whitespaces).isEmpty || sending)
                .foregroundStyle(GuardianColors.primaryAccent)
            }
            .padding(12)
            .background(GuardianColors.surface)
        }
        .background(GuardianColors.background.ignoresSafeArea())
        .navigationTitle(ticket.subject)
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func load() async {
        messages = (try? await container.api.fetchSupportMessages(ticketId: ticket.id)) ?? []
    }

    private func send() {
        let body = reply.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty else { return }
        sending = true
        Task {
            try? await container.api.replyToSupportTicket(ticketId: ticket.id, body: body)
            reply = ""
            await load()
            sending = false
        }
    }
}

struct MessageBubble: View {
    let message: SupportMessage

    private var fromUser: Bool { message.author.lowercased() == "user" }

    var body: some View {
        HStack {
            if fromUser { Spacer(minLength: 40) }
            VStack(alignment: fromUser ? .trailing : .leading, spacing: 3) {
                Text(message.body)
                    .font(.subheadline)
                    .foregroundStyle(fromUser ? .white : GuardianColors.textPrimary)
                if let at = message.createdAt {
                    Text(at.shortTime)
                        .font(.caption2)
                        .foregroundStyle(fromUser ? .white.opacity(0.7) : GuardianColors.textTertiary)
                }
            }
            .padding(12)
            .background(fromUser ? GuardianColors.primaryAccent : GuardianColors.surface)
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            if !fromUser { Spacer(minLength: 40) }
        }
    }
}

struct NewTicketSheet: View {
    @Environment(ServiceContainer.self) private var container
    @Environment(\.dismiss) private var dismiss
    let onCreated: () async -> Void

    /// Must match TICKET_CATEGORIES in apps/web/src/lib/support.ts — the route's
    /// Zod enum rejects anything else, and the registry rejects it before that.
    private static let categories = [
        "stablecoins", "cards", "kyc", "travel", "developers", "other",
    ]

    @State private var category = "other"
    @State private var subject = ""
    /// NOT `body`. A `@State private var body` sits alongside `var body: some
    /// View` in the same type, which is an invalid redeclaration and does not
    /// compile — one of several things that survived here because no Swift
    /// toolchain has ever run over this target from a Windows checkout.
    @State private var message = ""
    @State private var working = false
    @State private var error: String?

    /// The server's own minimums: subject 4–120, body 10–5000. Enforced here so
    /// the Send button is honest rather than letting the request 400.
    private var isValid: Bool {
        let s = subject.trimmingCharacters(in: .whitespacesAndNewlines)
        let m = message.trimmingCharacters(in: .whitespacesAndNewlines)
        return (4...120).contains(s.count) && (10...5000).contains(m.count)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Category") {
                    Picker("Category", selection: $category) {
                        ForEach(Self.categories, id: \.self) { Text($0.capitalized).tag($0) }
                    }
                }
                .listRowBackground(GuardianColors.surface)
                Section("Subject") { TextField("What's this about?", text: $subject) }
                    .listRowBackground(GuardianColors.surface)
                Section {
                    TextField("Tell us what happened", text: $message, axis: .vertical)
                        .lineLimit(4...12)
                } header: {
                    Text("Message")
                } footer: {
                    Text("At least 10 characters.")
                }
                .listRowBackground(GuardianColors.surface)
                if let error {
                    Section { Text(error).font(.footnote).foregroundStyle(GuardianColors.negative) }
                        .listRowBackground(GuardianColors.surface)
                }
            }
            .scrollContentBackground(.hidden)
            .background(GuardianColors.background.ignoresSafeArea())
            .navigationTitle("New ticket")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Send") { submit() }
                        .disabled(!isValid || working)
                }
            }
        }
        .preferredColorScheme(.dark)
    }

    private func submit() {
        working = true
        Task {
            // Through the registry, like every other server-mutating action.
            let rejection = await container.confirmAndDispatch(Confirmation(
                action: "create_support_ticket",
                endpoint: "/support/tickets",
                method: "POST",
                body: [
                    "category": .string(category),
                    "subject": .string(subject.trimmingCharacters(in: .whitespacesAndNewlines)),
                    "body": .string(message.trimmingCharacters(in: .whitespacesAndNewlines)),
                ],
                summary: "Open a support ticket",
                amountUsd: nil
            ))
            working = false
            if let rejection {
                error = rejection
            } else {
                await onCreated()
                dismiss()
            }
        }
    }
}
