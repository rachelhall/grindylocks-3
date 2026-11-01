import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FormScreen } from '@/components/screen';
import { BackButton, Button, TextField } from '@/components/ui';
import { authErrorKey, isEmail } from '@/lib/auth-errors';
import { supabase } from '@/lib/supabase';
import { Text } from '@/theme';

/** Step 1 of email sign-in: ask for the address and send a one-time code. */
export default function EmailSignIn() {
  const { t } = useTranslation();
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
    // shouldCreateUser: false — sign-ups stay closed until invites (M3), so
    // only members who already exist can get a code.
    const { error: sendError } = await supabase.auth.signInWithOtp({
      email: address,
      options: { shouldCreateUser: false },
    });
    setSending(false);
    if (sendError) {
      setError(t(authErrorKey(sendError)));
      return;
    }
    router.push({ pathname: '/code', params: { email: address } });
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
