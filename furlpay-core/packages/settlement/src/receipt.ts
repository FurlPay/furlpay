export class SettlementReceiptGenerator {
  generate(payment: any, finality: any): any {
    return {
      txSignature: 'sig', slot: 0, blockHash: 'hash', confirmationTimeMs: 100, finalityTimeMs: 150, finalityType: 'ALPENGLOW',
      paymentId: payment.id, amount: payment.amount, currency: payment.currency, payer: payment.payer, payee: payment.payee, timestamp: Date.now()
    };
  }
}
