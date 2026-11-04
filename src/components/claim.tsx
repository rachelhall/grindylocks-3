import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, ScrollView, Share, StyleSheet, View } from 'react-native';

import { Sheet, SheetHead } from '@/components/pages';
import { useExplainRestriction } from '@/components/safety';
import { Button, Icon, TextField } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import {
  type ClaimProof,
  emailMatchesPage,
  type MyClaim,
  resendClaimCode,
  type StartedClaim,
  useMyPageClaim,
  useSendClaim,
  useStartClaim,
  useWithdrawClaim,
} from '@/lib/claims';
import { isOfficial, type Page } from '@/lib/pages';
import { Sentry } from '@/lib/sentry';
import { brand, fontFamily, size, space, stroke, Text, useColors } from '@/theme';

/** How long a declined claim keeps its card on the page. */
const DECLINED_DAYS = 30;
const RESEND_SECONDS = 60;

const errorMessage = (err: unknown) => (err as { message?: string } | null)?.message ?? '';

/**
 * The bottom of an unofficial page for someone who might work there
 * (Brand-Unofficial, Claim-Pending): "Work at Dead? Claim this page", or,
 * once they've sent a claim, the pending card only they see (with Withdraw
 * claim), or Rachel's reason when it was declined (with Try again). An
 * owner or manager of a claimed page without a logo gets the Add logo card.
 */
export function ClaimFooter({ page, teamRole }: { page: Page; teamRole: string | null }) {
  const { t, i18n } = useTranslation();
  const c = useColors();
  const { session } = useAuth();
  const userId = session?.user.id;
  const claimable = page.state === 'unofficial' && !page.suspendedAt;
  const claim = useMyPageClaim(claimable ? userId : undefined, page.id);
  const withdraw = useWithdrawClaim(userId, page.id);
  const [sheet, setSheet] = useState(false);
  const [now] = useState(() => Date.now());
  const name = page.displayName;

  // A claimed page waiting for its logo: the owner and managers can add it.
  if (page.state === 'managed' && !isOfficial(page) && (teamRole === 'owner' || teamRole === 'manager')) {
    return (
      <View style={styles.footer}>
        <View style={[styles.card, { backgroundColor: c.accentSubtle, borderColor: c.border }]}>
          <Icon name="verified" color={c.onAccentSubtle} size={22} />
          <View style={styles.flex}>
            <Text variant="headline" style={{ color: c.onAccentSubtle }}>
              {t('claim.logoTitle', { name })}
            </Text>
            <Text variant="bodySm" style={{ color: c.onAccentSubtle }}>
              {t('claim.logoBody')}
            </Text>
          </View>
        </View>
        <Button label={t('pageLogo.choose')} onPress={() => router.push({ pathname: '/page-edit/[handle]', params: { handle: page.handle } })} />
      </View>
    );
  }

  if (!claimable || teamRole || claim.isPending) return null;
  const mine: MyClaim | null = claim.data ?? null;

  const confirmWithdraw = (id: string) =>
    Alert.alert(t('claim.withdrawTitle', { name }), t('claim.withdrawBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('claim.withdraw'),
        style: 'destructive',
        onPress: () => withdraw.mutate(id, { onError: () => Alert.alert(t('errors.generic'), t('errors.network')) }),
      },
    ]);

  const sheetNode = (
    <Sheet visible={sheet} onClose={() => setSheet(false)}>
      {sheet ? <ClaimSheetContent page={page} draft={mine?.status === 'draft' ? mine : null} onClose={() => setSheet(false)} /> : null}
    </Sheet>
  );

  if (mine?.status === 'pending') {
    const sent = mine.sentAt
      ? new Intl.DateTimeFormat(i18n.language, { month: 'short', day: 'numeric' }).format(new Date(mine.sentAt))
      : '';
    return (
      <View style={[styles.footer, styles.rule, { borderColor: c.borderSubtle }]}>
        <View accessibilityRole="summary" style={[styles.card, { backgroundColor: c.accentSubtle, borderColor: c.border }]}>
          <Icon name="hourglass" color={c.onAccentSubtle} size={22} />
          <View style={styles.flex}>
            <Text variant="headline" style={{ color: c.onAccentSubtle }}>
              {t('claim.pendingTitle')}
            </Text>
            <Text variant="bodySm" style={{ color: c.onAccentSubtle }}>
              {mine.proof === 'email' ? t('claim.pendingEmail', { date: sent }) : t('claim.pendingPosted', { date: sent })}
            </Text>
          </View>
        </View>
        <Text variant="bodySm" color="textSecondary">
          {t('claim.onlyYou')}{' '}
          <Text
            variant="bodySm"
            accessibilityRole="button"
            onPress={() => confirmWithdraw(mine.id)}
            style={{ color: c.accentText, fontFamily: fontFamily.sansSemiBold }}
          >
            {t('claim.withdraw')}
          </Text>
        </Text>
      </View>
    );
  }

  const recentlyDeclined =
    mine?.status === 'declined' &&
    mine.decidedAt !== null &&
    now - new Date(mine.decidedAt).getTime() < DECLINED_DAYS * 86_400_000;

  if (recentlyDeclined && mine) {
    const reason = mine.declineReason === 'another_claim_approved' ? t('claim.takenReason', { name }) : mine.declineReason;
    return (
      <View style={[styles.footer, styles.rule, { borderColor: c.borderSubtle }]}>
        <View style={[styles.card, { backgroundColor: c.surfaceSunk, borderColor: c.border }]}>
          <Icon name="block" color={c.text} size={22} />
          <View style={styles.flex}>
            <Text variant="headline">{t('claim.declinedTitle')}</Text>
            {reason ? (
              <Text variant="bodySm" color="textSecondary">
                “{reason}”
              </Text>
            ) : null}
          </View>
        </View>
        <Button variant="secondary" label={t('claim.tryAgain')} onPress={() => setSheet(true)} />
        {sheetNode}
      </View>
    );
  }

  return (
    <View style={[styles.footer, styles.rule, { borderColor: c.borderSubtle }]}>
      <Text variant="bodySm" color="textSecondary">
        {t('claim.workAt', { name })}{' '}
        <Text
          variant="bodySm"
          accessibilityRole="button"
          onPress={() => setSheet(true)}
          style={{ color: c.accentText, fontFamily: fontFamily.sansSemiBold }}
        >
          {t('claim.claimLink')}
        </Text>
      </Text>
      {sheetNode}
    </View>
  );
}

type Step = { kind: 'form' } | { kind: 'code'; claim: StartedClaim; email: string } | { kind: 'post'; claim: StartedClaim };

/**
 * Claim this page (Claim-Sheet, Claim-Code, Claim-PostCode): the role, how we
 * can check (a work email confirmed with a code, with a hint whether its
 * domain matches the page's website; or a GRIND-XXXX code to post), an
 * optional note, then step 2.
 */
function ClaimSheetContent({ page, draft, onClose }: { page: Page; draft: MyClaim | null; onClose: () => void }) {
  const { t } = useTranslation();
  const c = useColors();
  const { session } = useAuth();
  const userId = session?.user.id;
  const start = useStartClaim(userId, page.id);
  const explainRestriction = useExplainRestriction();
  const name = page.displayName;
  const [step, setStep] = useState<Step>({ kind: 'form' });
  const [role, setRole] = useState(draft?.roleTitle ?? '');
  const [proof, setProof] = useState<ClaimProof>(draft?.proof ?? 'email');
  const [email, setEmail] = useState(draft?.email ?? '');
  const [note, setNote] = useState('');
  const [showErrors, setShowErrors] = useState(false);

  const matches = proof === 'email' ? emailMatchesPage(email, page) : null;
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const ready = role.trim().length > 0 && (proof === 'posted_code' || emailOk);
  const label = `${name} · @${page.handle}`.toUpperCase();

  function next() {
    setShowErrors(true);
    if (!ready) return;
    start.mutate(
      { roleTitle: role, proof, email, note },
      {
        onSuccess: (claim) =>
          setStep(proof === 'email' ? { kind: 'code', claim, email: email.trim().toLowerCase() } : { kind: 'post', claim }),
        onError: async (err) => {
          if (await explainRestriction(err)) return;
          const key = claimErrorKey(errorMessage(err));
          if (!key) Sentry.captureException(err);
          Alert.alert(t(key ?? 'errors.generic'), key ? undefined : t('errors.network'));
        },
      },
    );
  }

  if (step.kind === 'code') {
    return <CodeStep page={page} claim={step.claim} email={step.email} onBack={() => setStep({ kind: 'form' })} onDone={onClose} />;
  }
  if (step.kind === 'post') {
    return <PostStep page={page} claim={step.claim} onBack={() => setStep({ kind: 'form' })} onDone={onClose} />;
  }

  return (
    <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" bounces={false}>
      <SheetHead label={label} title={t('claim.title')} onClose={onClose} />
      <Text variant="bodySm" color="textSecondary">
        {t('claim.intro', { name })}
      </Text>
      <TextField
        label={t('claim.role', { name })}
        value={role}
        onChangeText={setRole}
        maxLength={60}
        autoCapitalize="sentences"
        placeholder={t('claim.rolePlaceholder')}
        error={showErrors && !role.trim() ? t('claim.roleNeeded') : null}
      />

      <View accessibilityRole="radiogroup" style={styles.options}>
        <Text variant="bodySm" style={{ fontFamily: fontFamily.sansSemiBold }}>
          {t('claim.howCheck')}
        </Text>
        <ProofOption
          on={proof === 'email'}
          onPress={() => setProof('email')}
          title={t('claim.workEmail')}
          body={t('claim.workEmailBody', { name })}
        >
          {proof === 'email' ? (
            <View style={styles.optionExtra}>
              <TextField
                label={t('claim.workEmail')}
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                textContentType="emailAddress"
                autoComplete="email"
                autoCapitalize="none"
                autoCorrect={false}
                placeholder={t('auth.email.placeholder')}
                error={showErrors && !emailOk ? t('auth.email.invalid') : null}
              />
              {matches === true ? (
                <View style={styles.hint}>
                  <Icon name="check" color={c.text} size={16} />
                  <Text variant="bodySm">{t('claim.matches', { name })}</Text>
                </View>
              ) : matches === false ? (
                <View style={styles.hint}>
                  <Icon name="info" color={c.warning} size={16} />
                  <Text variant="bodySm" style={[styles.flex, { color: c.warning }]}>
                    {t('claim.noMatch', { name })}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}
        </ProofOption>
        <ProofOption
          on={proof === 'posted_code'}
          onPress={() => setProof('posted_code')}
          title={t('claim.postCode')}
          body={t('claim.postCodeBody', { name })}
        />
      </View>

      <TextField
        label={t('claim.note')}
        labelNote={t('common.optional')}
        value={note}
        onChangeText={setNote}
        maxLength={500}
        multiline
        placeholder={t('claim.notePlaceholder', { name })}
      />
      <Text variant="bodySm" color="textSecondary">
        {t('claim.afterApproval', { name })}
      </Text>
      <Button
        label={proof === 'email' ? t('claim.sendCode') : t('claim.getCode')}
        palette={{ fill: c.accent, text: c.onAccent, border: c.accent }}
        onPress={next}
        loading={start.isPending}
      />
    </ScrollView>
  );
}

function ProofOption({
  on,
  onPress,
  title,
  body,
  children,
}: {
  on: boolean;
  onPress: () => void;
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  const c = useColors();
  return (
    <View style={[styles.option, { borderColor: on ? c.border : c.borderSubtle, backgroundColor: on ? c.accentSubtle : c.surfaceRaised }]}>
      <Pressable
        accessibilityRole="radio"
        accessibilityState={{ selected: on }}
        accessibilityLabel={`${title}. ${body}`}
        onPress={onPress}
        style={styles.optionHead}
      >
        <View style={[styles.radio, { borderColor: on ? c.onAccentSubtle : c.text }]}>
          {on ? <View style={[styles.radioDot, { backgroundColor: c.onAccentSubtle }]} /> : null}
        </View>
        <View style={styles.flex}>
          <Text variant="headline" style={{ color: on ? c.onAccentSubtle : c.text }}>
            {title}
          </Text>
          <Text variant="bodySm" style={{ color: on ? c.onAccentSubtle : c.textSecondary }}>
            {body}
          </Text>
        </View>
      </Pressable>
      {children}
    </View>
  );
}

function StepHead({ page, onBack }: { page: Page; onBack: () => void }) {
  const { t } = useTranslation();
  const c = useColors();
  return (
    <View style={styles.stepHead}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('common.back')}
        onPress={onBack}
        style={({ pressed }) => [styles.square, { backgroundColor: c.surfaceRaised }, pressed && styles.pressed]}
      >
        <Icon name="chevronLeft" color={c.text} size={20} />
      </Pressable>
      <Text variant="label" color="textSecondary">
        {t('claim.step2', { name: page.displayName }).toUpperCase()}
      </Text>
      <View style={styles.square} />
    </View>
  );
}

/** Step 2 with a work email: the 6-digit code (Claim-Code). */
function CodeStep({
  page,
  claim,
  email,
  onBack,
  onDone,
}: {
  page: Page;
  claim: StartedClaim;
  email: string;
  onBack: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const c = useColors();
  const { session } = useAuth();
  const send = useSendClaim(session?.user.id, page.id);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [wait, setWait] = useState(RESEND_SECONDS);

  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  const submit = () =>
    send.mutate(
      { claimId: claim.claimId, emailCode: code },
      {
        onSuccess: (result) => {
          if (result === 'pending') onDone();
          else setError(t(`claim.result.${result}`));
        },
        onError: (err) => {
          const key = claimErrorKey(errorMessage(err));
          if (!key) Sentry.captureException(err);
          setError(t(key ?? 'errors.network'));
        },
      },
    );

  async function resend() {
    setError(null);
    setNotice(null);
    try {
      const result = await resendClaimCode(claim.claimId);
      if (result === 'sent') {
        setWait(RESEND_SECONDS);
        setNotice(t('auth.code.resent'));
      } else setError(t(result === 'wait' ? 'claim.result.wait' : 'claim.error.too_many_codes'));
    } catch (err) {
      Sentry.captureException(err);
      setError(t('errors.network'));
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" bounces={false}>
      <StepHead page={page} onBack={onBack} />
      <Text variant="title" accessibilityRole="header">
        {t('claim.inboxTitle')}
      </Text>
      <Text variant="body">{t('claim.inboxBody', { email })}</Text>
      <TextField
        label={t('auth.code.label')}
        value={code}
        onChangeText={(v) => {
          setCode(v.replace(/\D/g, '').slice(0, 6));
          if (error) setError(null);
        }}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        maxLength={6}
        autoFocus
        inputSize="large"
        returnKeyType="done"
        onSubmitEditing={submit}
        error={error}
        hint={notice ?? undefined}
      />
      <Button
        variant="tertiary"
        label={wait > 0 ? t('auth.code.resendIn', { seconds: wait }) : t('auth.code.resend')}
        disabled={wait > 0}
        onPress={resend}
      />
      <View style={[styles.dashed, { borderColor: c.borderSubtle }]}>
        <Icon name="info" color={c.textSecondary} size={20} />
        <Text variant="bodySm" color="textSecondary" style={styles.flex}>
          {t('claim.codeNote')}
        </Text>
      </View>
      <Button
        label={t('claim.send')}
        palette={{ fill: c.accent, text: c.onAccent, border: c.accent }}
        onPress={submit}
        disabled={code.length !== 6}
        loading={send.isPending}
      />
    </ScrollView>
  );
}

/** Step 2 with a posted code: GRIND-XXXX and where it's posted (Claim-PostCode). */
function PostStep({ page, claim, onBack, onDone }: { page: Page; claim: StartedClaim; onBack: () => void; onDone: () => void }) {
  const { t, i18n } = useTranslation();
  const c = useColors();
  const { session } = useAuth();
  const send = useSendClaim(session?.user.id, page.id);
  const [where, setWhere] = useState('');
  const [error, setError] = useState<string | null>(null);
  const name = page.displayName;
  const code = claim.postedCode ?? '';
  const until = claim.postedCodeExpiresAt
    ? new Intl.DateTimeFormat(i18n.language, { month: 'short', day: 'numeric' }).format(new Date(claim.postedCodeExpiresAt))
    : '';

  const submit = () => {
    if (where.trim().length < 4) {
      setError(t('claim.whereNeeded'));
      return;
    }
    send.mutate(
      { claimId: claim.claimId, postedUrl: where },
      {
        onSuccess: (result) => (result === 'pending' ? onDone() : setError(t(`claim.result.${result}`))),
        onError: (err) => {
          const key = claimErrorKey(errorMessage(err));
          if (!key) Sentry.captureException(err);
          setError(t(key ?? 'errors.network'));
        },
      },
    );
  };

  return (
    <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" bounces={false}>
      <StepHead page={page} onBack={onBack} />
      <Text variant="title" accessibilityRole="header">
        {t('claim.postTitle')}
      </Text>
      <Text variant="body">{t('claim.postBody', { name })}</Text>
      <View style={styles.codeBlock}>
        <Text variant="display" selectable accessibilityLabel={code.split('').join(' ')} style={styles.code}>
          {code}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('claim.shareCode')}
          onPress={() => void Share.share({ message: code }).catch(() => undefined)}
          style={({ pressed }) => [styles.shareButton, pressed && styles.pressed]}
        >
          <Icon name="share" color={brand.paper} size={18} />
          <Text variant="bodySm" style={{ color: brand.paper, fontFamily: fontFamily.sansSemiBold }}>
            {t('claim.share')}
          </Text>
        </Pressable>
      </View>
      <Text variant="bodySm" color="textSecondary">
        {t('claim.codeValid', { date: until })}
      </Text>
      <TextField
        label={t('claim.where')}
        value={where}
        onChangeText={(v) => {
          setWhere(v);
          if (error) setError(null);
        }}
        placeholder={t('claim.wherePlaceholder')}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        maxLength={300}
        error={error}
      />
      <View style={[styles.dashed, { borderColor: c.borderSubtle }]}>
        <Icon name="clock" color={c.textSecondary} size={20} />
        <Text variant="bodySm" color="textSecondary" style={styles.flex}>
          {t('claim.postLater')}
        </Text>
      </View>
      <Button
        label={t('claim.send')}
        palette={{ fill: c.accent, text: c.onAccent, border: c.accent }}
        onPress={submit}
        loading={send.isPending}
      />
    </ScrollView>
  );
}

/** The claim functions' error codes that have their own words. */
const CLAIM_ERRORS = ['claim_pending', 'too_many_claims', 'invalid_email', 'too_many_codes', 'not_claimable', 'invalid_link', 'invalid_role'] as const;
type ClaimError = (typeof CLAIM_ERRORS)[number];

function claimErrorKey(message: string) {
  return (CLAIM_ERRORS as readonly string[]).includes(message) ? (`claim.error.${message as ClaimError}` as const) : null;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pressed: { opacity: 0.75 },
  footer: { marginHorizontal: space[4], marginTop: space[8], paddingTop: space[4], gap: space[2] },
  rule: { borderTopWidth: 1 },
  card: { borderWidth: stroke.rule, padding: space[3], flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  body: { paddingHorizontal: 20, paddingTop: space[3], gap: space[4] },
  options: { gap: space[2] },
  option: { borderWidth: stroke.rule, padding: space[3], gap: space[2] },
  optionHead: { flexDirection: 'row', gap: space[3], alignItems: 'flex-start', minHeight: size.tapMin - 8 },
  optionExtra: { gap: space[2], paddingLeft: 34 },
  radio: { width: 22, height: 22, borderWidth: stroke.rule, borderRadius: 11, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  hint: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  stepHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  square: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  dashed: { borderWidth: stroke.rule, borderStyle: 'dashed', padding: space[3], flexDirection: 'row', gap: 10 },
  codeBlock: {
    backgroundColor: brand.ink,
    paddingVertical: 18,
    paddingHorizontal: space[4],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[3],
  },
  code: {
    color: brand.paper,
    fontSize: 26,
    lineHeight: 30,
    letterSpacing: 2,
    flexShrink: 1,
    textShadowColor: brand.pink,
    textShadowOffset: { width: 2, height: 2 },
    textShadowRadius: 0,
  },
  shareButton: {
    minHeight: 40,
    paddingHorizontal: space[3],
    borderWidth: stroke.rule,
    borderColor: brand.paper,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
});
