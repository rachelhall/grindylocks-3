import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FormScreen } from '@/components/screen';
import { BackButton, Button, TextField } from '@/components/ui';
import { useDeleteAccount } from '@/lib/account';
import { authErrorKey } from '@/lib/auth-errors';
import { useAuth } from '@/lib/auth';
import { isReviewEmail, reviewSignIn } from '@/lib/review-sign-in';
import { supabase } from '@/lib/supabase';
import { useColors, Text } from '@/theme';

const RESEND_SECONDS = 60;

/**
 * Delete account, step two (Delete-Code mockup, M5): the 6-digit code sent
 * to your own address. Entering it signs you in again (so the session
 * shows a fresh code), then the delete-account Edge Function deletes the
 * account and the app signs out, which clears the cache and lands on the
 * welcome screen. If the code is too old by the time it reaches the
 * server, it asks for a new one.
 */
export default function DeleteCode() {
  const { t } = useTranslation();
  const c = useColors();
  const { keep } = useLocalSearchParams<{ keep?: string }>();
  const keepPosts = keep !== '0';
  const { session } = useAuth();
  const email = session?.user.email ?? '';
  const remove = useDeleteAccount();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [wait, setWait] = useState(RESEND_SECONDS);
  // The App Review account confirms with its fixed code; nothing is emailed.
  const review = isReviewEmail(email);

  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  // Supabase codes are 6 digits by default; the length is a project setting.
  const ready = /^\d{6,10}$/.test(code);
  const busy = verifying || remove.isPending;

  async function confirm() {
    if (!ready || !email || busy) return;
    setError(null);
    setNotice(null);
    setVerifying(true);
    if (review) {
      const key = await reviewSignIn(code);
      setVerifying(false);
      if (key) {
        setError(t(key));
        return;
      }
    } else {
      const { error: verifyError } = await supabase.auth.verifyOtp({ email, token: code, type: 'email' });
      setVerifying(false);
      if (verifyError) {
        const key = authErrorKey(verifyError);
        setError(t(key === 'errors.generic' ? 'auth.code.wrong' : key));
        return;
      }
    }
    remove.mutate(
      { keepPosts },
      {
        // Signing out switches the app to the welcome screen by itself.
        onError: (err) => {
          setCode('');
          setError(
            err.message === 'confirm_with_a_code'
              ? t('deleteAccount.codeExpired')
              : err.message === 'network'
                ? t('errors.network')
                : t('errors.generic'),
          );
        },
      },
    );
  }

  async function resend() {
    if (!email) return;
    setError(null);
    setNotice(null);
    const { error: sendError } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
    if (sendError) {
      setError(t(authErrorKey(sendError)));
      return;
    }
    setCode('');
    setWait(RESEND_SECONDS);
    setNotice(t('auth.code.resent'));
  }

  return (
    <FormScreen
      header={<BackButton />}
      footer={
        <>
          <Button
            label={t('deleteAccount.confirm')}
            palette={{ fill: c.danger, text: c.onDanger, border: c.danger }}
            onPress={() => void confirm()}
            disabled={!ready}
            loading={busy}
          />
          {!review && (
            <Button
              variant="tertiary"
              label={wait > 0 ? t('auth.code.resendIn', { seconds: wait }) : t('auth.code.resend')}
              disabled={wait > 0 || busy}
              onPress={() => void resend()}
            />
          )}
          <Button
            variant="tertiary"
            label={t('deleteAccount.cancel')}
            disabled={busy}
            onPress={() => router.dismissTo('/settings')}
          />
        </>
      }
    >
      <Text variant="display" accessibilityRole="header">
        {t('deleteAccount.codeTitle')}
      </Text>
      <Text variant="body">
        {keepPosts ? t('deleteAccount.codeBodyKeep', { email }) : t('deleteAccount.codeBodyRemove', { email })}
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
        onSubmitEditing={() => void confirm()}
        error={error}
        hint={notice ?? undefined}
      />
    </FormScreen>
  );
}
