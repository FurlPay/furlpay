import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import CircularProgress from '../components/CircularProgress';
import { triggerHapticSuccess } from '../lib/haptics';

export default function StatusScreen({ navigation }: any) {
  const [status, setStatus] = useState<'pending' | 'success'>('pending');

  useEffect(() => {
    const timer = setTimeout(() => {
      setStatus('success');
      triggerHapticSuccess();
      setTimeout(() => navigation.navigate('Balance'), 2000);
    }, 1500);
    return () => clearTimeout(timer);
  }, [navigation]);

  return (
    <View style={styles.container}>
      {status === 'pending' ? (
        <CircularProgress />
      ) : (
        <View style={styles.successContainer}>
          <Text style={styles.check}>✓</Text>
          <Text style={styles.text}>Settled in 420ms</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  successContainer: {
    alignItems: 'center',
  },
  check: {
    fontSize: 80,
    color: '#34C759',
    marginBottom: 10,
  },
  text: {
    color: 'white',
    fontSize: 16,
  }
});
