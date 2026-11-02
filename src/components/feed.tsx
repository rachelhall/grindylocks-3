import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/ui';
import { size, space, stroke, Text, useColors } from '@/theme';

/**
 * Top row of the feed screens (Nov 1): New post on the left (a 48px pink
 * square with a 2px ink outline), the title in the middle, and the
 * notifications bell on the right. Only the feed screens have this row; the
 * map, profiles and Search keep their own headers.
 */
export function FeedHeader({ title, hasUnread = false }: { title: string; hasUnread?: boolean }) {
  const { t } = useTranslation();
  const c = useColors();
  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('feed.newPost')}
        onPress={() => router.push('/new-post')}
        style={({ pressed }) => [
          styles.square,
          { backgroundColor: c.accent, borderColor: c.onAccent, borderWidth: stroke.rule },
          pressed && styles.pressed,
        ]}
      >
        <Icon name="add" color={c.onAccent} size={26} />
      </Pressable>

      <Text variant="display" accessibilityRole="header" numberOfLines={1} style={styles.title}>
        {title}
      </Text>

      <NotificationsBell hasUnread={hasUnread} />
    </View>
  );
}

/**
 * The bell. `hasUnread` shows a small pink square with an ink outline, never
 * a count, and is announced in the label (M4b).
 */
export function NotificationsBell({ hasUnread = false }: { hasUnread?: boolean }) {
  const { t } = useTranslation();
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={hasUnread ? t('feed.notificationsUnread') : t('feed.notifications')}
      onPress={() => router.push('/notifications')}
      style={({ pressed }) => [styles.square, { backgroundColor: c.surfaceRaised }, pressed && styles.pressed]}
    >
      <Icon name="bell" color={c.text} size={26} />
      {hasUnread ? (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no"
          style={[styles.dot, { backgroundColor: c.accent, borderColor: c.onAccent }]}
        />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[3],
    paddingHorizontal: space[4],
    paddingTop: space[4],
  },
  square: { width: size.tapMin, height: size.tapMin, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center' },
  dot: { position: 'absolute', top: 8, right: 8, width: 10, height: 10, borderWidth: stroke.rule },
  pressed: { opacity: 0.75 },
});
