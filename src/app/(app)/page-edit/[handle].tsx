import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { PageTile } from '@/components/pages';
import { useClosedForAWhileSheet, useTeamErrorAlert } from '@/components/page-team';
import { SafeAreaView } from '@/components/safe-area';
import { openSupportMail } from '@/components/settings';
import { BackButton, Button, Icon, Toggle, useActionSheet } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { pickLogo, useSetPageLogo } from '@/lib/claims';
import {
  MAX_DESCRIPTION,
  MAX_PAGE_LINKS,
  PAGE_LANGUAGES,
  type PageLanguage,
  pickHeaderPhoto,
  roleRank,
  type ShopLocationType,
  useClosePageForGood,
  useSavePageDetails,
  useSetPageHeader,
} from '@/lib/page-team';
import { type Page, pageImageUrl, pageKind, usePage, usePageViewerState } from '@/lib/pages';
import { Sentry } from '@/lib/sentry';
import { brand, fontFamily, size, space, stroke, Text, useColors } from '@/theme';

const LOCATION_TYPES: ShopLocationType[] = ['storefront', 'by_appointment', 'online_only'];

/** The language's own name ("Dansk"), so a team reads its language the way it writes it. */
function languageName(code: string, inLanguage: string): string {
  try {
    const name = new Intl.DisplayNames([inLanguage], { type: 'language' }).of(code) ?? code;
    return name.charAt(0).toLocaleUpperCase(inLanguage) + name.slice(1);
  } catch {
    return code;
  }
}

/**
 * Edit page (Page-Edit mockup, part A PR 7a), for the page's team.
 *
 * - Managers and the owner: the logo and header photo (saved as soon as
 *   they're picked), the description per language with the main one, up to 3
 *   links, how people visit a shop, Closed for a while and Brands we carry.
 *   Name and handle are read-only ("ask Rachel").
 * - Staff: Closed for a while on a shop, and a line saying the rest is for
 *   managers and the owner.
 * - The owner: "Mark … as closed for good" (a shop) or "… no longer making
 *   gear" (a brand), each asking first.
 *
 * Address and pin, and hours, come with PR 7b once their screens are mocked.
 */
export default function PageEditScreen() {
  const { t } = useTranslation();
  const c = useColors();
  const { handle } = useLocalSearchParams<{ handle: string }>();
  const { session } = useAuth();
  const { data: page, isError, refetch } = usePage(handle);
  const viewer = usePageViewerState(session?.user.id, page?.id);

  if (!page || !viewer.data) {
    return (
      <SafeAreaView style={[styles.screen, { backgroundColor: c.surface }]}>
        <View style={styles.top}>
          <BackButton />
        </View>
        {isError || viewer.isError ? (
          <View style={styles.block}>
            <Text variant="body" color="textSecondary">
              {t('errors.network')}
            </Text>
            <Button label={t('common.retry')} onPress={() => void refetch()} />
          </View>
        ) : (
          <ActivityIndicator color={c.text} accessibilityLabel={t('common.loading')} style={styles.loading} />
        )}
      </SafeAreaView>
    );
  }
  const role = viewer.data.teamRole;
  if (!role || page.state !== 'managed') {
    return (
      <SafeAreaView style={[styles.screen, { backgroundColor: c.surface }]}>
        <View style={styles.top}>
          <BackButton />
        </View>
        <View style={styles.block}>
          <Text variant="body" color="textSecondary">
            {t('pageEdit.notYours')}
          </Text>
        </View>
      </SafeAreaView>
    );
  }
  return <EditForm key={page.id} page={page} manager={roleRank(role) >= 2} owner={role === 'owner'} />;
}

function EditForm({ page, manager, owner }: { page: Page; manager: boolean; owner: boolean }) {
  const { t, i18n } = useTranslation();
  const c = useColors();
  const { session } = useAuth();
  const userId = session?.user.id;
  const alertError = useTeamErrorAlert();
  const actions = useActionSheet();
  const closedSheet = useClosedForAWhileSheet(userId);
  const save = useSavePageDetails(userId);
  const setLogo = useSetPageLogo(userId);
  const setHeader = useSetPageHeader(userId);
  const closeForGood = useClosePageForGood(userId);

  const name = page.displayName;
  const shop = pageKind(page) === 'shop';
  const original = useMemo(() => {
    const main = (PAGE_LANGUAGES as readonly string[]).includes(page.mainLanguage) ? (page.mainLanguage as PageLanguage) : 'en';
    const bodies: Partial<Record<PageLanguage, string>> = {};
    for (const d of page.descriptions) {
      if ((PAGE_LANGUAGES as readonly string[]).includes(d.locale)) bodies[d.locale as PageLanguage] = d.body;
    }
    if (bodies[main] === undefined) bodies[main] = '';
    return { main, bodies, links: page.links, locationType: page.locationType ?? 'storefront', showPin: page.showPin };
  }, [page]);

  const [main, setMain] = useState<PageLanguage>(original.main);
  const [bodies, setBodies] = useState(original.bodies);
  const [tab, setTab] = useState<PageLanguage>(original.main);
  const [links, setLinks] = useState<string[]>(original.links.length ? original.links : []);
  const [locationType, setLocationType] = useState<ShopLocationType>(original.locationType);
  const [showPin, setShowPin] = useState(original.showPin);
  const [error, setError] = useState<string | null>(null);

  const languages = PAGE_LANGUAGES.filter((l) => bodies[l] !== undefined);
  const missing = PAGE_LANGUAGES.filter((l) => bodies[l] === undefined);
  const nameOf = (l: string) => languageName(l, l);

  const changedDescriptions = PAGE_LANGUAGES.filter((l) => (bodies[l] ?? null) !== (original.bodies[l] ?? null) && !(bodies[l] === '' && original.bodies[l] === undefined))
    .map((l) => ({ locale: l, body: bodies[l] ?? '' }));
  const cleanLinks = links.map((l) => l.trim()).filter(Boolean);
  const dirty =
    manager &&
    (main !== original.main ||
      changedDescriptions.length > 0 ||
      cleanLinks.join('\n') !== original.links.join('\n') ||
      (shop && (locationType !== original.locationType || showPin !== original.showPin)));

  const leave = () => (router.canGoBack() ? router.back() : router.replace({ pathname: '/page/[handle]', params: { handle: page.handle } }));
  const cancel = () => {
    if (!dirty) return leave();
    Alert.alert(t('pageEdit.discard'), undefined, [
      { text: t('pageEdit.keepEditing'), style: 'cancel' },
      { text: t('pageEdit.discardButton'), style: 'destructive', onPress: leave },
    ]);
  };

  const submit = () => {
    setError(null);
    if (!(bodies[main] ?? '').trim()) {
      setError(t('pageEdit.mainNeeded', { language: nameOf(main) }));
      setTab(main);
      return;
    }
    if (cleanLinks.some((l) => /\s/.test(l) || !l.includes('.') || l.length < 4)) {
      setError(t('pageEdit.invalidLink'));
      return;
    }
    save.mutate(
      {
        pageId: page.id,
        mainLanguage: main,
        links: cleanLinks,
        descriptions: changedDescriptions,
        locationType: shop ? { value: locationType, showPin: locationType === 'by_appointment' ? showPin : true } : null,
      },
      {
        onSuccess: leave,
        onError: async (err) => {
          const message = (err as { message?: string } | null)?.message ?? '';
          if (message === 'invalid_link') return setError(t('pageEdit.invalidLink'));
          if (message === 'main_language_needed') return setError(t('pageEdit.mainNeeded', { language: nameOf(main) }));
          await alertError(err);
        },
      },
    );
  };

  const changeLogo = async () => {
    try {
      const local = await pickLogo();
      if (!local) return;
      setLogo.mutate({ pageId: page.id, localUri: local }, { onError: (err) => void alertError(err) });
    } catch (err) {
      Sentry.captureException(err);
      Alert.alert(t('errors.generic'));
    }
  };
  const changeHeader = async () => {
    try {
      const local = await pickHeaderPhoto();
      if (!local) return;
      setHeader.mutate({ pageId: page.id, localUri: local }, { onError: (err) => void alertError(err) });
    } catch (err) {
      Sentry.captureException(err);
      Alert.alert(t('errors.generic'));
    }
  };
  const headerOptions = () =>
    actions.show({
      title: t('pageEdit.header'),
      actions: [
        { label: t('pageEdit.changeHeader'), onPress: () => void changeHeader() },
        {
          label: t('pageEdit.removeHeader'),
          destructive: true,
          onPress: () => setHeader.mutate({ pageId: page.id, localUri: null }, { onError: (err) => void alertError(err) }),
        },
      ],
    });

  const addLanguage = () =>
    actions.show({
      title: t('pageEdit.addLanguage'),
      actions: missing.map((l) => ({
        label: nameOf(l),
        onPress: () => {
          setBodies((b) => ({ ...b, [l]: '' }));
          setTab(l);
        },
      })),
    });
  const removeLanguage = (l: PageLanguage) => {
    setBodies((b) => {
      const next = { ...b };
      delete next[l];
      return next;
    });
    setTab(main);
  };

  const confirmClose = () => {
    const brandOnly = !shop;
    Alert.alert(
      t(brandOnly ? 'pageEdit.retireConfirm' : 'pageEdit.closeConfirm', { name }),
      t(brandOnly ? 'pageEdit.retireBody' : 'pageEdit.closeBody', { name }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t(brandOnly ? 'pageEdit.retireButton' : 'pageEdit.closeButton'),
          style: 'destructive',
          onPress: () =>
            closeForGood.mutate(page.id, {
              onSuccess: () => router.replace({ pathname: '/page/[handle]', params: { handle: page.handle } }),
              onError: (err) => void alertError(err),
            }),
        },
      ],
    );
  };

  const logoUrl = pageImageUrl(page.logoPath);
  const headerUrl = pageImageUrl(page.headerPath);
  const closedValue = page.tempClosedAt
    ? page.tempClosedUntil
      ? t('pageEdit.closedUntil', {
          date: new Intl.DateTimeFormat(i18n.language, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(
            new Date(`${page.tempClosedUntil}T00:00:00Z`),
          ),
        })
      : t('pageEdit.closedForNow')
    : t('pageEdit.off');

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: c.surface }]}>
      <View style={styles.head}>
        <Pressable accessibilityRole="button" onPress={cancel} hitSlop={4} style={({ pressed }) => [styles.headButton, pressed && styles.pressed]}>
          <Text variant="body" style={{ fontFamily: fontFamily.sansSemiBold }}>
            {manager ? t('common.cancel') : t('pageEdit.done')}
          </Text>
        </Pressable>
        <Text variant="title" accessibilityRole="header" style={styles.headTitle}>
          {t('pageEdit.title')}
        </Text>
        {manager ? (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !dirty || save.isPending }}
            disabled={!dirty || save.isPending}
            onPress={submit}
            style={({ pressed }) => [
              styles.save,
              { backgroundColor: dirty ? c.accent : c.surfaceSunk, borderColor: dirty ? c.onAccent : c.borderSubtle },
              pressed && styles.pressed,
            ]}
          >
            {save.isPending ? (
              <ActivityIndicator color={c.onAccent} accessibilityLabel={t('common.loading')} />
            ) : (
              <Text variant="body" style={{ color: dirty ? c.onAccent : c.textSecondary, fontFamily: fontFamily.sansSemiBold }}>
                {t('pageEdit.save')}
              </Text>
            )}
          </Pressable>
        ) : (
          <View style={styles.headButton} />
        )}
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
        {manager ? (
          <>
            <View style={styles.images}>
              {logoUrl ? (
                <Image source={{ uri: logoUrl }} style={[styles.logo, { borderColor: brand.ink }]} contentFit="contain" accessibilityLabel={t('page.logo', { name })} />
              ) : (
                <PageTile page={page} size={76} />
              )}
              <View style={styles.imageButtons}>
                <Button
                  variant="secondary"
                  icon="photo"
                  label={logoUrl ? t('pageEdit.changeLogo') : t('pageEdit.addLogo')}
                  onPress={() => void changeLogo()}
                  loading={setLogo.isPending}
                />
                <Button
                  variant="secondary"
                  icon="addPhoto"
                  label={headerUrl ? t('pageEdit.changeHeader') : t('pageEdit.addHeader')}
                  onPress={() => (headerUrl ? headerOptions() : void changeHeader())}
                  loading={setHeader.isPending}
                />
              </View>
            </View>
            {!logoUrl ? (
              <Text variant="bodySm" color="textSecondary">
                {t('pageEdit.logoNote')}
              </Text>
            ) : null}

            <View style={styles.section}>
              <Text variant="label" color="textSecondary">
                {t('pageEdit.nameHandle')}
              </Text>
              <Text variant="headline">{`${name} · @${page.handle}`}</Text>
              <Text variant="bodySm" color="textSecondary">
                {t('pageEdit.askRachelBefore')}
                <Text
                  variant="bodySm"
                  color="accentText"
                  accessibilityRole="link"
                  onPress={() => void openSupportMail(t('pageEdit.askRachelSubject', { name }))}
                  style={styles.link}
                >
                  {t('pageEdit.askRachel')}
                </Text>
                {t('pageEdit.askRachelAfter')}
              </Text>
            </View>

            <View style={styles.section}>
              <Text variant="label" color="textSecondary">
                {t('pageEdit.description')}
              </Text>
              <View accessibilityRole="tablist" style={styles.langs}>
                {languages.map((l) => {
                  const on = tab === l;
                  return (
                    <Pressable
                      key={l}
                      accessibilityRole="tab"
                      accessibilityState={{ selected: on }}
                      onPress={() => setTab(l)}
                      style={({ pressed }) => [styles.lang, { borderColor: c.border, backgroundColor: on ? c.text : c.surfaceRaised }, pressed && styles.pressed]}
                    >
                      <Text variant="bodySm" style={{ color: on ? c.surface : c.text, fontFamily: fontFamily.sansSemiBold }}>
                        {l === main ? t('pageEdit.mainLanguage', { language: nameOf(l) }) : nameOf(l)}
                      </Text>
                    </Pressable>
                  );
                })}
                {missing.length > 0 ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={addLanguage}
                    style={({ pressed }) => [styles.lang, styles.dashed, { borderColor: c.border }, pressed && styles.pressed]}
                  >
                    <Text variant="bodySm" style={{ fontFamily: fontFamily.sansSemiBold }}>
                      {t('pageEdit.addLanguage')}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
              <TextInput
                accessibilityLabel={t('pageEdit.descriptionIn', { language: nameOf(tab) })}
                value={bodies[tab] ?? ''}
                onChangeText={(v) => setBodies((b) => ({ ...b, [tab]: v }))}
                maxLength={MAX_DESCRIPTION}
                multiline
                style={[styles.textarea, { borderColor: c.border, backgroundColor: c.surfaceRaised, color: c.text }]}
              />
              <Text variant="bodySm" color="textSecondary">
                {t('pageEdit.descriptionNote', { language: nameOf(main) })}
              </Text>
              {tab !== main ? (
                <View style={styles.langActions}>
                  <Text variant="bodySm" color="accentText" accessibilityRole="button" onPress={() => setMain(tab)} style={styles.link}>
                    {t('pageEdit.makeMain', { language: nameOf(tab) })}
                  </Text>
                  <Text variant="bodySm" color="accentText" accessibilityRole="button" onPress={() => removeLanguage(tab)} style={styles.link}>
                    {t('pageEdit.removeLanguage', { language: nameOf(tab) })}
                  </Text>
                </View>
              ) : null}
            </View>

            <View style={styles.section}>
              <Text variant="label" color="textSecondary">
                {t('pageEdit.links')}
              </Text>
              {links.map((l, i) => (
                <View key={i} style={styles.linkRow}>
                  <TextInput
                    accessibilityLabel={t('pageEdit.linkLabel', { n: i + 1 })}
                    value={l}
                    onChangeText={(v) => setLinks((all) => all.map((x, j) => (j === i ? v : x)))}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                    placeholder={i === 0 ? 'instagram.com/…' : 'example.com'}
                    placeholderTextColor={c.textSecondary}
                    style={[styles.input, { borderColor: c.border, backgroundColor: c.surfaceRaised, color: c.text }]}
                  />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('pageEdit.removeLink', { n: i + 1 })}
                    onPress={() => setLinks((all) => all.filter((_, j) => j !== i))}
                    hitSlop={4}
                    style={({ pressed }) => [styles.square, pressed && styles.pressed]}
                  >
                    <Icon name="close" color={c.text} size={20} />
                  </Pressable>
                </View>
              ))}
              {links.length < MAX_PAGE_LINKS ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setLinks((all) => [...all, ''])}
                  style={({ pressed }) => [styles.navRow, { borderColor: c.borderSubtle }, pressed && styles.pressed]}
                >
                  <Text variant="body" color="accentText" style={styles.link}>
                    {t('pageEdit.addLink')}
                  </Text>
                  <Text variant="bodySm" color="textSecondary">
                    {t('pageEdit.linksLeft', { count: MAX_PAGE_LINKS - links.length })}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          </>
        ) : (
          <Text variant="body" color="textSecondary">
            {t('pageEdit.staffOnly', { name })}
          </Text>
        )}

        {shop ? (
          <View style={styles.section}>
            {manager ? (
              <>
                <Text variant="label" color="textSecondary">
                  {t('pageEdit.visit')}
                </Text>
                <View accessibilityRole="radiogroup" style={[styles.segments, { borderColor: c.border }]}>
                  {LOCATION_TYPES.map((type) => {
                    const on = locationType === type;
                    return (
                      <Pressable
                        key={type}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: on }}
                        onPress={() => setLocationType(type)}
                        style={[styles.segment, { backgroundColor: on ? c.text : c.surfaceRaised }]}
                      >
                        <Text variant="bodySm" style={{ color: on ? c.surface : c.text, fontFamily: fontFamily.sansSemiBold, textAlign: 'center' }}>
                          {t(`shop.type.${type}`)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                {locationType === 'by_appointment' ? (
                  <View style={styles.switchRow}>
                    <View style={styles.flex}>
                      <Text variant="body" style={{ fontFamily: fontFamily.sansSemiBold }}>
                        {t('pageEdit.showPin')}
                      </Text>
                      <Text variant="bodySm" color="textSecondary">
                        {t('pageEdit.showPinBody')}
                      </Text>
                    </View>
                    <Toggle value={showPin} onChange={setShowPin} label={t('pageEdit.showPin')} fg={c.text} />
                  </View>
                ) : null}
              </>
            ) : null}
            <View>
              <NavRow first title={t('pageEdit.closedForAWhile')} value={closedValue} onPress={() => closedSheet.open(page)} />
              {manager ? (
                <NavRow
                  title={t('shop.brandsWeCarry')}
                  value={String(page.brandsCarried.length)}
                  onPress={() => router.push({ pathname: '/page-brands/[handle]', params: { handle: page.handle } })}
                />
              ) : null}
            </View>
            <Text variant="bodySm" color="textSecondary">
              {t('pageEdit.staffNote')}
            </Text>
          </View>
        ) : null}

        {owner ? (
          <View style={styles.section}>
            <Text variant="label" color="textSecondary">
              {t('pageTeam.ownerOnly')}
            </Text>
            <Button
              variant="secondary"
              label={t(shop ? 'pageEdit.closeShop' : 'pageEdit.retireBrand', { name })}
              onPress={confirmClose}
              loading={closeForGood.isPending}
              palette={{ fill: 'transparent', text: c.danger, border: c.danger }}
            />
            <Text variant="bodySm" color="textSecondary">
              {t(shop ? 'pageEdit.closeNote' : 'pageEdit.retireNote')}
            </Text>
          </View>
        ) : null}

        {error ? (
          <Text variant="bodySm" color="statusClosed" accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
      </ScrollView>
      {actions.sheet}
      {closedSheet.sheet}
    </SafeAreaView>
  );
}

function NavRow({ title, value, onPress, first }: { title: string; value: string; onPress: () => void; first?: boolean }) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${value}`}
      onPress={onPress}
      style={({ pressed }) => [styles.navRow, { borderColor: c.borderSubtle }, first && { borderTopWidth: 1 }, pressed && styles.pressed]}
    >
      <Text variant="body" style={{ fontFamily: fontFamily.sansSemiBold }}>
        {title}
      </Text>
      <View style={styles.navValue}>
        <Text variant="body" color="textSecondary">
          {value}
        </Text>
        <Icon name="chevron" color={c.textSecondary} size={20} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  pressed: { opacity: 0.75 },
  top: { paddingHorizontal: space[4], paddingVertical: space[2] },
  block: { paddingHorizontal: space[4], gap: space[3], paddingTop: space[4] },
  loading: { marginTop: space[12] },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space[3], paddingTop: space[3] },
  headButton: { minWidth: size.tapMin, height: size.tapMin, paddingHorizontal: space[2], justifyContent: 'center' },
  headTitle: { textTransform: 'uppercase' },
  save: { height: size.tapMin, paddingHorizontal: space[4], borderWidth: stroke.rule, justifyContent: 'center' },
  content: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: space[12], gap: 22 },
  images: { flexDirection: 'row', gap: space[3], alignItems: 'center' },
  imageButtons: { flex: 1, gap: space[2] },
  logo: { width: 76, height: 76, borderWidth: stroke.rule, backgroundColor: brand.paper },
  section: { gap: space[2] },
  link: { fontFamily: fontFamily.sansSemiBold },
  langs: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  lang: { minHeight: 40, paddingHorizontal: 10, borderWidth: stroke.rule, justifyContent: 'center' },
  dashed: { borderStyle: 'dashed', backgroundColor: 'transparent' },
  langActions: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space[4], rowGap: space[1] },
  textarea: { minHeight: 96, borderWidth: stroke.rule, paddingHorizontal: space[3], paddingVertical: 10, fontSize: 16, lineHeight: 22, textAlignVertical: 'top' },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  input: { flex: 1, height: size.tapMin, borderWidth: stroke.rule, paddingHorizontal: space[3], fontSize: 16 },
  square: { width: size.tapMin, height: size.tapMin, alignItems: 'center', justifyContent: 'center' },
  navRow: { minHeight: 56, borderBottomWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[3] },
  navValue: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 },
  segments: { flexDirection: 'row', borderWidth: stroke.rule },
  segment: { flex: 1, minHeight: size.tapMin, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingTop: space[2] },
});
