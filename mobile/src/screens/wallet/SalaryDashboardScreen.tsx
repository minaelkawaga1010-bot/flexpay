import React, { useCallback } from 'react';
import {
  FlatList,
  ListRenderItem,
  RefreshControl,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Card,
  EmptyState,
  Skeleton,
  SkeletonCard,
  Text,
} from '@components/ui';
import { BalanceErrorBanner } from '@components/cards/BalanceErrorBanner';
import { useSalaryFeed } from '@hooks/useSalaryFeed';
import { formatAED } from '@services/utils/currency';
import { relativeTime } from '@services/utils/date';
import { colors, radii, spacing } from '@theme';
import type { Transaction } from '@/types/transaction';

/**
 * SalaryDashboardScreen — WPS-aware view of the worker's wage stream.
 *
 * Distinct from the general `WalletScreen`:
 *
 *   • The transaction list is filtered to wage-rail movements only
 *     (PAYROLL / REFUND / REMITTANCE). Card-purchase / cashback /
 *     referral noise stays on the wallet screen.
 *
 *   • The hero shows the CBUAE Universal Account compliance posture
 *     (the wallet IS the WPS payee under the new framework) and the
 *     last settled payroll cycle. A worker whose last cycle hasn't
 *     settled sees the "in-flight" copy and the SVF wallet handle.
 *
 *   • Errors are surfaced per-source: gateway errors render through
 *     `BalanceErrorBanner` (typed codes from the gateway). A
 *     transaction-list error renders inline with a retry button so
 *     the user can re-fetch without losing the balance hero.
 *
 *   • Skeleton-first paint: until both queries have resolved at least
 *     once, the screen renders `SkeletonCard`s in the hero slot and
 *     four placeholder rows in the list. Once the first paint lands,
 *     subsequent fetches happen under the RefreshControl spinner.
 */

export const SalaryDashboardScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { t } = useTranslation();
  const feed = useSalaryFeed();

  const onRefresh = useCallback(() => {
    void feed.refresh();
  }, [feed]);

  const onEndReached = useCallback(() => {
    void feed.loadMore();
  }, [feed]);

  const renderItem: ListRenderItem<Transaction> = useCallback(
    ({ item }) => <TransactionRow tx={item} />,
    [],
  );

  return (
    <SafeAreaView style={styles.root} testID="salary-dashboard">
      <FlatList
        testID="salary-flatlist"
        data={feed.status === 'success' || feed.status === 'idle' ? feed.transactions : []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={feed.isRefreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary[700]}
            testID="salary-refresh-control"
          />
        }
        // Virtualization defaults — FlatList already virtualizes; we
        // tighten the window so a long history list keeps memory flat
        // on low-end Android devices.
        removeClippedSubviews
        initialNumToRender={12}
        maxToRenderPerBatch={12}
        windowSize={7}
        onEndReached={onEndReached}
        onEndReachedThreshold={0.4}
        ListHeaderComponent={
          <Header
            feed={feed}
            onSend={() => navigation.navigate('Transfer')}
          />
        }
        ListEmptyComponent={
          feed.status === 'loading' ? (
            <View testID="salary-tx-skeletons">
              {Array.from({ length: 4 }).map((_, i) => (
                <View key={i} style={styles.txRowSkeleton}>
                  <Skeleton width="50%" height={14} />
                  <Skeleton width={80} height={14} />
                </View>
              ))}
            </View>
          ) : feed.status === 'error' ? (
            <InlineErrorRetry onRetry={feed.retry} />
          ) : (
            <View testID="salary-empty-state">
              <EmptyState
                title={t('salary.empty_title')}
                subtitle={t('salary.empty_subtitle')}
              />
            </View>
          )
        }
        renderItem={renderItem}
      />
    </SafeAreaView>
  );
};

// ═══════════════════════════════════════════════════════════════════
// Hero header
// ═══════════════════════════════════════════════════════════════════

interface HeaderProps {
  feed: ReturnType<typeof useSalaryFeed>;
  onSend: () => void;
}

const Header: React.FC<HeaderProps> = ({ feed, onSend }) => {
  const { t } = useTranslation();

  return (
    <>
      <BalanceErrorBanner error={feed.error} onRetry={feed.retry} />

      {feed.status === 'loading' || (feed.status === 'idle' && !feed.balance) ? (
        <Card style={styles.heroCardLoading} testID="salary-hero-skeleton">
          <SkeletonCard />
        </Card>
      ) : feed.balance ? (
        <BalanceHero balance={feed.balance} onSend={onSend} />
      ) : null}

      <View style={styles.sectionHeader}>
        <Text variant="bodyBold">{t('salary.recent_wps_movements')}</Text>
        <ComplianceBadge />
      </View>
    </>
  );
};

const BalanceHero: React.FC<{
  balance: NonNullable<ReturnType<typeof useSalaryFeed>['balance']>;
  onSend: () => void;
}> = ({ balance, onSend }) => {
  const { t } = useTranslation();
  const cycleActive = balance.cycle.status === 'ACTIVE';

  return (
    <Card elevation="md" style={styles.heroCard} testID="salary-hero">
      <Text variant="caption" color="inverse" style={styles.label}>
        {t('salary.wallet_balance')}
      </Text>
      <Text variant="h1" color="inverse" testID="salary-balance-amount">
        {formatAED(balance.walletBalance)}
      </Text>

      <View style={styles.cycleRow}>
        <View style={{ flex: 1 }}>
          <Text variant="caption" color="inverse" style={styles.label}>
            {cycleActive
              ? t('salary.cycle_accrued')
              : t('salary.cycle_last_settled')}
          </Text>
          <Text variant="bodyBold" color="inverse" testID="salary-cycle-amount">
            {formatAED(cycleActive ? balance.accruedWages : balance.walletBalance)}
          </Text>
        </View>
        <Button
          title={t('salary.send')}
          size="small"
          onPress={onSend}
          testID="salary-send-button"
        />
      </View>
    </Card>
  );
};

const ComplianceBadge: React.FC = () => {
  const { t } = useTranslation();
  return (
    <View style={styles.complianceBadge} testID="compliance-badge">
      <View style={styles.complianceDot} />
      <Text variant="caption" color="secondary">
        {t('salary.compliance_badge')}
      </Text>
    </View>
  );
};

// ═══════════════════════════════════════════════════════════════════
// Transaction row
// ═══════════════════════════════════════════════════════════════════

const TransactionRow: React.FC<{ tx: Transaction }> = ({ tx }) => {
  const { t } = useTranslation();
  const isCredit = tx.amount >= 0;

  return (
    <View style={styles.txRow} testID={`salary-tx-${tx.id}`}>
      <View style={styles.txMeta}>
        <Text variant="bodyBold">{t(`transactions.${tx.type}`)}</Text>
        <Text variant="caption" color="secondary">
          {tx.description ?? relativeTime(tx.createdAt)}
        </Text>
        {tx.status === 'PENDING' && (
          <Text variant="caption" color="secondary" testID={`salary-tx-${tx.id}-pending`}>
            {t('salary.status_pending')}
          </Text>
        )}
      </View>
      <Text
        variant="bodyBold"
        color={isCredit ? 'success' : 'primary'}
        testID={`salary-tx-${tx.id}-amount`}
      >
        {formatAED(tx.amount, { showSign: true })}
      </Text>
    </View>
  );
};

// ═══════════════════════════════════════════════════════════════════
// Inline error retry — for the transaction list path
// ═══════════════════════════════════════════════════════════════════

const InlineErrorRetry: React.FC<{ onRetry: () => void }> = ({ onRetry }) => {
  const { t } = useTranslation();
  return (
    <Card style={styles.errorRetry} testID="salary-error-retry">
      <Text variant="bodyBold">{t('salary.error_title')}</Text>
      <Text variant="caption" color="secondary" style={styles.errorBody}>
        {t('salary.error_body')}
      </Text>
      <TouchableOpacity
        onPress={onRetry}
        style={styles.retryAction}
        testID="salary-retry-button"
        accessibilityRole="button"
      >
        <Text variant="bodyBold" color="success">
          {t('salary.retry')}
        </Text>
      </TouchableOpacity>
    </Card>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.gray[50] },
  list: { paddingBottom: spacing.xl },
  heroCard: {
    margin: spacing.base,
    marginBottom: spacing.sm,
    padding: spacing.xl,
    backgroundColor: colors.primary[700],
    borderRadius: radii.lg,
    gap: spacing.xs,
  },
  heroCardLoading: {
    margin: spacing.base,
    marginBottom: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.gray[100],
    borderRadius: radii.lg,
  },
  label: { opacity: 0.85 },
  cycleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.md,
    gap: spacing.md,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginHorizontal: spacing.base,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  complianceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.base,
    backgroundColor: colors.gray[100],
  },
  complianceDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.success[500],
  },
  txRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.base,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.gray[200],
    backgroundColor: colors.white,
  },
  txRowSkeleton: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.base,
    backgroundColor: colors.white,
  },
  txMeta: { flex: 1, gap: spacing.xs / 2 },
  errorRetry: {
    margin: spacing.base,
    padding: spacing.md,
    gap: spacing.xs,
  },
  errorBody: { marginBottom: spacing.sm },
  retryAction: { alignSelf: 'flex-start', paddingVertical: spacing.xs },
});
