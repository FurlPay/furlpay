import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import PayScreen from './src/screens/PayScreen';
import StatusScreen from './src/screens/StatusScreen';
import BalanceScreen from './src/screens/BalanceScreen';
import { StatusBar } from 'expo-status-bar';

const Stack = createStackNavigator();

export default function App() {
  return (
    <NavigationContainer>
      <StatusBar style="auto" />
      <Stack.Navigator screenOptions={{ headerShown: false, cardStyle: { backgroundColor: '#000' } }}>
        <Stack.Screen name="Balance" component={BalanceScreen} />
        <Stack.Screen name="Pay" component={PayScreen} />
        <Stack.Screen name="Status" component={StatusScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
