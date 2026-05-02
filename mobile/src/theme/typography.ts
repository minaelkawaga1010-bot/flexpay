import { Platform, TextStyle } from 'react-native';

export const typography = {
  fonts: {
    regular: Platform.select({ ios: 'System', android: 'Roboto', default: 'System' }),
    medium: Platform.select({ ios: 'System', android: 'Roboto-Medium', default: 'System' }),
    bold: Platform.select({ ios: 'System', android: 'Roboto-Bold', default: 'System' }),
    mono: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
  },
  sizes: {
    xs: 11,
    sm: 13,
    base: 15,
    md: 17,
    lg: 20,
    xl: 24,
    '2xl': 28,
    '3xl': 32,
    '4xl': 40,
  },
  weights: {
    regular: '400',
    medium: '500',
    semibold: '600',
    bold: '700',
  } satisfies Record<string, TextStyle['fontWeight']>,
  lineHeights: {
    tight: 1.2,
    normal: 1.4,
    relaxed: 1.6,
  },
} as const;

export type TypographyVariant =
  | 'h1'
  | 'h2'
  | 'h3'
  | 'body'
  | 'bodyBold'
  | 'caption'
  | 'overline'
  | 'mono';

export const variants: Record<TypographyVariant, TextStyle> = {
  h1: { fontSize: typography.sizes['3xl'], fontWeight: '700', lineHeight: typography.sizes['3xl'] * 1.2 },
  h2: { fontSize: typography.sizes['2xl'], fontWeight: '700', lineHeight: typography.sizes['2xl'] * 1.2 },
  h3: { fontSize: typography.sizes.xl, fontWeight: '600', lineHeight: typography.sizes.xl * 1.3 },
  body: { fontSize: typography.sizes.base, fontWeight: '400', lineHeight: typography.sizes.base * 1.5 },
  bodyBold: { fontSize: typography.sizes.base, fontWeight: '600', lineHeight: typography.sizes.base * 1.5 },
  caption: { fontSize: typography.sizes.sm, fontWeight: '400', lineHeight: typography.sizes.sm * 1.4 },
  overline: { fontSize: typography.sizes.xs, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1 },
  mono: { fontSize: typography.sizes.base, fontFamily: typography.fonts.mono, letterSpacing: 1 },
};
