import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FormScreen } from '@/components/screen';
import { BackButton, Button, TextField } from '@/components/ui';
import { authErrorKey, otpOptions } from '@/lib/auth-errors';
import { isReviewEmail, reviewSignIn } from '@/lib/review-sign-in';
import { supabase } from '@/lib/supabase';
import { Text } from '@/theme';

const RESEND_SECONDS = 60;

/**
 * Step 2 of email sign-in: enter the code from the email. Once it verifies,
 * the session changes and the root layout moves on to onboarding or the app
 * by itself.
 */
export default function CodeSignIn() {
  const { t } = useTranslation();
  const { email, invite } = useLocalSearchParams<{ email: string; invite?: string }>();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [wait, setWait] = useState(RESEND_SECONDS);
  // The App Review account: its code is fixed, so there's nothing to resend.
  const review = isReviewEmail(email);

  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  // Supabase codes are 6 digits by default; the length is a project setting.
  const ready = /^\d{6,10}$/.test(code);

  async function verify() {
    if (!ready || !email) return;
    setVerifying(true);
    setError(null);
    if (review) {
      const key = await reviewSignIn(code);
      if (key) {
        setVerifying(false);
        setError(t(key));
      }
      return;
    }
    const { error: verifyError } = await supabase.auth.verifyOtp({ email, token: code, type: 'email' });
    if (verifyError) {
      setVerifying(false);
      const key = authErrorKey(verifyError);
      setError(t(key === 'errors.generic' ? 'auth.code.wrong' : key));
    }
    // On success this screen unmounts as the root layout switches groups.
  }

  async function resend() {
    if (!email) return;
    setError(null);
    setNotice(null);
    const { error: sendError } = await supabase.auth.signInWithOtp({
      email,
      options: otpOptions(invite),
    });
    if (sendError) {
      setError(t(authErrorKey(sendError, Boolean(invite))));
      return;
    }
    setWait(RESEND_SECONDS);
    setNotice(t('auth.code.resent'));
  }

  return (
    <FormScreen
      header={<BackButton />}
      footer={
        <>
          <Button label={t('auth.code.verify')} onPress={verify} disabled={!ready} loading={verifying} />
          {!review && (
            <Button
              variant="tertiary"
              label={wait > 0 ? t('auth.code.resendIn', { seconds: wait }) : t('auth.code.resend')}
              disabled={wait > 0}
              onPress={resend}
            />
          )}
          <Button variant="tertiary" label={t('auth.code.otherEmail')} onPress={() => router.back()} />
        </>
      }
    >
      <Text variant="display" accessibilityRole="header">
        {t('auth.code.title')}
      </Text>
      <Text variant="body" color="textSecondary">
        {t('auth.code.body', { email })}
      </Text>
      <TextField
        label={t('auth.code.label')}
        value={code}
        onChangeText={(v) => {
          setCode(v.replace(/\D/g, ''));
          if (error) setError(null);
        }}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        maxLength={10}
        autoFocus
        inputSize="large"
        returnKeyType="done"
        onSubmitEditing={verify}
        error={error}
        hint={notice ?? undefined}
      />
    </FormScreen>
  );
}
