import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface QRDisplayProps {
  url: string;
}

export const QRDisplay: React.FC<QRDisplayProps> = ({ url }) => {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>QR Code for: {url}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 20,
    backgroundColor: '#FFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    color: '#000',
  },
});
