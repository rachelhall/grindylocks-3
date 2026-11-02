import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { CityTape, Wordmark } from '@/components/brand';
import { HalftoneGround } from '@/components/park-header';
import { FormScreen } from '@/components/screen';
import { BackButton, Button, TextField } from '@/components/ui';
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

  const ready = normalizeInviteCode(typed).length === INVITE_CODE_LENGTH;
  const inviter = check.data;
  const valid = submitted.length === INVITE_CODE_LENGTH && check.isSuccess && Boolean(inviter);
  const invalid = submitted.length === INVITE_CODE_LENGTH && check.isSuccess && !inviter;

  function submit() {
    if (ready) setSubmitted(normalizeInviteCode(typed));
  }

  const join = () => router.push({ pathname: '/email', params: { invite: submitted } });

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
      footer={<Button label={t('auth.invite.check')} onPress={submit} disabled={!ready} loading={check.isFetching} />}
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
            : check.isError
              ? t('errors.network')
              : null
        }
      />
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  center: { textAlign: 'center' },
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

