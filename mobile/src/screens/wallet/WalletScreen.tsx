import React, { useEffect } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { Button, Card, EmptyState, Text } from '@components/ui';
import { useWalletStore } from '@store/useWalletStore';
import { useRefresh } from '@hooks/useRefresh';
import { formatAED } from '@services/utils/currency';
import { relativeTime } from '@services/utils/date';
import { colors, spacing } from '@theme';

export const WalletScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { t } = useTranslation();

  const balance = useWalletStore((s) => s.balance);
  const transactions = useWalletStore((s) => s.transactions);
  const hasMore = useWalletStore((s) => s.hasMore);
  const fetchBalance = useWalletStore((s) => s.fetchBalance);
  const fetchTransactions = useWalletStore((s) => s.fetchTransactions);

  useEffect(() => {
    void fetchBalance();
    void fetchTransactions(1);
  }, [fetchBalance, fetchTransactions]);

  const { refreshing, onRefresh } = useRefresh(async () => {
    await Promise.all([fetchBalance(), fetchTransactions(1)]);
  });

  // Pagination is offset-based; we infer the next page from current length.
  const handleEndReached = async () => {
    if (!hasMore) return;
    const nextPage = Math.floor(transactions.length / 20) + 1;
    await fetchTransactions(nextPage);
  };

  return (
    <SafeAreaView style={styles.root}>
      <Card style={styles.balanceCard}>
        <Text variant="caption" color="secondary">
          {t('wallet.balance')}
        </Text>
        <Text variant="h1">{formatAED(balance)}</Text>
        <View style={styles.row}>
          <Button
            title={t('wallet.send')}
            size="small"
            onPress={() => navigation.navigate('Transfer')}
          />
        </View>
      </Card>

      <FlatList
        data={transactions}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={<EmptyState title={t('wallet.transactions_empty')} />}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.4}
        renderItem={({ item }) => (
          <View style={styles.tx}>
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

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.gray[50] },
  balanceCard: { margin: spacing.base, gap: spacing.sm },
  row: { flexDirection: 'row', marginTop: spacing.sm },
  list: { padding: spacing.base, paddingTop: 0 },
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
