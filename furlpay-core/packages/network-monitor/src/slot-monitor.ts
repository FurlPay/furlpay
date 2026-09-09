import { Connection, EpochInfo } from '@solana/web3.js';
import { EventEmitter } from 'events';

export class SlotMonitor extends EventEmitter {
    private connection: Connection;
    private subscriptionId: number | null = null;
    private lastSlot: number = 0;
    private lastSlotTime: number = Date.now();
    private currentSlotTimeMs: number = 400; // Expected slot time 400ms

    constructor(connection: Connection) {
        super();
        this.connection = connection;
    }

    public start() {
        if (this.subscriptionId !== null) return;
        this.subscriptionId = this.connection.onSlotChange((slotInfo) => {
            const now = Date.now();
            this.currentSlotTimeMs = now - this.lastSlotTime;
            this.lastSlot = slotInfo.slot;
            this.lastSlotTime = now;
            this.emit('slot-change', slotInfo);
        });
    }

    public stop() {
        if (this.subscriptionId !== null) {
            this.connection.removeSlotChangeListener(this.subscriptionId);
            this.subscriptionId = null;
        }
    }

    public async getCurrentSlot(): Promise<number> {
        if (this.lastSlot > 0) return this.lastSlot;
        this.lastSlot = await this.connection.getSlot();
        this.lastSlotTime = Date.now();
        return this.lastSlot;
    }

    public async getSlotTime(): Promise<number> {
        return this.currentSlotTimeMs;
    }

    public isProducing(): boolean {
        return (Date.now() - this.lastSlotTime) < 5000; // If slot time is older than 5s, not producing
    }

    public onSlotChange(callback: (slotInfo: any) => void) {
        this.on('slot-change', callback);
    }

    public async getEpochInfo(): Promise<EpochInfo> {
        return await this.connection.getEpochInfo();
    }
}
