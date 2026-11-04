/**
 * Brand and shop page pieces (part A, PR 2), per the Brand accounts (v2)
 * mockups (brand pages, discovery, reporting rows):
 *
 * - PageTile: the small square for Search, the @ list and the report picker:
 *   a managed page's logo, or an ink tile with its first letter.
 * - StampTape: OFFICIAL (pink tape) or UNOFFICIAL / RETIRED / CLOSED (paper
 *   outline), drawn by the app so nobody can fake it with a profile photo.
 * - PageRow: a page in Search results.
 * - PageMentionRows: the @ list's Pages heading.
 * - usePageMenu: the ⋯ menu sheet (Mute, Report, Block, each explained).
 * - usePageReportSheet: Report this page, then "Thanks, it's sent".
 * - SuggestPageBox and its sheet: "Can't find a brand or shop? Suggest it".
 * - PagePicker: "Which brand or shop?" on a profile report.
 */
import { Image } from 'expo-image';
import { type ReactNode, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';

import { Button, Icon, type IconName, SelectRow, TextField } from '@/components/ui';
import { MAX_REPORT_DETAILS } from '@/lib/moderation';
import {
  isOfficial,
  MAX_SUGGEST_NAME,
  MAX_SUGGEST_TEXT,
  PAGE_REPORT_REASONS,
  type PageReportReason,
  type PageResult,
  type PageRole,
  pageImageUrl,
  pageKind,
  placeName,
  searchPages,
  type Stamp,
  stampFor,
  useFilePageReport,
  useSuggestPage,
} from '@/lib/pages';
import { fresh, keys } from '@/lib/query';
import { Sentry } from '@/lib/sentry';
import { brand, fontFamily, size, space, stroke, Text, useColors } from '@/theme';

/* Small pieces ------------------------------------------------------------------------- */

/** A managed page's logo, or an ink tile with the first letter in Archivo Black. */
export function PageTile({
  page,
  size: side = 44,
}: {
  page: { displayName: string; state: PageResult['state']; logoPath: string | null };
  size?: number;
}) {
  const url = isOfficial(page) ? pageImageUrl(page.logoPath) : null;
  if (url) {
    return (
      <Image
        source={{ uri: url }}
        style={[styles.logoTile, { width: side, height: side, borderColor: brand.ink }]}
        contentFit="contain"
        accessibilityIgnoresInvertColors
      />
    );
  }
  return (
    <View style={[styles.letterTile, { width: side, height: side, backgroundColor: brand.ink }]}>
      <Text variant="display" style={{ color: brand.paper, fontSize: side * 0.45, lineHeight: side * 0.5 }}>
        {page.displayName.trim().charAt(0)}
      </Text>
    </View>
  );
}

/**
 * The stamp after a page's name. `onInk` for the header (paper outline on
 * ink); otherwise it sits on the screen's surface. `small` is the tape in
 * Search and the @ list, where only OFFICIAL shows.
 */
export function StampTape({ stamp, onInk = false, small = false }: { stamp: Stamp; onInk?: boolean; small?: boolean }) {
  const { t } = useTranslation();
  const c = useColors();
  const official = stamp === 'official';
  const line = onInk ? brand.paper : c.text;
  return (
    <View
      style={[
        small ? styles.stampSmall : styles.stamp,
        official
          ? { backgroundColor: brand.pink, borderColor: brand.pink }
          : { backgroundColor: 'transparent', borderColor: line },
      ]}
    >
      <Text
        variant="label"
        style={[styles.stampText, small && styles.stampTextSmall, { color: official ? brand.ink : line }]}
      >
        {t(`page.stamp.${stamp}`)}
      </Text>
    </View>
  );
}

/** "@themskates · Brand · Santa Ana", or the state word when it isn't official. */
export function usePageLine() {
  const { t, i18n } = useTranslation();
  return useCallback(
    (p: PageResult) => {
      const stamp = stampFor(p);
      const where = stamp === 'official' ? placeName(p, i18n.language) : t(`page.stamp.${stamp}`);
      return [
        `@${p.handle}`,
        t(`page.${pageKind(p)}`),
        where,
        p.formerly ? t('page.formerly', { names: p.formerly }) : null,
      ]
        .filter(Boolean)
        .join(' · ');
    },
    [t, i18n.language],
  );
}

/** A page in Search: tile, name with OFFICIAL, the line, and "Following". */
export function PageRow({ page, onPress }: { page: PageResult; onPress: () => void }) {
  const { t } = useTranslation();
  const c = useColors();
  const line = usePageLine()(page);
  const official = isOfficial(page);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[page.displayName, official ? t('page.stamp.official') : null, line, page.following ? t('find.following') : null]
        .filter(Boolean)
        .join(', ')}
      onPress={onPress}
      style={({ pressed }) => [styles.row, { backgroundColor: c.surfaceRaised }, pressed && styles.pressed]}
    >
      <PageTile page={page} />
      <View style={styles.rowMain}>
        <View style={styles.nameRow}>
          <Text variant="headline" numberOfLines={1} style={styles.shrink}>
            {page.displayName}
          </Text>
          {official ? <StampTape stamp="official" small /> : null}
        </View>
        <Text variant="bodySm" color="textSecondary" numberOfLines={1}>
          {line}
        </Text>
      </View>
      {page.following ? (
        <Text variant="label" color="textSecondary">
          {t('find.following')}
        </Text>
      ) : null}
    </Pressable>
  );
}

/**
 * The @ list's Pages heading and rows, after the people (Mention-Pages
 * mockup), with the line saying a mention goes to the page's inbox.
 * `highlightFirst` when no people are listed, so the first page is the
 * likely pick.
 */
export function PageMentionRows({
  pages,
  typed,
  highlightFirst,
  onPick,
}: {
  pages: PageResult[];
  typed: number;
  highlightFirst: boolean;
  onPick: (handle: string) => void;
}) {
  const { t } = useTranslation();
  const c = useColors();
  if (pages.length === 0) return null;
  return (
    <View>
      <Text variant="label" color="textSecondary" style={styles.mentionHeading}>
        {t('page.mention.heading')}
      </Text>
      {pages.map((p, i) => {
        const first = highlightFirst && i === 0;
        const ink = first ? c.onAccentSubtle : c.text;
        const reason = p.following ? t(pageKind(p) === 'shop' ? 'page.mention.shopFollowing' : 'page.mention.brandFollowing') : t(`page.${pageKind(p)}`);
        return (
          <Pressable
            key={p.id}
            accessibilityRole="button"
            accessibilityLabel={`${p.displayName}, @${p.handle}, ${reason}`}
            onPress={() => onPick(p.handle)}
            style={({ pressed }) => [styles.mentionRow, first && { backgroundColor: c.accentSubtle }, pressed && styles.pressed]}
          >
            <PageTile page={p} size={32} />
            <View style={styles.rowMain}>
              <View style={styles.nameRow}>
                <Text variant="body" numberOfLines={1} style={[styles.shrink, { color: ink, fontFamily: fontFamily.sansSemiBold }]}>
                  {p.displayName}
                </Text>
                {isOfficial(p) ? <StampTape stamp="official" small /> : null}
              </View>
              <Text variant="caption" numberOfLines={1} style={{ color: first ? c.onAccentSubtle : c.textSecondary }}>
                <Text variant="caption" style={[styles.typed, { color: first ? c.onAccentSubtle : c.textSecondary }]}>
                  {`@${p.handle.slice(0, typed)}`}
                </Text>
                {`${p.handle.slice(typed)} · ${reason}`}
              </Text>
            </View>
          </Pressable>
        );
      })}
      <Text variant="caption" color="textSecondary" style={styles.mentionNote}>
        {t('page.mention.inbox')}
      </Text>
    </View>
  );
}

/* Bottom sheet frame ---------------------------------------------------------------------- */

function Sheet({ visible, onClose, children }: { visible: boolean; onClose: () => void; children: ReactNode }) {
  const { t } = useTranslation();
  const c = useColors();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable accessibilityLabel={t('common.close')} style={styles.scrim} onPress={onClose} />
        <View style={[styles.sheet, { backgroundColor: c.surface, borderColor: c.border, paddingBottom: space[6] + insets.bottom }]}>
          <View style={[styles.grabber, { backgroundColor: c.borderSubtle }]} />
          {children}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function SheetHead({ label, title, onClose }: { label?: string | null; title: string; onClose: () => void }) {
  const { t } = useTranslation();
  const c = useColors();
  return (
    <View style={styles.head}>
      <View style={styles.flex}>
        {label ? (
          <Text variant="label" color="textSecondary">
            {label}
          </Text>
        ) : null}
        <Text variant="title" accessibilityRole="header" style={styles.title}>
          {title}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('common.close')}
        onPress={onClose}
        hitSlop={4}
        style={({ pressed }) => [styles.close, { backgroundColor: c.surfaceRaised }, pressed && styles.pressed]}
      >
        <Icon name="close" color={c.text} size={20} />
      </Pressable>
    </View>
  );
}

/* The ⋯ menu -------------------------------------------------------------------------------- */

type MenuItem = { icon: IconName; title: string; body: string; destructive?: boolean; onPress: () => void };

/**
 * The page's ⋯ menu (Page-Menu mockup): each action with a line saying what
 * it does, since none of them tells the page. Render `sheet` once and call
 * `open`.
 */
export function usePageMenu(): {
  sheet: ReactNode;
  open: (head: { name: string; handle: string; stamp: Stamp }, items: MenuItem[]) => void;
} {
  const { t } = useTranslation();
  const c = useColors();
  const [state, setState] = useState<{ head: { name: string; handle: string; stamp: Stamp }; items: MenuItem[] } | null>(null);
  const close = useCallback(() => setState(null), []);
  const open = useCallback(
    (head: { name: string; handle: string; stamp: Stamp }, items: MenuItem[]) => setState({ head, items }),
    [],
  );
  const sheet = (
    <Sheet visible={state !== null} onClose={close}>
      {state ? (
        <View style={styles.body}>
          <View style={styles.menuHead}>
            <View style={styles.nameRow}>
              <Text variant="title" numberOfLines={1} style={styles.shrink}>
                {state.head.name}
              </Text>
              <StampTape stamp={state.head.stamp} small />
            </View>
            <Text variant="bodySm" color="textSecondary">
              @{state.head.handle}
            </Text>
          </View>
          {state.items.map((item) => (
            <Pressable
              key={item.title}
              accessibilityRole="button"
              accessibilityLabel={`${item.title}, ${item.body}`}
              onPress={() => {
                close();
                item.onPress();
              }}
              style={({ pressed }) => [styles.menuRow, { borderTopColor: c.borderSubtle }, pressed && styles.pressed]}
            >
              <Icon name={item.icon} color={item.destructive ? c.danger : c.text} size={22} />
              <View style={styles.rowMain}>
                <Text variant="headline" style={{ color: item.destructive ? c.danger : c.text }}>
                  {item.title}
                </Text>
                <Text variant="bodySm" color="textSecondary">
                  {item.body}
                </Text>
              </View>
            </Pressable>
          ))}
          <Button label={t('common.cancel')} variant="secondary" onPress={close} />
        </View>
      ) : null}
    </Sheet>
  );
  return { sheet, open };
}

/* Report this page ------------------------------------------------------------------------- */

type ReportablePage = { id: string; handle: string; displayName: string };

/**
 * Report this page (Page-Report mockup), then "Thanks, it's sent" with
 * "Block {name} too?". `onBlock` blocks the page.
 */
export function usePageReportSheet({ onBlock }: { onBlock?: () => void } = {}): {
  sheet: ReactNode;
  open: (page: ReportablePage) => void;
} {
  const [page, setPage] = useState<ReportablePage | null>(null);
  const close = useCallback(() => setPage(null), []);
  const open = useCallback((next: ReportablePage) => setPage(next), []);
  const sheet = (
    <Sheet visible={page !== null} onClose={close}>
      {page ? <PageReportContent key={page.id} page={page} onClose={close} onBlock={onBlock} /> : null}
    </Sheet>
  );
  return { sheet, open };
}

function PageReportContent({ page, onClose, onBlock }: { page: ReportablePage; onClose: () => void; onBlock?: () => void }) {
  const { t } = useTranslation();
  const c = useColors();
  const file = useFilePageReport();
  const [reason, setReason] = useState<PageReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [sent, setSent] = useState(false);
  const name = page.displayName;

  const text = (r: PageReportReason) => {
    switch (r) {
      case 'impersonation':
        return { title: t('report.impersonation'), subtitle: t('page.report.impersonationBody') };
      case 'our_page':
        return { title: t('page.report.ourPage'), subtitle: t('page.report.ourPageBody') };
      case 'wrong_info':
        return { title: t('page.report.wrongInfo'), subtitle: t('page.report.wrongInfoBody') };
      case 'spam':
        return { title: t('report.spam'), subtitle: t('report.spamBody') };
      case 'harassment':
        return { title: t('report.harassment'), subtitle: undefined };
      default:
        return { title: t('report.other'), subtitle: undefined };
    }
  };

  const send = () => {
    if (!reason) return;
    file.mutate(
      { pageId: page.id, reason, details },
      {
        onSuccess: () => setSent(true),
        onError: (err) => {
          Sentry.captureException(err);
          Alert.alert(t('errors.generic'), t('errors.network'));
        },
      },
    );
  };

  if (sent) {
    return (
      <View style={styles.body}>
        <View style={styles.sent}>
          <Icon name="checkCircle" color={c.statusOpen} size={40} />
          <Text variant="title" accessibilityRole="header" accessibilityLiveRegion="polite">
            {t('report.sentTitle')}
          </Text>
          <Text variant="body" color="textSecondary">
            {t('report.sentOwner')}
          </Text>
        </View>
        {onBlock ? (
          <View style={[styles.box, { backgroundColor: c.surfaceRaised, borderColor: c.borderSubtle }]}>
            <Text variant="headline">{t('page.report.blockToo', { name })}</Text>
            <Text variant="bodySm" color="textSecondary">
              {t('page.report.blockTooBody')}
            </Text>
            <Button
              label={t('page.menu.block', { name })}
              variant="secondary"
              palette={{ fill: 'transparent', text: c.danger, border: c.danger }}
              onPress={() => {
                onClose();
                onBlock();
              }}
              style={styles.outline}
            />
          </View>
        ) : null}
        <Button label={t('report.done')} palette={{ fill: c.accent, text: c.onAccent, border: c.accent }} onPress={onClose} />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" bounces={false}>
      <SheetHead label={t('page.report.label', { handle: page.handle })} title={t('page.report.title')} onClose={onClose} />
      <View style={styles.group} accessibilityRole="radiogroup">
        <Text variant="label" color="textSecondary">
          {t('report.whatsWrong')}
        </Text>
        {PAGE_REPORT_REASONS.map((r) => {
          const { title, subtitle } = text(r);
          return <SelectRow key={r} title={title} subtitle={subtitle} selected={reason === r} onPress={() => setReason(r)} />;
        })}
      </View>
      <TextField
        label={reason === 'our_page' ? t('page.report.reach') : t('report.details')}
        labelNote={t('common.optional')}
        placeholder={reason === 'our_page' ? t('page.report.reachHint') : undefined}
        value={details}
        onChangeText={setDetails}
        maxLength={MAX_REPORT_DETAILS}
        multiline
        textAlignVertical="top"
      />
      <Text variant="bodySm" color="textSecondary">
        {t('page.report.who', { name })}
      </Text>
      <Button
        label={t('report.send')}
        palette={{ fill: c.accent, text: c.onAccent, border: c.accent }}
        onPress={send}
        disabled={!reason}
        loading={file.isPending}
      />
    </ScrollView>
  );
}

/* Suggest a brand or shop -------------------------------------------------------------------- */

/** The dashed box under Search results (Search-Pages mockup). */
export function SuggestPageBox() {
  const { t } = useTranslation();
  const c = useColors();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${t('find.suggestTitle')} ${t('find.suggestLink')}`}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.suggestBox, { borderColor: c.border }, pressed && styles.pressed]}
      >
        <Icon name="storefront" color={c.text} size={22} />
        <Text variant="bodySm" style={styles.shrink}>
          {t('find.suggestTitle')}{' '}
          <Text variant="bodySm" style={{ color: c.accentText, fontFamily: fontFamily.sansSemiBold }}>
            {t('find.suggestLink')}
          </Text>
        </Text>
      </Pressable>
      <Sheet visible={open} onClose={() => setOpen(false)}>
        {open ? <SuggestPageContent onClose={() => setOpen(false)} /> : null}
      </Sheet>
    </>
  );
}

function SuggestPageContent({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const c = useColors();
  const suggest = useSuggestPage();
  const [role, setRole] = useState<PageRole>('brand');
  const [name, setName] = useState('');
  const [what, setWhat] = useState('');
  const [link, setLink] = useState('');
  const [sent, setSent] = useState(false);

  const send = () =>
    suggest.mutate(
      { role, name, what, link },
      {
        onSuccess: () => setSent(true),
        onError: (err) => {
          if ((err as { message?: string }).message === 'too_many_suggestions') {
            Alert.alert(t('page.suggest.tooMany'));
            return;
          }
          Sentry.captureException(err);
          Alert.alert(t('errors.generic'), t('errors.network'));
        },
      },
    );

  if (sent) {
    return (
      <View style={styles.body}>
        <View style={styles.sent}>
          <Icon name="checkCircle" color={c.statusOpen} size={40} />
          <Text variant="title" accessibilityRole="header" accessibilityLiveRegion="polite">
            {t('page.suggest.sentTitle')}
          </Text>
          <Text variant="body" color="textSecondary">
            {t('page.suggest.sentBody')}
          </Text>
        </View>
        <Button label={t('report.done')} palette={{ fill: c.accent, text: c.onAccent, border: c.accent }} onPress={onClose} />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" bounces={false}>
      <SheetHead title={t('page.suggest.title')} onClose={onClose} />
      <View accessibilityRole="radiogroup" style={[styles.segments, { borderColor: c.border }]}>
        {(['brand', 'shop'] as const).map((r) => {
          const on = role === r;
          return (
            <Pressable
              key={r}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              onPress={() => setRole(r)}
              style={({ pressed }) => [styles.segment, { backgroundColor: on ? c.text : c.surfaceRaised }, pressed && styles.pressed]}
            >
              <Text variant="bodySm" style={{ color: on ? c.surface : c.text, fontFamily: fontFamily.sansSemiBold }}>
                {t(`page.${r}`)}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <TextField label={t('page.suggest.name')} value={name} onChangeText={setName} maxLength={MAX_SUGGEST_NAME} autoCapitalize="words" />
      <TextField
        label={role === 'shop' ? t('page.suggest.whatShop') : t('page.suggest.what')}
        labelNote={t('common.optional')}
        value={what}
        onChangeText={setWhat}
        maxLength={MAX_SUGGEST_TEXT}
      />
      <TextField
        label={t('page.suggest.link')}
        labelNote={t('common.optional')}
        value={link}
        onChangeText={setLink}
        maxLength={MAX_SUGGEST_TEXT}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
      />
      <Text variant="bodySm" color="textSecondary">
        {t('page.suggest.note')}
      </Text>
      <Button
        label={t('page.suggest.send')}
        palette={{ fill: c.accent, text: c.onAccent, border: c.accent }}
        onPress={send}
        disabled={!name.trim()}
        loading={suggest.isPending}
      />
    </ScrollView>
  );
}

/* "Which brand or shop?" on a profile report -------------------------------------------------- */

/**
 * Pick the page a profile is pretending to be (Profile-Report-Impersonation
 * mockup): search, then the picked page's row with Change.
 */
export function PagePicker({ value, onChange }: { value: PageResult | null; onChange: (page: PageResult | null) => void }) {
  const { t } = useTranslation();
  const c = useColors();
  const line = usePageLine();
  const [q, setQ] = useState('');
  const query = q.trim().replace(/^@+/, '');
  const results = useQuery({
    queryKey: keys.pageSearch(query.toLowerCase(), false),
    queryFn: () => searchPages(query, false, 5),
    enabled: !value && query.length >= 2,
    staleTime: fresh.search,
  });

  if (value) {
    return (
      <View style={styles.group}>
        <Text variant="label" color="textSecondary">
          {t('report.whichPage')}
        </Text>
        <View style={[styles.row, styles.picked, { backgroundColor: c.surfaceRaised, borderColor: c.border }]}>
          <PageTile page={value} />
          <View style={styles.rowMain}>
            <Text variant="headline" numberOfLines={1}>
              {value.displayName}
            </Text>
            <Text variant="bodySm" color="textSecondary" numberOfLines={1}>
              {`@${value.handle} · ${t(`page.${pageKind(value)}`)}`}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              onChange(null);
              setQ('');
            }}
            hitSlop={8}
            style={({ pressed }) => [styles.change, pressed && styles.pressed]}
          >
            <Text variant="bodySm" style={{ color: c.accentText, fontFamily: fontFamily.sansSemiBold }}>
              {t('report.changePage')}
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.group}>
      <TextField
        label={t('report.whichPage')}
        placeholder={t('report.findPage')}
        icon="search"
        value={q}
        onChangeText={setQ}
        autoCapitalize="none"
        autoCorrect={false}
      />
      {(results.data ?? []).map((p) => (
        <Pressable
          key={p.id}
          accessibilityRole="button"
          accessibilityLabel={`${p.displayName}, ${line(p)}`}
          onPress={() => onChange(p)}
          style={({ pressed }) => [styles.row, { backgroundColor: c.surfaceRaised }, pressed && styles.pressed]}
        >
          <PageTile page={p} size={36} />
          <View style={styles.rowMain}>
            <Text variant="headline" numberOfLines={1}>
              {p.displayName}
            </Text>
            <Text variant="bodySm" color="textSecondary" numberOfLines={1}>
              {line(p)}
            </Text>
          </View>
        </Pressable>
      ))}
      {results.data && results.data.length === 0 ? (
        <Text variant="bodySm" color="textSecondary">
          {t('report.noPageFound')}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  shrink: { flexShrink: 1 },
  pressed: { opacity: 0.75 },
  logoTile: { borderWidth: stroke.rule, backgroundColor: brand.paper },
  letterTile: { alignItems: 'center', justifyContent: 'center' },
  stamp: { borderWidth: stroke.rule, paddingHorizontal: 7, paddingVertical: 3, transform: [{ rotate: '-3deg' }] },
  stampSmall: { borderWidth: stroke.hairline, paddingHorizontal: 4, paddingVertical: 1 },
  stampText: { fontFamily: fontFamily.sansSemiBold, letterSpacing: 0.96 },
  stampTextSmall: { fontSize: 10, lineHeight: 13 },
  row: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingHorizontal: space[3],
    paddingVertical: 10,
  },
  picked: { borderWidth: stroke.rule },
  rowMain: { flex: 1, minWidth: 0, gap: 3 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  change: { minHeight: size.tapMin, justifyContent: 'center', paddingHorizontal: space[1] },
  mentionHeading: { paddingHorizontal: space[3], paddingTop: space[2], paddingBottom: 2 },
  mentionRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52, paddingHorizontal: space[3] },
  mentionNote: { paddingHorizontal: space[3], paddingVertical: space[2] },
  typed: { textDecorationLine: 'underline' },
  scrim: { flex: 1, backgroundColor: 'rgba(17,17,17,0.5)' },
  sheet: { maxHeight: '92%', borderTopWidth: stroke.rule },
  grabber: { width: 40, height: 5, alignSelf: 'center', marginTop: 10 },
  body: { paddingHorizontal: 20, paddingTop: space[3], gap: space[4] },
  head: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  title: { fontSize: 26, lineHeight: 28 },
  close: { width: size.tapMin, height: size.tapMin, alignItems: 'center', justifyContent: 'center' },
  group: { gap: space[2] },
  sent: { gap: space[2], paddingTop: space[2] },
  box: { borderWidth: stroke.rule, padding: space[4], gap: space[2] },
  outline: { minHeight: size.tapMin, marginTop: space[1] },
  menuHead: { gap: 2, paddingBottom: space[1] },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space[3],
    paddingVertical: space[3],
    borderTopWidth: stroke.hairline,
    minHeight: size.tapMin,
  },
  suggestBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    borderWidth: stroke.rule,
    borderStyle: 'dashed',
    padding: space[4],
    minHeight: size.tapMin,
  },
  segments: { flexDirection: 'row', alignSelf: 'flex-start', borderWidth: stroke.rule },
  segment: { height: 40, minWidth: 88, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
});
