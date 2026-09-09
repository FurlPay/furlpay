import React from 'react';
import { View, Text, StyleSheet, Switch } from 'react-native';

export default function SettingsScreen() {
  const [notifications, setNotifications] = React.useState(true);
  
  return (
    <View style={styles.container}>
      <Text style={styles.header}>Wallet</Text>
      <View style={styles.row}>
        <Text style={styles.label}>Connected Wallet</Text>
        <Text style={styles.value}>HN7c...3qw</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Network</Text>
        <Text style={styles.value}>Mainnet Beta</Text>
      </View>

      <Text style={styles.header}>Preferences</Text>
      <View style={styles.row}>
        <Text style={styles.label}>Notifications</Text>
        <Switch value={notifications} onValueChange={setNotifications} trackColor={{ true: '#10B981' }} />
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Default Currency</Text>
        <Text style={styles.value}>USDC</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb', padding: 16 },
  header: { fontSize: 18, fontWeight: 'bold', marginTop: 24, marginBottom: 12 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'white', padding: 16, borderRadius: 8, marginBottom: 8 },
  label: { fontSize: 16, color: '#374151' },
  value: { fontSize: 16, color: '#6B7280', fontFamily: 'monospace' }
});
