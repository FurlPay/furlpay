import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export default function SpeedBadge({ ms }: { ms: number }) {
  return (
    <View style={styles.badge}>
      <Text style={styles.text}>⚡ {ms}ms</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { backgroundColor: '#D1FAE5', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  text: { color: '#059669', fontSize: 10, fontWeight: 'bold' }
});
