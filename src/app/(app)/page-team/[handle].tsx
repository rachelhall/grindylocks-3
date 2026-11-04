import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { useRoleName, useTeamErrorAlert } from '@/components/page-team';
import { SafeAreaView } from '@/components/safe-area';
import { BackButton, Button, Icon, TextField, useActionSheet } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import {
  MAX_OPEN_INVITES,
  roleRank,
  type TeamMember,
  useCancelPageInvite,
  useInviteToPage,
  useLeaveTeam,
  useMyOwnedPages,
  useOfferOwnership,
  usePageBlock,
  usePageBlocked,
  usePageTeam,
  usePageTeamInvites,
  useRemoveMember,
  useSetMemberRole,
} from '@/lib/page-team';
import { type Page, type PageMemberRole, usePage, usePageViewerState } from '@/lib/pages';
import { timeAgo } from '@/components/post-card';
import { fontFamily, size, space, stroke, Text, useColors } from '@/theme';

/**
 * Team (Page-Team mockup, part A PR 7a). Everyone on the team sees who's on
 * it; managers and the owner also see the invite box, the Waiting list and
 * the page's Blocked list. Per the PRD's matrix:
 *
 * - Managers invite staff and managers, move staff up, remove staff, cancel
 *   invites and block or unblock skaters.
 * - Only the owner moves a manager down, removes a manager or hands the page
 *   over. The new owner accepts from the bell; the owner becomes a manager.
 * - Anyone but the owner can leave.
 */
export default function PageTeamScreen() {
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
  if (!viewer.data.teamRole) {
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
  return <Team page={page} role={viewer.data.teamRole} />;
}

function Team({ page, role }: { page: Page; role: PageMemberRole }) {
  const { t, i18n } = useTranslation();
  const c = useColors();
  const { session } = useAuth();
  const userId = session?.user.id;
  const roleName = useRoleName();
  const alertError = useTeamErrorAlert();
  const actions = useActionSheet();
  const name = page.displayName;
  const manager = roleRank(role) >= 2 && page.state === 'managed';
  const owner = role === 'owner' && page.state === 'managed';

  const team = usePageTeam(page.id);
  const invites = usePageTeamInvites(page.id, manager);
  const blocked = usePageBlocked(page.id, manager);
  const owned = useMyOwnedPages(owner ? userId : undefined);
  const handover = owned.data?.find((p) => p.pageId === page.id);

  const invite = useInviteToPage(page.id, userId);
  const cancelInvite = useCancelPageInvite(page.id, userId);
  const setRole = useSetMemberRole(page.id, userId);
  const remove = useRemoveMember(page.id, userId);
  const leave = useLeaveTeam(page.id, userId);
  const offer = useOfferOwnership(page.id, userId);
  const block = usePageBlock(page.id, userId);

  const [who, setWho] = useState('');
  const [inviteRole, setInviteRole] = useState<'staff' | 'manager'>('staff');
  const [sent, setSent] = useState<string | null>(null);
  // Read once per visit, for "expires in 5 days".
  const [now] = useState(() => Date.now());

  const members = team.data ?? [];
  const waiting = (invites.data ?? []).filter((i) => i.kind === 'team');
  const openHandover = (invites.data ?? []).find((i) => i.kind === 'ownership');

  const sendInvite = () => {
    const target = who.trim();
    if (!target) return;
    setSent(null);
    invite.mutate(
      { who: target, role: inviteRole },
      {
        onSuccess: () => {
          setSent(t('pageTeam.sent', { who: target }));
          setWho('');
        },
        onError: (err) => void alertError(err, { who: target, name }),
      },
    );
  };

  const date = (iso: string) => new Intl.DateTimeFormat(i18n.language, { month: 'short', year: 'numeric' }).format(new Date(iso));
  const left = (iso: string) => {
    const days = Math.max(1, Math.ceil((new Date(iso).getTime() - now) / 86_400_000));
    return t('pageTeam.inDays', { count: days });
  };

  const confirmRemove = (m: TeamMember) =>
    Alert.alert(t('pageTeam.removeConfirm', { username: m.username ?? '', name }), t('pageTeam.removeBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('pageTeam.remove'), style: 'destructive', onPress: () => remove.mutate(m.userId, { onError: (err) => void alertError(err) }) },
    ]);
  const confirmOffer = (m: TeamMember) =>
    Alert.alert(t('pageTeam.offerConfirm', { username: m.username ?? '', name }), t('pageTeam.offerBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('pageTeam.offerButton'), onPress: () => offer.mutate(m.userId, { onError: (err) => void alertError(err) }) },
    ]);
  const confirmLeave = () =>
    Alert.alert(t('pageTeam.menu.leaveConfirm', { name }), t('pageTeam.menu.leaveBody', { name }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('pageTeam.menu.leaveButton'),
        style: 'destructive',
        onPress: () =>
          leave.mutate(undefined, {
            onSuccess: () => router.replace({ pathname: '/page/[handle]', params: { handle: page.handle } }),
            onError: (err) => void alertError(err),
          }),
      },
    ]);

  const optionsFor = (m: TeamMember) => {
    const list: { label: string; onPress: () => void; destructive?: boolean }[] = [];
    if (m.isMe) {
      if (role !== 'owner') list.push({ label: t('pageTeam.menu.leave', { name }), destructive: true, onPress: confirmLeave });
    } else if (m.role === 'staff' && manager) {
      list.push({ label: t('pageTeam.makeManager'), onPress: () => setRole.mutate({ member: m.userId, role: 'manager' }, { onError: (err) => void alertError(err) }) });
      if (owner) list.push({ label: t('pageTeam.makeOwner'), onPress: () => confirmOffer(m) });
      list.push({ label: t('pageTeam.remove'), destructive: true, onPress: () => confirmRemove(m) });
    } else if (m.role === 'manager' && owner) {
      list.push({ label: t('pageTeam.makeStaff'), onPress: () => setRole.mutate({ member: m.userId, role: 'staff' }, { onError: (err) => void alertError(err) }) });
      list.push({ label: t('pageTeam.makeOwner'), onPress: () => confirmOffer(m) });
      list.push({ label: t('pageTeam.remove'), destructive: true, onPress: () => confirmRemove(m) });
    }
    return list;
  };

  const transfer = () => {
    const others = members.filter((m) => !m.isMe);
    if (others.length === 0) {
      Alert.alert(t('pageTeam.transferNobody', { name }));
      return;
    }
    actions.show({
      title: t('pageTeam.transferTitle', { name }),
      message: t('pageTeam.offerBody'),
      actions: others.map((m) => ({ label: m.username ?? t('common.deletedUser'), onPress: () => confirmOffer(m) })),
    });
  };

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: c.surface }]}>
      <View style={styles.top}>
        <BackButton />
        <View style={styles.flex}>
          <Text variant="label" color="textSecondary">
            {name}
          </Text>
          <Text variant="title" accessibilityRole="header" style={styles.upper}>
            {t('pageTeam.bar.team')}
          </Text>
        </View>
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {manager ? (
          <View style={[styles.inviteBox, { borderColor: c.border, backgroundColor: c.surfaceRaised }]}>
            <Text variant="headline">{t('pageTeam.inviteTitle')}</Text>
            <TextField
              label={t('pageTeam.whoLabel')}
              hint={t('pageTeam.whoHint')}
              value={who}
              onChangeText={setWho}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              returnKeyType="send"
              onSubmitEditing={sendInvite}
            />
            <View accessibilityRole="radiogroup" accessibilityLabel={t('pageTeam.roleLabel')} style={styles.chips}>
              {(['staff', 'manager'] as const).map((r) => {
                const on = inviteRole === r;
                return (
                  <Pressable
                    key={r}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    onPress={() => setInviteRole(r)}
                    style={({ pressed }) => [
                      styles.chip,
                      { borderColor: on ? c.accent : c.borderSubtle, backgroundColor: on ? c.accent : c.surfaceRaised },
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text variant="bodySm" style={{ color: on ? c.onAccent : c.text, fontFamily: fontFamily.sansSemiBold }}>
                      {roleName(r)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Button label={t('pageTeam.send')} onPress={sendInvite} disabled={!who.trim()} loading={invite.isPending} />
            {sent ? (
              <Text variant="bodySm" color="textSecondary" accessibilityLiveRegion="polite">
                {sent}
              </Text>
            ) : null}
          </View>
        ) : null}

        <Text variant="label" color="textSecondary" accessibilityRole="header">
          {t('pageTeam.onTeam', { count: members.length })}
        </Text>
        {team.isPending ? <ActivityIndicator color={c.text} accessibilityLabel={t('common.loading')} /> : null}
        {members.map((m) => {
          const options = optionsFor(m);
          return (
            <View key={m.userId} style={[styles.member, { backgroundColor: c.surfaceRaised }]}>
              <Avatar path={m.avatarPath} username={m.username ?? '?'} size={36} />
              <View style={styles.flex}>
                <Text variant="headline" numberOfLines={1}>
                  {m.username ?? t('common.deletedUser')}
                </Text>
                <Text variant="bodySm" color="textSecondary">
                  {m.isMe ? t('pageTeam.you') : t('pageTeam.since', { date: date(m.joinedAt) })}
                </Text>
              </View>
              <View
                style={[
                  styles.roleTag,
                  { borderColor: c.text },
                  m.role === 'owner' && { backgroundColor: c.text },
                ]}
              >
                <Text variant="label" style={{ color: m.role === 'owner' ? c.surface : c.text }}>
                  {roleName(m.role)}
                </Text>
              </View>
              {options.length > 0 ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('pageTeam.optionsFor', { username: m.username ?? '' })}
                  onPress={() => actions.show({ title: m.username ?? undefined, actions: options })}
                  hitSlop={4}
                  style={({ pressed }) => [styles.square, pressed && styles.pressed]}
                >
                  <Icon name="more" color={c.text} />
                </Pressable>
              ) : null}
            </View>
          );
        })}

        {manager ? (
          <>
            <View style={styles.capRow}>
              <Text variant="label" color="textSecondary" accessibilityRole="header">
                {t('pageTeam.waiting', { count: waiting.length })}
              </Text>
              <Text variant="label" color="textSecondary">
                {t('pageTeam.moreAllowed', { count: Math.max(0, MAX_OPEN_INVITES - waiting.length) })}
              </Text>
            </View>
            {waiting.length === 0 ? (
              <Text variant="bodySm" color="textSecondary">
                {t('pageTeam.noneWaiting')}
              </Text>
            ) : (
              waiting.map((i) => (
                <View key={i.id} style={[styles.member, styles.dashed, { borderColor: c.border }]}>
                  <Icon name={i.email ? 'mail' : 'coHost'} color={c.textSecondary} size={22} />
                  <View style={styles.flex}>
                    <Text variant="headline" numberOfLines={1}>
                      {i.username ?? i.email ?? t('common.deletedUser')}
                    </Text>
                    <Text variant="bodySm" color="textSecondary">
                      {i.email
                        ? t('pageTeam.emailInvite', { role: roleName(i.role ?? 'staff'), when: left(i.expiresAt) })
                        : t('pageTeam.invited', { role: roleName(i.role ?? 'staff'), when: timeAgo(i.createdAt, t, i18n.language) })}
                    </Text>
                  </View>
                  <Button
                    variant="secondary"
                    label={t('common.cancel')}
                    onPress={() => cancelInvite.mutate(i.id, { onError: (err) => void alertError(err) })}
                    style={styles.smallButton}
                  />
                </View>
              ))
            )}
          </>
        ) : null}

        {owner ? (
          <View style={styles.section}>
            <Text variant="label" color="textSecondary" accessibilityRole="header">
              {t('pageTeam.ownerOnly')}
            </Text>
            {openHandover ? (
              <View style={[styles.member, styles.dashed, { borderColor: c.border }]}>
                <Icon name="hourglass" color={c.textSecondary} size={22} />
                <Text variant="bodySm" style={styles.flex}>
                  {t('pageTeam.waitingFor', { username: openHandover.username ?? '' })}
                </Text>
                <Button
                  variant="secondary"
                  label={t('common.cancel')}
                  onPress={() => cancelInvite.mutate(openHandover.id, { onError: (err) => void alertError(err) })}
                  style={styles.smallButton}
                />
              </View>
            ) : handover?.declinedUsername ? (
              <Text variant="bodySm" color="textSecondary">
                {t('pageTeam.declined', { username: handover.declinedUsername })}
              </Text>
            ) : null}
            <Button variant="secondary" icon="key" label={t('pageTeam.transfer')} onPress={transfer} loading={offer.isPending} />
            <Text variant="bodySm" color="textSecondary">
              {members.length < 2 ? t('pageTeam.nudge', { name }) : t('pageTeam.transferNote', { name })}
            </Text>
          </View>
        ) : null}

        {manager ? (
          <View style={styles.section}>
            <Text variant="label" color="textSecondary" accessibilityRole="header">
              {t('pageTeam.blocked', { count: blocked.data?.length ?? 0 })}
            </Text>
            <Text variant="bodySm" color="textSecondary">
              {t('pageTeam.blockedNote', { name })}
            </Text>
            {(blocked.data ?? []).map((b) => (
              <View key={b.userId} style={[styles.member, { backgroundColor: c.surfaceRaised }]}>
                <Avatar path={b.avatarPath} username={b.username ?? '?'} size={36} />
                <View style={styles.flex}>
                  <Text variant="headline" numberOfLines={1}>
                    {b.username ?? t('common.deletedUser')}
                  </Text>
                  <Text variant="bodySm" color="textSecondary">
                    {b.blockedByUsername
                      ? t('pageTeam.blockedBy', { username: b.blockedByUsername, when: timeAgo(b.blockedAt, t, i18n.language) })
                      : timeAgo(b.blockedAt, t, i18n.language)}
                  </Text>
                </View>
                <Button
                  variant="secondary"
                  label={t('pageTeam.unblock')}
                  onPress={() => block.mutate({ who: b.userId, on: false }, { onError: (err) => void alertError(err) })}
                  style={styles.smallButton}
                />
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>
      {actions.sheet}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  pressed: { opacity: 0.75 },
  upper: { textTransform: 'uppercase' },
  top: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingHorizontal: space[4], paddingTop: space[2] },
  block: { paddingHorizontal: space[4], gap: space[3], paddingTop: space[4] },
  loading: { marginTop: space[12] },
  content: { paddingHorizontal: space[4], paddingTop: space[4], paddingBottom: space[12], gap: space[2] },
  inviteBox: { borderWidth: stroke.rule, padding: 14, gap: space[3], marginBottom: space[4] },
  chips: { flexDirection: 'row', gap: 6 },
  chip: { minHeight: 40, paddingHorizontal: space[3], borderWidth: stroke.rule, justifyContent: 'center' },
  member: { flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: 60, paddingHorizontal: space[3], paddingVertical: space[2] },
  dashed: { borderWidth: stroke.rule, borderStyle: 'dashed' },
  roleTag: { borderWidth: stroke.rule, paddingHorizontal: 6, paddingVertical: 2 },
  square: { width: size.tapMin, height: size.tapMin, alignItems: 'center', justifyContent: 'center' },
  capRow: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: space[4] },
  section: { gap: space[2], paddingTop: space[4] },
  smallButton: { minHeight: 40, paddingHorizontal: 10 },
});
