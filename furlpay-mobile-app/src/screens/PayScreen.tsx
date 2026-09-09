import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import PaymentConfirmation from '../components/PaymentConfirmation';

export default function PayScreen({ route, navigation }: any) {
  // Simulate parsed data
  const paymentDetails = {
      recipient: 'HN7c...3qw',
      amount: '50.00',
      currency: 'USDC',
      merchantName: 'Acme Corp'
  };

  const handleConfirm = () => {
      // Simulate biometric auth and signing
      alert('Payment Confirmed!');
      navigation.navigate('Home');
  };

  return (
    <View style={styles.container}>
        <PaymentConfirmation details={paymentDetails} onConfirm={handleConfirm} onCancel={() => navigation.goBack()} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb', justifyContent: 'center', padding: 16 }
});
