import React, { useCallback, useEffect, useRef } from 'react';
import {
  Animated,
  FlatList,
  Linking,
  ListRenderItem,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Button, Card, EmptyState, Skeleton, SkeletonCard, Text } from '@components/ui';
import { useAIOffers } from '@hooks/useAIOffers';
import type { PersonalisedOffer } from '@services/api/aiOffers';
import { colors, radii, spacing } from '@theme';

/**
 * AIOffersScreen — Tool 11-firewalled, LLM-personalised offer feed.
 *
 * Visual stack:
 *   • Header — Tool 11 / Prompt Firewall Secured compliance badge,
 *     pinned visibly inside the layout perimeter.
 *   • List — virtualised FlatList of premium animated offer cards.
 *     Each card fades in once on first mount (Animated, no
 *     Reanimated dependency for jest-friendliness).
 *   • CTA — per-card "Claim offer" button gated on the hook's
 *     `claimingOfferId` lock so a rapid tap never double-fires.
 *
 * State surfaces:
 *   • loading        → 4 SkeletonCard rows under the badge.
 *   • success/empty  → EmptyState with localised copy + retry CTA.
 *   • error          → inline error card + retry button.
 *   • firewall_block → distinct surface explaining the safety
 *                       service refused the request. Codes 403 vs
 *                       451 surface different copy.
 */

export const AIOffersScreen: React.FC = () => {
  const { t } = useTranslation();
  const feed = useAIOffers();

  const renderItem: ListRenderItem<PersonalisedOffer> = useCallback(
    ({ item, index }) => (
      <OfferCard
        offer={item}
        index={index}
        onClaim={async () => {
          const link = await feed.claim(item.offerId);
          if (link) Linking.openURL(link).catch(() => {});
        }}
        isClaiming={feed.claimingOfferId === item.offerId}
        anyClaimInFlight={feed.claimingOfferId !== null}
      />
    ),
    [feed],
  );

  return (
    <SafeAreaView style={styles.root} testID="ai-offers-screen">
      <FlatList
        testID="ai-offers-flatlist"
        data={feed.status === 'success' ? feed.offers : []}
        keyExtractor={(o) => o.offerId}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={feed.isRefreshing}
            onRefresh={() => void feed.refresh()}
            testID="ai-offers-refresh-control"
          />
        }
        removeClippedSubviews
        initialNumToRender={6}
        maxToRenderPerBatch={6}
        windowSize={5}
        onEndReached={() => void feed.loadMore()}
        onEndReachedThreshold={0.5}
        ListHeaderComponent={<Header />}
        ListEmptyComponent={
          feed.status === 'loading' ? (
            <View testID="ai-offers-skeletons">
              {Array.from({ length: 4 }).map((_, i) => (
                <Card key={i} style={styles.cardLoading}>
                  <SkeletonCard />
                </Card>
              ))}
            </View>
          ) : feed.status === 'firewall_blocked' ? (
            <FirewallBlockedSurface
              code={feed.error?.code ?? 'AI_OFFERS_FIREWALL_UNAVAILABLE'}
              message={feed.error?.message ?? ''}
              onRetry={feed.retry}
            />
          ) : feed.status === 'error' ? (
            <ErrorSurface message={feed.error?.message ?? ''} onRetry={feed.retry} />
          ) : (
            <View testID="ai-offers-empty">
              <EmptyState
                title={t('ai_offers.empty_title')}
                subtitle={t('ai_offers.empty_subtitle')}
              />
            </View>
          )
        }
        renderItem={renderItem}
      />
    </SafeAreaView>
  );
};

// ───────────────────────────────────────────────────────────────────
// Compliance badge — pinned in the header so it's always visible
// inside the layout perimeter, regardless of feed state.
// ───────────────────────────────────────────────────────────────────

const Header: React.FC = () => {
  const { t } = useTranslation();
  return (
    <View style={styles.header}>
      <Text variant="h2">{t('ai_offers.title')}</Text>
      <Text variant="caption" color="secondary" style={styles.subtitle}>
        {t('ai_offers.subtitle')}
      </Text>
      <View style={styles.firewallBadge} testID="ai-offers-firewall-badge">
        <View style={styles.firewallDot} />
        <Text variant="caption" color="secondary" style={styles.firewallText}>
          {t('ai_offers.firewall_badge')}
        </Text>
      </View>
    </View>
  );
};

// ───────────────────────────────────────────────────────────────────
// Premium animated offer card
// ───────────────────────────────────────────────────────────────────

interface OfferCardProps {
  offer: PersonalisedOffer;
  index: number;
  onClaim: () => Promise<void>;
  isClaiming: boolean;
  anyClaimInFlight: boolean;
}

const OfferCard: React.FC<OfferCardProps> = ({ offer, index, onClaim, isClaiming, anyClaimInFlight }) => {
  const { t } = useTranslation();
  const fade = useRef(new Animated.Value(0)).current;
  const slide = useRef(new Animated.Value(16)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, {
        toValue: 1,
        duration: 320,
        delay: Math.min(index * 60, 360),
        useNativeDriver: true,
      }),
      Animated.timing(slide, {
        toValue: 0,
        duration: 320,
        delay: Math.min(index * 60, 360),
        useNativeDriver: true,
      }),
    ]).start();
  }, [fade, slide, index]);

  const eligibilityTone = scoreTone(offer.score);

  return (
    <Animated.View
      style={{ opacity: fade, transform: [{ translateY: slide }] }}
      testID={`ai-offer-card-${offer.offerId}`}
    >
      <Card style={styles.card} elevation="md">
        <View style={styles.cardHeader}>
          <View style={{ flex: 1 }}>
            <Text variant="bodyBold">
              {offer.title ?? offer.merchant ?? t('ai_offers.offer_label')}
            </Text>
            {offer.merchant && (
              <Text variant="caption" color="secondary">
                {offer.merchant}
              </Text>
            )}
          </View>
          <View style={[styles.scoreBadge, eligibilityTone]}
                testID={`ai-offer-score-${offer.offerId}`}>
            <Text variant="caption" color="inverse" style={styles.scoreText}>
              {scoreLabel(offer.score)}
            </Text>
          </View>
        </View>

        <Text variant="caption" color="secondary" style={styles.reason}>
          {offer.reason}
        </Text>

        {offer.discountPercentage != null && (
          <Text variant="bodyBold" style={styles.discount}>
            {offer.discountPercentage}% off
          </Text>
        )}

        <View style={styles.ctaRow}>
          <View style={styles.categoryChip} testID={`ai-offer-category-${offer.offerId}`}>
            <Text variant="caption" color="secondary">
              {t(`ai_offers.category.${offer.category}`)}
            </Text>
          </View>
          <Pressable
            onPress={() => {
              if (anyClaimInFlight) return;
              void onClaim();
            }}
            disabled={anyClaimInFlight}
            style={[styles.cta, anyClaimInFlight && styles.ctaDisabled]}
            testID={`ai-offer-claim-${offer.offerId}`}
            accessibilityRole="button"
            accessibilityState={{ disabled: anyClaimInFlight, busy: isClaiming }}
          >
            <Text variant="bodyBold" color="inverse">
              {isClaiming ? t('ai_offers.claiming') : t('ai_offers.claim')}
            </Text>
          </Pressable>
        </View>
      </Card>
    </Animated.View>
  );
};

// ───────────────────────────────────────────────────────────────────
// Failure surfaces
// ───────────────────────────────────────────────────────────────────

const FirewallBlockedSurface: React.FC<{
  code: string;
  message: string;
  onRetry: () => void;
}> = ({ code, message, onRetry }) => {
  const { t } = useTranslation();
  const isInjection = code === 'AI_OFFERS_INJECTION_BLOCKED';
  return (
    <Card style={styles.firewallBlocked} testID="ai-offers-firewall-blocked">
      <Text variant="h2">
        {isInjection
          ? t('ai_offers.firewall_blocked.injection_title')
          : t('ai_offers.firewall_blocked.unavailable_title')}
      </Text>
      <Text variant="caption" color="secondary" style={styles.firewallBody}>
        {message ||
          (isInjection
            ? t('ai_offers.firewall_blocked.injection_body')
            : t('ai_offers.firewall_blocked.unavailable_body'))}
      </Text>
      <Text variant="caption" color="secondary" testID="ai-offers-firewall-code">
        {code}
      </Text>
      {!isInjection && (
        <Button title={t('ai_offers.retry')} onPress={onRetry} testID="ai-offers-firewall-retry" />
      )}
    </Card>
  );
};

const ErrorSurface: React.FC<{ message: string; onRetry: () => void }> = ({ message, onRetry }) => {
  const { t } = useTranslation();
  return (
    <Card style={styles.errorCard} testID="ai-offers-error">
      <Text variant="bodyBold">{t('ai_offers.error_title')}</Text>
      <Text variant="caption" color="secondary" style={styles.errorBody}>
        {message || t('ai_offers.error_body')}
      </Text>
      <Button title={t('ai_offers.retry')} onPress={onRetry} testID="ai-offers-retry" />
    </Card>
  );
};

// ───────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────

function scoreTone(score: number) {
  if (score >= 80) return styles.scoreHigh;
  if (score >= 50) return styles.scoreMid;
  return styles.scoreLow;
}

function scoreLabel(score: number) {
  if (score >= 80) return 'TOP MATCH';
  if (score >= 50) return 'GOOD MATCH';
  return 'WORTH A LOOK';
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.gray[50] },
  list: { paddingBottom: spacing.xl },
  header: { padding: spacing.base, gap: spacing.xs },
  subtitle: { marginTop: -spacing.xs },
  firewallBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    backgroundColor: colors.success[100],
    borderRadius: radii.base,
    alignSelf: 'flex-start',
  },
  firewallDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.success[500],
  },
  firewallText: { fontSize: 11 },
  card: {
    margin: spacing.base,
    marginVertical: spacing.sm,
    padding: spacing.md,
    gap: spacing.sm,
  },
  cardLoading: { margin: spacing.base, marginVertical: spacing.sm, padding: spacing.md },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  scoreBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs / 2,
    borderRadius: radii.sm,
  },
  scoreHigh: { backgroundColor: colors.success[700] },
  scoreMid: { backgroundColor: colors.primary[700] },
  scoreLow: { backgroundColor: colors.gray[600] },
  scoreText: { letterSpacing: 1, fontSize: 10 },
  reason: { lineHeight: 18 },
  discount: { fontSize: 18 },
  ctaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  categoryChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    backgroundColor: colors.gray[100],
    borderRadius: radii.base,
  },
  cta: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.primary[700],
    borderRadius: radii.md,
  },
  ctaDisabled: { opacity: 0.5 },
  firewallBlocked: {
    margin: spacing.base,
    padding: spacing.lg,
    gap: spacing.sm,
    backgroundColor: colors.warning[100],
  },
  firewallBody: { lineHeight: 20 },
  errorCard: {
    margin: spacing.base,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  errorBody: { lineHeight: 20 },
});
