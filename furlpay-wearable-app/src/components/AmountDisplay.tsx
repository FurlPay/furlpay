import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export default function AmountDisplay({ amount, currency }: { amount: number, currency: string }) {
  return (
    <View style={styles.container}>
      <Text style={styles.amount}>${amount.toFixed(2)}</Text>
      <Text style={styles.currency}>{currency}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
  },
  amount: {
    color: 'white',
    fontSize: 48,
    fontWeight: 'bold',
  },
  currency: {
    color: '#8E8E93',
    fontSize: 18,
    marginTop: 5,
  }
});
