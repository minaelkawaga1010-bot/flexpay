import React from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Button, Card, Text } from '@components/ui';
import { useAuth } from '@services/auth/useAuth';
import { useUserStore } from '@store/useUserStore';
import { colors, spacing } from '@theme';

export const ProfileScreen: React.FC = () => {
  const { t } = useTranslation();
  const { logout } = useAuth();
  const user = useUserStore((s) => s.user);

  const confirmLogout = () => {
    Alert.alert('Log out', 'Are you sure?', [
      { text: t('common.cancel'), style: 'cancel' },
      { text: 'Log out', style: 'destructive', onPress: () => void logout() },
    ]);
  };

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Card style={styles.card}>
          <Text variant="caption" color="secondary">
            Name
          </Text>
          <Text variant="bodyBold">{user?.fullName ?? '—'}</Text>
          <View style={styles.divider} />
          <Text variant="caption" color="secondary">
            Phone
          </Text>
          <Text variant="bodyBold">{user?.phone ?? '—'}</Text>
          <View style={styles.divider} />
          <Text variant="caption" color="secondary">
            Plan
          </Text>
          <Text variant="bodyBold">{user?.plan ?? 'BASIC'}</Text>
        </Card>

        <Button title="Log out" variant="destructive" onPress={confirmLogout} style={styles.cta} />
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.gray[50] },
  scroll: { padding: spacing.lg, gap: spacing.lg },
  card: { gap: 4 },
  divider: { height: 1, backgroundColor: colors.gray[100], marginVertical: spacing.sm },
  cta: { marginTop: spacing.base },
});
