import 'react-native-gesture-handler';
import 'react-native-get-random-values';
import './src/i18n';

import React, { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StatusBar } from 'react-native';
import { AuthProvider, useAuth } from '@services/auth/useAuth';
import { RootNavigator } from '@navigation/RootNavigator';
import { pushService } from '@services/notifications/pushService';
import { colors } from '@theme';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
    mutations: { retry: 0 },
  },
});

const PushBootstrap: React.FC = () => {
  const { isAuthenticated } = useAuth();

  useEffect(() => {
    if (!isAuthenticated) return;
    let teardown: (() => void) | undefined;
    (async () => {
      const granted = await pushService.requestPermission();
      if (!granted) return;
      await pushService.registerForRemoteNotifications();
      teardown = await pushService.setupNotificationListeners();
    })();
    return () => teardown?.();
  }, [isAuthenticated]);

  return null;
};

const App: React.FC = () => (
  <GestureHandlerRootView style={{ flex: 1 }}>
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <StatusBar barStyle="dark-content" backgroundColor={colors.white} />
          <PushBootstrap />
          <RootNavigator />
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  </GestureHandlerRootView>
);

export default App;
