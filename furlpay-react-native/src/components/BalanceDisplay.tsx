import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface BalanceDisplayProps {
  balance: number;
  symbol?: string;
}

export const BalanceDisplay: React.FC<BalanceDisplayProps> = ({ balance, symbol = 'SOL' }) => {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>{balance.toFixed(4)} {symbol}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 10,
    backgroundColor: '#eee',
    borderRadius: 8,
  },
  text: {
    fontWeight: 'bold',
  }
});
