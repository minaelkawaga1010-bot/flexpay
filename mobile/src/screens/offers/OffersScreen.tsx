import React, { useEffect, useState } from 'react';
import { FlatList, Linking, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Card, EmptyState, Text } from '@components/ui';
import { offersService, Offer } from '@services/api/offers';
import { useRefresh } from '@hooks/useRefresh';
import { handleApiError } from '@services/api/client';
import * as Analytics from '@services/analytics/analytics';
import { EVENTS } from '@services/analytics/events';
import { colors, spacing } from '@theme';

export const OffersScreen: React.FC = () => {
  const [offers, setOffers] = useState<Offer[]>([]);

  const load = async () => {
    try {
      const { offers } = await offersService.list();
      setOffers(offers);
    } catch (err) {
      // Surface silently — UI shows empty state.
      handleApiError(err);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const { refreshing, onRefresh } = useRefresh(load);

  const handleClick = async (offer: Offer) => {
    Analytics.logEvent(EVENTS.OFFER_CLICKED, { merchant: offer.merchant, offerId: offer.id });
    try {
      const url = await offersService.click(offer.id);
      const target = url ?? offer.affiliateLink;
      if (target) await Linking.openURL(target);
    } catch (err) {
      handleApiError(err);
    }
  };

  return (
    <SafeAreaView style={styles.root}>
      <FlatList
        data={offers}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={<EmptyState title="No offers right now" subtitle="Check back soon." />}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        renderItem={({ item }) => (
          <Card style={styles.row} onTouchEnd={() => handleClick(item)}>
            <View style={styles.body}>
              <Text variant="overline" color="secondary">
                {item.merchant}
              </Text>
              <Text variant="bodyBold">{item.title}</Text>
              {item.description ? (
                <Text variant="caption" color="secondary">
                  {item.description}
                </Text>
              ) : null}
            </View>
            <Text variant="h3" color="success">
              -{item.discountPercentage}%
            </Text>
          </Card>
        )}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.gray[50] },
  list: { padding: spacing.base, gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  body: { flex: 1, paddingRight: spacing.base, gap: 2 },
});
