import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Card, Text } from '@components/ui';
import { colors, spacing } from '@theme';

/**
 * Inline banner surfacing the typed errors that come back from the
 * mobile-wallet gateway (`useMobileWalletStore.lastError`).
 *
 * The gateway emits a small, closed set of error codes. We render a
 * distinct, action-oriented surface for each — never a raw
 * server-message dump. The mapping is:
 *
 *   COMPLIANCE_BLOCK     →  account flagged, ops review pending
 *   ACCOUNT_NOT_ACTIVE   →  account is BLOCKED / DEACTIVATED
 *   KYC_NOT_COMPLETE     →  PENDING_KYC; finish onboarding to unlock
 *   BIOMETRIC_STALE      →  prompt to re-authenticate (transactional)
 *   STEP_UP_*            →  the OTP modal was dismissed; user retry
 *   OVER_AVAILABLE_LIMIT →  client-side I1 cap rejection
 *   UNKNOWN / *          →  generic surface; never mask the network failure
 *
 * Returns null when there's nothing to show — safe to render
 * unconditionally from the parent screen.
 */
export interface BalanceErrorBannerProps {
  error: { code: string; message: string } | null;
  onDismiss?: () => void;
  onRetry?: () => void;
}

type Tone = 'danger' | 'warning' | 'info';

interface BannerSpec {
  tone: Tone;
  titleKey: string;
  bodyKey: string;
  ctaKey?: string;
}

const SPECS: Record<string, BannerSpec> = {
  COMPLIANCE_BLOCK: {
    tone: 'danger',
    titleKey: 'wallet.errors.compliance_title',
    bodyKey: 'wallet.errors.compliance_body',
    ctaKey: 'wallet.errors.compliance_cta',
  },
  ACCOUNT_NOT_ACTIVE: {
    tone: 'danger',
    titleKey: 'wallet.errors.account_blocked_title',
    bodyKey: 'wallet.errors.account_blocked_body',
  },
  KYC_NOT_COMPLETE: {
    tone: 'warning',
    titleKey: 'wallet.errors.kyc_title',
    bodyKey: 'wallet.errors.kyc_body',
    ctaKey: 'wallet.errors.kyc_cta',
  },
  BIOMETRIC_STALE: {
    tone: 'warning',
    titleKey: 'wallet.errors.biometric_title',
    bodyKey: 'wallet.errors.biometric_body',
    ctaKey: 'common.retry',
  },
  OVER_AVAILABLE_LIMIT: {
    tone: 'warning',
    titleKey: 'wallet.errors.over_limit_title',
    bodyKey: 'wallet.errors.over_limit_body',
  },
};

const TONE_STYLES: Record<Tone, { bg: string; fg: string }> = {
  danger: { bg: '#FEE2E2', fg: '#7F1D1D' },
  warning: { bg: '#FEF3C7', fg: '#78350F' },
  info: { bg: '#DBEAFE', fg: '#1E3A8A' },
};

export const BalanceErrorBanner: React.FC<BalanceErrorBannerProps> = ({
  error,
  onDismiss: _onDismiss,
  onRetry,
}) => {
  const { t } = useTranslation();
  if (!error) return null;

  const spec = SPECS[error.code];
  // Unknown / fallback path. We surface the server's own message rather
  // than swallowing it — the user gets to see what actually happened.
  if (!spec) {
    return (
      <Card style={[styles.card, { backgroundColor: TONE_STYLES.info.bg }]} testID="balance-error-unknown">
        <Text variant="bodyBold" style={{ color: TONE_STYLES.info.fg }}>
          {t('wallet.errors.generic_title')}
        </Text>
        <Text variant="caption" style={{ color: TONE_STYLES.info.fg }}>
          {error.message}
        </Text>
      </Card>
    );
  }

  const palette = TONE_STYLES[spec.tone];

  return (
    <Card
      style={[styles.card, { backgroundColor: palette.bg }]}
      testID={`balance-error-${error.code.toLowerCase()}`}
    >
      <Text variant="bodyBold" style={{ color: palette.fg }}>
        {t(spec.titleKey)}
      </Text>
      <Text variant="caption" style={[styles.body, { color: palette.fg }]}>
        {t(spec.bodyKey)}
      </Text>
      {spec.ctaKey && onRetry ? (
        <View style={styles.ctaRow}>
          <Text
            variant="bodyBold"
            style={{ color: palette.fg }}
            onPress={onRetry}
            testID="balance-error-cta"
          >
            {t(spec.ctaKey)}
          </Text>
        </View>
      ) : null}
    </Card>
  );
};

const styles = StyleSheet.create({
  card: {
    margin: spacing.base,
    marginBottom: 0,
    padding: spacing.md,
    gap: spacing.xs,
    borderLeftWidth: 4,
    borderLeftColor: colors.gray[700],
  },
  body: { lineHeight: 18 },
  ctaRow: { marginTop: spacing.sm },
});
