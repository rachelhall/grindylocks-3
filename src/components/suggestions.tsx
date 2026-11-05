import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { Icon } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { useFollowFromList } from '@/lib/social';
import type { SuggestedSkater } from '@/lib/suggestions';
import { fontFamily, size, space, stroke, Text, useColors } from '@/theme';

/** "Inline · posts at Linda Vista" */
export function useSkaterLine() {
  const { t } = useTranslation();
  return (p: SuggestedSkater) =>
    [p.disciplines.map((d) => t(`disciplines.${d}`)).join(', '), t('empty.postsAt', { park: p.parkName })]
      .filter(Boolean)
      .join(' · ');
}

/**
 * Follow in a list or strip: outlined (Rachel, Nov 5), so it never competes
 * with the screen's one filled button. Turns into "Following" once tapped.
 */
function FollowOutline({ person }: { person: SuggestedSkater }) {
  const { t } = useTranslation();
  const c = useColors();
  const { session } = useAuth();
  const follow = useFollowFromList(session?.user.id);
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <Text variant="label" color="textSecondary" style={styles.following}>
        {t('find.following')}
      </Text>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('empty.followName', { username: person.username })}
      accessibilityState={{ busy: follow.isPending }}
      disabled={follow.isPending}
      hitSlop={6}
      onPress={() => {
        setDone(true);
        follow.mutate(person.id, {
          onError: () => {
            setDone(false);
            Alert.alert(t('errors.generic'));
          },
        });
      }}
      style={({ pressed }) => [styles.follow, { borderColor: c.border }, pressed && styles.pressed]}
    >
      <Text variant="bodySm" style={styles.followText}>
        {t('follow.follow')}
      </Text>
    </Pressable>
  );
}

const openProfile = (username: string) => router.push({ pathname: '/profile/[username]', params: { username } });

/** A suggested skater as a row, like Search's people rows. */
export function SkaterRow({ person }: { person: SuggestedSkater }) {
  const c = useColors();
  const line = useSkaterLine()(person);
  return (
    <View style={[styles.row, { backgroundColor: c.surfaceRaised }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${person.username}, ${line}`}
        onPress={() => openProfile(person.username)}
        style={({ pressed }) => [styles.rowMain, pressed && styles.pressed]}
      >
        <Avatar path={person.avatarPath} username={person.username} size={44} />
        <View style={styles.rowText}>
          <Text variant="headline" numberOfLines={1}>
            {person.username}
          </Text>
          <Text variant="bodySm" color="textSecondary" numberOfLines={1}>
            {line}
          </Text>
        </View>
      </Pressable>
      <FollowOutline person={person} />
    </View>
  );
}

/** Home's "Skaters near you": a strip of small cards that scrolls sideways. */
export function SkaterStrip({ people, title }: { people: SuggestedSkater[]; title: string }) {
  const c = useColors();
  return (
    <View style={styles.strip}>
      <Text variant="label" color="textSecondary" accessibilityRole="header">
        {title}
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.stripRow}>
        {people.map((p) => (
          <View key={p.id} style={[styles.card, { backgroundColor: c.surfaceRaised }]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${p.username}, ${p.parkName}`}
              onPress={() => openProfile(p.username)}
              style={({ pressed }) => [styles.cardMain, pressed && styles.pressed]}
            >
              <Avatar path={p.avatarPath} username={p.username} size={48} />
              <Text variant="bodySm" numberOfLines={1} style={styles.cardName}>
                {p.username}
              </Text>
              <Text variant="caption" color="textSecondary" numberOfLines={1}>
                {p.parkName}
              </Text>
            </Pressable>
            <FollowOutline person={p} />
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

/** A section heading with an optional link on the right ("See map", "Clear"). */
export function SectionHead({ title, link }: { title: string; link?: { label: string; onPress: () => void } }) {
  const c = useColors();
  return (
    <View style={styles.head}>
      <Text variant="label" color="textSecondary" accessibilityRole="header" style={styles.headTitle}>
        {title}
      </Text>
      {link ? (
        <Pressable accessibilityRole="button" onPress={link.onPress} hitSlop={10} style={({ pressed }) => pressed && styles.pressed}>
          <Text variant="bodySm" style={[styles.headLink, { color: c.text, textDecorationColor: c.text }]}>
            {link.label}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Search's recent searches: tap to search again, ✕ to forget one. */
export function RecentSearchRows({
  items,
  onPick,
  onRemove,
}: {
  items: string[];
  onPick: (q: string) => void;
  onRemove: (q: string) => void;
}) {
  const { t } = useTranslation();
  const c = useColors();
  return (
    <View>
      {items.map((q) => (
        <View key={q} style={[styles.recent, { borderBottomColor: c.borderSubtle }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('empty.searchAgain', { q })}
            onPress={() => onPick(q)}
            style={({ pressed }) => [styles.recentMain, pressed && styles.pressed]}
          >
            <Icon name="history" color={c.textSecondary} size={20} />
            <Text variant="body" numberOfLines={1} style={styles.rowText}>
              {q}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('empty.removeRecent', { q })}
            onPress={() => onRemove(q)}
            style={({ pressed }) => [styles.recentRemove, pressed && styles.pressed]}
          >
            <Icon name="close" color={c.textSecondary} size={18} />
          </Pressable>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.75 },
  row: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: space[2], paddingLeft: space[3], paddingRight: space[2] },
  rowMain: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: space[2] },
  rowText: { flex: 1, minWidth: 0, gap: 3 },
  follow: { minHeight: 36, minWidth: 72, paddingHorizontal: space[3], borderWidth: stroke.rule, alignItems: 'center', justifyContent: 'center' },
  followText: { fontFamily: fontFamily.sansSemiBold },
  following: { minHeight: 36, minWidth: 72, textAlign: 'center', textAlignVertical: 'center', lineHeight: 36 },
  strip: { gap: space[2] },
  stripRow: { gap: space[2] },
  card: { width: 136, padding: space[3], gap: space[2], alignItems: 'center' },
  cardMain: { alignItems: 'center', gap: 4, alignSelf: 'stretch' },
  cardName: { fontFamily: fontFamily.sansSemiBold, maxWidth: '100%' },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[3], minHeight: 20 },
  headTitle: { flex: 1 },
  headLink: { fontFamily: fontFamily.sansSemiBold, textDecorationLine: 'underline' },
  recent: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: stroke.hairline },
  recentMain: { flex: 1, minWidth: 0, minHeight: size.tapMin, flexDirection: 'row', alignItems: 'center', gap: 10 },
  recentRemove: { width: size.tapMin, height: size.tapMin, alignItems: 'center', justifyContent: 'center' },
});
