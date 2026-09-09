import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import AmountDisplay from '../components/AmountDisplay';
import { triggerHapticSelection } from '../lib/haptics';
import { startNfcPayment } from '../lib/nfc';

export default function PayScreen({ navigation }: any) {
  const handlePay = async () => {
    triggerHapticSelection();
    await startNfcPayment();
    navigation.navigate('Status');
  };

  return (
    <View style={styles.container}>
      <AmountDisplay amount={10.50} currency="USDC" />
      <TouchableOpacity style={styles.button} onPress={handlePay}>
        <Text style={styles.buttonText}>Tap to Pay</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  button: {
    marginTop: 40,
    backgroundColor: '#007AFF',
    paddingVertical: 15,
    paddingHorizontal: 40,
    borderRadius: 30,
  },
  buttonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  }
});
