import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LOGO_OVERLAP, PAGE_HEADER_HEIGHT, PageHeader, PLAIN_HEADER_HEIGHT } from '@/components/page-header';
import { usePageMenu, usePageReportSheet } from '@/components/pages';
import { SafeAreaView } from '@/components/safe-area';
import { useExplainRestriction } from '@/components/safety';
import { BackButton, Button, Icon, type IconName } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import {
  isArchive,
  isOfficial,
  linkKind,
  linkUrl,
  type Page,
  pageDescription,
  pageImageUrl,
  pageKind,
  placeName,
  stampFor,
  usePage,
  usePageRelation,
  usePageViewerState,
} from '@/lib/pages';
import { Sentry } from '@/lib/sentry';
import { fontFamily, size, space, stroke, Text, useColors, useColorSchemeName } from '@/theme';

/**
 * A brand or shop page (part A, PR 2), per the Brand accounts (v2) mockups:
 * Brand-Unofficial, Brand-NameOnly, Brand-OutOfBusiness (Retired),
 * Brand-Managed, Shop-Closed and the "Closed until" part of Shop-TempClosed.
 *
 * - The header shows the state: OFFICIAL (managed, with its logo),
 *   UNOFFICIAL, RETIRED or CLOSED, plus the founding partner tape.
 * - Unofficial and managed pages can be followed; an unofficial page says
 *   following means hearing when it joins.
 * - The ⋯ menu has Mute, Report and Block (Report only on archives), each
 *   with a line saying what it does. The page's own team sees no menu yet;
 *   Edit page comes with running a page (PR 7).
 *
 * Coming with later PRs: the shop's address, hours and brands carried (PR 3),
 * the Products tab (PR 4), Claim this page (PR 5) and the page's own posts
 * (PR 8). Until then a managed page's Posts section is empty.
 */
export default function PageScreen() {
  const { handle } = useLocalSearchParams<{ handle: string }>();
  const { t } = useTranslation();
  const c = useColors();
  const { data: page, isError, refetch } = usePage(handle);

  if (page === undefined && !isError) {
    return (
      <SafeAreaView style={[styles.screen, { backgroundColor: c.surface }]}>
        <View style={styles.topBar}>
          <BackButton />
        </View>
        <ActivityIndicator color={c.text} style={styles.loading} accessibilityLabel={t('common.loading')} />
      </SafeAreaView>
    );
  }
  if (!page) {
    return (
      <SafeAreaView style={[styles.screen, { backgroundColor: c.surface }]}>
        <View style={styles.topBar}>
          <BackButton />
        </View>
        <View style={styles.block}>
          <Text variant="body" color="textSecondary">
            {isError ? t('errors.network') : t('page.missing')}
          </Text>
          {isError ? <Button label={t('common.retry')} onPress={() => void refetch()} /> : null}
        </View>
      </SafeAreaView>
    );
  }
  return <PageBody page={page} />;
}

function PageBody({ page }: { page: Page }) {
  const { t, i18n } = useTranslation();
  const c = useColors();
  const scheme = useColorSchemeName();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const userId = session?.user.id;
  const viewer = usePageViewerState(userId, page.id);
  const relation = usePageRelation(userId, page.id);
  const explainRestriction = useExplainRestriction();
  const menu = usePageMenu();
  const [pastHeader, setPastHeader] = useState(false);

  const name = page.displayName;
  const kind = pageKind(page);
  const stamp = stampFor(page);
  const official = isOfficial(page);
  const archive = isArchive(page);
  const nameOnly = page.state === 'name_only';
  const state = viewer.data;
  const onTeam = Boolean(state?.teamRole);
  const headerHeight = nameOnly ? PLAIN_HEADER_HEIGHT : PAGE_HEADER_HEIGHT;

  const block = () =>
    relation.mutate(
      { what: 'block', on: true },
      { onError: () => Alert.alert(t('errors.generic'), t('errors.network')) },
    );
  const confirmBlock = () =>
    Alert.alert(t('page.menu.blockConfirm', { name }), t('page.menu.blockBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('block.block'), style: 'destructive', onPress: block },
    ]);
  const report = usePageReportSheet({ onBlock: state?.blocked ? undefined : block });

  const toggle = (what: 'follow' | 'mute' | 'block', on: boolean) =>
    relation.mutate(
      { what, on },
      {
        onError: async (err) => {
          if (await explainRestriction(err)) return;
          Sentry.captureException(err);
          Alert.alert(what === 'follow' ? t('page.followFailed') : t('errors.generic'), what === 'follow' ? undefined : t('errors.network'));
        },
      },
    );

  const openMenu = () => {
    const reportItem = {
      icon: 'flag' as const,
      title: t('page.menu.report'),
      body: t('page.menu.reportBody'),
      onPress: () => report.open({ id: page.id, handle: page.handle, displayName: name }),
    };
    if (archive) return menu.open({ name, handle: page.handle, stamp }, [reportItem]);
    menu.open({ name, handle: page.handle, stamp }, [
      state?.muted
        ? { icon: 'soundOn', title: t('page.menu.unmute'), body: t('page.menu.unmuteBody'), onPress: () => toggle('mute', false) }
        : { icon: 'soundOff', title: t('page.menu.mute'), body: t('page.menu.muteBody'), onPress: () => toggle('mute', true) },
      reportItem,
      state?.blocked
        ? { icon: 'block', title: t('page.menu.unblock', { name }), body: t('page.menu.unblockBody'), onPress: () => toggle('block', false) }
        : { icon: 'block', title: t('page.menu.block', { name }), body: t('page.menu.blockBody'), destructive: true, onPress: confirmBlock },
    ]);
  };

  // The tape: BRAND · SANTA ANA, and the years on an archive (BRAND · USA · 1993–C. 2005).
  const where = placeName(page, i18n.language);
  const years = archive && (page.foundedLabel || page.endedLabel) ? [page.foundedLabel, page.endedLabel].filter(Boolean).join('–') : null;
  const tape = nameOnly ? null : [t(`page.${kind}`), where, years].filter(Boolean).join(' · ');

  const description = nameOnly ? null : pageDescription(page, i18n.language);
  // Unofficial pages show their website; managed ones their own links (up to 3).
  const links = nameOnly ? [] : official || page.state === 'managed' ? page.links : page.website ? [page.website] : [];
  const canShowFollow = !archive && !nameOnly && !onTeam;
  const statusLine =
    page.state === 'unofficial' || (page.state === 'managed' && !official)
      ? t(kind === 'shop' ? 'page.unofficialShop' : 'page.unofficialBrand')
      : official
        ? t('page.officialPage')
        : nameOnly
          ? t('page.nameOnly')
          : null;

  return (
    <View style={[styles.screen, { backgroundColor: c.surface }]}>
      <StatusBar style={pastHeader ? (scheme === 'dark' ? 'light' : 'dark') : 'light'} />
      <ScrollView
        contentInsetAdjustmentBehavior="never"
        contentContainerStyle={{ paddingBottom: space[12] + insets.bottom }}
        scrollEventThrottle={32}
        onScroll={(e) => {
          const past = e.nativeEvent.contentOffset.y > headerHeight - insets.top;
          if (past !== pastHeader) setPastHeader(past);
        }}
      >
        <PageHeader
          name={name}
          tape={tape ? tape.toUpperCase() : null}
          stamp={stamp}
          foundingPartner={Boolean(page.foundingPartnerAt) && !archive}
          logoUrl={official ? pageImageUrl(page.logoPath) : null}
          plain={nameOnly}
          dim={archive}
          moreLabel={archive ? t('page.moreReport') : t('page.more')}
          onBack={() => (router.canGoBack() ? router.back() : router.replace('/search'))}
          onMore={onTeam ? undefined : openMenu}
        />

        {archive ? <ArchiveNote page={page} /> : null}

        <View style={[styles.who, official && styles.whoBesideLogo]}>
          <Text variant="headline" style={styles.handle}>
            @{page.handle}
          </Text>
          {statusLine ? (
            <Text variant="bodySm" color="textSecondary">
              {statusLine}
            </Text>
          ) : null}
          {page.formerly.length > 0 ? (
            <Text variant="bodySm" color="textSecondary">
              {t('page.formerly', { names: page.formerly.join(', ') })}
            </Text>
          ) : null}
        </View>

        {kind === 'shop' && page.tempClosedAt && !archive ? <ClosedUntil page={page} /> : null}

        {description ? (
          <Text variant="body" style={styles.description}>
            {description}
          </Text>
        ) : null}

        {links.length > 0 ? (
          <View style={styles.links}>
            {links.map((url) => (
              <LinkButton key={url} url={url} />
            ))}
          </View>
        ) : null}

        {canShowFollow && state ? (
          state.blocked ? (
            <View style={styles.followBlock}>
              <Text variant="bodySm" color="textSecondary">
                {t('page.blocked', { name })}
              </Text>
              <Button label={t('page.unblock')} variant="secondary" onPress={() => toggle('block', false)} />
            </View>
          ) : state.following || state.canFollow ? (
            <View style={styles.followBlock}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: state.following }}
                onPress={() => toggle('follow', !state.following)}
                style={({ pressed }) => [
                  styles.follow,
                  state.following
                    ? { backgroundColor: 'transparent', borderColor: c.border }
                    : { backgroundColor: c.text, borderColor: c.text },
                  pressed && styles.pressed,
                ]}
              >
                <Icon name={state.following ? 'check' : 'add'} color={state.following ? c.text : c.surface} size={18} />
                <Text variant="headline" style={{ color: state.following ? c.text : c.surface, fontSize: 15 }}>
                  {state.following ? t('page.following') : t('page.follow')}
                </Text>
              </Pressable>
              {page.state === 'unofficial' ? (
                <Text variant="bodySm" color="textSecondary">
                  {t('page.followHint', { name })}
                </Text>
              ) : null}
            </View>
          ) : null
        ) : null}

        {page.state === 'managed' || page.state === 'closed' ? (
          <View style={styles.section}>
            <Text variant="title" accessibilityRole="header">
              {t('page.posts')}
            </Text>
            <View style={[styles.empty, { borderColor: c.borderSubtle }]}>
              <Text variant="body" color="textSecondary">
                {t('page.noPosts')}
              </Text>
            </View>
          </View>
        ) : null}
      </ScrollView>
      {pastHeader ? (
        <View pointerEvents="none" style={[styles.statusStrip, { height: insets.top, backgroundColor: c.surface }]} />
      ) : null}
      {menu.sheet}
      {report.sheet}
    </View>
  );
}

/** "Senate stopped making gear around 2005…" or "This shop closed in March 2026…". */
function ArchiveNote({ page }: { page: Page }) {
  const { t, i18n } = useTranslation();
  const c = useColors();
  let text: string;
  if (page.state === 'closed') {
    text = page.closedAt
      ? t('page.closedIn', {
          date: new Intl.DateTimeFormat(i18n.language, { month: 'long', year: 'numeric' }).format(new Date(page.closedAt)),
        })
      : t('page.closed');
  } else {
    const ended = page.endedLabel?.trim() ?? '';
    const around = /^c\.?\s*/i.test(ended);
    const year = ended.replace(/^c\.?\s*/i, '');
    text = year
      ? t(around ? 'page.retiredAround' : 'page.retiredIn', { name: page.displayName, year })
      : t('page.retired', { name: page.displayName });
  }
  return (
    <View style={[styles.note, { backgroundColor: c.surfaceSunk }]}>
      <Icon name={page.state === 'closed' ? 'storefront' : 'archive'} color={c.textSecondary} size={20} />
      <Text variant="bodySm" style={styles.flex}>
        {text}
      </Text>
    </View>
  );
}

/** A shop away for a while: the warning chip and the team's note (Shop-TempClosed). */
function ClosedUntil({ page }: { page: Page }) {
  const { t, i18n } = useTranslation();
  const c = useColors();
  const until = page.tempClosedUntil
    ? new Intl.DateTimeFormat(i18n.language, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(
        new Date(`${page.tempClosedUntil}T00:00:00Z`),
      )
    : null;
  const chip = until ? t('page.closedUntil', { date: until }) : t('page.closedForNow');
  return (
    <View style={styles.closedBlock}>
      <View style={[styles.warningChip, { borderColor: c.warning }]}>
        <Text variant="label" style={{ color: c.warning }}>
          {chip}
        </Text>
      </View>
      {page.tempClosedNote ? (
        <View style={[styles.note, styles.noteFlush, { backgroundColor: c.surfaceSunk }]}>
          <Icon name="calendarOff" color={c.textSecondary} size={20} />
          <View style={styles.flex}>
            <Text variant="bodySm">{page.tempClosedNote}</Text>
            <Text variant="caption" color="textSecondary">
              {t('page.closedSetBy', { name: page.displayName })}
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function LinkButton({ url }: { url: string }) {
  const { t } = useTranslation();
  const c = useColors();
  const kind = linkKind(url);
  const icon: IconName = kind === 'instagram' ? 'photoCamera' : kind === 'youtube' ? 'playCircle' : 'globe';
  const label = t(`page.${kind}`);
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={label}
      accessibilityHint={url}
      onPress={() => void Linking.openURL(linkUrl(url)).catch(() => Alert.alert(t('errors.generic')))}
      style={({ pressed }) => [styles.link, { borderColor: c.border }, pressed && styles.pressed]}
    >
      <Icon name={icon} color={c.text} size={18} />
      <Text variant="bodySm" style={{ fontFamily: fontFamily.sansSemiBold }}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  pressed: { opacity: 0.75 },
  loading: { marginTop: space[12] },
  topBar: { paddingHorizontal: space[4], paddingVertical: space[2] },
  block: { paddingHorizontal: space[4], gap: space[3], paddingTop: space[4] },
  statusStrip: { position: 'absolute', top: 0, left: 0, right: 0 },
  who: { paddingHorizontal: space[4], paddingTop: 14, gap: 2 },
  // Beside the logo tile, which overlaps the header's bottom edge.
  whoBesideLogo: { paddingLeft: space[4] + 76 + 16, paddingTop: 10, minHeight: LOGO_OVERLAP + 10 },
  handle: { fontSize: 15 },
  description: { paddingHorizontal: space[4], paddingTop: 14 },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], paddingHorizontal: space[4], paddingTop: space[3] },
  link: {
    minHeight: 40,
    borderWidth: stroke.rule,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  followBlock: { paddingHorizontal: space[4], paddingTop: space[4], gap: space[2] },
  follow: {
    height: size.tapMin,
    borderWidth: stroke.rule,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[2],
  },
  section: { paddingHorizontal: space[4], paddingTop: space[6], gap: space[3] },
  empty: { borderWidth: stroke.rule, borderStyle: 'dashed', padding: space[4] },
  note: { marginHorizontal: space[4], marginTop: space[4], padding: space[3], flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  noteFlush: { marginHorizontal: 0, marginTop: 0, alignSelf: 'stretch' },
  closedBlock: { paddingHorizontal: space[4], paddingTop: 14, gap: 10, alignItems: 'flex-start' },
  warningChip: { borderWidth: stroke.rule, paddingHorizontal: space[2], paddingVertical: space[1] },
});
