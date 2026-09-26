// Serialised, spaced delivery of realtime alerts.
//
// The realtime feed is bursty — a block lands and thirty whales resolve at
// once — so posts cannot be fired as they are found. Three rules, each of
// which exists because of something already learned the hard way in this repo:
//
//  1. ONE post at a time, spaced. Discord rate limits per channel, and the
//     price-cards job measured that 1.1s between writes to a shared channel
//     was not enough while 1.6s was. This uses 2s.
//
//  2. MARK ONLY AFTER Discord accepts. Marking first loses an alert whenever a
//     post fails: the row reads as delivered and is never retried. Marking
//     after can at worst repost one message if the process dies between the
//     write and the update, which is the failure worth having.
//
//  3. A BOUNDED queue that drops the SMALLEST. An unbounded queue during a
//     burst turns into an hour of stale alerts arriving after the fact. When
//     the queue is full the least significant item goes, and the drop is
//     counted so the digest can say it happened.

import { makeLogger } from "../util/logger.js";
import type { Publisher } from "../bot/publisher.js";
import type { EmbedBuilder } from "discord.js";

const log = makeLogger("btc-alerts");

export interface QueuedAlert {
  /** Sorting weight — larger is more significant, and survives eviction. */
  weight: number;
  embed: EmbedBuilder;
  /** Called only after Discord has accepted the message. */
  onDelivered: () => void;
  label: string;
}

export interface AlertQueueOptions {
  minGapMs?: number;
  maxQueued?: number;
}

export class AlertQueue {
  private queue: QueuedAlert[] = [];
  private draining = false;
  private lastPostAt = 0;
  private stopped = false;

  delivered = 0;
  failed = 0;
  dropped = 0;

  constructor(
    private readonly pub: Publisher,
    private readonly channelId: string,
    private readonly opts: AlertQueueOptions = {},
  ) {}

  private get minGap(): number {
    return this.opts.minGapMs ?? 2_000;
  }
  private get maxQueued(): number {
    return this.opts.maxQueued ?? 25;
  }

  /** Queue an alert, evicting the least significant one when full. */
  push(alert: QueuedAlert): void {
    if (this.stopped) return;
    this.queue.push(alert);
    if (this.queue.length > this.maxQueued) {
      // Sort so the smallest is at the end, then drop it. A 2,400 BTC alert
      // must never be evicted by a burst of 60 BTC ones.
      this.queue.sort((a, b) => b.weight - a.weight);
      const gone = this.queue.pop();
      this.dropped += 1;
      log.warn("alert dropped — queue full", {
        label: gone?.label,
        queued: this.queue.length,
        droppedTotal: this.dropped,
      });
    }
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.draining || this.stopped) return;
    this.draining = true;
    try {
      while (this.queue.length && !this.stopped) {
        // Most significant first: during a burst the big ones should land
        // before any spacing budget is spent on small ones.
        this.queue.sort((a, b) => b.weight - a.weight);
        const next = this.queue.shift()!;

        const since = Date.now() - this.lastPostAt;
        if (since < this.minGap) await sleep(this.minGap - since);

        try {
          await this.pub.send(this.channelId, [next.embed]);
          this.lastPostAt = Date.now();
          next.onDelivered();
          this.delivered += 1;
        } catch (err) {
          this.failed += 1;
          const msg = (err as Error).message.slice(0, 160);
          log.warn("alert failed", { label: next.label, err: msg });
          // Not requeued: a failing channel fails for the next one too, and a
          // retry loop here would spin against a 401 or a deleted channel. The
          // row stays unmarked, so the next tick picks it up.
          this.lastPostAt = Date.now();
          break;
        }
      }
    } finally {
      this.draining = false;
    }
  }

  /** Wait for the queue to empty, up to `timeoutMs`. */
  async flush(timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while ((this.queue.length || this.draining) && Date.now() < deadline) {
      await sleep(200);
    }
  }

  stop(): void {
    this.stopped = true;
  }

  get pending(): number {
    return this.queue.length;
  }

  stats(): { delivered: number; failed: number; dropped: number; pending: number } {
    return { delivered: this.delivered, failed: this.failed, dropped: this.dropped, pending: this.queue.length };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => {
    const t = setTimeout(res, ms);
    t.unref?.();
  });
}
