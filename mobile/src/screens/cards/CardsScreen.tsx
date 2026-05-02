import React, { useEffect } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { Button, EmptyState, Text } from '@components/ui';
import { VirtualCardVisual } from '@components/cards/VirtualCardVisual';
import { CardShimmer } from '@components/cards/CardShimmer';
import { useCardsStore } from '@store/useCardsStore';
import { useUserStore } from '@store/useUserStore';
import { useWalletStore } from '@store/useWalletStore';
import { colors, spacing } from '@theme';

export const CardsScreen: React.FC = () => {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();

  const cards = useCardsStore((s) => s.cards);
  const isLoading = useCardsStore((s) => s.isLoading);
  const fetchCards = useCardsStore((s) => s.fetchCards);

  const user = useUserStore((s) => s.user);
  const balance = useWalletStore((s) => s.balance);

  useEffect(() => {
    void fetchCards();
  }, [fetchCards]);

  const virtual = cards.find((c) => c.type === 'VIRTUAL');
  const physical = cards.find((c) => c.type === 'PHYSICAL');

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {isLoading && !virtual ? (
          <CardShimmer />
        ) : virtual ? (
          <VirtualCardVisual
            card={virtual}
            cardholderName={user?.fullName?.toUpperCase()}
            balance={balance}
          />
        ) : (
          <EmptyState title={t('cards.no_card')} />
        )}

        <View style={styles.actions}>
          {!physical ? (
            <Button
              title={t('cards.order_physical')}
              onPress={() => navigation.navigate('OrderPhysicalCard')}
            />
          ) : (
            <Text variant="caption" color="secondary">
              {physical.shippingStatus ?? 'PENDING'}
              {physical.trackingNumber ? ` · ${physical.trackingNumber}` : ''}
            </Text>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.gray[50] },
  scroll: { padding: spacing.lg, gap: spacing.lg },
  actions: { gap: spacing.sm },
});
