import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import {
  NativeSyntheticEvent,
  StyleSheet,
  TextInput,
  TextInputKeyPressEventData,
  View,
} from 'react-native';
import { colors, radii, spacing, typography } from '@theme';

export interface OTPInputHandle {
  /** Focus the first cell (typically called when the parent resets the value). */
  focus: () => void;
}

interface Props {
  value: string;
  onChange: (next: string) => void;
  length?: number;
  onComplete?: (code: string) => void;
  disabled?: boolean;
  testIDPrefix?: string;
}

/**
 * One independently-focusable TextInput per digit. Auto-advances on
 * digit entry; Backspace either clears the current cell (if filled) or
 * jumps back to the previous cell (if empty).
 *
 * The component holds its own digit state so the test harness — which
 * passes `value=""` and never re-renders the parent — can still drive
 * the cells sequentially.
 */
export const OTPInput = forwardRef<OTPInputHandle, Props>(
  (
    { value, onChange, length = 6, onComplete, disabled = false, testIDPrefix = 'otp-input' },
    ref,
  ) => {
    const refs = useRef<Array<TextInput | null>>(new Array(length).fill(null));

    const [digits, setDigits] = useState<string[]>(() =>
      Array.from({ length }, (_, i) => value[i] ?? ''),
    );

    // Sync down when the parent forces a reset (e.g. clearing on
    // INVALID_OR_EXPIRED_OTP). We only resync when the parent's value
    // diverges from our internal state — otherwise we'd loop on every
    // keystroke.
    useEffect(() => {
      const current = digits.join('');
      if (value === current) return;
      setDigits(Array.from({ length }, (_, i) => value[i] ?? ''));
      // length is intentionally not in deps — changing length is a
      // structural change the parent should also key against.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value]);

    useImperativeHandle(ref, () => ({
      focus: () => refs.current[0]?.focus(),
    }));

    const commit = (next: string[]) => {
      setDigits(next);
      const joined = next.join('');
      onChange(joined);
      if (next.every((d) => d.length === 1)) onComplete?.(joined);
    };

    const handleChange = (text: string, index: number) => {
      // Take only the trailing character — paste/SMS-autofill can deliver
      // the whole code at once; route those to the multi-cell branch.
      if (text.length > 1) {
        const cleaned = text.replace(/\D/g, '').slice(0, length);
        const next = Array.from({ length }, (_, i) => cleaned[i] ?? '');
        commit(next);
        // Move focus to the next empty cell (or the last cell if full).
        const target = Math.min(cleaned.length, length - 1);
        refs.current[target]?.focus();
        return;
      }

      const digit = text.slice(-1);
      if (digit !== '' && !/\d/.test(digit)) return;

      const next = [...digits];
      next[index] = digit;
      commit(next);

      if (digit && index < length - 1) refs.current[index + 1]?.focus();
    };

    const handleKeyPress = (
      e: NativeSyntheticEvent<TextInputKeyPressEventData>,
      index: number,
    ) => {
      if (e.nativeEvent.key !== 'Backspace') return;
      const next = [...digits];
      if (next[index]) {
        next[index] = '';
        commit(next);
      } else if (index > 0) {
        next[index - 1] = '';
        commit(next);
        refs.current[index - 1]?.focus();
      }
    };

    return (
      <View style={styles.row} accessibilityLabel="One-time passcode">
        {digits.map((digit, i) => (
          <TextInput
            key={i}
            ref={(el) => {
              refs.current[i] = el;
            }}
            value={digit}
            onChangeText={(text) => handleChange(text, i)}
            onKeyPress={(e) => handleKeyPress(e, i)}
            editable={!disabled}
            maxLength={1}
            keyboardType="number-pad"
            autoFocus={i === 0}
            // SMS autofill on iOS only attaches to the first cell; once
            // it pastes, our multi-character branch fans the digits out.
            textContentType={i === 0 ? 'oneTimeCode' : 'none'}
            autoComplete={i === 0 ? 'sms-otp' : 'off'}
            style={[styles.cell, digit ? styles.cellFilled : null]}
            testID={`${testIDPrefix}-${i}`}
            accessibilityLabel={`Digit ${i + 1}`}
          />
        ))}
      </View>
    );
  },
);

OTPInput.displayName = 'OTPInput';

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  cell: {
    width: 48,
    height: 56,
    borderRadius: radii.md,
    backgroundColor: colors.gray[50],
    borderWidth: 1,
    borderColor: colors.gray[200],
    textAlign: 'center',
    fontSize: typography.sizes.xl,
    fontWeight: '700',
    color: colors.gray[900],
  },
  cellFilled: { borderColor: colors.primary[500], backgroundColor: colors.white },
});
