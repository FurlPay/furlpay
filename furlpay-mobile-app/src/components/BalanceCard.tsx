import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export default function BalanceCard() {
  return (
    <View style={styles.card}>
      <Text style={styles.label}>Total Balance</Text>
      <Text style={styles.total}>$1,245.50</Text>
      
      <View style={styles.assets}>
        <View style={styles.assetRow}>
            <Text style={styles.assetName}>USDC</Text>
            <Text style={styles.assetValue}>1,000.00</Text>
        </View>
        <View style={styles.assetRow}>
            <Text style={styles.assetName}>SOL</Text>
            <Text style={styles.assetValue}>1.5</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#10B981', margin: 16, padding: 24, borderRadius: 16, shadowColor: '#10B981', shadowOpacity: 0.3, shadowRadius: 10, elevation: 5 },
  label: { color: '#D1FAE5', fontSize: 14, marginBottom: 4 },
  total: { color: 'white', fontSize: 36, fontWeight: 'bold', marginBottom: 24 },
  assets: { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.2)', paddingTop: 16 },
  assetRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  assetName: { color: 'white', fontWeight: '500' },
  assetValue: { color: 'white', fontFamily: 'monospace' }
});
