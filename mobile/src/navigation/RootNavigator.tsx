import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { RootStackParamList } from '@types/navigation';
import { useAuth } from '@services/auth/useAuth';
import { AuthStack } from './AuthStack';
import { AppStack } from './AppStack';
import { navigationRef } from './NavigationService';
import { linking } from './linking';
import { colors } from '@theme';

const Stack = createNativeStackNavigator<RootStackParamList>();

export const RootNavigator: React.FC = () => {
  const { isAuthenticated, isHydrating } = useAuth();

  if (isHydrating) {
    return (
      <View style={styles.boot}>
        <ActivityIndicator size="large" color={colors.primary[700]} />
      </View>
    );
  }

  return (
    <NavigationContainer ref={navigationRef} linking={linking}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {isAuthenticated ? (
          <Stack.Screen name="App" component={AppStack} />
        ) : (
          <Stack.Screen name="Auth" component={AuthStack} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
};

const styles = StyleSheet.create({
  boot: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.white },
});
