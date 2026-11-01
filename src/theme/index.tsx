import { Text as RNText, type TextProps, useColorScheme } from 'react-native';

import { colors, type ColorScheme, type ThemeColors, type, type TypeVariant, uppercaseVariants } from './tokens';

export * from './tokens';

/** Light or dark, following the device setting. */
export function useColorSchemeName(): ColorScheme {
  return useColorScheme() === 'dark' ? 'dark' : 'light';
}

export function useColors(): ThemeColors {
  return colors[useColorSchemeName()];
}

type Props = TextProps & {
  variant?: TypeVariant;
  /** A semantic text color; defaults to `text`. */
  color?: keyof ThemeColors;
};

/** Text in the design system's type styles and colors. */
export function Text({ variant = 'body', color = 'text', style, ...rest }: Props) {
  const c = useColors();
  return (
    <RNText
      style={[
        type[variant],
        { color: c[color] },
        uppercaseVariants.includes(variant) && { textTransform: 'uppercase' },
        style,
      ]}
      {...rest}
    />
  );
}
