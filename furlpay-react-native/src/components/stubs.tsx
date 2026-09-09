import React from 'react';
import { View, Text } from 'react-native';

export const QRScanner: React.FC<any> = () => {
  return (
    <View style={{ padding: 20, backgroundColor: '#eee', alignItems: 'center' }}>
      <Text>QR Scanner (Camera stub)</Text>
    </View>
  );
};

export const QRDisplay: React.FC<any> = ({ paymentUrl }) => {
  return (
    <View style={{ padding: 20, backgroundColor: '#eee', alignItems: 'center' }}>
      <Text>QR Display for: {paymentUrl}</Text>
    </View>
  );
};

export const BalanceDisplay: React.FC<any> = ({ showTokens }) => {
  return (
    <View style={{ padding: 10 }}>
      <Text>Balance: 42.0 USDC</Text>
    </View>
  );
};
