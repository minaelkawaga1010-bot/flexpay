import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import { colors, radii, spacing } from '@theme';
import { Text } from './Text';

type Variant = 'primary' | 'secondary' | 'ghost' | 'link' | 'destructive';
type Size = 'small' | 'medium' | 'large';

interface ButtonProps {
  title: string;
  onPress?: () => void;
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  disabled?: boolean;
  icon?: React.ReactNode;
  style?: ViewStyle;
}

export const Button: React.FC<ButtonProps> = ({
  title,
  onPress,
  variant = 'primary',
  size = 'medium',
  loading = false,
  disabled = false,
  icon,
  style,
}) => {
  const isDisabled = disabled || loading;
  const styles = useStyles(variant, size, isDisabled);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.container,
        pressed && !isDisabled && styles.pressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={styles.label.color as string} />
      ) : (
        <View style={styles.row}>
          {icon ? <View style={{ marginRight: spacing.sm }}>{icon}</View> : null}
          <Text variant={size === 'small' ? 'caption' : 'bodyBold'} style={styles.label}>
            {title}
          </Text>
        </View>
      )}
    </Pressable>
  );
};

function useStyles(variant: Variant, size: Size, disabled: boolean) {
  const heights: Record<Size, number> = { small: 36, medium: 44, large: 52 };
  const paddings: Record<Size, number> = { small: spacing.sm, medium: spacing.base, large: spacing.lg };

  const palette: Record<Variant, { bg: string; fg: string; border?: string }> = {
    primary: { bg: colors.primary[700], fg: colors.white },
    secondary: { bg: colors.gray[100], fg: colors.gray[900] },
    ghost: { bg: 'transparent', fg: colors.primary[700] },
    link: { bg: 'transparent', fg: colors.primary[700] },
    destructive: { bg: colors.error[500], fg: colors.white },
  };
  const p = palette[variant];

  return StyleSheet.create({
    container: {
      height: heights[size],
      paddingHorizontal: paddings[size],
      borderRadius: variant === 'link' ? 0 : radii.base,
      backgroundColor: disabled ? colors.gray[200] : p.bg,
      alignItems: 'center',
      justifyContent: 'center',
      opacity: disabled ? 0.7 : 1,
    },
    pressed: { opacity: 0.85 },
    row: { flexDirection: 'row', alignItems: 'center' },
    label: {
      color: disabled ? colors.gray[500] : p.fg,
      textAlign: 'center',
    },
  });
}
