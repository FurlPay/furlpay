import { TravelRuleData } from './types';

export class TravelRuleHandler {
  isRequired(amountUsd: number): boolean {
    return amountUsd >= 3000;
  }

  buildTravelRuleData(originator: any, beneficiary: any, amount: number, currency: string = 'USD'): TravelRuleData {
    return {
      originator: {
        name: originator.name,
        accountNumber: originator.accountNumber,
        physicalAddress: originator.physicalAddress,
        nationalId: originator.nationalId,
      },
      beneficiary: {
        name: beneficiary.name,
        accountNumber: beneficiary.accountNumber,
      },
      amount,
      currency,
    };
  }

  validate(data: TravelRuleData): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    if (!data.originator.name) errors.push('Originator name is required');
    if (!data.originator.accountNumber) errors.push('Originator account number is required');
    if (!data.originator.physicalAddress && !data.originator.nationalId) {
      errors.push('Originator physical address or national ID is required for Travel Rule compliance');
    }
    
    if (!data.beneficiary.name) errors.push('Beneficiary name is required');
    if (!data.beneficiary.accountNumber) errors.push('Beneficiary account number is required');

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}
