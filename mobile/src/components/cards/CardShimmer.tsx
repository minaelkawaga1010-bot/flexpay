import React, { useEffect } from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { colors, radii, spacing } from '@theme';

const { width } = Dimensions.get('window');
const CARD_WIDTH = width - spacing.xl * 2;
const CARD_HEIGHT = CARD_WIDTH * 0.62;

export const CardShimmer: React.FC = () => {
  const opacity = useSharedValue(0.4);

  useEffect(() => {
    opacity.value = withRepeat(
      withTiming(1, { duration: 800, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [opacity]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <View style={styles.container}>
      <Animated.View style={[styles.card, animatedStyle]} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { width: CARD_WIDTH, height: CARD_HEIGHT, alignSelf: 'center' },
  card: {
    flex: 1,
    backgroundColor: colors.gray[200],
    borderRadius: radii.lg,
  },
});
