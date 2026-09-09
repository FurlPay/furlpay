import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import BalanceCard from '../components/BalanceCard';
import TransactionItem from '../components/TransactionItem';

export default function HomeScreen({ navigation }: any) {
  return (
    <ScrollView style={styles.container}>
      <BalanceCard />
      
      <View style={styles.actions}>
        <TouchableOpacity style={styles.button} onPress={() => navigation.navigate('Scan')}>
          <Text style={styles.buttonText}>Scan QR to Pay</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.recentSection}>
        <Text style={styles.recentTitle}>Recent Transactions</Text>
        <TransactionItem 
            type="send" amount="25.00 USDC" status="Finalized" time="2 hours ago" />
        <TransactionItem 
            type="receive" amount="1.5 SOL" status="Confirmed" time="Yesterday" />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  actions: { padding: 16 },
  button: { backgroundColor: '#10B981', padding: 16, rounded: 8, alignItems: 'center', borderRadius: 8 },
  buttonText: { color: 'white', fontWeight: 'bold', fontSize: 16 },
  recentSection: { padding: 16 },
  recentTitle: { fontSize: 18, fontWeight: '600', marginBottom: 12 }
});
