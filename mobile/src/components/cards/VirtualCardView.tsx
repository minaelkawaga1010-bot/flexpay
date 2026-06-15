import React, { useCallback } from 'react';
import {
  Dimensions,
  Pressable,
  StyleSheet,
  Switch,
  View,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { useTranslation } from 'react-i18next';
import { Text } from '@components/ui/Text';
import { useCardReveal } from '@hooks/useCardReveal';
import { useCardFreeze } from '@hooks/useCardFreeze';
import { formatCardExpiry, maskCardNumber } from '@services/utils/currency';
import { colors, radii, shadows, spacing } from '@theme';
import type { Card } from '@/types/card';

/**
 * VirtualCardView — premium Mastercard-gradient virtual card surface.
 *
 * Responsibilities:
 *   • Render the masked PAN, brand mark, holder name, expiry, and
 *     a dynamic status tag (ACTIVE / FROZEN / BLOCKED / EXPIRED).
 *   • Drive the secure-reveal interaction through `useCardReveal`,
 *     swapping the masked PAN for the unmasked one only while the
 *     hook's `status === 'revealed'`. Auto-clears via the hook timer.
 *   • Drive the freeze/unfreeze toggle through `useCardFreeze`,
 *     issuing the rail call and rolling back the local store row
 *     on failure.
 *   • Mount the CBUAE Universal Account compliance badge on the
 *     card surface — explicit visual signal that this card is a
 *     spend instrument linked to the SVF wallet, NEVER a WPS payee.
 *
 * Non-responsibilities:
 *   • Network coordination — the reveal/freeze hooks own that.
 *   • Persistent PAN storage — sensitive data lives in the hook's
 *     component-local state, lost on unmount or auto-clear.
 */

const { width } = Dimensions.get('window');
const CARD_WIDTH = width - spacing.xl * 2;
const CARD_HEIGHT = CARD_WIDTH * 0.62;

interface Props {
  card: Card;
  cardholderName?: string;
  testID?: string;
}

export const VirtualCardView: React.FC<Props> = ({
  card,
  cardholderName = 'FLEXPAY USER',
  testID,
}) => {
  const { t } = useTranslation();
  const reveal = useCardReveal({ cardId: card.id });
  const freeze = useCardFreeze();

  const isFrozen = card.status === 'BLOCKED';
  const isActive = card.status === 'ACTIVE';
  const isRevealed = reveal.status === 'revealed' && reveal.details != null;

  const onToggleFreeze = useCallback(() => {
    void freeze.toggle(card);
    // If we freeze while details are revealed, also re-mask — frozen
    // cards have no business showing a usable PAN on screen.
    if (isRevealed) reveal.hide();
  }, [card, freeze, isRevealed, reveal]);

  const onPressReveal = useCallback(() => {
    if (isRevealed) {
      reveal.hide();
      return;
    }
    void reveal.reveal();
  }, [isRevealed, reveal]);

  // Pick a gradient family based on status. Frozen = cool slate so
  // the visual state matches the functional state at a glance.
  const gradientColors = isFrozen
    ? [colors.gray[600], colors.gray[800]]
    : isActive
    ? [colors.primary[500], colors.primary[900]]
    : [colors.gray[700], colors.gray[900]];

  return (
    <View testID={testID ?? 'virtual-card-view'}>
      <View style={styles.cardContainer}>
        <LinearGradient
          colors={gradientColors}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.gradient}
        >
          {/* ── Header: brand mark + status tag ────────────────────── */}
          <View style={styles.headerRow}>
            <Text variant="bodyBold" color="inverse" style={styles.brand}>
              {card.brand?.toUpperCase() ?? 'MASTERCARD'}
            </Text>
            <StatusTag status={card.status} />
          </View>

          {/* ── Center: PAN ─────────────────────────────────────────── */}
          <View style={styles.panRow}>
            <Text
              variant="h2"
              color="inverse"
              style={styles.pan}
              testID={isRevealed ? 'virtual-card-pan-revealed' : 'virtual-card-pan-masked'}
            >
              {isRevealed
                ? formatRevealedPan(reveal.details!.pan)
                : maskCardNumber(card.last4)}
            </Text>
          </View>

          {/* ── Footer: holder + expiry + CVV (if revealed) ─────────── */}
          <View style={styles.footerRow}>
            <View style={styles.footerCol}>
              <Text variant="caption" color="inverse" style={styles.label}>
                {t('cards.cardholder')}
              </Text>
              <Text variant="bodyBold" color="inverse" testID="virtual-card-holder">
                {cardholderName.toUpperCase()}
              </Text>
            </View>
            <View style={styles.footerCol}>
              <Text variant="caption" color="inverse" style={styles.label}>
                {t('cards.expires')}
              </Text>
              <Text variant="bodyBold" color="inverse" testID="virtual-card-expiry">
                {isRevealed
                  ? formatCardExpiry(reveal.details!.expiryMonth, reveal.details!.expiryYear)
                  : formatCardExpiry(card.expiryMonth, card.expiryYear)}
              </Text>
            </View>
            {isRevealed && (
              <View style={styles.footerCol}>
                <Text variant="caption" color="inverse" style={styles.label}>
                  {t('cards.cvv')}
                </Text>
                <Text
                  variant="bodyBold"
                  color="inverse"
                  testID="virtual-card-cvv"
                >
                  {reveal.details!.cvv}
                </Text>
              </View>
            )}
          </View>
        </LinearGradient>
      </View>

      {/* ── Compliance badge — CBUAE Universal Account re-characterisation */}
      <ComplianceBadge />

      {/* ── Actions row: Reveal / Freeze ─────────────────────────────── */}
      <View style={styles.actionsRow}>
        <Pressable
          accessibilityRole="button"
          onPress={onPressReveal}
          disabled={reveal.status === 'authenticating' || reveal.status === 'loading'}
          style={[styles.actionButton, !isActive && styles.actionButtonDisabled]}
          testID="virtual-card-reveal-button"
        >
          <Text variant="bodyBold">
            {reveal.status === 'loading'
              ? t('cards.revealing')
              : isRevealed
              ? t('cards.hide_details')
              : t('cards.reveal_details')}
          </Text>
          {isRevealed && reveal.secondsRemaining != null && (
            <Text variant="caption" color="secondary" testID="virtual-card-countdown">
              {t('cards.auto_clear_in', { seconds: reveal.secondsRemaining })}
            </Text>
          )}
        </Pressable>

        <View style={styles.freezeRow}>
          <View style={{ flex: 1 }}>
            <Text variant="bodyBold">{t('cards.freeze')}</Text>
            <Text variant="caption" color="secondary">
              {isFrozen ? t('cards.frozen_subtitle') : t('cards.active_subtitle')}
            </Text>
          </View>
          <Switch
            value={isFrozen}
            onValueChange={onToggleFreeze}
            disabled={freeze.isToggling || card.status === 'EXPIRED' || card.status === 'REPLACED'}
            testID="virtual-card-freeze-toggle"
          />
        </View>
      </View>

      {/* ── Inline error surfaces ────────────────────────────────────── */}
      {reveal.error && (
        <Text variant="caption" color="error" testID="virtual-card-reveal-error">
          {reveal.error.message}
        </Text>
      )}
      {freeze.error && (
        <Text variant="caption" color="error" testID="virtual-card-freeze-error">
          {freeze.error.message}
        </Text>
      )}
    </View>
  );
};

// ───────────────────────────────────────────────────────────────────
// Sub-components
// ───────────────────────────────────────────────────────────────────

const StatusTag: React.FC<{ status: Card['status'] }> = ({ status }) => {
  const { t } = useTranslation();
  const label = (
    {
      ACTIVE: t('cards.status.active'),
      INACTIVE: t('cards.status.inactive'),
      BLOCKED: t('cards.status.frozen'),
      EXPIRED: t('cards.status.expired'),
      REPLACED: t('cards.status.replaced'),
    } as Record<Card['status'], string>
  )[status];

  const tone =
    status === 'ACTIVE'
      ? styles.tagActive
      : status === 'BLOCKED'
      ? styles.tagFrozen
      : styles.tagOther;

  return (
    <View style={[styles.tag, tone]} testID={`virtual-card-status-${status}`}>
      <Text variant="caption" color="inverse" style={styles.tagText}>
        {label}
      </Text>
    </View>
  );
};

const ComplianceBadge: React.FC = () => {
  const { t } = useTranslation();
  return (
    <View style={styles.compliance} testID="virtual-card-compliance-badge">
      <View style={styles.complianceDot} />
      <Text variant="caption" color="secondary" style={styles.complianceText}>
        {t('cards.compliance_badge')}
      </Text>
    </View>
  );
};

// ───────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────

function formatRevealedPan(pan: string): string {
  // Group into 4-digit clusters. Tolerates inputs of any length so a
  // 16-digit Mastercard PAN and a 15-digit AmEx render legibly.
  const clean = pan.replace(/\s+/g, '');
  return clean.match(/.{1,4}/g)?.join(' ') ?? clean;
}

// ───────────────────────────────────────────────────────────────────
// Styles
// ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  cardContainer: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: radii.lg,
    overflow: 'hidden',
    ...(shadows?.lg ?? {}),
  },
  gradient: {
    flex: 1,
    padding: spacing.lg,
    justifyContent: 'space-between',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  brand: { letterSpacing: 2 },
  panRow: { marginVertical: spacing.sm },
  pan: { letterSpacing: 3 },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    gap: spacing.md,
  },
  footerCol: { gap: spacing.xs },
  label: { opacity: 0.85 },
  tag: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs / 2,
    borderRadius: radii.sm,
  },
  tagActive: { backgroundColor: colors.success?.[700] ?? colors.primary[700] },
  tagFrozen: { backgroundColor: colors.warning?.[700] ?? colors.gray[700] },
  tagOther: { backgroundColor: colors.gray[700] },
  tagText: { letterSpacing: 1 },
  compliance: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.sm,
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
    backgroundColor: colors.success?.[500] ?? colors.primary[600],
  },
  complianceText: { fontSize: 11 },
  actionsRow: {
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  actionButton: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.base,
    borderRadius: radii.md,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.gray[200],
    alignItems: 'center',
  },
  actionButtonDisabled: { opacity: 0.4 },
  freezeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
    backgroundColor: colors.white,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.gray[200],
  },
});
