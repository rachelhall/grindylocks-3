import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { CityTape, Wordmark } from '@/components/brand';
import { HalftoneGround } from '@/components/park-header';
import { PageTile, StampTape } from '@/components/pages';
import { FormScreen } from '@/components/screen';
import { BackButton, Button, TextField } from '@/components/ui';
import { type PageInvitePreview, previewPageInvite } from '@/lib/claims';
import { isOfficial, pageKind, placeName } from '@/lib/pages';
import {
  formatInviteCode,
  INVITE_CODE_LENGTH,
  normalizeInviteCode,
  previewInvite,
} from '@/lib/social';
import { brand, colors, space, Text } from '@/theme';

// Brand layer, like the welcome screen: always ink.
const ink = brand.ink;
const paper = brand.paper;
const muted = colors.dark.textSecondary;

/**
 * Opened from an invite link (grindylocks://invite?code=…) or from "I have an
 * invite code" on the welcome screen. Checks the code, shows who sent it, and
 * goes on to email sign-in with the code attached, so the new account can
 * be created.
 *
 * The same code box takes emailed page invites (brand and shop accounts,
 * PR 5): Rachel's claim invite ("You're invited to run 8SET", Invite-Claim)
 * and a team invite ("8SET invited you", Invite-Team). They go on to email
 * sign-in with the invited address filled in; a member who's already on
 * Grindylocks signs in with it and finds the invite under the bell.
 */
export default function Invite() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ code?: string }>();
  const [typed, setTyped] = useState(params.code ? formatInviteCode(params.code) : '');
  const [submitted, setSubmitted] = useState(params.code ? normalizeInviteCode(params.code) : '');

  const check = useQuery({
    queryKey: ['invite-preview', submitted],
    queryFn: () => previewInvite(submitted),
    enabled: submitted.length === INVITE_CODE_LENGTH,
    staleTime: 0,
    retry: 1,
  });
  // A page invite code has the same shape; it's checked alongside.
  const pageCheck = useQuery({
    queryKey: ['page-invite-preview', submitted],
    queryFn: () => previewPageInvite(submitted),
    enabled: submitted.length === INVITE_CODE_LENGTH,
    staleTime: 0,
    retry: 1,
  });

  const ready = normalizeInviteCode(typed).length === INVITE_CODE_LENGTH;
  const inviter = check.data;
  const pageInvite = pageCheck.data ?? null;
  const both = check.isSuccess && pageCheck.isSuccess;
  const valid = submitted.length === INVITE_CODE_LENGTH && check.isSuccess && Boolean(inviter);
  const invalid = submitted.length === INVITE_CODE_LENGTH && both && !inviter && !pageInvite;

  function submit() {
    if (ready) setSubmitted(normalizeInviteCode(typed));
  }

  const join = () => router.push({ pathname: '/email', params: { invite: submitted } });

  if (pageInvite && submitted.length === INVITE_CODE_LENGTH) {
    return (
      <PageInviteScreen
        invite={pageInvite}
        onJoin={() =>
          router.push({
            pathname: '/email',
            params: pageInvite.email ? { invite: submitted, address: pageInvite.email } : { invite: submitted },
          })
        }
      />
    );
  }

  if (valid) {
    return (
      <FormScreen
        background={ink}
        backdrop={<HalftoneGround fromTopRight fadeStart={0.55} fadeEnd={1} />}
        header={<BackButton />}
        footer={
          <>
            <Button label={t('auth.welcome.email')} onPress={join} palette={{ fill: paper, text: ink, border: paper }} />
            <Text variant="bodySm" style={[styles.center, { color: muted }]}>
              {t('auth.invite.otherWays')}
            </Text>
          </>
        }
      >
        <StatusBar style="light" />
        <View style={styles.top}>
          <Text variant="label" style={{ color: muted }}>
            {t('auth.welcome.kicker')}
          </Text>
          <Wordmark />
          <View style={styles.invitedTape}>
            <Text variant="title" style={{ color: ink }}>
              {t('auth.invite.invitedYou', { username: inviter })}
            </Text>
          </View>
          <Text variant="headline" style={{ color: paper }}>
            {t('auth.welcome.tagline')}
          </Text>
        </View>
        <View style={styles.middle}>
          <CityTape />
        </View>
        <Text variant="bodySm" style={{ color: muted }}>
          {t('auth.invite.validFor', { code: formatInviteCode(submitted) })}
        </Text>
      </FormScreen>
    );
  }

  return (
    <FormScreen
      header={<BackButton />}
      footer={
        <Button label={t('auth.invite.check')} onPress={submit} disabled={!ready} loading={check.isFetching || pageCheck.isFetching} />
      }
    >
      <Text variant="display" accessibilityRole="header">
        {t('auth.invite.title')}
      </Text>
      <Text variant="body" color="textSecondary">
        {t('auth.invite.body')}
      </Text>
      <TextField
        label={t('auth.invite.label')}
        value={typed}
        onChangeText={(v) => {
          // Shown as XXXX-XXXX while typing.
          const c = normalizeInviteCode(v).slice(0, INVITE_CODE_LENGTH);
          setTyped(c.length > 4 ? `${c.slice(0, 4)}-${c.slice(4)}` : c);
          if (submitted) setSubmitted('');
        }}
        placeholder="ABCD-2345"
        autoCapitalize="characters"
        autoCorrect={false}
        autoComplete="off"
        autoFocus={!params.code}
        maxLength={INVITE_CODE_LENGTH + 1}
        inputSize="large"
        returnKeyType="go"
        onSubmitEditing={submit}
        error={
          invalid
            ? t('auth.invite.invalid')
            : check.isError && pageCheck.isError
              ? t('errors.network')
              : null
        }
      />
    </FormScreen>
  );
}

/**
 * An emailed page invite, in the invite screen's ink and halftone (the
 * Invite-Claim and Invite-Team mockups): the page on a paper card, what the
 * person can do there, and Continue with email.
 */
function PageInviteScreen({ invite, onJoin }: { invite: PageInvitePreview; onJoin: () => void }) {
  const { t, i18n } = useTranslation();
  const page = invite.page;
  const name = page.displayName;
  const kind = pageKind(page);
  const official = isOfficial(page);
  const where = placeName(page, i18n.language);
  const claim = invite.kind === 'claim';
  const [now] = useState(() => Date.now());
  const days = Math.max(1, Math.ceil((new Date(invite.expiresAt).getTime() - now) / 86_400_000));
  const tape = (claim ? t('pageInvite.runTape', { name }) : t('pageInvite.invitedTape', { name })).toUpperCase();
  const line = [t(`page.${kind}`), where, claim ? `@${page.handle}` : null].filter(Boolean).join(' · ').toUpperCase();
  const points = claim
    ? [t(kind === 'shop' ? 'pageInvite.claimShop' : kind === 'organizer' ? 'pageInvite.claimOrganizer' : 'pageInvite.claimBrand', { name }), t('pageInvite.claimTeam'), t('pageInvite.claimChecked', { name })]
    : [t(kind === 'shop' ? 'pageInvite.teamShop' : 'pageInvite.teamBrand', { name }), t('pageInvite.teamOwnAccount')];

  return (
    <FormScreen
      background={ink}
      backdrop={<HalftoneGround fromTopRight fadeStart={0.55} fadeEnd={1} />}
      header={<BackButton />}
      footer={
        <>
          <Button label={t('auth.welcome.email')} onPress={onJoin} palette={{ fill: paper, text: ink, border: paper }} />
          <Text variant="bodySm" style={[styles.center, { color: muted }]}>
            {claim
              ? t('pageInvite.claimFoot', { name, days })
              : invite.email
                ? t('pageInvite.teamFoot', { email: invite.email, days })
                : t('pageInvite.teamFootNoEmail', { days })}
          </Text>
        </>
      }
    >
      <StatusBar style="light" />
      <View style={styles.top}>
        <Text variant="label" style={{ color: muted }}>
          {t('auth.welcome.kicker')}
        </Text>
        <Wordmark />
        <View style={styles.invitedTape}>
          <Text variant="title" style={{ color: ink }}>
            {tape}
          </Text>
        </View>
      </View>
      <View style={styles.card}>
        <View style={styles.cardHead}>
          <PageTile page={page} size={52} />
          <View style={styles.cardName}>
            <View style={styles.nameRow}>
              <Text variant="title" numberOfLines={1} style={[styles.shrink, { color: ink }]}>
                {name.toUpperCase()}
              </Text>
              {official ? <StampTape stamp="official" small /> : null}
            </View>
            <Text variant="label" numberOfLines={2} style={{ color: brand.ink, opacity: 0.7 }}>
              {line}
            </Text>
          </View>
          {claim ? (
            <View style={styles.ownerTag}>
              <Text variant="label" style={{ color: paper }}>
                {t('pageInvite.owner')}
              </Text>
            </View>
          ) : null}
        </View>
        {!claim && invite.role ? (
          <Text variant="body" style={{ color: ink }}>
            {invite.inviterUsername
              ? t('pageInvite.wantsYou', { username: invite.inviterUsername, name, role: t(`pageInvite.role.${invite.role === 'manager' ? 'manager' : 'staff'}`) })
              : t('pageInvite.wantsYouNoName', { name, role: t(`pageInvite.role.${invite.role === 'manager' ? 'manager' : 'staff'}`) })}
          </Text>
        ) : null}
        <View style={styles.points}>
          {points.map((p) => (
            <View key={p} style={styles.point}>
              <Text variant="bodySm" style={{ color: ink }}>
                {'•'}
              </Text>
              <Text variant="bodySm" style={[styles.shrink, { color: ink }]}>
                {p}
              </Text>
            </View>
          ))}
        </View>
      </View>
      <View style={styles.middle} />
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  center: { textAlign: 'center' },
  shrink: { flexShrink: 1 },
  card: { backgroundColor: paper, padding: space[4], gap: space[3], marginTop: space[6] },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  cardName: { flex: 1, minWidth: 0, gap: 4 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  ownerTag: { backgroundColor: ink, paddingHorizontal: 6, paddingVertical: 3 },
  points: { gap: 6 },
  point: { flexDirection: 'row', gap: space[2] },
  top: { gap: space[3] },
  middle: { flexGrow: 1, justifyContent: 'center' },
  // "@name invited you" as a strip of pink tape, like the park header's label.
  invitedTape: {
    alignSelf: 'flex-start',
    backgroundColor: brand.pink,
    paddingHorizontal: space[2],
    paddingVertical: space[1],
    marginTop: space[2],
    transform: [{ rotate: '-2deg' }],
  },
});

