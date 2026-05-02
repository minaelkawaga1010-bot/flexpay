import React, { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { Button, Card, Text } from '@components/ui';
import { AmountInput, PhoneInput } from '@components/forms';
import { walletService } from '@services/api/wallet';
import { useWalletStore } from '@store/useWalletStore';
import { useUserStore } from '@store/useUserStore';
import { handleApiError } from '@services/api/client';
import { validatePhone, validateAmount } from '@services/utils/validation';
import { haptics } from '@services/utils/haptics';
import * as Analytics from '@services/analytics/analytics';
import { EVENTS } from '@services/analytics/events';
import { colors, spacing } from '@theme';

export const TransferScreen: React.FC = () => {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const user = useUserStore((s) => s.user);
  const optimisticTransfer = useWalletStore((s) => s.optimisticTransfer);
  const rollbackOptimistic = useWalletStore((s) => s.rollbackOptimistic);
  const fetchBalance = useWalletStore((s) => s.fetchBalance);
  const fetchTransactions = useWalletStore((s) => s.fetchTransactions);

  const [recipientPhone, setRecipientPhone] = useState('+971');
  const [amount, setAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const isValid = validatePhone(recipientPhone) && validateAmount(amount);
  const feeNotice =
    user?.plan === 'LUXURY'
      ? t('wallet.fee_notice_luxury')
      : t('wallet.fee_notice_basic');

  const handleSubmit = async () => {
    if (!isValid || submitting) return;

    setSubmitting(true);
    haptics.selection();
    const numericAmount = parseFloat(amount);
    const tempId = optimisticTransfer(numericAmount, recipientPhone);

    try {
      const result = await walletService.transfer({
        recipientPhone,
        amount: numericAmount,
      });
      Analytics.logEvent(EVENTS.TRANSFER_SUCCESS, { amount: numericAmount, replay: result.replay });
      haptics.success();
      // Re-sync from the server so the temp row is replaced with the real one.
      await Promise.all([fetchBalance(), fetchTransactions(1)]);
      navigation.goBack();
    } catch (err) {
      rollbackOptimistic(tempId);
      const apiError = handleApiError(err);
      Analytics.logEvent(EVENTS.TRANSFER_FAILED, { code: apiError.error });
      Alert.alert(t('common.error'), apiError.message ?? apiError.error);
      haptics.notification('error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.root}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text variant="h2" style={styles.title}>
            {t('wallet.send')}
          </Text>

          <Card style={styles.form}>
            <PhoneInput value={recipientPhone} onChange={setRecipientPhone} />
            <View style={styles.field}>
              <AmountInput value={amount} onChange={setAmount} label={t('wallet.amount')} />
            </View>
            <Text variant="caption" color="secondary" style={styles.fee}>
              {feeNotice}
            </Text>
          </Card>

          <Button
            title={t('wallet.send_now')}
            size="large"
            loading={submitting}
            disabled={!isValid || submitting}
            onPress={handleSubmit}
            style={styles.cta}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.gray[50] },
  flex: { flex: 1 },
  content: { padding: spacing.lg },
  title: { marginBottom: spacing.lg },
  form: { gap: spacing.base },
  field: { marginTop: spacing.sm },
  fee: { marginTop: spacing.xs },
  cta: { marginTop: spacing.lg },
});
