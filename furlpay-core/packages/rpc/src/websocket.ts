import { Connection, PublicKey, LogsFilter } from '@solana/web3.js';

export class WebSocketManager {
    private connection: Connection;
    private subscriptions: Map<number, boolean> = new Map();

    constructor(connection: Connection) {
        this.connection = connection;
    }

    public subscribeSignature(signature: string, callback: (result: any, context: any) => void): number {
        const id = this.connection.onSignature(signature, callback);
        this.subscriptions.set(id, true);
        return id;
    }

    public subscribeAccount(pubkey: PublicKey, callback: (accountInfo: any, context: any) => void): number {
        const id = this.connection.onAccountChange(pubkey, callback);
        this.subscriptions.set(id, true);
        return id;
    }

    public subscribeLogs(filter: LogsFilter, callback: (logs: any, context: any) => void): number {
        const id = this.connection.onLogs(filter, callback);
        this.subscriptions.set(id, true);
        return id;
    }

    public unsubscribeAll() {
        for (const [id] of this.subscriptions) {
            this.connection.removeSignatureListener(id); // Using appropriate remove method generically
        }
        this.subscriptions.clear();
    }

    public reconnect() {
        // Typically handled by underlying connection in modern web3.js, but useful wrapper
        console.warn('Reconnect requested');
    }

    public getActiveSubscriptions(): number {
        return this.subscriptions.size;
    }
}
