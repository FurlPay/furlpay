import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { PayButton } from '../src/components/PayButton';

describe('PayButton', () => {
  it('renders correctly', () => {
    render(<PayButton amount={100} currency="USDC" merchantId="m1" />);
    expect(screen.getByText('Pay Now')).toBeDefined();
  });
});
