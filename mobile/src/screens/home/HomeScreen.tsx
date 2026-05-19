import React, { useEffect } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { Button, Card, Text } from '@components/ui';
import { useUserStore } from '@store/useUserStore';
import { useWalletStore } from '@store/useWalletStore';
import { useRefresh } from '@hooks/useRefresh';
import { formatAED } from '@services/utils/currency';
import { relativeTime } from '@services/utils/date';
import { colors, radii, spacing } from '@theme';

export const HomeScreen: React.FC = () => {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();

  const user = useUserStore((s) => s.user);
  const balance = useWalletStore((s) => s.balance);
  const transactions = useWalletStore((s) => s.transactions);
  const fetchBalance = useWalletStore((s) => s.fetchBalance);
  const fetchTransactions = useWalletStore((s) => s.fetchTransactions);

  useEffect(() => {
    void fetchBalance();
    void fetchTransactions(1);
  }, [fetchBalance, fetchTransactions]);

  const { refreshing, onRefresh } = useRefresh(async () => {
    await Promise.all([fetchBalance(), fetchTransactions(1)]);
  });

  const recent = transactions.slice(0, 5);

  return (
    <SafeAreaView style={styles.root} testID="home-screen">
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.greeting}>
          <Text variant="caption" color="secondary">
            Hi {user?.fullName ?? 'there'}
          </Text>
        </View>

        <Card elevation="md" style={styles.balance} testID="balance-card">
          <Text variant="caption" color="inverse" style={styles.balanceLabel}>
            {t('home.balance_title')}
          </Text>
          <Text variant="h1" color="inverse" testID="balance-amount">
            {formatAED(balance)}
          </Text>
        </Card>

        <View style={styles.actions}>
          <Button title={t('home.transfer')} onPress={() => navigation.navigate('Wallet', { screen: 'Transfer' })} />
          <Button
            variant="secondary"
            title={t('home.card')}
            onPress={() => navigation.navigate('Cards')}
            style={styles.secondaryAction}
          />
        </View>

        <Text variant="bodyBold" style={styles.sectionTitle}>
          {t('home.recent_transactions')}
        </Text>
        {recent.length === 0 ? (
          <Text variant="caption" color="secondary">
            {t('wallet.transactions_empty')}
          </Text>
        ) : (
          recent.map((tx) => (
            <Card key={tx.id} elevation="sm" style={styles.txRow}>
              <View>
                <Text variant="bodyBold">{t(`transactions.${tx.type}`)}</Text>
                <Text variant="caption" color="secondary">
                  {tx.description ?? relativeTime(tx.createdAt)}
                </Text>
              </View>
              <Text
                variant="bodyBold"
                color={tx.amount >= 0 ? 'success' : 'primary'}
              >
                {formatAED(tx.amount, { showSign: true })}
              </Text>
            </Card>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.gray[50] },
  scroll: { padding: spacing.lg, gap: spacing.base },
  greeting: { marginBottom: spacing.sm },
  balance: {
    backgroundColor: colors.primary[700],
    borderRadius: radii.lg,
    padding: spacing.xl,
  },
  balanceLabel: { opacity: 0.85, marginBottom: 4 },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.base },
  secondaryAction: { flex: 1 },
  sectionTitle: { marginTop: spacing.lg, marginBottom: spacing.sm },
  txRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
