import React from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';

export default function CircularProgress() {
  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#007AFF" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
    alignItems: 'center',
  }
});
