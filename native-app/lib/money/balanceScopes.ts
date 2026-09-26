export type AuthHold = {
  id: string;
  amount: bigint;
  merchantName: string;
  expiresAt: number;
  status: 'pending' | 'settled' | 'released';
};

export type ScopedBalance = {
  total: bigint;
  available: bigint;
  blocked: bigint;
  pending: bigint;
  forPayment: bigint;
  forWithdrawal: bigint;
  debt: bigint;
};

export function decompose(rawBalance: bigint, authorizationHolds: AuthHold[]): ScopedBalance {
  let pending = 0n;
  for (const hold of authorizationHolds) {
    if (hold.status === 'pending') {
      pending += hold.amount;
    }
  }

  // Assuming total is just rawBalance + any debt (if balance is negative)
  const total = rawBalance;
  
  // Available is total - pending holds (blocked is not explicitly defined in requirements without inputs, assuming 0n)
  let blocked = 0n;
  let debt = 0n;

  if (total < 0n) {
    debt = -total;
  }

  const available = total > pending ? total - pending : 0n;
  
  // forPayment allows spending available funds
  const forPayment = available;

  // forWithdrawal might be same as available in simple model
  const forWithdrawal = available;

  return {
    total,
    available,
    blocked,
    pending,
    forPayment,
    forWithdrawal,
    debt
  };
}

export function canAfford(scope: ScopedBalance, amount: bigint, purpose: 'payment' | 'withdrawal'): boolean {
  if (purpose === 'payment') {
    return scope.forPayment >= amount;
  }
  if (purpose === 'withdrawal') {
    return scope.forWithdrawal >= amount;
  }
  return false;
}
