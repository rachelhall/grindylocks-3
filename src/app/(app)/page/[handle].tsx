import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Animated, Linking, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ClaimFooter } from '@/components/claim';
import { ProductsList } from '@/components/catalog';
import { LOGO_OVERLAP, PAGE_HEADER_HEIGHT, PageHeader, PLAIN_HEADER_HEIGHT } from '@/components/page-header';
import { usePageMenu, usePageReportSheet } from '@/components/pages';
import { TeamBar } from '@/components/page-team';
import { MasonryGrid } from '@/components/profile';
import { PinnedBar, useBarHeight } from '@/components/pinned-bar';
import { useShopFixSheet } from '@/components/shop-fix';
import { BrandsCarried, ShopButtons, ShopHours, shopHasDirections, ShopPlace } from '@/components/shop';
import { SafeAreaView } from '@/components/safe-area';
import { useExplainRestriction } from '@/components/safety';
import { BackButton, Button, Icon, type IconName } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { useMyPages } from '@/lib/claims';
import { useLeaveTeam } from '@/lib/page-team';
import { usePageCatalog } from '@/lib/catalog';
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
import { toGridPost, usePagePostBylines, usePagePosts } from '@/lib/posts';
import { Sentry } from '@/lib/sentry';
import { fontFamily, size, space, stroke, Text, useColors } from '@/theme';

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
 *   with a line saying what it does. The page's own team gets Edit page,
 *   Team, Inbox and Leave there instead (PR 7a).
 *
 * Shops (PR 3, the Shop-8SET and Shop-TempClosed mockups) add the address
 * with open-now and location-type chips, Directions beside Follow, the
 * hours card on the shop's own clock and Brands we carry.
 *
 * Products (PR 4, Brand-Products and Brand-Products-Bones): a managed page
 * gets Posts and Products tabs; other pages with products show a Products
 * section (unofficial and retired pages have no posts). A page with no
 * products shows neither.
 *
 * Claiming (PR 5): "Work at Dead? Claim this page" at the bottom of an
 * unofficial page, then the claimant's pending card (or Rachel's reason if
 * it was declined); a claimed page waiting for its logo shows its owner and
 * managers the Add logo card. Founding partner tape shows once the page is
 * OFFICIAL. `?logo=1` (the claim-approved push) opens Edit page to add it.
 *
 * Running a page (PR 7a, Page-TeamView): the team sees "You're the owner"
 * (or manager, or staff) under the handle and an ink bar with Edit page,
 * Team and Inbox, with a dot when the inbox has something new.
 *
 * Posts (PR 8a, Page-TeamView): the page's own posts in the masonry grid;
 * the team sees "by [member]" on each tile, nobody else learns who posted.
 *
 * Coming with PR 9: the page's meetups.
 */
export default function PageScreen() {
  const { handle, logo } = useLocalSearchParams<{ handle: string; logo?: string }>();
  const { t } = useTranslation();
  const c = useColors();
  const { data: page, isError, refetch } = usePage(handle);

  // Opened from "Your claim was approved": go on to Edit page to add the logo.
  const askedLogo = useRef(false);
  useEffect(() => {
    if (logo !== '1' || askedLogo.current || !page || isOfficial(page)) return;
    askedLogo.current = true;
    router.push({ pathname: '/page-edit/[handle]', params: { handle: page.handle } });
  }, [logo, page]);

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
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const userId = session?.user.id;
  const viewer = usePageViewerState(userId, page.id);
  const relation = usePageRelation(userId, page.id);
  const explainRestriction = useExplainRestriction();
  const menu = usePageMenu();
  // Drives the pinned bar's fade (natively, with the scroll).
  const [scrollY] = useState(() => new Animated.Value(0));
  const barHeight = useBarHeight();
  const catalog = usePageCatalog(page.id);
  const [tab, setTab] = useState<'posts' | 'products'>('posts');

  const name = page.displayName;
  const kind = pageKind(page);
  const stamp = stampFor(page);
  const official = isOfficial(page);
  const archive = isArchive(page);
  const nameOnly = page.state === 'name_only';
  const state = viewer.data;
  const onTeam = Boolean(state?.teamRole);
  const myPages = useMyPages(onTeam ? userId : undefined);
  const inboxNew = myPages.data?.find((p) => p.pageId === page.id)?.inboxNew ?? 0;
  const leave = useLeaveTeam(page.id, userId);
  // The team runs a managed page from here; an archive or a suspended page has nothing to run.
  const running = onTeam && page.state === 'managed' && !page.suspendedAt;
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
  const shopFix = useShopFixSheet();

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

  const openTeamMenu = () => {
    const go = (pathname: '/page-edit/[handle]' | '/page-team/[handle]' | '/page-inbox/[handle]') =>
      router.push({ pathname, params: { handle: page.handle } });
    const items = [
      { icon: 'edit' as const, title: t('pageTeam.bar.edit'), body: t('pageTeam.menu.editBody'), onPress: () => go('/page-edit/[handle]') },
      { icon: 'people' as const, title: t('pageTeam.bar.team'), body: t('pageTeam.menu.teamBody'), onPress: () => go('/page-team/[handle]') },
      { icon: 'mail' as const, title: t('pageTeam.bar.inbox'), body: t('pageTeam.menu.inboxBody'), onPress: () => go('/page-inbox/[handle]') },
    ];
    const leaveItem =
      state?.teamRole && state.teamRole !== 'owner'
        ? [
            {
              icon: 'close' as const,
              title: t('pageTeam.menu.leave', { name }),
              body: t('pageTeam.menu.leaveBody', { name }),
              destructive: true,
              onPress: () =>
                Alert.alert(t('pageTeam.menu.leaveConfirm', { name }), t('pageTeam.menu.leaveBody', { name }), [
                  { text: t('common.cancel'), style: 'cancel' },
                  {
                    text: t('pageTeam.menu.leaveButton'),
                    style: 'destructive',
                    onPress: () => leave.mutate(undefined, { onError: () => Alert.alert(t('errors.generic'), t('errors.network')) }),
                  },
                ]),
            },
          ]
        : [];
    menu.open({ name, handle: page.handle, stamp }, [...(running ? items : []), ...leaveItem]);
  };

  const openMenu = () => {
    const reportItem = {
      icon: 'flag' as const,
      title: t('page.menu.report'),
      body: t('page.menu.reportBody'),
      onPress: () => report.open({ id: page.id, handle: page.handle, displayName: name }),
    };
    if (archive) return menu.open({ name, handle: page.handle, stamp }, [reportItem]);
    // Unofficial shops have nobody to fix them: anyone can suggest a fix,
    // checked by the shop's city admin (Shop-Fix).
    const fixItem =
      page.state === 'unofficial' && page.roles.includes('shop')
        ? [{ icon: 'edit' as const, title: t('shopFix.menu'), body: t('shopFix.menuBody'), onPress: () => shopFix.open(page) }]
        : [];
    menu.open({ name, handle: page.handle, stamp }, [
      ...fixItem,
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
  const shop = kind === 'shop' && !archive;
  const shopButtons = shop && (shopHasDirections(page) || links.length > 0);
  const statusLine =
    page.state === 'unofficial' || (page.state === 'managed' && !official)
      ? t(kind === 'shop' ? 'page.unofficialShop' : 'page.unofficialBrand')
      : official
        ? t('page.officialPage')
        : nameOnly
          ? t('page.nameOnly')
          : null;

  const showPosts = page.state === 'managed' || page.state === 'closed';
  const hasProducts = (catalog.data?.length ?? 0) > 0;
  const products = catalog.data ? (
    <ProductsList page={{ id: page.id, displayName: name }} entries={catalog.data} archive={archive} />
  ) : null;
  const postsEmpty = (
    <View style={[styles.empty, { borderColor: c.borderSubtle }]}>
      <Text variant="body" color="textSecondary">
        {t('page.noPosts')}
      </Text>
    </View>
  );
  const postsBlock = <PagePosts pageId={page.id} onTeam={onTeam} empty={postsEmpty} />;

  const tabRow = (
    <View accessibilityRole="tablist" style={[styles.tabs, { borderColor: c.borderSubtle }]}>
      {(['posts', 'products'] as const).map((k) => {
        const on = tab === k;
        return (
          <Pressable
            key={k}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => setTab(k)}
            style={[styles.tab, on && { borderColor: c.text, borderBottomWidth: 3 }]}
          >
            <Text variant="body" style={{ fontFamily: fontFamily.sansSemiBold, color: on ? c.text : c.textSecondary }}>
              {t(k === 'posts' ? 'page.posts' : 'catalog.title')}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
  // Posts | Products pin under the bar once they reach it (pages with both tabs only).
  const tabbed = showPosts && hasProducts;

  const descriptionBlock = description ? (
    <Text variant="body" style={styles.description}>
      {description}
    </Text>
  ) : null;

  const followButton =
    canShowFollow && state && !state.blocked && (state.following || state.canFollow) ? (
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
    ) : null;

  return (
    <View style={[styles.screen, { backgroundColor: c.surface }]}>
      {/* The header and the pinned bar are ink in both themes, so the clock stays light. */}
      <StatusBar style="light" />
      <PinnedBar
        scrollY={scrollY}
        headerHeight={headerHeight}
        name={name}
        stamp={stamp}
        moreLabel={archive ? t('page.moreReport') : t('page.more')}
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/search'))}
        onMore={onTeam ? (running || state?.teamRole !== 'owner' ? openTeamMenu : undefined) : openMenu}
      />
      <Animated.ScrollView
        contentInsetAdjustmentBehavior="never"
        contentContainerStyle={{ paddingBottom: space[12] + insets.bottom }}
        scrollEventThrottle={16}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })}
        // Child 1 is the tab row when there are tabs (see below).
        stickyHeaderIndices={tabbed ? [1] : undefined}
      >
        {/* Everything above the tabs, in one child so the tab row's index is fixed. */}
        <View>
          <PageHeader
            name={name}
            tape={tape ? tape.toUpperCase() : null}
            stamp={stamp}
            foundingPartner={Boolean(page.foundingPartnerAt) && official}
            logoUrl={official ? pageImageUrl(page.logoPath) : null}
            photoUrl={page.state === 'managed' ? pageImageUrl(page.headerPath) : null}
            plain={nameOnly}
            dim={archive}
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
            {state?.teamRole ? (
              <Text variant="bodySm" color="textSecondary">
                {t(`pageTeam.youAre.${state.teamRole}`)}
              </Text>
            ) : null}
            {page.formerly.length > 0 ? (
              <Text variant="bodySm" color="textSecondary">
                {t('page.formerly', { names: page.formerly.join(', ') })}
              </Text>
            ) : null}
          </View>

          {running ? <TeamBar page={page} inboxNew={inboxNew} /> : null}

          {shop ? <ShopPlace page={page} /> : null}
          {shop && page.tempClosedAt && page.tempClosedNote ? <ClosedNote page={page} /> : null}

          {shop ? null : descriptionBlock}

          {!shop && links.length > 0 ? (
            <View style={styles.links}>
              {links.map((url) => (
                <LinkButton key={url} url={url} />
              ))}
            </View>
          ) : null}

          {state?.blocked && canShowFollow ? (
            <View style={styles.followBlock}>
              <Text variant="bodySm" color="textSecondary">
                {t('page.blocked', { name })}
              </Text>
              <Button label={t('page.unblock')} variant="secondary" onPress={() => toggle('block', false)} />
            </View>
          ) : null}

          {followButton || shopButtons ? (
            <View style={styles.followBlock}>
              <View style={styles.actionRow}>
                {followButton}
                {shopButtons ? <ShopButtons page={page} links={links} /> : null}
              </View>
              {followButton && page.state === 'unofficial' ? (
                <Text variant="bodySm" color="textSecondary">
                  {t('page.followHint', { name })}
                </Text>
              ) : null}
            </View>
          ) : null}

          {shop ? descriptionBlock : null}
          {shop ? <ShopHours page={page} /> : null}
          {shop ? <BrandsCarried brands={page.brandsCarried} /> : null}
          {tabbed ? null : showPosts ? (
            <View style={styles.section}>
              <Text variant="title" accessibilityRole="header">
                {t('page.posts')}
              </Text>
              {postsBlock}
            </View>
          ) : hasProducts ? (
            <View style={styles.section}>
              <Text variant="title" accessibilityRole="header">
                {t('catalog.title')}
              </Text>
              {products}
            </View>
          ) : null}
        </View>

        {tabbed ? (
          // Sticky: the wrapper reaches up by the bar's height (transparent,
          // passing taps through), so the row sticks just under the bar, not
          // under the status bar. `pointerEvents` goes in the style too, since
          // the ScrollView moves the child's style onto its own sticky wrapper.
          <View pointerEvents="box-none" style={[styles.stickyTabs, { marginTop: space[6] - barHeight, paddingTop: barHeight }]}>
            <View style={[styles.tabsGround, { backgroundColor: c.surface }]}>{tabRow}</View>
          </View>
        ) : null}
        {tabbed ? <View style={styles.tabBody}>{tab === 'posts' ? postsBlock : products}</View> : null}

        <ClaimFooter page={page} teamRole={state?.teamRole ?? null} />
      </Animated.ScrollView>
      {menu.sheet}
      {report.sheet}
      {shopFix.sheet}
    </View>
  );
}

/**
 * A page's posts in the masonry grid, with Show more. The team sees "by
 * [member]" on the tiles (from page_post_bylines, which answers only them).
 */
function PagePosts({ pageId, onTeam, empty }: { pageId: string; onTeam: boolean; empty: React.ReactNode }) {
  const { t } = useTranslation();
  const c = useColors();
  const window = useWindowDimensions();
  // Measured: the grid sits in a padded section or under the tabs.
  const [width, setWidth] = useState(window.width);
  const posts = usePagePosts(pageId);
  const list = posts.data?.pages.flat() ?? [];
  const bylines = usePagePostBylines(pageId, list.map((p) => p.id), onTeam);
  if (posts.isPending) return <ActivityIndicator color={c.text} style={styles.postsLoading} />;
  if (posts.isError && list.length === 0) {
    return (
      <View style={styles.postsMore}>
        <Text variant="bodySm" color="statusClosed">
          {t('errors.network')}
        </Text>
        <Button label={t('common.retry')} variant="secondary" onPress={() => void posts.refetch()} />
      </View>
    );
  }
  if (list.length === 0) return <>{empty}</>;
  const grid = list.map((p) => {
    const g = toGridPost(p);
    const who = onTeam ? bylines.data?.[p.id] : undefined;
    return { ...g, byline: who ? t('postingAs.by', { username: who }) : null };
  });
  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <MasonryGrid posts={grid} width={width} />
      {posts.hasNextPage ? (
        <View style={styles.postsMore}>
          <Button
            label={t('park.morePosts')}
            variant="secondary"
            loading={posts.isFetchingNextPage}
            onPress={() => void posts.fetchNextPage()}
          />
        </View>
      ) : null}
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

/** A shop away for a while: the team's note under the "Closed until" chip (Shop-TempClosed). */
function ClosedNote({ page }: { page: Page }) {
  const { t } = useTranslation();
  const c = useColors();
  return (
    <View style={[styles.note, { backgroundColor: c.surfaceSunk }]}>
      <Icon name="calendarOff" color={c.textSecondary} size={20} />
      <View style={styles.flex}>
        <Text variant="bodySm">{page.tempClosedNote}</Text>
        <Text variant="caption" color="textSecondary">
          {t('page.closedSetBy', { name: page.displayName })}
        </Text>
      </View>
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
  postsLoading: { marginVertical: space[6] },
  postsMore: { padding: space[4], gap: space[2] },
  screen: { flex: 1 },
  flex: { flex: 1 },
  pressed: { opacity: 0.75 },
  loading: { marginTop: space[12] },
  topBar: { paddingHorizontal: space[4], paddingVertical: space[2] },
  block: { paddingHorizontal: space[4], gap: space[3], paddingTop: space[4] },
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
  actionRow: { flexDirection: 'row', gap: space[2] },
  follow: {
    flex: 1,
    height: size.tapMin,
    borderWidth: stroke.rule,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[2],
  },
  section: { paddingHorizontal: space[4], paddingTop: space[6], gap: space[3] },
  empty: { borderWidth: stroke.rule, borderStyle: 'dashed', padding: space[4] },
  stickyTabs: { pointerEvents: 'box-none' },
  tabsGround: { paddingHorizontal: space[4] },
  tabBody: { paddingHorizontal: space[4], paddingTop: space[3], gap: space[3] },
  tabs: { flexDirection: 'row', gap: 22, borderBottomWidth: stroke.rule },
  tab: { minHeight: size.tapMin, justifyContent: 'center', marginBottom: -stroke.rule, borderColor: 'transparent', borderBottomWidth: 3 },
  note: { marginHorizontal: space[4], marginTop: space[4], padding: space[3], flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
});
