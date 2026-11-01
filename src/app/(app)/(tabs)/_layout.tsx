import { router } from 'expo-router';
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
 * Tab bar from the design system: home, map, a pink new-post button,
 * notifications and you. The current tab gets a filled icon and a 3px ink
 * bar under it; the others have no underline.
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
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('tabs.newPost')}
          onPress={() => router.push('/new-post')}
          style={({ pressed }) => [styles.newPost, { backgroundColor: c.accent }, pressed && styles.pressed]}
        >
          <Icon name="add" color={c.onAccent} />
        </Pressable>
        <TabTrigger name="notifications" href="/notifications" asChild>
          <TabButton icon="bell" iconFocused="bellFill" label={t('tabs.notifications')} />
        </TabTrigger>
        <TabTrigger name="you" href="/you" asChild>
          <TabButton icon="person" iconFocused="personFill" label={t('tabs.you')} />
        </TabTrigger>
      </TabList>
    </Tabs>
  );
}

type TabButtonProps = TabTriggerSlotProps & { icon: IconName; iconFocused: IconName; label: string };

const TabButton = forwardRef<View, TabButtonProps>(function TabButton(
  { icon, iconFocused, label, isFocused, ...props },
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
      <Icon name={isFocused ? iconFocused : icon} color={c.text} />
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
  newPost: { width: 52, height: 44, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.75 },
});
