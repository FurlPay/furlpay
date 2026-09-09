import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';

interface Props {
    details: { recipient: string, amount: string, currency: string, merchantName: string };
    onConfirm: () => void;
    onCancel: () => void;
}

export default function PaymentConfirmation({ details, onConfirm, onCancel }: Props) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Confirm Payment</Text>
      
      <View style={styles.card}>
        <Text style={styles.merchant}>{details.merchantName}</Text>
        <Text style={styles.amount}>{details.amount} {details.currency}</Text>
        <Text style={styles.recipient}>To: {details.recipient}</Text>
      </View>

      <TouchableOpacity style={styles.confirmButton} onPress={onConfirm}>
        <Text style={styles.confirmText}>Sign & Confirm Payment</Text>
      </TouchableOpacity>
      
      <TouchableOpacity style={styles.cancelButton} onPress={onCancel}>
        <Text style={styles.cancelText}>Cancel</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: 'white', padding: 24, borderRadius: 16, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 10, elevation: 4 },
  title: { fontSize: 20, fontWeight: 'bold', textAlign: 'center', marginBottom: 24 },
  card: { alignItems: 'center', marginBottom: 32 },
  merchant: { fontSize: 16, color: '#6B7280', marginBottom: 8 },
  amount: { fontSize: 36, fontWeight: 'bold', color: '#10B981', marginBottom: 8 },
  recipient: { fontSize: 12, color: '#9CA3AF', fontFamily: 'monospace' },
  confirmButton: { backgroundColor: '#10B981', padding: 16, borderRadius: 8, alignItems: 'center', marginBottom: 12 },
  confirmText: { color: 'white', fontWeight: 'bold', fontSize: 16 },
  cancelButton: { padding: 16, alignItems: 'center' },
  cancelText: { color: '#6B7280', fontWeight: '500' }
});
