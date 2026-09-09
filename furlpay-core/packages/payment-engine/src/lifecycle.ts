import { PaymentStatus } from '@furlpay/shared';
export class TransactionLifecycleManager {
  private state: PaymentStatus = PaymentStatus.CREATED;
  transition(newState: PaymentStatus) { this.state = newState; }
  getState() { return this.state; }
}
