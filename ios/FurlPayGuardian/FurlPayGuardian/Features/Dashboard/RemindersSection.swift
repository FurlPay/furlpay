//
//  RemindersSection.swift
//
//  Port of RemindersSection.kt — the active reminder feed and the creation
//  sheet with its priority picker.
//

import SwiftUI

struct RemindersSection: View {
    @Environment(ServiceContainer.self) private var container
    @Binding var showNewReminder: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Reminders").sectionTitle()

            if container.events.active.isEmpty {
                Text("Nothing scheduled.")
                    .font(.subheadline)
                    .foregroundStyle(GuardianColors.textTertiary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(16)
                    .background(GuardianColors.surface)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            } else {
                VStack(spacing: 8) {
                    // Effective-priority order, not storage order: an imminent
                    // MEDIUM outranks a distant HIGH. See PrioritizeEvents.
                    ForEach(container.prioritisedEvents) { event in
                        ReminderRow(event: event) {
                            container.events.acknowledge(event.id)
                            Task { await container.alarms.cancel(event.id) }
                        }
                    }
                }
            }

            Button {
                showNewReminder = true
            } label: {
                Label("New Reminder", systemImage: "plus")
                    .font(.subheadline.weight(.medium))
                    .frame(maxWidth: .infinity)
                    .frame(height: 46)
                    .background(GuardianColors.surface)
                    .foregroundStyle(GuardianColors.primaryAccent)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
        }
    }
}

struct ReminderRow: View {
    let event: GuardianEvent
    let onAcknowledge: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            // Priority reads as a colour bar rather than a label: the list is
            // scanned, not read, and four words of text would slow that down.
            RoundedRectangle(cornerRadius: 2)
                .fill(colour)
                .frame(width: 3, height: 34)

            VStack(alignment: .leading, spacing: 2) {
                Text(event.title)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(GuardianColors.textPrimary)
                    .lineLimit(1)
                Text(event.startAt.relativeDescription)
                    .font(.caption)
                    .foregroundStyle(GuardianColors.textSecondary)
            }

            Spacer()

            Button(action: onAcknowledge) {
                Image(systemName: "checkmark.circle")
                    .foregroundStyle(GuardianColors.textTertiary)
            }
            .buttonStyle(.plain)
        }
        .padding(14)
        .background(GuardianColors.surface)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private var colour: Color {
        switch event.priority {
        case .low: GuardianColors.textTertiary
        case .medium: GuardianColors.primaryAccent
        case .high: GuardianColors.warning
        case .critical: GuardianColors.negative
        }
    }
}

struct NewReminderSheet: View {
    @Environment(ServiceContainer.self) private var container
    @Environment(\.dismiss) private var dismiss

    @State private var title = ""
    @State private var detail = ""
    @State private var startAt = Date().addingTimeInterval(3600)
    @State private var priority: EventPriority = .medium

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("What needs doing?", text: $title)
                    TextField("Details (optional)", text: $detail, axis: .vertical)
                        .lineLimit(2...4)
                }
                Section("When") {
                    DatePicker("Time", selection: $startAt, in: Date()...)
                }
                Section("Priority") {
                    Picker("Priority", selection: $priority) {
                        ForEach(EventPriority.allCases, id: \.self) { level in
                            Text(level.rawValue.capitalized).tag(level)
                        }
                    }
                    .pickerStyle(.segmented)

                    if priority == .critical {
                        // Said plainly rather than discovered: the ladder's last
                        // stage asks to pierce Do Not Disturb, and that only
                        // works with Apple's Critical Alerts entitlement.
                        Text("Critical reminders try to bypass Do Not Disturb. This needs Apple's Critical Alerts entitlement — without it they behave as time-sensitive.")
                            .font(.caption)
                            .foregroundStyle(GuardianColors.textSecondary)
                    }
                }
            }
            .navigationTitle("New Reminder")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add") { add() }
                        .disabled(title.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
        .preferredColorScheme(.dark)
    }

    private func add() {
        let event = GuardianEvent(
            source: .user,
            title: title.trimmingCharacters(in: .whitespaces),
            detail: detail.isEmpty ? nil : detail,
            startAt: startAt,
            priority: priority
        )
        container.events.add(event)
        Task {
            // Asked HERE rather than at launch. A permission that can override
            // Silent mode should be requested at the moment the user asks for
            // something that needs it — at launch it reads as a shakedown and
            // gets denied, and a denied alarm permission is permanent.
            if priority == .critical || priority == .high {
                await container.alarms.requestAlarmAuthorization()
            }
            await container.alarms.schedule(event)
            await container.sync.pushAllSnapshots(from: container)
        }
        dismiss()
    }
}
