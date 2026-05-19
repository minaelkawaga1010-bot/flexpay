import React from 'react';
import { Text as RNText, TextProps as RNTextProps, StyleSheet } from 'react-native';
import { colors, variants, TypographyVariant } from '@theme';

type TextColor = 'primary' | 'secondary' | 'inverse' | 'error' | 'success';

interface TextProps extends RNTextProps {
  variant?: TypographyVariant;
  color?: TextColor;
}

const colorMap: Record<TextColor, string> = {
  primary: colors.gray[900],
  secondary: colors.gray[600],
  inverse: colors.white,
  error: colors.error[500],
  success: colors.success[700],
};

export const Text: React.FC<TextProps> = ({
  variant = 'body',
  color = 'primary',
  style,
  ...rest
}) => {
  return (
    <RNText
      {...rest}
      style={StyleSheet.flatten([variants[variant], { color: colorMap[color] }, style])}
    />
  );
};
