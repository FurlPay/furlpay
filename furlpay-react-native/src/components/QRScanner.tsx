import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface QRScannerProps {
  onScan: (url: string) => void;
}

export const QRScanner: React.FC<QRScannerProps> = ({ onScan }) => {
  // Placeholder for real camera implementation, e.g. using react-native-camera
  return (
    <View style={styles.container}>
      <Text style={styles.text}>Scanner Placeholder</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    color: '#FFF',
  },
});
