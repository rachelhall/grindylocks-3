import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FormScreen } from '@/components/screen';
import { BackButton, Button, TextField } from '@/components/ui';
import { authErrorKey, isEmail } from '@/lib/auth-errors';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { Text } from '@/theme';

type Step =
  | { kind: 'enter' }
  /** A code went to `email`; `current` is true for the second code, to the old address. */
  | { kind: 'code'; email: string; newEmail: string; current: boolean };

/**
 * Change email: enter the new address, then the code Supabase sends to it
 * (verifyOtp, type email_change). If the project has "secure email change"
 * on, a second code goes to the current address too, and this asks for it.
 */
export default function ChangeEmail() {
  const { t } = useTranslation();
  const { session } = useAuth();
  const currentEmail = session?.user.email ?? '';
  const [step, setStep] = useState<Step>({ kind: 'enter' });
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const next = email.trim().toLowerCase();
  const codeReady = /^\d{6,10}$/.test(code);

  async function send() {
    setError(null);
    if (!isEmail(next)) {
      setError(t('auth.email.invalid'));
      return;
    }
    if (next === currentEmail.toLowerCase()) {
      setError(t('changeEmail.same'));
      return;
    }
    setBusy(true);
    const { error: sendError } = await supabase.auth.updateUser({ email: next });
    setBusy(false);
    if (sendError) {
      setError(sendError.code === 'email_exists' ? t('changeEmail.taken') : t(authErrorKey(sendError)));
      return;
    }
    setCode('');
    setStep({ kind: 'code', email: next, newEmail: next, current: false });
  }

  async function verify() {
    if (step.kind !== 'code' || !codeReady) return;
    setError(null);
    setBusy(true);
    const { data, error: verifyError } = await supabase.auth.verifyOtp({
      email: step.email,
      token: code,
      type: 'email_change',
    });
    setBusy(false);
    if (verifyError) {
      const key = authErrorKey(verifyError);
      setError(t(key === 'errors.generic' ? 'auth.code.wrong' : key));
      return;
    }
    const changed = data.user?.email?.toLowerCase() === step.newEmail;
    if (changed) {
      setDone(true);
      return;
    }
    // Secure email change: the old address has to confirm too.
    setCode('');
    setStep({ kind: 'code', email: currentEmail, newEmail: step.newEmail, current: true });
  }

  if (done) {
    return (
      <FormScreen
        header={<BackButton />}
        footer={<Button label={t('editProfile.done')} onPress={() => router.back()} />}
      >
        <Text variant="display" accessibilityRole="header">
          {t('changeEmail.doneTitle')}
        </Text>
        <Text variant="body" color="textSecondary" accessibilityLiveRegion="polite">
          {t('changeEmail.doneBody', { email: session?.user.email ?? '' })}
        </Text>
      </FormScreen>
    );
  }

  if (step.kind === 'code') {
    return (
      <FormScreen
        header={<BackButton onPress={() => setStep({ kind: 'enter' })} />}
        footer={
          <>
            <Button label={t('changeEmail.confirm')} onPress={verify} disabled={!codeReady} loading={busy} />
            <Button variant="tertiary" label={t('auth.code.otherEmail')} onPress={() => setStep({ kind: 'enter' })} />
          </>
        }
      >
        <Text variant="display" accessibilityRole="header">
          {t('auth.code.title')}
        </Text>
        <Text variant="body" color="textSecondary">
          {step.current
            ? t('changeEmail.codeCurrent', { email: step.email })
            : t('auth.code.body', { email: step.email })}
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
        />
      </FormScreen>
    );
  }

  return (
    <FormScreen
      header={<BackButton />}
      footer={<Button label={t('auth.email.send')} onPress={send} loading={busy} disabled={!next} />}
    >
      <Text variant="display" accessibilityRole="header">
        {t('changeEmail.title')}
      </Text>
      <Text variant="body" color="textSecondary">
        {t('changeEmail.body', { email: currentEmail })}
      </Text>
      <TextField
        label={t('changeEmail.label')}
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
