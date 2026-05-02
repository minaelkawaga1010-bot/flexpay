import React from 'react';
import { Input } from '@components/ui/Input';

interface Props {
  value: string;
  onChange: (next: string) => void;
  label?: string;
  error?: string | null;
}

const sanitise = (raw: string) => raw.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1');

export const AmountInput: React.FC<Props> = ({ value, onChange, label, error }) => {
  return (
    <Input
      label={label}
      value={value}
      onChangeText={(text) => onChange(sanitise(text))}
      placeholder="0.00"
      keyboardType="decimal-pad"
      prefix="AED"
      error={error}
    />
  );
};
