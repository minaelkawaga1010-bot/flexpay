import React, { useCallback, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Button, Card, Input, Text } from '@components/ui';
import { usePayBill, type PayBillFormValues } from '@hooks/usePayBill';
import type { BillerType } from '@services/api/bills';
import { formatAED } from '@services/utils/currency';
import { colors, radii, spacing } from '@theme';

/**
 * BillsPaymentScreen — wallet-funded utility bill payment.
 *
 * Flow:
 *   1. User picks a biller from the dynamic UAE provider grid
 *      (DEWA / SEWA / ADDC / FEWA / Etisalat / du / Salik / RTA).
 *   2. User enters the biller-side account reference + AED amount.
 *      Inline Zod-driven validation surfaces field-shaped errors.
 *   3. Tap Pay → confirmation modal with the bill summary +
 *      compliance badge.
 *   4. Confirm → `usePayBill.submit()` flips `isSubmittingBill` to
 *      true, locks the Pay button, and dispatches to the backend.
 *      The lock survives any number of taps until settle.
 *   5. Success surface → receipt with the CBUAE Universal Account
 *      Receipts compliance badge.
 *   6. Failure surface → typed error + retry CTA. Retries re-use the
 *      same idempotency key; the backend dedupes.
 */

interface Biller {
  type: BillerType;
  shortName: string;
  refPlaceholder: string;
}

const BILLERS: ReadonlyArray<Biller> = [
  { type: 'DEWA',     shortName: 'DEWA',     refPlaceholder: 'Premise / account no.' },
  { type: 'SEWA',     shortName: 'SEWA',     refPlaceholder: 'Account no.' },
  { type: 'ADDC',     shortName: 'ADDC',     refPlaceholder: 'Account no.' },
  { type: 'FEWA',     shortName: 'FEWA',     refPlaceholder: 'Account no.' },
  { type: 'ETISALAT', shortName: 'e&',       refPlaceholder: 'Mobile / landline' },
  { type: 'DU',       shortName: 'du',       refPlaceholder: 'Mobile / landline' },
  { type: 'SALIK',    shortName: 'Salik',    refPlaceholder: 'Plate number' },
  { type: 'RTA',      shortName: 'RTA',      refPlaceholder: 'Fine / plate ref' },
];

export const BillsPaymentScreen: React.FC = () => {
  const { t } = useTranslation();
  const pay = usePayBill();

  const [billerType, setBillerType] = useState<BillerType | null>(null);
  const [billerAccountRef, setRef] = useState('');
  const [amountInput, setAmountInput] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);

  const selectedBiller = useMemo(
    () => BILLERS.find((b) => b.type === billerType) ?? null,
    [billerType],
  );

  const parsedAmount = useMemo(() => {
    const n = Number(amountInput.replace(/,/g, ''));
    return Number.isFinite(n) ? n : NaN;
  }, [amountInput]);

  const formValues: PayBillFormValues | null = useMemo(() => {
    if (!billerType) return null;
    return {
      billerType,
      billerAccountRef: billerAccountRef.trim(),
      amount: parsedAmount,
    };
  }, [billerType, billerAccountRef, parsedAmount]);

  const canOpenConfirm =
    !!billerType &&
    billerAccountRef.trim().length >= 3 &&
    Number.isFinite(parsedAmount) &&
    parsedAmount > 0 &&
    pay.status !== 'submitting';

  const onPayPress = useCallback(() => {
    if (!canOpenConfirm) return;
    setConfirmOpen(true);
  }, [canOpenConfirm]);

  const onConfirm = useCallback(async () => {
    if (!formValues) return;
    const result = await pay.submit(formValues);
    if (result) {
      setConfirmOpen(false);
    }
  }, [formValues, pay]);

  const onStartOver = useCallback(() => {
    pay.reset();
    setBillerType(null);
    setRef('');
    setAmountInput('');
    setConfirmOpen(false);
  }, [pay]);

  // ── Success surface ──────────────────────────────────────────────
  if (pay.status === 'success' && pay.bill) {
    return (
      <ReceiptSurface bill={pay.bill} onDone={onStartOver} />
    );
  }

  // ── Form surface ─────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.root} testID="bills-payment-screen">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.scroll}>
          <Text variant="h2">{t('bills.title')}</Text>
          <Text variant="caption" color="secondary" style={styles.subtitle}>
            {t('bills.subtitle')}
          </Text>

          {/* Biller grid */}
          <Text variant="bodyBold" style={styles.sectionLabel}>
            {t('bills.choose_biller')}
          </Text>
          <View style={styles.billerGrid} testID="biller-grid">
            {BILLERS.map((b) => (
              <Pressable
                key={b.type}
                onPress={() => setBillerType(b.type)}
                style={[
                  styles.billerTile,
                  billerType === b.type && styles.billerTileSelected,
                ]}
                testID={`biller-tile-${b.type}`}
                accessibilityRole="button"
                accessibilityState={{ selected: billerType === b.type }}
              >
                <Text variant="bodyBold">{b.shortName}</Text>
              </Pressable>
            ))}
          </View>

          {/* Account ref */}
          <Input
            label={selectedBiller?.refPlaceholder ?? t('bills.account_ref_label')}
            value={billerAccountRef}
            onChangeText={setRef}
            placeholder="e.g. 2001234567"
            autoCapitalize="characters"
            autoCorrect={false}
            editable={!!billerType}
            testID="biller-account-ref"
            error={
              pay.error?.validation?.billerAccountRef?.[0] ?? null
            }
          />

          {/* Amount */}
          <Input
            label={t('bills.amount_label')}
            value={amountInput}
            onChangeText={setAmountInput}
            placeholder="0.00"
            keyboardType="decimal-pad"
            editable={!!billerType}
            prefix="AED"
            testID="biller-amount"
            error={pay.error?.validation?.amount?.[0] ?? null}
          />

          {/* Pay CTA */}
          <Button
            title={t('bills.pay')}
            onPress={onPayPress}
            disabled={!canOpenConfirm}
            loading={pay.isSubmittingBill}
            testID="bills-pay-button"
          />

          {pay.error && pay.error.code !== 'VALIDATION_FAILED' && (
            <Card style={styles.errorCard} testID="bills-error-card">
              <Text variant="bodyBold" color="error">
                {t('bills.error_title')}
              </Text>
              <Text variant="caption" color="secondary">
                {pay.error.message}
              </Text>
            </Card>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Confirmation modal */}
      <Modal
        visible={confirmOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setConfirmOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <Card style={styles.modalCard} testID="bills-confirm-modal">
            <Text variant="h2">{t('bills.confirm_title')}</Text>
            {selectedBiller && formValues && (
              <View style={styles.summary}>
                <SummaryLine label={t('bills.biller')} value={selectedBiller.shortName} />
                <SummaryLine label={t('bills.account')} value={formValues.billerAccountRef} />
                <SummaryLine label={t('bills.amount')} value={formatAED(formValues.amount)} />
              </View>
            )}
            <ComplianceBadge />
            <View style={styles.modalActions}>
              <Button
                title={t('bills.cancel')}
                variant="secondary"
                onPress={() => setConfirmOpen(false)}
                disabled={pay.isSubmittingBill}
                testID="bills-cancel-button"
              />
              <Button
                title={t('bills.confirm_pay')}
                onPress={onConfirm}
                loading={pay.isSubmittingBill}
                disabled={pay.isSubmittingBill}
                testID="bills-confirm-button"
              />
            </View>
          </Card>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

// ───────────────────────────────────────────────────────────────────
// Sub-components
// ───────────────────────────────────────────────────────────────────

const SummaryLine: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <View style={styles.summaryRow}>
    <Text variant="caption" color="secondary">{label}</Text>
    <Text variant="bodyBold">{value}</Text>
  </View>
);

const ComplianceBadge: React.FC = () => {
  const { t } = useTranslation();
  return (
    <View style={styles.compliance} testID="bills-compliance-badge">
      <View style={styles.complianceDot} />
      <Text variant="caption" color="secondary" style={styles.complianceText}>
        {t('bills.compliance_badge')}
      </Text>
    </View>
  );
};

const ReceiptSurface: React.FC<{
  bill: import('@services/api/bills').BillPayment;
  onDone: () => void;
}> = ({ bill, onDone }) => {
  const { t } = useTranslation();
  return (
    <SafeAreaView style={styles.root} testID="bills-receipt">
      <ScrollView contentContainerStyle={styles.scroll}>
        <Card style={styles.receiptCard}>
          <Text variant="h2">{t('bills.receipt_title')}</Text>
          <Text variant="caption" color="secondary">{t('bills.receipt_subtitle')}</Text>

          <View style={styles.summary}>
            <SummaryLine label={t('bills.biller')} value={bill.billerType} />
            <SummaryLine label={t('bills.account')} value={bill.billerAccountRef} />
            <SummaryLine label={t('bills.amount')} value={formatAED(bill.amount)} />
            <SummaryLine label={t('bills.fee')} value={formatAED(bill.fee)} />
            <SummaryLine
              label={t('bills.status')}
              value={t(`bills.status_${bill.status}`)}
            />
          </View>

          <ComplianceBadge />
        </Card>

        <Button title={t('bills.pay_another')} onPress={onDone} testID="bills-done-button" />
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.gray[50] },
  scroll: { padding: spacing.base, gap: spacing.md },
  subtitle: { marginTop: -spacing.xs },
  sectionLabel: { marginTop: spacing.sm },
  billerGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  billerTile: {
    minWidth: 90,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.base,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.gray[200],
    backgroundColor: colors.white,
    alignItems: 'center',
  },
  billerTileSelected: {
    borderColor: colors.primary[700],
    backgroundColor: colors.primary[100] ?? colors.primary[700],
  },
  errorCard: {
    padding: spacing.md,
    backgroundColor: colors.error[100] ?? colors.white,
    gap: spacing.xs,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    padding: spacing.lg,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    gap: spacing.md,
  },
  summary: { gap: spacing.xs },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  modalActions: { flexDirection: 'row', gap: spacing.sm },
  compliance: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    backgroundColor: colors.gray[100],
    borderRadius: radii.base,
    alignSelf: 'flex-start',
  },
  complianceDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.success[500],
  },
  complianceText: { fontSize: 11 },
  receiptCard: { padding: spacing.lg, gap: spacing.md },
});
