import React from 'react';
import { Dimensions, Pressable, StyleSheet, View } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { useTranslation } from 'react-i18next';
import { Text } from '@components/ui/Text';
import { colors, radii, shadows, spacing, typography } from '@theme';
import { formatAED, formatCardExpiry, maskCardNumber } from '@services/utils/currency';

const { width } = Dimensions.get('window');
const CARD_WIDTH = width - spacing.xl * 2;
const CARD_HEIGHT = CARD_WIDTH * 0.62;

interface Props {
  card: {
    last4: string;
    expiryMonth: number;
    expiryYear: number;
    brand: string;
    status: string;
  };
  cardholderName?: string;
  balance?: number;
  onPress?: () => void;
}

export const VirtualCardVisual: React.FC<Props> = ({
  card,
  cardholderName = 'FLEXPAY USER',
  balance,
  onPress,
}) => {
  const { t } = useTranslation();
  const isBlocked = card.status !== 'ACTIVE';

  const colorsForStatus = isBlocked
    ? [colors.gray[700], colors.gray[900]]
    : [colors.primary[600], colors.primary[900]];

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={[styles.cardContainer, isBlocked && styles.cardBlocked]}
    >
      <LinearGradient
        colors={colorsForStatus}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.gradient}
      >
        <View style={styles.header}>
          <Text variant="bodyBold" color="inverse" style={styles.brand}>
            {card.brand}
          </Text>
          {isBlocked ? (
            <View style={styles.statusBadge}>
              <Text variant="caption" color="inverse" style={styles.statusText}>
                {t('cards.status.blocked', 'Blocked')}
              </Text>
            </View>
          ) : null}
        </View>

        <Text style={styles.cardNumber}>{maskCardNumber(card.last4)}</Text>

        {balance !== undefined ? (
          <View>
            <Text variant="caption" color="inverse" style={styles.balanceLabel}>
              {t('cards.balance', 'Balance')}
            </Text>
            <Text variant="h2" color="inverse">
              {formatAED(balance)}
            </Text>
          </View>
        ) : null}

        <View style={styles.footer}>
          <View>
            <Text variant="overline" color="inverse" style={styles.muted}>
              {t('cards.cardholder', 'Cardholder')}
            </Text>
            <Text variant="bodyBold" color="inverse">
              {cardholderName}
            </Text>
          </View>
          <View style={styles.expiryWrap}>
            <Text variant="overline" color="inverse" style={styles.muted}>
              {t('cards.expires', 'Expires')}
            </Text>
            <Text variant="bodyBold" color="inverse">
              {formatCardExpiry(card.expiryMonth, card.expiryYear)}
            </Text>
          </View>
        </View>

        <View style={styles.icons}>
          <View style={styles.chip} />
        </View>
      </LinearGradient>

      {isBlocked ? (
        <View style={styles.blockedOverlay}>
          <Text variant="bodyBold" color="inverse" style={styles.blockedText}>
            {t('cards.blocked_message', 'Card temporarily blocked')}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  cardContainer: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: radii.lg,
    overflow: 'hidden',
    ...shadows.lg,
  },
  cardBlocked: { opacity: 0.7 },
  gradient: { flex: 1, padding: spacing.lg, justifyContent: 'space-between' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  brand: { letterSpacing: 1 },
  statusBadge: {
    backgroundColor: colors.error[500],
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radii.sm,
  },
  statusText: { fontSize: 10 },
  cardNumber: {
    fontFamily: typography.fonts.mono,
    fontSize: 20,
    color: colors.white,
    letterSpacing: 3,
    textAlign: 'center',
  },
  balanceLabel: { opacity: 0.8, marginBottom: 2 },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  expiryWrap: { alignItems: 'flex-end' },
  muted: { opacity: 0.7 },
  icons: { position: 'absolute', bottom: spacing.base, right: spacing.base },
  chip: {
    width: 36,
    height: 26,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: radii.sm,
    borderLeftWidth: 2,
    borderRightWidth: 2,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  blockedOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  blockedText: {
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radii.full,
  },
});
