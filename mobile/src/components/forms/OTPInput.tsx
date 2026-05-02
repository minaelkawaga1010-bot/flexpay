import React, { RefObject, useEffect } from 'react';
import {
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { colors, radii, spacing, typography } from '@theme';

interface Props {
  value: string;
  onChange: (next: string) => void;
  length?: number;
  onComplete?: (code: string) => void;
  inputRef?: RefObject<TextInput>;
  disabled?: boolean;
}

/**
 * Single hidden TextInput backs N visual cells. This avoids the focus-juggling
 * pitfalls of per-cell inputs while still rendering a typical OTP grid.
 */
export const OTPInput: React.FC<Props> = ({
  value,
  onChange,
  length = 6,
  onComplete,
  inputRef,
  disabled = false,
}) => {
  useEffect(() => {
    if (value.length === length) onComplete?.(value);
    // intentional: only fire when value reaches full length
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, length]);

  const cells = Array.from({ length }).map((_, i) => value[i] ?? '');

  return (
    <View style={styles.row} accessibilityLabel="One-time passcode">
      {cells.map((digit, i) => (
        <View key={i} style={[styles.cell, digit ? styles.cellFilled : null]}>
          <TextInput
            value={digit}
            editable={false}
            style={styles.digit}
            allowFontScaling={false}
          />
        </View>
      ))}
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={(text) => {
          const next = text.replace(/\D/g, '').slice(0, length);
          onChange(next);
        }}
        keyboardType="number-pad"
        maxLength={length}
        autoFocus
        editable={!disabled}
        style={styles.hiddenInput}
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
      />
    </View>
  );
};

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  cell: {
    width: 48,
    height: 56,
    borderRadius: radii.md,
    backgroundColor: colors.gray[50],
    borderWidth: 1,
    borderColor: colors.gray[200],
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellFilled: { borderColor: colors.primary[500], backgroundColor: colors.white },
  digit: {
    fontSize: typography.sizes.xl,
    fontWeight: '700',
    color: colors.gray[900],
    textAlign: 'center',
    width: 24,
  },
  hiddenInput: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
  },
});
