import React from 'react';
import { View, Text, Button } from 'react-native';

export default function App() {
  return (
    <View>
      <Text>FurlPay RN Example</Text>
      <Button title="Pay with FurlPay" onPress={() => console.log('Pay')} />
    </View>
  );
}
