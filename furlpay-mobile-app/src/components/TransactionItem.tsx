import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import SpeedBadge from './SpeedBadge';

interface Props {
    type: 'send' | 'receive';
    amount: string;
    status: 'Pending' | 'Confirmed' | 'Finalized';
    time: string;
}

export default function TransactionItem({ type, amount, status, time }: Props) {
  return (
    <View style={styles.container}>
      <View style={styles.iconContainer}>
        <Text>{type === 'send' ? '↗️' : '↙️'}</Text>
      </View>
      <View style={styles.details}>
        <Text style={styles.amount}>{amount}</Text>
        <Text style={styles.time}>{time}</Text>
      </View>
      <View style={styles.statusContainer}>
        <Text style={styles.status(status)}>{status === 'Finalized' ? '🔒' : '✅'} {status}</Text>
        {status === 'Confirmed' && <SpeedBadge ms={420} />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flexDirection: 'row', backgroundColor: 'white', padding: 16, borderRadius: 8, marginBottom: 8, alignItems: 'center' },
  iconContainer: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#F3F4F6', justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  details: { flex: 1 },
  amount: { fontSize: 16, fontWeight: 'bold' },
  time: { fontSize: 12, color: '#6B7280' },
  statusContainer: { alignItems: 'flex-end' },
  status: (status: string) => ({
      color: status === 'Pending' ? '#D97706' : (status === 'Confirmed' ? '#059669' : '#2563EB'),
      fontSize: 12,
      fontWeight: '500',
      marginBottom: 4
  })
});
