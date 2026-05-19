import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { colors } from '@theme';

interface Props {
  overlay?: boolean;
  size?: 'small' | 'large';
  color?: string;
}

export const LoadingSpinner: React.FC<Props> = ({
  overlay = false,
  size = 'large',
  color = colors.primary[700],
}) => {
  if (!overlay) return <ActivityIndicator size={size} color={color} />;
  return (
    <View style={styles.overlay} pointerEvents="auto">
      <ActivityIndicator size={size} color={color} />
    </View>
  );
};

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
