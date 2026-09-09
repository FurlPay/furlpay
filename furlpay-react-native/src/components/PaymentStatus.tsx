import React from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';

interface PaymentStatusProps {
  status: 'pending' | 'success' | 'failed';
}

export const PaymentStatus: React.FC<PaymentStatusProps> = ({ status }) => {
  return (
    <View style={styles.container}>
      {status === 'pending' && <ActivityIndicator color="#000" />}
      {status === 'success' && <Text style={styles.success}>Payment Successful!</Text>}
      {status === 'failed' && <Text style={styles.failed}>Payment Failed.</Text>}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 20,
    alignItems: 'center',
  },
  success: { color: 'green' },
  failed: { color: 'red' }
});
