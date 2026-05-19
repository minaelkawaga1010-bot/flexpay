export const colors = {
  primary: {
    50: '#EFF6FF',
    100: '#DBEAFE',
    200: '#BFDBFE',
    300: '#93C5FD',
    400: '#60A5FA',
    500: '#3B82F6',
    600: '#2563EB',
    700: '#1E40AF',
    800: '#1E3A8A',
    900: '#172554',
  },
  gray: {
    50: '#F9FAFB',
    100: '#F3F4F6',
    200: '#E5E7EB',
    300: '#D1D5DB',
    400: '#9CA3AF',
    500: '#6B7280',
    600: '#4B5563',
    700: '#374151',
    800: '#1F2937',
    900: '#111827',
  },
  success: {
    100: '#D1FAE5',
    500: '#10B981',
    700: '#047857',
  },
  warning: {
    100: '#FEF3C7',
    500: '#F59E0B',
    700: '#B45309',
  },
  error: {
    100: '#FEE2E2',
    500: '#EF4444',
    700: '#B91C1C',
  },
  white: '#FFFFFF',
  black: '#000000',
  transparent: 'transparent',
} as const;

export type ColorScale = keyof typeof colors.primary;
