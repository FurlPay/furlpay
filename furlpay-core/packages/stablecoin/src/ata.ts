import { Connection, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import { AtaResult } from './types';

export class AtaManager {
  async getOrCreateAta(connection: Connection, payer: PublicKey, mint: PublicKey, owner: PublicKey): Promise<AtaResult> {
    const ata = await getAssociatedTokenAddress(mint, owner);
    const exists = await this.doesAtaExist(connection, ata);
    
    if (exists) {
      return { address: ata, created: false };
    }

    return { address: ata, created: true };
  }

  getAta(owner: PublicKey, mint: PublicKey): PublicKey {
    const SPL_ASSOCIATED_TOKEN_ACCOUNT_PROGRAM_ID = new PublicKey(
      'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'
    );
    const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
    const [address] = PublicKey.findProgramAddressSync(
      [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
      SPL_ASSOCIATED_TOKEN_ACCOUNT_PROGRAM_ID
    );
    return address;
  }

  async doesAtaExist(connection: Connection, ata: PublicKey): Promise<boolean> {
    try {
      const info = await connection.getAccountInfo(ata);
      return info !== null;
    } catch (e) {
      return false;
    }
  }

  async estimateAtaRent(connection: Connection): Promise<number> {
    return connection.getMinimumBalanceForRentExemption(165);
  }
}
