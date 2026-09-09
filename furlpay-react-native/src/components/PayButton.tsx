import React from 'react';
import { TouchableOpacity, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { triggerSuccessHaptic } from '../utils/haptics';

interface PayButtonProps {
  onPress: () => Promise<void>;
  loading?: boolean;
  success?: boolean;
  title?: string;
}

export const PayButton: React.FC<PayButtonProps> = ({ onPress, loading, success, title = 'Pay Now' }) => {
  const handlePress = async () => {
    if (loading || success) return;
    await onPress();
    triggerSuccessHaptic();
  };

  return (
    <TouchableOpacity 
      style={[styles.button, success && styles.successButton]} 
      onPress={handlePress}
      disabled={loading || success}
    >
      {loading ? (
        <ActivityIndicator color="#FFF" />
      ) : (
        <Text style={styles.text}>{success ? 'Paid!' : title}</Text>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  button: {
    backgroundColor: '#000',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  successButton: {
    backgroundColor: '#4CAF50',
  },
  text: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
