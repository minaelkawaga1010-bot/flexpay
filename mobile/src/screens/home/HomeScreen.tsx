import React, { useCallback, useEffect } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { Button, Card, LoadingSpinner, Text } from '@components/ui';
import { BalanceErrorBanner } from '@components/cards/BalanceErrorBanner';
import { useUserStore } from '@store/useUserStore';
import { useWalletStore } from '@store/useWalletStore';
import { useMobileWalletStore } from '@store/useMobileWalletStore';
import { useRefresh } from '@hooks/useRefresh';
import { formatAED } from '@services/utils/currency';
import { relativeTime } from '@services/utils/date';
import { colors, radii, spacing } from '@theme';

/**
 * Home dashboard.
 *
 * Gateway-bound:
 *   - Hero balance card pulls `walletBalance` + `accruedWages` from
 *     useMobileWalletStore (Zod-parsed GET /mobile/wallet/balance).
 *   - Get-Advance CTA is enabled iff
 *     dcse.eligibleForEWA && availableLimit > 0 — the SAME predicate
 *     the backend uses inside reserveAdvance. Disabling here is a UX
 *     courtesy; the server still re-checks I1.
 *
 * Legacy-bound (kept for now):
 *   - Recent activity list comes from useWalletStore (the legacy
 *     /wallet/transactions route). The mobile gateway intentionally
 *     does not expose a transactions endpoint.
 */

export const HomeScreen: React.FC = () => {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();

  const user = useUserStore((s) => s.user);

  // ─── Gateway-bound state ──────────────────────────────────────────
  const balance = useMobileWalletStore((s) => s.balance);
  const isLoadingBalance = useMobileWalletStore((s) => s.isLoading);
  const lastError = useMobileWalletStore((s) => s.lastError);
  const fetchBalance = useMobileWalletStore((s) => s.fetchBalance);
  const clearError = useMobileWalletStore((s) => s.clearError);

  // ─── Legacy: transaction list ─────────────────────────────────────
  const transactions = useWalletStore((s) => s.transactions);
  const fetchTransactions = useWalletStore((s) => s.fetchTransactions);

  useEffect(() => {
    void fetchBalance();
    void fetchTransactions(1);
  }, [fetchBalance, fetchTransactions]);

  const { refreshing, onRefresh } = useRefresh(async () => {
    await Promise.all([fetchBalance(), fetchTransactions(1)]);
  });

  const handleRetry = useCallback(() => {
    clearError();
    void fetchBalance();
  }, [clearError, fetchBalance]);

  const recent = transactions.slice(0, 5);

  const ewaEligible = !!balance && balance.dcse.eligibleForEWA && balance.availableLimit > 0;

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

        <BalanceErrorBanner error={lastError} onRetry={handleRetry} />

        {isLoadingBalance && !balance ? (
          <Card elevation="md" style={styles.balance}>
            <LoadingSpinner />
          </Card>
        ) : (
          <Card elevation="md" style={styles.balance} testID="balance-card">
            <Text variant="caption" color="inverse" style={styles.balanceLabel}>
              {t('home.balance_title')}
            </Text>
            <Text variant="h1" color="inverse" testID="balance-amount">
              {formatAED(balance?.walletBalance ?? 0)}
            </Text>

            {balance?.cycle.status === 'ACTIVE' ? (
              <View style={styles.subRow}>
                <Text variant="caption" color="inverse" style={styles.balanceLabel}>
                  {t('home.accrued_this_cycle')}
                </Text>
                <Text variant="bodyBold" color="inverse" testID="accrued-amount">
                  {formatAED(balance.accruedWages)}
                </Text>
              </View>
            ) : null}
          </Card>
        )}

        {balance ? (
          <Card style={styles.advanceCard} testID="advance-card">
            <View style={styles.advanceHeader}>
              <View>
                <Text variant="caption" color="secondary">
                  {t('home.available_advance')}
                </Text>
                <Text variant="h2" testID="available-limit">
                  {formatAED(balance.availableLimit)}
                </Text>
              </View>
              <Button
                title={t('home.get_advance')}
                size="small"
                disabled={!ewaEligible}
                onPress={() => navigation.navigate('Wallet', { screen: 'AddMoney' })}
                testID="get-advance-button"
              />
            </View>
            <Text variant="caption" color="secondary">
              {ewaEligible
                ? t('home.dcse_eligible_note')
                : balance.cycle.status === 'NO_ACTIVE_CYCLE'
                  ? t('home.no_active_cycle')
                  : t('home.dcse_ineligible_note')}
            </Text>
          </Card>
        ) : null}

        <View style={styles.actions}>
          <Button
            title={t('home.transfer')}
            onPress={() => navigation.navigate('Wallet', { screen: 'Transfer' })}
          />
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
              <Text variant="bodyBold" color={tx.amount >= 0 ? 'success' : 'primary'}>
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
  subRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm },
  advanceCard: { padding: spacing.md, gap: spacing.sm },
  advanceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.base },
  secondaryAction: { flex: 1 },
  sectionTitle: { marginTop: spacing.lg, marginBottom: spacing.sm },
  txRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
