export class PaymentMetadata {
  static encode(data: any): string { return JSON.stringify(data); }
  static decode(memo: string): any { return JSON.parse(memo); }
}
