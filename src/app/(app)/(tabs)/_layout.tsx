import { TabList, Tabs, TabSlot, TabTrigger, type TabTriggerSlotProps } from 'expo-router/ui';
import { forwardRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, type IconName } from '@/components/ui';
import { size, space, stroke, useColors } from '@/theme';

/** The app opens on the map. */
export const unstable_settings = { initialRouteName: '(map)' };

/**
 * Tab bar from the design system (Nov 1): home, map, messages, search and
 * you. The current tab gets a filled icon (a heavier one for search, which
 * has no filled form) and a 3px ink bar under it; the others have no
 * underline. New post and notifications live in the home feed's top row.
 */
export default function TabsLayout() {
  const { t } = useTranslation();
  const c = useColors();
  const insets = useSafeAreaInsets();

  return (
    <Tabs style={styles.flex}>
      <TabSlot style={styles.flex} />
      <TabList
        accessibilityRole="tablist"
        style={[
          styles.bar,
          {
            backgroundColor: c.surfaceRaised,
            borderTopColor: c.borderSubtle,
            paddingBottom: Math.max(insets.bottom, space[2]),
          },
        ]}
      >
        <TabTrigger name="home" href="/home" asChild>
          <TabButton icon="home" iconFocused="homeFill" label={t('tabs.home')} />
        </TabTrigger>
        <TabTrigger name="(map)" href="/" asChild>
          <TabButton icon="map" iconFocused="mapFill" label={t('tabs.map')} />
        </TabTrigger>
        <TabTrigger name="messages" href="/messages" asChild>
          <TabButton icon="chat" iconFocused="chatFill" label={t('tabs.messages')} />
        </TabTrigger>
        <TabTrigger name="search" href="/search" asChild>
          <TabButton icon="search" iconFocused="search" heavyWhenFocused label={t('tabs.search')} />
        </TabTrigger>
        <TabTrigger name="you" href="/you" asChild>
          <TabButton icon="person" iconFocused="personFill" label={t('tabs.you')} />
        </TabTrigger>
      </TabList>
    </Tabs>
  );
}

type TabButtonProps = TabTriggerSlotProps & {
  icon: IconName;
  iconFocused: IconName;
  /** For icons with no filled form: a heavier weight marks the current tab. */
  heavyWhenFocused?: boolean;
  label: string;
};

const TabButton = forwardRef<View, TabButtonProps>(function TabButton(
  { icon, iconFocused, heavyWhenFocused, label, isFocused, ...props },
  ref,
) {
  const c = useColors();
  return (
    <Pressable
      ref={ref}
      {...props}
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected: Boolean(isFocused) }}
      style={({ pressed }) => [styles.tab, pressed && styles.pressed]}
    >
      <Icon name={isFocused ? iconFocused : icon} heavy={Boolean(isFocused && heavyWhenFocused)} color={c.text} />
      <View style={[styles.underline, { backgroundColor: isFocused ? c.text : 'transparent' }]} />
    </Pressable>
  );
});

const styles = StyleSheet.create({
  flex: { flex: 1 },
  bar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingTop: space[2],
    paddingHorizontal: space[3],
    borderTopWidth: stroke.hairline,
  },
  tab: { width: size.tapMin, height: size.tapMin, alignItems: 'center', justifyContent: 'center' },
  underline: { position: 'absolute', left: 8, right: 8, bottom: 0, height: 3 },
  pressed: { opacity: 0.75 },
});
