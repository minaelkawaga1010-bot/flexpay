import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { AuthStackParamList } from '@/types/navigation';
import { PhoneInputScreen } from '@screens/auth/PhoneInputScreen';
import { OTPScreen } from '@screens/auth/OTPScreen';
import { ProfileSetupScreen } from '@screens/auth/ProfileSetupScreen';
import { WelcomeScreen } from '@screens/auth/WelcomeScreen';

const Stack = createNativeStackNavigator<AuthStackParamList>();

export const AuthStack: React.FC = () => (
  <Stack.Navigator screenOptions={{ headerShown: false }}>
    <Stack.Screen name="Welcome" component={WelcomeScreen} />
    <Stack.Screen name="PhoneInput" component={PhoneInputScreen} />
    <Stack.Screen name="OTP" component={OTPScreen} />
    <Stack.Screen name="ProfileSetup" component={ProfileSetupScreen} />
  </Stack.Navigator>
);
