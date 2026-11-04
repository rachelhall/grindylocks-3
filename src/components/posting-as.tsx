/**
 * Posting as a page (PR 8a, PostingAs-Caption mockup).
 *
 * - PostingAsRow: the pink "Posting as" row on Caption. It defaults to you;
 *   Change opens a sheet listing you and the pages you can post as. Under
 *   it, a line on where the post reaches: the page's followers, Near you in
 *   a shop's metro area while today's slot is free, and that page posts never
 *   count toward regulars.
 * - Pages you can post as: managed, with a logo (the database also checks
 *   suspension, disputes and closures, and refuses the post if one applies).
 * - The row isn't shown at all to someone with no page to post as.
 */
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { PageTile, Sheet, SheetHead } from '@/components/pages';
import { Icon } from '@/components/ui';
import { type MyPage, useMyPages } from '@/lib/claims';
import { supabase } from '@/lib/supabase';
import { fontFamily, size, space, stroke, Text, useColors } from '@/theme';

/** The pages you can post as, in my_pages order. */
export function usePostablePages(userId: string | undefined): MyPage[] {
  const mine = useMyPages(userId);
  return (mine.data ?? []).filter((p) => p.state === 'managed' && p.logoPath);
}

export type NearYouStatus = { reaches: boolean; usedToday: boolean; weekLeft: number; metroName: string | null };

/** Whether this page's next post would reach Near you (team only). */
export function usePageNearYou(pageId: string | null) {
  return useQuery({
    queryKey: ['page-near-you', pageId ?? ''],
    queryFn: async (): Promise<NearYouStatus | null> => {
      const { data, error } = await supabase.rpc('page_near_you_status', { page: pageId! });
      if (error) throw error;
      const r = data?.[0];
      return r
        ? { reaches: r.reaches, usedToday: r.used_today, weekLeft: r.week_left, metroName: r.metro_name }
        : null;
    },
    enabled: Boolean(pageId),
    // Checked each time Caption opens: a teammate may have just used the slot.
    staleTime: 0,
  });
}

export function PostingAsRow({
  username,
  avatarPath,
  pages,
  value,
  onChange,
}: {
  username: string;
  avatarPath: string | null;
  pages: MyPage[];
  /** The page picked, or null for you. */
  value: string | null;
  onChange: (pageId: string | null) => void;
}) {
  const { t } = useTranslation();
  const c = useColors();
  const [open, setOpen] = useState(false);
  const page = pages.find((p) => p.pageId === value) ?? null;
  const nearYou = usePageNearYou(page?.pageId ?? null);
  const name = page?.displayName ?? username;

  const reach = (() => {
    if (!page) return null;
    const s = nearYou.data;
    if (s?.reaches && s.metroName) return t('postingAs.reachNearYou', { name: page.displayName, metro: s.metroName });
    if (s && !s.reaches && s.metroName && s.usedToday) return t('postingAs.reachUsedToday', { name: page.displayName });
    if (s && !s.reaches && s.metroName) return t('postingAs.reachUsedWeek', { name: page.displayName });
    return t('postingAs.reachFollowers', { name: page.displayName });
  })();

  return (
    <View style={styles.wrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('postingAs.label', { name })}
        accessibilityHint={t('postingAs.changeHint')}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          styles.row,
          { backgroundColor: page ? c.accentSubtle : c.surfaceRaised, borderColor: c.border },
          pressed && styles.pressed,
        ]}
      >
        <Text variant="label" style={{ color: page ? c.onAccentSubtleSecondary : c.textSecondary }}>
          {t('postingAs.title').toUpperCase()}
        </Text>
        {page ? (
          <PageTile page={{ displayName: page.displayName, state: page.state, logoPath: page.logoPath }} size={28} />
        ) : (
          <Avatar path={avatarPath} username={username} size={28} />
        )}
        <Text
          variant="headline"
          numberOfLines={1}
          style={[styles.flex, { color: page ? c.onAccentSubtle : c.text }]}
        >
          {name}
        </Text>
        <Text variant="bodySm" style={{ color: page ? c.onAccentSubtle : c.text, fontFamily: fontFamily.sansSemiBold }}>
          {t('postingAs.change')}
        </Text>
      </Pressable>
      {reach ? (
        <Text variant="bodySm" color="textSecondary" accessibilityLiveRegion="polite">
          {reach} {t('postingAs.noRegulars')}
        </Text>
      ) : null}

      <Sheet visible={open} onClose={() => setOpen(false)}>
        <SheetHead title={t('postingAs.sheetTitle')} onClose={() => setOpen(false)} />
        <View accessibilityRole="radiogroup">
          <Option
            selected={value === null}
            title={username}
            subtitle={t('postingAs.you')}
            onPress={() => {
              onChange(null);
              setOpen(false);
            }}
            tile={<Avatar path={avatarPath} username={username} size={32} />}
          />
          {pages.map((p) => (
            <Option
              key={p.pageId}
              selected={value === p.pageId}
              title={p.displayName}
              subtitle={t(p.roles.includes('shop') ? 'postingAs.shop' : 'postingAs.brand')}
              onPress={() => {
                onChange(p.pageId);
                setOpen(false);
              }}
              tile={<PageTile page={{ displayName: p.displayName, state: p.state, logoPath: p.logoPath }} size={32} />}
            />
          ))}
        </View>
      </Sheet>
    </View>
  );
}

function Option({
  selected,
  title,
  subtitle,
  tile,
  onPress,
}: {
  selected: boolean;
  title: string;
  subtitle: string;
  tile: React.ReactNode;
  onPress: () => void;
}) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={`${title}, ${subtitle}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.option,
        { borderBottomColor: c.borderSubtle, backgroundColor: selected ? c.accentSubtle : 'transparent' },
        pressed && styles.pressed,
      ]}
    >
      {tile}
      <Text variant="headline" numberOfLines={1} style={[styles.flex, selected && { color: c.onAccentSubtle }]}>
        {title}{' '}
        <Text variant="body" style={{ color: selected ? c.onAccentSubtleSecondary : c.textSecondary }}>
          · {subtitle}
        </Text>
      </Text>
      <View
        style={[
          styles.box,
          { borderColor: selected ? c.onAccentSubtle : c.text, backgroundColor: selected ? c.accent : c.surfaceRaised },
        ]}
      >
        {selected ? <Icon name="check" color={c.onAccent} size={16} /> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: space[4], gap: space[2] },
  flex: { flex: 1 },
  row: {
    minHeight: 56,
    borderWidth: stroke.rule,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingHorizontal: space[3],
  },
  option: {
    minHeight: size.tapMin + 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingHorizontal: space[3],
    borderBottomWidth: stroke.hairline,
  },
  box: { width: 22, height: 22, borderWidth: stroke.rule, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.7 },
});
