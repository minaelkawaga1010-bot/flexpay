import React, { useState } from 'react';
import {
  StyleSheet,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native';
import { colors, radii, spacing, variants } from '@theme';
import { Text } from './Text';

interface InputProps extends TextInputProps {
  label?: string;
  error?: string | null;
  prefix?: string;
  containerStyle?: ViewStyle;
}

export const Input: React.FC<InputProps> = ({
  label,
  error,
  prefix,
  containerStyle,
  onFocus,
  onBlur,
  style,
  ...rest
}) => {
  const [focused, setFocused] = useState(false);

  return (
    <View style={containerStyle}>
      {label ? (
        <Text variant="caption" color="secondary" style={styles.label}>
          {label}
        </Text>
      ) : null}

      <View
        style={[
          styles.field,
          focused && styles.fieldFocused,
          error ? styles.fieldError : null,
        ]}
      >
        {prefix ? (
          <Text variant="bodyBold" color="secondary" style={styles.prefix}>
            {prefix}
          </Text>
        ) : null}
        <TextInput
          {...rest}
          placeholderTextColor={colors.gray[400]}
          style={[variants.body, styles.input, style]}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
        />
      </View>

      {error ? (
        <Text variant="caption" color="error" style={styles.error}>
          {error}
        </Text>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  label: { marginBottom: spacing.xs },
  field: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.base,
    backgroundColor: colors.gray[50],
    borderRadius: radii.base,
    borderWidth: 1,
    borderColor: colors.gray[200],
  },
  fieldFocused: { borderColor: colors.primary[500] },
  fieldError: { borderColor: colors.error[500] },
  prefix: { marginRight: spacing.sm },
  input: { flex: 1, paddingVertical: 0, color: colors.gray[900] },
  error: { marginTop: spacing.xs },
});
