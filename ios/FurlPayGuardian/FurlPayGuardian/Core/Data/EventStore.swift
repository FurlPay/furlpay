//
//  EventStore.swift
//
//  Port of GuardianDatabase.kt + RoomEventRepository.kt onto SwiftData.
//
//  The first pass persisted events in App-Group UserDefaults — a whole array
//  encoded and rewritten on every acknowledge. That is fine for ten reminders
//  and quietly terrible for a thousand: every mutation rewrites every row, and
//  there is no way to query without loading the lot.
//
//  SwiftData gives what Room gave the Android build: per-row writes, indexed
//  queries, and a schema that migrates. The App Group container is kept so the
//  complications can still read without waking the app.
//
//  MIGRATION IS ONE-WAY AND AUTOMATIC. On first launch with this build, any
//  events sitting in UserDefaults are imported and the old key deleted. A user
//  upgrading does not lose their reminders, and a downgrade is not supported —
//  which is the normal expectation for a store change.
//

import Foundation
import SwiftData

// MARK: - Model

@Model
public final class StoredEvent {
    /// The domain id, not SwiftData's. `.unique` makes upsert actually upsert
    /// rather than accumulating duplicates on every sync.
    @Attribute(.unique) public var id: String

    public var sourceRaw: String
    public var title: String
    public var detail: String?
    public var startAt: Date
    /// Stored as Int so `#Predicate` can compare and sort on it directly — a
    /// String enum would force every comparison into memory.
    public var priorityRank: Int
    public var actionUrl: String?
    public var acknowledged: Bool

    public init(from event: GuardianEvent) {
        id = event.id
        sourceRaw = event.source.rawValue
        title = event.title
        detail = event.detail
        startAt = event.startAt
        priorityRank = event.priority.rank
        actionUrl = event.actionUrl
        acknowledged = event.acknowledged
    }

    public func update(from event: GuardianEvent) {
        sourceRaw = event.source.rawValue
        title = event.title
        detail = event.detail
        startAt = event.startAt
        priorityRank = event.priority.rank
        actionUrl = event.actionUrl
        acknowledged = event.acknowledged
    }

    public var domain: GuardianEvent {
        GuardianEvent(
            id: id,
            source: EventSource(rawValue: sourceRaw) ?? .system,
            title: title,
            detail: detail,
            startAt: startAt,
            priority: EventPriority.allCases.first { $0.rank == priorityRank } ?? .medium,
            actionUrl: actionUrl,
            acknowledged: acknowledged
        )
    }
}

// MARK: - Store

@MainActor
public final class EventStore {

    public static let shared = EventStore()

    private let container: ModelContainer?
    private var context: ModelContext? { container?.mainContext }

    /// In-memory init for tests, so a test run never touches the real store.
    init(inMemory: Bool = false) {
        let configuration = ModelConfiguration(
            isStoredInMemoryOnly: inMemory,
            // Same App Group as the snapshot cache, so a future widget could
            // query events directly rather than waiting for a push.
            groupContainer: inMemory ? .none : .identifier(SnapshotCache.appGroup)
        )
        container = try? ModelContainer(for: StoredEvent.self, configurations: configuration)
    }

    // MARK: Reads

    public func all() -> [GuardianEvent] {
        guard let context else { return [] }
        let descriptor = FetchDescriptor<StoredEvent>(
            sortBy: [SortDescriptor(\.startAt, order: .forward)]
        )
        return ((try? context.fetch(descriptor)) ?? []).map(\.domain)
    }

    /// Unacknowledged only, pushed into the query rather than filtered after —
    /// the reason for moving off UserDefaults in the first place.
    public func active() -> [GuardianEvent] {
        guard let context else { return [] }
        var descriptor = FetchDescriptor<StoredEvent>(
            predicate: #Predicate { !$0.acknowledged },
            sortBy: [SortDescriptor(\.startAt, order: .forward)]
        )
        descriptor.fetchLimit = 500
        return ((try? context.fetch(descriptor)) ?? []).map(\.domain)
    }

    // MARK: Writes

    public func upsert(_ events: [GuardianEvent]) {
        guard let context else { return }
        for event in events {
            let id = event.id
            let descriptor = FetchDescriptor<StoredEvent>(
                predicate: #Predicate { $0.id == id }
            )
            if let existing = try? context.fetch(descriptor).first {
                existing.update(from: event)
            } else {
                context.insert(StoredEvent(from: event))
            }
        }
        try? context.save()
    }

    public func acknowledge(_ id: String) {
        guard let context else { return }
        let descriptor = FetchDescriptor<StoredEvent>(predicate: #Predicate { $0.id == id })
        guard let stored = try? context.fetch(descriptor).first else { return }
        stored.acknowledged = true
        try? context.save()
    }

    public func remove(_ id: String) {
        guard let context else { return }
        let descriptor = FetchDescriptor<StoredEvent>(predicate: #Predicate { $0.id == id })
        guard let stored = try? context.fetch(descriptor).first else { return }
        context.delete(stored)
        try? context.save()
    }

    /// Drops acknowledged events older than the cutoff. Called on refresh —
    /// unbounded history is the failure mode a local store invites.
    public func prune(olderThan cutoff: Date = Date().addingTimeInterval(-30 * 24 * 3600)) {
        guard let context else { return }
        let descriptor = FetchDescriptor<StoredEvent>(
            predicate: #Predicate { $0.acknowledged && $0.startAt < cutoff }
        )
        for stale in (try? context.fetch(descriptor)) ?? [] {
            context.delete(stale)
        }
        try? context.save()
    }

    // MARK: One-way migration

    private static let legacyKey = "guardian.events"

    /// Imports the old UserDefaults array once, then deletes it. Idempotent:
    /// after the key is gone this does nothing.
    public func migrateLegacyStoreIfNeeded() {
        let defaults = UserDefaults(suiteName: SnapshotCache.appGroup) ?? .standard
        guard let data = defaults.data(forKey: Self.legacyKey) else { return }
        if let events = try? JSONDecoder().decode([GuardianEvent].self, from: data) {
            upsert(events)
        }
        // Removed even if decoding failed. A blob we cannot read will not
        // become readable later, and leaving it means retrying every launch.
        defaults.removeObject(forKey: Self.legacyKey)
    }
}
