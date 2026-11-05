import { Image } from 'expo-image';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, StyleSheet, View } from 'react-native';

import { HalftoneGround } from '@/components/park-header';
import { StampTape } from '@/components/pages';
import { FormScreen } from '@/components/screen';
import { Button, Icon } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { pickLogo, useSetPageLogo } from '@/lib/claims';
import { type PageRole, pageKind } from '@/lib/pages';
import { Sentry } from '@/lib/sentry';
import { brand, fontFamily, space, stroke, Text, useColors } from '@/theme';

/**
 * "Add 8SET's logo" (the Onboard-Logo mockup): a preview of the page's
 * header with the logo in, Choose a logo, and Skip for now. The logo is the
 * official signal, so the page stays UNOFFICIAL until it has one.
 *
 * Used as the last onboarding step for an owner joining through a page.
 * After that, the logo is changed from Edit page (PR 7a).
 * `onDone` gets whether a logo was saved.
 */
export function PageLogoForm({
  page,
  header,
  onDone,
}: {
  page: { id: string; displayName: string; roles: PageRole[]; city: string | null };
  header: ReactNode;
  onDone: (saved: boolean) => Promise<void> | void;
}) {
  const { t } = useTranslation();
  const c = useColors();
  const { session } = useAuth();
  const setLogo = useSetPageLogo(session?.user.id);
  const [local, setLocal] = useState<string | null>(null);
  const [finishing, setFinishing] = useState<'save' | 'skip' | null>(null);
  // Spinner from the tap until the photo library closes (it can be slow to open).
  const [picking, setPicking] = useState(false);
  const name = page.displayName;
  const tape = [t(`page.${pageKind(page)}`), page.city].filter(Boolean).join(' · ').toUpperCase();

  async function choose() {
    if (picking) return;
    setPicking(true);
    try {
      const uri = await pickLogo();
      if (uri) setLocal(uri);
    } catch (err) {
      Sentry.captureException(err);
      Alert.alert(t('errors.generic'));
    } finally {
      setPicking(false);
    }
  }

  async function save() {
    if (!local) return;
    setFinishing('save');
    setLogo.mutate(
      { pageId: page.id, localUri: local },
      {
        onSuccess: async () => {
          await onDone(true);
          setFinishing(null);
        },
        onError: (err) => {
          Sentry.captureException(err);
          setFinishing(null);
          Alert.alert(t('pageLogo.failed'), t('errors.network'));
        },
      },
    );
  }

  async function skip() {
    setFinishing('skip');
    await onDone(false);
    setFinishing(null);
  }

  return (
    <FormScreen
      header={header}
      footer={
        <>
          <Button
            label={t('common.continue')}
            onPress={save}
            disabled={!local || finishing !== null}
            loading={finishing === 'save'}
          />
          <Button variant="tertiary" label={t('pageLogo.skip')} onPress={skip} disabled={finishing !== null} loading={finishing === 'skip'} />
        </>
      }
    >
      <Text variant="display" accessibilityRole="header">
        {t('pageLogo.title', { name })}
      </Text>
      <Text variant="body" color="textSecondary">
        {t('pageLogo.body', { name })}
      </Text>

      {/* How the header looks once the logo is in. */}
      <View accessible accessibilityLabel={t('pageLogo.previewLabel', { name })}>
        <View style={styles.preview}>
          <HalftoneGround fromTopRight fadeStart={0.3} fadeEnd={1} />
          {tape ? (
            <View style={styles.tape}>
              <Text variant="label" style={{ color: brand.ink }}>
                {tape}
              </Text>
            </View>
          ) : null}
          <View style={styles.nameRow}>
            <Text variant="display" numberOfLines={1} style={styles.name}>
              {name.toUpperCase()}
            </Text>
            <StampTape stamp="official" onInk />
          </View>
        </View>
        <View style={[styles.tile, { borderColor: brand.ink, backgroundColor: brand.paper }]}>
          {local ? (
            <Image source={{ uri: local }} style={StyleSheet.absoluteFill} contentFit="contain" />
          ) : (
            <View style={styles.placeholder}>
              <Icon name="addPhoto" color={brand.ink} size={22} />
              <Text variant="label" style={{ color: brand.ink }}>
                {t('pageLogo.logo')}
              </Text>
            </View>
          )}
        </View>
      </View>
      <Text variant="bodySm" color="textSecondary" style={styles.previewNote}>
        {t('pageLogo.preview', { name })}
      </Text>

      <Button
        variant="secondary"
        label={local ? t('pageLogo.change') : t('pageLogo.choose')}
        onPress={choose}
        loading={picking}
        disabled={finishing !== null}
      />
      <Text variant="bodySm" color="textSecondary">
        {t('pageLogo.hint')}
      </Text>

      <View style={[styles.skipNote, { borderColor: c.borderSubtle }]}>
        <Text variant="bodySm" color="textSecondary" style={styles.flex}>
          {t('pageLogo.skipNote', { name })}
        </Text>
        <StampTape stamp="unofficial" small />
      </View>
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  preview: {
    height: 150,
    backgroundColor: brand.ink,
    padding: space[4],
    paddingBottom: 46,
    justifyContent: 'flex-end',
    gap: space[2],
    overflow: 'hidden',
  },
  tape: {
    alignSelf: 'flex-start',
    backgroundColor: brand.pink,
    paddingHorizontal: space[2],
    paddingVertical: 2,
    transform: [{ rotate: '-2deg' }],
  },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  name: { color: brand.paper, fontSize: 32, lineHeight: 34, flexShrink: 1, textShadowColor: brand.pink, textShadowOffset: { width: 3, height: 3 }, textShadowRadius: 0 },
  tile: {
    position: 'absolute',
    left: space[4],
    bottom: -30,
    width: 64,
    height: 64,
    borderWidth: stroke.rule,
    overflow: 'hidden',
  },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2 },
  previewNote: { marginTop: 34, fontFamily: fontFamily.sans },
  skipNote: { borderWidth: stroke.rule, borderStyle: 'dashed', padding: space[3], flexDirection: 'row', alignItems: 'center', gap: space[2] },
});
