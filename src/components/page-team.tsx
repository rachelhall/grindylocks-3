import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { PageTile, Sheet, SheetHead } from '@/components/pages';
import { useExplainRestriction } from '@/components/safety';
import { Button, Icon, type IconName, Toggle } from '@/components/ui';
import { type MyPage, useMyPages } from '@/lib/claims';
import { localNow } from '@/lib/hours';
import { MAX_CLOSED_NOTE, useSetTempClosed } from '@/lib/page-team';
import { type Page, type PageMemberRole, pageKind } from '@/lib/pages';
import { Sentry } from '@/lib/sentry';
import { brand, fontFamily, size, space, stroke, Text, useColors } from '@/theme';

/** "Owner", "Manager" or "Staff". */
export function useRoleName() {
  const { t } = useTranslation();
  return (role: PageMemberRole) => t(`pageTeam.roleName.${role}`);
}

/* Pages you manage (Profile-PagesYouManage) ------------------------------------------------- */

/**
 * On your own profile, under Edit profile and Invites: the pages you're on,
 * with your role and a dot for new inbox items. Only you see it, and it's
 * left out when you're on no team.
 */
export function PagesYouManage({ userId }: { userId: string }) {
  const { t } = useTranslation();
  const c = useColors();
  const { data } = useMyPages(userId);
  const roleName = useRoleName();
  if (!data || data.length === 0) return null;
  return (
    <View style={styles.manage}>
      <View style={styles.manageHead}>
        <Text variant="label" color="textSecondary" accessibilityRole="header">
          {t('pageTeam.managed.title')}
        </Text>
        <Icon name="lock" color={c.textSecondary} size={14} />
        <Text variant="caption" color="textSecondary">
          {t('pageTeam.managed.onlyYou')}
        </Text>
      </View>
      {data.map((p) => (
        <ManagedRow key={p.pageId} page={p} line={`${t(`page.${pageKind(p)}`)} · ${roleName(p.role)}`} />
      ))}
    </View>
  );
}

function ManagedRow({ page, line }: { page: MyPage; line: string }) {
  const { t } = useTranslation();
  const c = useColors();
  const fresh = page.inboxNew > 0 ? t('pageTeam.bar.newCount', { count: page.inboxNew }) : null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[page.displayName, line, fresh].filter(Boolean).join(', ')}
      onPress={() => router.push({ pathname: '/page/[handle]', params: { handle: page.handle } })}
      style={({ pressed }) => [styles.managedRow, { backgroundColor: c.surfaceRaised, borderColor: c.border }, pressed && styles.pressed]}
    >
      <PageTile page={page} />
      <View style={styles.flex}>
        <Text variant="headline" numberOfLines={1}>
          {page.displayName}
        </Text>
        <Text variant="bodySm" color="textSecondary" numberOfLines={1}>
          {line}
        </Text>
      </View>
      {fresh ? (
        <View style={styles.newTag}>
          <View style={[styles.dot, { backgroundColor: brand.pink, borderColor: c.text }]} />
          <Text variant="bodySm" style={{ fontFamily: fontFamily.sansSemiBold }}>
            {fresh}
          </Text>
        </View>
      ) : null}
      <Icon name="chevron" color={c.textSecondary} size={20} />
    </Pressable>
  );
}

/* The team's bar on its own page (Page-TeamView) --------------------------------------------- */

/**
 * Edit page, Team and Inbox, under the page's header for the team only. The
 * Inbox gets a pink dot when something's new for you.
 */
export function TeamBar({ page, inboxNew }: { page: Page; inboxNew: number }) {
  const { t } = useTranslation();
  const items: { key: string; icon: IconName; label: string; onPress: () => void; dot?: boolean }[] = [
    { key: 'edit', icon: 'edit', label: t('pageTeam.bar.edit'), onPress: () => router.push({ pathname: '/page-edit/[handle]', params: { handle: page.handle } }) },
    { key: 'team', icon: 'people', label: t('pageTeam.bar.team'), onPress: () => router.push({ pathname: '/page-team/[handle]', params: { handle: page.handle } }) },
    {
      key: 'inbox',
      icon: 'mail',
      label: t('pageTeam.bar.inbox'),
      dot: inboxNew > 0,
      onPress: () => router.push({ pathname: '/page-inbox/[handle]', params: { handle: page.handle } }),
    },
  ];
  return (
    <View style={styles.barWrap}>
      <View accessibilityRole="toolbar" accessibilityLabel={t('pageTeam.bar.label', { name: page.displayName })} style={[styles.bar, { backgroundColor: brand.ink }]}>
        {items.map((item, i) => (
          <Pressable
            key={item.key}
            accessibilityRole="button"
            accessibilityLabel={item.dot ? `${item.label}, ${t('pageTeam.bar.newCount', { count: inboxNew })}` : item.label}
            onPress={item.onPress}
            style={({ pressed }) => [styles.barItem, i < items.length - 1 && styles.barRule, pressed && styles.pressed]}
          >
            <Icon name={item.icon} color={brand.paper} size={20} />
            <Text variant="bodySm" style={{ color: brand.paper, fontFamily: fontFamily.sansSemiBold }}>
              {item.label}
            </Text>
            {item.dot ? <View style={[styles.barDot, { backgroundColor: brand.pink, borderColor: brand.paper }]} /> : null}
          </Pressable>
        ))}
      </View>
      <Text variant="bodySm" color="textSecondary">
        {t('pageTeam.bar.onlyTeam')}
      </Text>
    </View>
  );
}

/* Closed for a while ------------------------------------------------------------------------ */

const DAYS_AHEAD = 120;

/**
 * Closed for a while (everyone on the team): on or off, "Until" a day or
 * "For now", and the note skaters see under the "Closed until" chip.
 */
export function useClosedForAWhileSheet(userId: string | undefined) {
  const { t, i18n } = useTranslation();
  const c = useColors();
  const explain = useExplainRestriction();
  const save = useSetTempClosed(userId);
  const [page, setPage] = useState<Page | null>(null);
  const [closed, setClosed] = useState(false);
  const [until, setUntil] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const today = useMemo(() => (page ? localNow(new Date(), page.timeZone) : null), [page]);
  const days = useMemo(() => {
    if (!today) return [];
    const start = Date.UTC(today.year, today.month - 1, today.day);
    return Array.from({ length: DAYS_AHEAD }, (_, i) => new Date(start + (i + 1) * 86_400_000).toISOString().slice(0, 10));
  }, [today]);
  const dayLabel = (iso: string) =>
    new Intl.DateTimeFormat(i18n.language, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));

  const open = (p: Page) => {
    setPage(p);
    setClosed(Boolean(p.tempClosedAt));
    setUntil(p.tempClosedUntil);
    setNote(p.tempClosedNote ?? '');
    setError(null);
  };
  const close = () => setPage(null);

  const submit = () => {
    if (!page) return;
    if (closed && !note.trim()) {
      setError(t('pageEdit.closedSheet.noteNeeded'));
      return;
    }
    setError(null);
    save.mutate(
      { pageId: page.id, closed, closedUntil: until, note },
      {
        onSuccess: close,
        onError: async (err) => {
          if (await explain(err)) return;
          Sentry.captureException(err);
          setError(t('pageEdit.saveFailed'));
        },
      },
    );
  };

  const sheet = (
    <Sheet visible={page !== null} onClose={close}>
      {page ? (
        <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled">
          <SheetHead label={page.displayName} title={t('pageEdit.closedSheet.title')} onClose={close} />
          <Text variant="bodySm" color="textSecondary">
            {t('pageEdit.closedSheet.body')}
          </Text>
          <View style={styles.switchRow}>
            <Text variant="headline" style={styles.flex}>
              {t('pageEdit.closedSheet.switch')}
            </Text>
            <Toggle value={closed} onChange={setClosed} label={t('pageEdit.closedSheet.switch')} fg={c.text} />
          </View>
          {closed ? (
            <>
              <Text variant="label" color="textSecondary">
                {t('pageEdit.closedSheet.until')}
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                <Chip label={t('pageEdit.closedSheet.forNow')} picked={until === null} onPress={() => setUntil(null)} />
                {days.map((d) => (
                  <Chip key={d} label={dayLabel(d)} picked={until === d} onPress={() => setUntil(d)} />
                ))}
              </ScrollView>
              <Text variant="bodySm" style={{ fontFamily: fontFamily.sansSemiBold }}>
                {t('pageEdit.closedSheet.note')}
              </Text>
              <TextInput
                accessibilityLabel={t('pageEdit.closedSheet.note')}
                value={note}
                onChangeText={setNote}
                maxLength={MAX_CLOSED_NOTE}
                multiline
                placeholder={t('pageEdit.closedSheet.notePlaceholder')}
                placeholderTextColor={c.textSecondary}
                style={[styles.noteInput, { borderColor: c.border, backgroundColor: c.surfaceRaised, color: c.text }]}
              />
            </>
          ) : null}
          {error ? (
            <Text variant="bodySm" color="statusClosed" accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}
          <Button label={t('pageEdit.save')} onPress={submit} loading={save.isPending} />
        </ScrollView>
      ) : null}
    </Sheet>
  );
  return { sheet, open };
}

function Chip({ label, picked, onPress }: { label: string; picked: boolean; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: picked }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        { borderColor: picked ? c.accent : c.borderSubtle, backgroundColor: picked ? c.accent : c.surfaceRaised },
        pressed && styles.pressed,
      ]}
    >
      <Text variant="bodySm" style={{ color: picked ? c.onAccent : c.text, fontFamily: fontFamily.sansSemiBold }}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Alerts for the team functions' refusals, in plain words. */
export function useTeamErrorAlert() {
  const { t } = useTranslation();
  const explain = useExplainRestriction();
  return async (err: unknown, values: { who?: string; name?: string } = {}) => {
    if (await explain(err)) return;
    const message = (err as { message?: string } | null)?.message ?? '';
    const known = {
      not_found: 'pageTeam.errors.notFound',
      already_on_team: 'pageTeam.errors.alreadyOnTeam',
      too_many_invites: 'pageTeam.errors.tooMany',
      invalid_email: 'pageTeam.errors.invalidEmail',
      not_allowed: 'pageTeam.errors.notAllowed',
      suspended: 'pageTeam.errors.suspended',
      on_the_team: 'pageTeam.errors.onTheTeam',
      invite_closed: 'notifications.page.inviteClosed',
    } as const;
    const key = message in known ? known[message as keyof typeof known] : null;
    if (!key) Sentry.captureException(err);
    Alert.alert(key ? t(key, values) : t('errors.generic'), key ? undefined : t('errors.network'));
  };
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pressed: { opacity: 0.75 },
  manage: { paddingHorizontal: 20, paddingTop: 18, gap: space[2] },
  manageHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  managedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingHorizontal: space[3],
    paddingVertical: 10,
    borderWidth: stroke.rule,
    minHeight: size.tapMin,
  },
  newTag: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 10, height: 10, borderWidth: stroke.rule },
  barWrap: { paddingHorizontal: space[4], paddingTop: space[4], gap: space[2] },
  bar: { flexDirection: 'row' },
  barItem: { flex: 1, minHeight: 52, alignItems: 'center', justifyContent: 'center', gap: 2, paddingVertical: space[1] },
  // A hairline between the items, in paper at low strength (the ink bar is dark in both themes).
  barRule: { borderRightWidth: 1, borderRightColor: 'rgba(242, 239, 230, 0.25)' },
  barDot: { position: 'absolute', top: 8, right: '28%', width: 10, height: 10, borderWidth: stroke.rule },
  sheetBody: { gap: space[3], paddingBottom: space[2] },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: size.tapMin },
  chips: { gap: space[2], paddingVertical: space[1] },
  chip: { minHeight: 40, paddingHorizontal: space[3], borderWidth: stroke.rule, justifyContent: 'center' },
  noteInput: { minHeight: 88, borderWidth: stroke.rule, padding: space[3], fontSize: 16, textAlignVertical: 'top' },
});
