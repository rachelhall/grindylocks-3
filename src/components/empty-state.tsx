import type { ReactNode } from 'react';
import { Platform, StyleSheet, View, type ViewStyle } from 'react-native';

import { HalftoneGround } from '@/components/park-header';
import { Button, Icon, type IconName } from '@/components/ui';
import { brand, fontFamily, space, stroke, Text, useColors } from '@/theme';

export type EmptyAction = {
  label: string;
  onPress: () => void;
  icon?: IconName;
  /**
   * `accent` is the screen's one pink button (Post a clip here, New post,
   * Turn on location); `outline` the usual quiet next step. Defaults to outline.
   */
  kind?: 'accent' | 'outline';
};

type Props = {
  /**
   * `product` (the default) is the flat layer for lists, tabs and errors.
   * `brand` is the halftone block with the pink-offset title, only for a
   * screen that's truly empty and invites the person themselves (Home with
   * nothing near you or nothing at all, your own Posts tab).
   */
  variant?: 'product' | 'brand';
  title: string;
  body?: string | ReactNode;
  /** A small icon above the title (product only): lock, cloud off. */
  icon?: IconName;
  /** At most one: the most useful next step. */
  action?: EmptyAction;
  /** Real content under the copy: nearby parks, local skaters, a second link. */
  children?: ReactNode;
  /** Product only: centred under a tab bar (profile tabs), or left-aligned in a section. */
  align?: 'center' | 'start';
  /** Product only: a dashed box, for an empty section inside a busier page. */
  dashed?: boolean;
  style?: ViewStyle;
};

/**
 * Every empty state in the app (Empty states page of the Mockups canvas,
 * approved Nov 5): a title, one line, at most one action, and room for real
 * content (nearby parks, local skaters) rather than an illustration.
 */
export function EmptyState({
  variant = 'product',
  title,
  body,
  icon,
  action,
  children,
  align = 'center',
  dashed,
  style,
}: Props) {
  const c = useColors();

  if (variant === 'brand') {
    return (
      <View style={[styles.brand, { borderColor: c.border, backgroundColor: c.surfaceRaised }, style]}>
        <HalftoneGround ground={c.surfaceRaised} fadeStart={0.35} fadeEnd={1.1} />
        <View style={styles.brandInner}>
          <OffsetTitle text={title} />
          {typeof body === 'string' ? (
            <Text variant="body" style={styles.brandBody}>
              {body}
            </Text>
          ) : (
            body
          )}
          {action ? <ActionButton action={action} /> : null}
          {children}
        </View>
      </View>
    );
  }

  const start = align === 'start';
  return (
    <View
      style={[
        start ? styles.productStart : styles.product,
        dashed && [styles.dashed, { borderColor: c.textMuted }],
        style,
      ]}
    >
      {icon ? <Icon name={icon} color={c.text} size={28} /> : null}
      <Text variant="headline" accessibilityRole="header" style={!start && styles.center}>
        {title}
      </Text>
      {typeof body === 'string' ? (
        <Text variant="bodySm" color="textSecondary" style={!start && styles.center}>
          {body}
        </Text>
      ) : (
        body
      )}
      {action ? <ActionButton action={action} style={start ? undefined : styles.centerButton} /> : null}
      {children}
    </View>
  );
}

function ActionButton({ action, style }: { action: EmptyAction; style?: ViewStyle }) {
  const c = useColors();
  const accent = action.kind === 'accent';
  return (
    <Button
      label={action.label}
      icon={action.icon}
      variant={accent ? 'primary' : 'secondary'}
      palette={
        accent
          ? { fill: c.accent, text: c.onAccent, border: c.onAccent }
          : { fill: c.surfaceRaised, text: c.text, border: c.border }
      }
      onPress={action.onPress}
      style={{ ...styles.action, ...style }}
    />
  );
}

/** Large Text: the title wraps but stops growing at 1.6×, so the block stays a block. */
const TITLE_MAX_SCALE = 1.6;

/**
 * The brand layer's title: Archivo Black, uppercase, with a hard pink offset.
 * A second copy draws the offset, since Android won't draw a hard text shadow.
 */
export function OffsetTitle({ text }: { text: string }) {
  const c = useColors();
  return (
    <View style={styles.titleWrap}>
      <Text
        style={[styles.title, styles.titleShadow, { color: brand.pink }]}
        accessibilityElementsHidden
        importantForAccessibility="no"
        maxFontSizeMultiplier={TITLE_MAX_SCALE}
      >
        {text}
      </Text>
      <Text accessibilityRole="header" maxFontSizeMultiplier={TITLE_MAX_SCALE} style={[styles.title, { color: c.text }]}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  brand: { borderWidth: stroke.rule, overflow: 'hidden' },
  brandInner: { paddingHorizontal: 20, paddingTop: space[8], paddingBottom: space[6], gap: 14 },
  brandBody: { maxWidth: 320 },
  titleWrap: { alignSelf: 'flex-start', paddingRight: 3, paddingBottom: 3 },
  title: {
    fontFamily: fontFamily.display,
    fontSize: 32,
    lineHeight: 34,
    textTransform: 'uppercase',
    includeFontPadding: Platform.OS === 'android' ? false : undefined,
  },
  // Same width as the title (the wrap's right padding), so both wrap alike.
  titleShadow: { position: 'absolute', top: 3, left: 3, right: 0 },
  product: { alignItems: 'center', gap: space[2], paddingHorizontal: space[6], paddingTop: space[8], paddingBottom: space[4] },
  productStart: { gap: space[2] },
  dashed: { borderWidth: stroke.rule, borderStyle: 'dashed', padding: space[4] },
  center: { textAlign: 'center' },
  centerButton: { alignSelf: 'center', marginTop: space[2] },
  action: { minHeight: 48, alignSelf: 'stretch' },
});
