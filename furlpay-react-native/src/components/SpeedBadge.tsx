import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface SpeedBadgeProps {
  speedMs: number;
}

export const SpeedBadge: React.FC<SpeedBadgeProps> = ({ speedMs }) => {
  return (
    <View style={styles.badge}>
      <Text style={styles.text}>{speedMs}ms</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  badge: {
    backgroundColor: '#E0F7FA',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  text: {
    color: '#006064',
    fontSize: 12,
    fontWeight: 'bold',
  }
});
