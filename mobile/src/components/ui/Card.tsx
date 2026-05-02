import React from 'react';
import { StyleSheet, View, ViewProps } from 'react-native';
import { colors, radii, shadows, spacing } from '@theme';

interface CardProps extends ViewProps {
  elevation?: 'sm' | 'md' | 'lg' | 'none';
  padding?: number;
}

export const Card: React.FC<CardProps> = ({
  elevation = 'sm',
  padding = spacing.base,
  style,
  ...rest
}) => {
  return (
    <View
      {...rest}
      style={[
        styles.card,
        elevation !== 'none' ? shadows[elevation] : null,
        { padding },
        style,
      ]}
    />
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.white,
    borderRadius: radii.lg,
  },
});
