import { FURLPAY_NFC_AID } from './protocol';

/**
 * Host Card Emulation (HCE) basic stub for raw APDU processing.
 */
export class HceProcessor {
  // ISO 7816-4 APDU commands
  private readonly INS_SELECT = 0xA4;
  private readonly INS_GET_DATA = 0xCA;
  private readonly INS_PROCESS_PAYMENT = 0xD0;

  public processApdu(command: Uint8Array): Uint8Array {
    if (command.length < 4) return this.error(0x67, 0x00); // Wrong length
    
    const cla = command[0];
    const ins = command[1];
    const p1 = command[2];
    const p2 = command[3];
    
    if (ins === this.INS_SELECT) {
      return this.handleSelect(command);
    } else if (ins === this.INS_GET_DATA) {
      return this.handleGetData(command);
    } else if (ins === this.INS_PROCESS_PAYMENT) {
      return this.handleProcessPayment(command);
    }
    
    return this.error(0x6D, 0x00); // Instruction code not supported
  }

  private handleSelect(command: Uint8Array): Uint8Array {
    // Simplified AID check
    const lc = command[4];
    const data = command.slice(5, 5 + lc);
    // Real implementation would verify the AID matches FURLPAY_NFC_AID
    return this.success(new Uint8Array(0));
  }
  
  private handleGetData(command: Uint8Array): Uint8Array {
    // Return requested payment data
    return this.success(new Uint8Array([0x01, 0x02, 0x03]));
  }

  private handleProcessPayment(command: Uint8Array): Uint8Array {
    // Process signature/transaction
    return this.success(new Uint8Array([0x90, 0x00]));
  }

  private success(data: Uint8Array): Uint8Array {
    const res = new Uint8Array(data.length + 2);
    res.set(data);
    res[data.length] = 0x90; // SW1
    res[data.length + 1] = 0x00; // SW2
    return res;
  }
  
  private error(sw1: number, sw2: number): Uint8Array {
    return new Uint8Array([sw1, sw2]);
  }
}
