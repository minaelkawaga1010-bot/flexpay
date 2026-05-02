import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { Button, Card, Input, Text } from '@components/ui';
import { cardsService } from '@services/api/cards';
import { handleApiError } from '@services/api/client';
import * as Analytics from '@services/analytics/analytics';
import { EVENTS } from '@services/analytics/events';
import { colors, spacing } from '@theme';

export const OrderPhysicalCardScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { t } = useTranslation();

  const [street, setStreet] = useState('');
  const [city, setCity] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [country, setCountry] = useState('UAE');
  const [submitting, setSubmitting] = useState(false);

  const isValid = street.length >= 5 && city.length >= 2 && postalCode.length >= 4;

  const handleSubmit = async () => {
    if (!isValid) return;
    setSubmitting(true);
    try {
      await cardsService.orderPhysicalCard({ street, city, postalCode, country });
      Analytics.logEvent(EVENTS.PHYSICAL_CARD_ORDERED);
      Alert.alert(t('common.ok'), 'Physical card ordered. We will SMS you the tracking number.');
      navigation.goBack();
    } catch (err) {
      const apiError = handleApiError(err);
      Alert.alert(t('common.error'), apiError.message ?? apiError.error);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text variant="h2" style={styles.title}>
          Shipping address
        </Text>

        <Card style={styles.card}>
          <Input label="Street" value={street} onChangeText={setStreet} />
          <View style={styles.field}>
            <Input label="City" value={city} onChangeText={setCity} />
          </View>
          <View style={styles.field}>
            <Input label="Postal code" value={postalCode} onChangeText={setPostalCode} keyboardType="numeric" />
          </View>
          <View style={styles.field}>
            <Input label="Country" value={country} onChangeText={setCountry} />
          </View>
        </Card>

        <Text variant="caption" color="secondary" style={styles.fee}>
          A AED 30 issuance fee will be deducted from your wallet.
        </Text>

        <Button
          title={t('cards.order_physical')}
          loading={submitting}
          disabled={!isValid || submitting}
          onPress={handleSubmit}
          style={styles.cta}
        />
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.gray[50] },
  scroll: { padding: spacing.lg },
  title: { marginBottom: spacing.lg },
  card: { gap: spacing.sm },
  field: { marginTop: spacing.sm },
  fee: { marginTop: spacing.base },
  cta: { marginTop: spacing.lg },
});
