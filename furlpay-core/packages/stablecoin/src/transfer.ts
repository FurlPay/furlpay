import { Connection, PublicKey, Transaction, SystemProgram } from '@solana/web3.js';
import { getAssociatedTokenAddress, createTransferInstruction } from '@solana/spl-token';
import { TransferParams } from './types';
import { SUPPORTED_STABLECOINS, getDecimals } from './tokens';

export class StablecoinTransfer {
  constructor(private connection: Connection) {}

  async buildTransfer(params: TransferParams): Promise<Transaction> {
    const decimals = getDecimals(params.mint);
    const amountInSmallestUnits = Math.floor(params.amount * Math.pow(10, decimals));

    const senderAta = await getAssociatedTokenAddress(params.mint, params.sender);
    const recipientAta = await getAssociatedTokenAddress(params.mint, params.recipient);

    const instruction = createTransferInstruction(
      senderAta,
      recipientAta,
      params.sender,
      amountInSmallestUnits
    );

    const tx = new Transaction().add(instruction);
    const { blockhash } = await this.connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = params.sender;
    return tx;
  }

  async buildSolTransfer(params: { sender: PublicKey; recipient: PublicKey; amount: number }): Promise<Transaction> {
    const lamports = Math.floor(params.amount * 1e9);
    const instruction = SystemProgram.transfer({
      fromPubkey: params.sender,
      toPubkey: params.recipient,
      lamports,
    });

    const tx = new Transaction().add(instruction);
    const { blockhash } = await this.connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = params.sender;
    return tx;
  }

  async getBalance(owner: PublicKey, mint: PublicKey): Promise<number> {
    try {
      const ata = await getAssociatedTokenAddress(mint, owner);
      const balance = await this.connection.getTokenAccountBalance(ata);
      return balance.value.uiAmount ?? 0;
    } catch (e) {
      return 0;
    }
  }

  async getAllBalances(owner: PublicKey): Promise<Map<string, number>> {
    const balances = new Map<string, number>();
    for (const [symbol, coin] of SUPPORTED_STABLECOINS.entries()) {
      const bal = await this.getBalance(owner, coin.mint);
      balances.set(symbol, bal);
    }
    return balances;
  }
}
