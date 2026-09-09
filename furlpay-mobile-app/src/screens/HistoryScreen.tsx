import React from 'react';
import { View, StyleSheet, FlatList } from 'react-native';
import TransactionItem from '../components/TransactionItem';

const data = [
    { id: '1', type: 'send', amount: '25.00 USDC', status: 'Finalized', time: '2 hours ago' },
    { id: '2', type: 'receive', amount: '1.5 SOL', status: 'Confirmed', time: 'Yesterday' },
    { id: '3', type: 'send', amount: '10.00 USDT', status: 'Finalized', time: '3 days ago' },
];

export default function HistoryScreen() {
  return (
    <View style={styles.container}>
      <FlatList
        data={data}
        keyExtractor={item => item.id}
        renderItem={({ item }) => (
            <TransactionItem type={item.type as any} amount={item.amount} status={item.status as any} time={item.time} />
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb', padding: 16 }
});
