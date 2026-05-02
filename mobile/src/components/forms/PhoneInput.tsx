import React from 'react';
import { Input } from '@components/ui/Input';

interface Props {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  error?: string | null;
  editable?: boolean;
  testID?: string;
}

const sanitise = (raw: string) => {
  // Keep only `+` and digits, with `+` only allowed at index 0.
  let cleaned = raw.replace(/[^\d+]/g, '');
  cleaned = cleaned.replace(/(?!^)\+/g, '');
  return cleaned;
};

export const PhoneInput: React.FC<Props> = ({
  value,
  onChange,
  placeholder,
  error,
  editable,
  testID,
}) => {
  return (
    <Input
      value={value}
      onChangeText={(text) => onChange(sanitise(text))}
      placeholder={placeholder ?? '+971 50 123 4567'}
      keyboardType="phone-pad"
      autoComplete="tel"
      autoCorrect={false}
      editable={editable}
      error={error}
      maxLength={16}
      testID={testID}
    />
  );
};
