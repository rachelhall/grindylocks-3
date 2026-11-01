import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FormScreen } from '@/components/screen';
import { BackButton, Button, TextField } from '@/components/ui';
import { authErrorKey, isEmail, otpOptions } from '@/lib/auth-errors';
import { supabase } from '@/lib/supabase';
import { Text } from '@/theme';

/**
 * Step 1 of email sign-in: ask for the address and send a one-time code.
 * Opened from an invite, it may create the account: the code goes along as
 * user metadata, and the before_user_created hook checks it. Without one,
 * only existing members get a code.
 */
export default function EmailSignIn() {
  const { t } = useTranslation();
  const { invite } = useLocalSearchParams<{ invite?: string }>();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function send() {
    const address = email.trim().toLowerCase();
    if (!isEmail(address)) {
      setError(t('auth.email.invalid'));
      return;
    }
    setSending(true);
    setError(null);
    const { error: sendError } = await supabase.auth.signInWithOtp({
      email: address,
      options: otpOptions(invite),
    });
    setSending(false);
    if (sendError) {
      setError(t(authErrorKey(sendError, Boolean(invite))));
      return;
    }
    router.push({ pathname: '/code', params: invite ? { email: address, invite } : { email: address } });
  }

  return (
    <FormScreen
      header={<BackButton />}
      footer={<Button label={t('auth.email.send')} onPress={send} loading={sending} />}
    >
      <Text variant="display" accessibilityRole="header">
        {t('auth.email.title')}
      </Text>
      <Text variant="body" color="textSecondary">
        {t('auth.email.body')}
      </Text>
      <TextField
        label={t('auth.email.label')}
        value={email}
        onChangeText={(v) => {
          setEmail(v);
          if (error) setError(null);
        }}
        placeholder={t('auth.email.placeholder')}
        keyboardType="email-address"
        textContentType="emailAddress"
        autoComplete="email"
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus
        returnKeyType="send"
        onSubmitEditing={send}
        error={error}
      />
    </FormScreen>
  );
}
