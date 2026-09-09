import { describe, it, expect } from 'vitest';
import { TravelRuleHandler } from '../src/travel-rule';

describe('TravelRuleHandler', () => {
  const handler = new TravelRuleHandler();

  it('should require travel rule data for amounts >= $3000', () => {
    expect(handler.isRequired(3000)).toBe(true);
    expect(handler.isRequired(3500)).toBe(true);
    expect(handler.isRequired(2999)).toBe(false);
  });

  it('should validate complete travel rule data', () => {
    const data = handler.buildTravelRuleData(
      { name: 'John Doe', accountNumber: '123', physicalAddress: '123 Main St' },
      { name: 'Jane Smith', accountNumber: '456' },
      3000
    );
    const result = handler.validate(data);
    expect(result.valid).toBe(true);
    expect(result.errors.length).toBe(0);
  });

  it('should reject incomplete travel rule data', () => {
    const data = handler.buildTravelRuleData(
      { name: 'John Doe', accountNumber: '123' },
      { name: 'Jane Smith', accountNumber: '456' },
      3000
    );
    const result = handler.validate(data);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Originator physical address or national ID is required for Travel Rule compliance');
  });
});
