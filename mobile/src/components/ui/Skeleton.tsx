import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View, ViewStyle } from 'react-native';
import { colors, radii } from '@theme';

/**
 * Skeleton — animated placeholder block.
 *
 * A small, dependency-free shimmer that wraps the design-system
 * neutral palette. Use as a first-paint placeholder when the
 * underlying AsyncValue is in its `idle` or `loading` state. Once
 * the query has resolved at least once, subsequent fetches should
 * use the RefreshControl spinner (or the inline retry banner on
 * error) instead of replacing real content with a skeleton.
 *
 * Why animated:
 *   A static grey block reads as a broken UI to fast-eyed users.
 *   The fading opacity loop is the universal signal for "content
 *   incoming." We use Animated (not Reanimated) so the skeleton has
 *   zero peer-dependency surface and works in plain Jest snapshots.
 *
 * Why no external library:
 *   react-native-shimmer-placeholder pulls in a Lottie or LinearGradient
 *   dependency that we'd rather not enlist for a 12-line primitive.
 */

export interface SkeletonProps {
  width?: number | `${number}%`;
  height?: number;
  radius?: number;
  style?: ViewStyle;
  testID?: string;
}

export const Skeleton: React.FC<SkeletonProps> = ({
  width = '100%',
  height = 16,
  radius = radii.sm,
  style,
  testID,
}) => {
  const opacity = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.9, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return (
    <Animated.View
      testID={testID}
      accessibilityRole="progressbar"
      style={[
        styles.base,
        { width: width as number, height, borderRadius: radius, opacity },
        style,
      ]}
    />
  );
};

/**
 * Composed multi-line skeleton — the typical "card with title + 2
 * body lines + amount" shape used on the salary dashboard.
 */
export const SkeletonCard: React.FC<{ testID?: string }> = ({ testID }) => (
  <View style={styles.card} testID={testID}>
    <Skeleton width="40%" height={12} />
    <Skeleton width="70%" height={28} />
    <View style={styles.row}>
      <Skeleton width="30%" height={12} />
      <Skeleton width="20%" height={12} />
    </View>
  </View>
);

const styles = StyleSheet.create({
  base: { backgroundColor: colors.gray[200] },
  card: { gap: 12, padding: 16 },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
});
