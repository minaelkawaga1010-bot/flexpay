import React, { useCallback, useEffect } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { Button, Card, EmptyState, LoadingSpinner, Text } from '@components/ui';
import { BalanceErrorBanner } from '@components/cards/BalanceErrorBanner';
import { useWalletStore } from '@store/useWalletStore';
import { useMobileWalletStore } from '@store/useMobileWalletStore';
import { useRefresh } from '@hooks/useRefresh';
import { formatAED } from '@services/utils/currency';
import { relativeTime } from '@services/utils/date';
import { colors, radii, spacing } from '@theme';

/**
 * Wallet screen — wired to TWO stores:
 *
 *   useMobileWalletStore (gateway)
 *      ↳ Zod-parsed GET /api/v1/mobile/wallet/balance
 *      ↳ Source of truth for: walletBalance, accruedWages,
 *        availableLimit (the I1-cap), DCSE summary, cycle status.
 *      ↳ Surfaces typed errors (COMPLIANCE_BLOCK / KYC_NOT_COMPLETE /
 *        BIOMETRIC_STALE / ACCOUNT_NOT_ACTIVE) via the BalanceErrorBanner.
 *
 *   useWalletStore (legacy)
 *      ↳ GET /api/v1/wallet/transactions for the paginated history list.
 *        The transactions endpoint is not on the mobile-gateway surface
 *        because the gateway's read-only routes are intentionally narrow
 *        (balance + cards + nothing else).
 *
 * Pull-to-refresh fans out to both stores in parallel — the screen is
 * one consistent snapshot after the refresh resolves.
 */

export const WalletScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { t } = useTranslation();

  // ─── Gateway-bound (the moat-aware fields) ─────────────────────────
  const balance = useMobileWalletStore((s) => s.balance);
  const isLoadingBalance = useMobileWalletStore((s) => s.isLoading);
  const lastError = useMobileWalletStore((s) => s.lastError);
  const fetchBalance = useMobileWalletStore((s) => s.fetchBalance);
  const clearError = useMobileWalletStore((s) => s.clearError);

  // ─── Legacy-store (transaction list only) ──────────────────────────
  const transactions = useWalletStore((s) => s.transactions);
  const hasMore = useWalletStore((s) => s.hasMore);
  const fetchTransactions = useWalletStore((s) => s.fetchTransactions);

  useEffect(() => {
    void fetchBalance();
    void fetchTransactions(1);
  }, [fetchBalance, fetchTransactions]);

  const { refreshing, onRefresh } = useRefresh(async () => {
    await Promise.all([fetchBalance(), fetchTransactions(1)]);
  });

  const handleEndReached = useCallback(async () => {
    if (!hasMore) return;
    const nextPage = Math.floor(transactions.length / 20) + 1;
    await fetchTransactions(nextPage);
  }, [hasMore, transactions.length, fetchTransactions]);

  const handleRetry = useCallback(() => {
    clearError();
    void fetchBalance();
  }, [clearError, fetchBalance]);

  // First-paint shimmer — show ONLY when we have no cached snapshot to
  // render. Once we've drawn a balance once, subsequent fetches happen
  // under the RefreshControl spinner so the screen never goes blank.
  const showFirstPaintLoader = isLoadingBalance && !balance;

  return (
    <SafeAreaView style={styles.root} testID="wallet-screen">
      <FlatList
        data={transactions}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.4}
        ListHeaderComponent={
          <>
            <BalanceErrorBanner error={lastError} onRetry={handleRetry} />

            {showFirstPaintLoader ? (
              <Card style={styles.balanceCard}>
                <LoadingSpinner />
              </Card>
            ) : (
              <BalanceHeader
                balance={balance}
                onSend={() => navigation.navigate('Transfer')}
                onAdvance={() => navigation.navigate('AddMoney' as never)}
              />
            )}

            <Text variant="bodyBold" style={styles.sectionTitle}>
              {t('wallet.recent_activity')}
            </Text>
          </>
        }
        ListEmptyComponent={
          !showFirstPaintLoader ? (
            <EmptyState title={t('wallet.transactions_empty')} />
          ) : null
        }
        renderItem={({ item }) => (
          <View style={styles.tx} testID={`wallet-tx-${item.id}`}>
            <View style={styles.txMeta}>
              <Text variant="bodyBold">{t(`transactions.${item.type}`)}</Text>
              <Text variant="caption" color="secondary">
                {item.description ?? relativeTime(item.createdAt)}
              </Text>
            </View>
            <Text variant="bodyBold" color={item.amount >= 0 ? 'success' : 'primary'}>
              {formatAED(item.amount, { showSign: true })}
            </Text>
          </View>
        )}
      />
    </SafeAreaView>
  );
};

// ═══════════════════════════════════════════════════════════════════
// Balance header
//
// Renders three logical blocks from the gateway response:
//
//   1. Spendable wallet balance — the AED already settled in the wallet
//      (post-residual credit, post-cashback). What the user can move.
//
//   2. This cycle's accrued wages — what HR-tech attendance has
//      confirmed they've already earned. Reset on cycle settle.
//
//   3. Available advance — the SERVER-COMPUTED I1-cap:
//         MAX(0, MIN(DCSE limit, accruedWages) - fixedFee)
//      The UI binds DIRECTLY to this value. Never recomputed locally.
// ═══════════════════════════════════════════════════════════════════

interface BalanceHeaderProps {
  balance: NonNullable<ReturnType<typeof useMobileWalletStore.getState>['balance']>;
  onSend: () => void;
  onAdvance: () => void;
}

const BalanceHeader: React.FC<{
  balance: BalanceHeaderProps['balance'] | null;
  onSend: () => void;
  onAdvance: () => void;
}> = ({ balance, onSend, onAdvance }) => {
  const { t } = useTranslation();
  if (!balance) {
    // Defensive: the parent guards on `showFirstPaintLoader`, but
    // exposing a null-safe branch keeps the component independently
    // testable without contriving a balance fixture.
    return null;
  }

  const cycleActive = balance.cycle.status === 'ACTIVE';
  const ewaEligible = balance.dcse.eligibleForEWA && balance.availableLimit > 0;

  return (
    <View>
      <Card elevation="md" style={styles.balanceCard} testID="balance-card">
        <Text variant="caption" color="inverse" style={styles.balanceLabel}>
          {t('wallet.balance')}
        </Text>
        <Text variant="h1" color="inverse" testID="balance-amount">
          {formatAED(balance.walletBalance)}
        </Text>

        {cycleActive ? (
          <View style={styles.subRow}>
            <Text variant="caption" color="inverse" style={styles.balanceLabel}>
              {t('wallet.accrued_this_cycle')}
            </Text>
            <Text variant="bodyBold" color="inverse" testID="accrued-amount">
              {formatAED(balance.accruedWages)}
            </Text>
          </View>
        ) : (
          <Text variant="caption" color="inverse" style={styles.balanceLabel}>
            {t('wallet.no_active_cycle')}
          </Text>
        )}

        <View style={styles.actionRow}>
          <Button title={t('wallet.send')} size="small" onPress={onSend} />
        </View>
      </Card>

      <Card style={styles.advanceCard} testID="advance-card">
        <View style={styles.advanceHeader}>
          <View>
            <Text variant="caption" color="secondary">
              {t('wallet.available_advance')}
            </Text>
            <Text variant="h2" testID="available-limit">
              {formatAED(balance.availableLimit)}
            </Text>
          </View>
          <Button
            title={t('wallet.get_advance')}
            size="small"
            disabled={!ewaEligible}
            onPress={onAdvance}
            testID="get-advance-button"
          />
        </View>
        <Text variant="caption" color="secondary" style={styles.dcseNote}>
          {ewaEligible
            ? t('wallet.dcse_eligible_note', { modelVersion: balance.dcse.modelVersion })
            : t('wallet.dcse_ineligible_note')}
        </Text>
      </Card>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.gray[50] },
  list: { padding: spacing.base, paddingTop: 0 },
  balanceCard: {
    margin: spacing.base,
    marginBottom: spacing.sm,
    padding: spacing.xl,
    backgroundColor: colors.primary[700],
    borderRadius: radii.lg,
    gap: spacing.xs,
  },
  balanceLabel: { opacity: 0.85 },
  subRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm },
  actionRow: { flexDirection: 'row', marginTop: spacing.md },
  advanceCard: {
    marginHorizontal: spacing.base,
    marginBottom: spacing.base,
    padding: spacing.md,
    gap: spacing.xs,
  },
  advanceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dcseNote: { marginTop: spacing.xs },
  sectionTitle: { marginHorizontal: spacing.base, marginVertical: spacing.sm },
  tx: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.gray[200],
  },
  txMeta: { flex: 1 },
});
