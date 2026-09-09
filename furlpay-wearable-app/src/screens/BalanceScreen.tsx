import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';

export default function BalanceScreen({ navigation }: any) {
  return (
    <View style={styles.container}>
      <Text style={styles.label}>Available Balance</Text>
      <Text style={styles.balance}>$1,240.50</Text>
      <Text style={styles.currency}>USDC</Text>
      
      <TouchableOpacity 
        style={styles.payButton}
        onPress={() => navigation.navigate('Pay')}
      >
        <Text style={styles.payButtonText}>Pay Now</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  label: {
    color: '#8E8E93',
    fontSize: 14,
    marginBottom: 5,
  },
  balance: {
    color: 'white',
    fontSize: 40,
    fontWeight: 'bold',
  },
  currency: {
    color: '#007AFF',
    fontSize: 16,
    marginTop: 5,
  },
  payButton: {
    marginTop: 30,
    backgroundColor: '#34C759',
    paddingVertical: 12,
    paddingHorizontal: 30,
    borderRadius: 20,
  },
  payButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  }
});
