import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/ui';
import { fontFamily, space, stroke, Text, useColors } from '@/theme';

/** A settings group: an uppercase label, then its rows. */
export function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View>
      <Text variant="label" color="textSecondary" accessibilityRole="header" style={styles.section}>
        {title}
      </Text>
      <View>{children}</View>
    </View>
  );
}

/**
 * One row: a title, an optional line under it, and on the right a value,
 * a chevron (opens a screen), an external-link mark (leaves the app) or a
 * control such as a switch. Rows with onPress are buttons; the rest are text.
 */
export function SettingsRow({
  title,
  subtitle,
  value,
  trailing,
  control,
  onPress,
  first,
  accessibilityHint,
}: {
  title: string;
  subtitle?: string;
  value?: string;
  trailing?: 'chevron' | 'external';
  control?: ReactNode;
  onPress?: () => void;
  first?: boolean;
  accessibilityHint?: string;
}) {
  const c = useColors();
  const content = (
    <>
      <View style={styles.text}>
        <Text variant="body" style={styles.title}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="bodySm" color="textSecondary">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value || trailing ? (
        <View style={styles.value}>
          {value ? (
            <Text variant="bodySm" color="textSecondary">
              {value}
            </Text>
          ) : null}
          {trailing ? (
            <Icon name={trailing === 'chevron' ? 'chevron' : 'external'} color={c.textSecondary} size={20} />
          ) : null}
        </View>
      ) : null}
      {control}
    </>
  );
  const rowStyle = [
    styles.row,
    { backgroundColor: c.surfaceRaised, borderColor: c.borderSubtle, borderTopWidth: first ? stroke.hairline : 0 },
  ];
  if (!onPress) return <View style={rowStyle}>{content}</View>;
  return (
    <Pressable
      accessibilityRole={trailing === 'external' ? 'link' : 'button'}
      accessibilityLabel={[title, subtitle, value].filter(Boolean).join(', ')}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      style={({ pressed }) => [...rowStyle, pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: { paddingHorizontal: 20, paddingTop: space[6], paddingBottom: space[2] },
  row: {
    minHeight: 56,
    paddingHorizontal: 20,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[3],
    borderBottomWidth: stroke.hairline,
  },
  text: { flex: 1, gap: 2 },
  title: { fontFamily: fontFamily.sansSemiBold, fontSize: 15 },
  value: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 0 },
  pressed: { opacity: 0.75 },
});
