import { Image } from 'expo-image';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Icon, SelectRow, TextField } from '@/components/ui';
import type { PickedMedia } from '@/lib/media';
import {
  LICENSE_CC_BY_SA,
  LICENSE_OWN,
  LICENSE_PERMISSION,
  MAX_PARK_PHOTOS,
  permissionSource,
  type RoleName,
  SOURCE_OWN,
  SOURCE_WIKIMEDIA,
  useUploadParkPhotos,
} from '@/lib/park-photos';
import { fontFamily, size, space, stroke, Text, useColors } from '@/theme';

/* Role badge ----------------------------------------------------------------- */

/** "You're a contributor": blue role fill, shown to people with a role here. */
export function RoleBadge({ role }: { role: RoleName }) {
  const { t } = useTranslation();
  const c = useColors();
  return (
    <View style={[styles.badge, { backgroundColor: c.role }]}>
      <Text variant="label" style={{ color: c.onRole }}>
        {t(`parkPhotos.role.${role}`)}
      </Text>
    </View>
  );
}

/* No photos yet ---------------------------------------------------------------- */

/**
 * The "This park has no photos yet" card for contributors, per the
 * contributor mockup: three empty slots, what makes a good park photo, and
 * the button that opens the picker.
 */
export function NoPhotosCard({ onAdd }: { onAdd: () => void }) {
  const { t } = useTranslation();
  const c = useColors();
  const tips = [t('parkPhotos.tipWide'), t('parkPhotos.tipPeople'), t('parkPhotos.tipRights')];
  return (
    <View style={[styles.card, { backgroundColor: c.surfaceRaised, borderColor: c.border }]}>
      <View style={styles.cardHead}>
        <Text variant="headline" style={styles.flex}>
          {t('parkPhotos.noneYet')}
        </Text>
        <Text variant="label" color="textSecondary">
          {t('parkPhotos.count', { count: 0, max: MAX_PARK_PHOTOS })}
        </Text>
      </View>
      <View style={styles.slots} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {[0, 1, 2].map((i) => (
          <View key={i} style={[styles.slot, { borderColor: c.textSecondary }]}>
            <Icon name="landscape" color={c.textSecondary} size={22} />
          </View>
        ))}
      </View>
      <View style={styles.tips}>
        {tips.map((tip) => (
          <View key={tip} style={styles.tip}>
            <Text variant="bodySm" color="textSecondary">
              {'•'}
            </Text>
            <Text variant="bodySm" color="textSecondary" style={styles.flex}>
              {tip}
            </Text>
          </View>
        ))}
      </View>
      <Pressable
        accessibilityRole="button"
        onPress={onAdd}
        style={({ pressed }) => [
          styles.pinkButton,
          { backgroundColor: c.accent, borderColor: c.onAccent },
          pressed && styles.pressed,
        ]}
      >
        <Icon name="addPhoto" color={c.onAccent} size={20} />
        <Text variant="headline" style={{ color: c.onAccent, fontSize: 16 }}>
          {t('parkPhotos.addPark')}
        </Text>
      </Pressable>
    </View>
  );
}

/* Upload sheet ------------------------------------------------------------------ */

type SourceChoice = 'own' | 'permission' | 'wikimedia' | 'other';

const LICENSE_FOR: Record<SourceChoice, string> = {
  own: LICENSE_OWN,
  permission: LICENSE_PERMISSION,
  wikimedia: LICENSE_CC_BY_SA,
  other: '',
};

/**
 * After picking: the photos, who took them, where they're from and under
 * what license, prefilled for "own photo". One credit covers the batch.
 */
export function AddParkPhotosSheet(props: {
  parkId: string;
  parkName: string;
  username: string;
  /** Picked photos; the sheet is open while there are some. */
  photos: PickedMedia[];
  onClose: () => void;
}) {
  const { photos, onClose } = props;
  return (
    <Modal visible={photos.length > 0} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {/* Keyed by the batch, so each new pick starts from "own photo", by you. */}
      {photos.length > 0 ? <SheetContent key={photos.map((p) => p.key).join('|')} {...props} /> : null}
    </Modal>
  );
}

function SheetContent({
  parkId,
  parkName,
  username,
  photos,
  onClose,
}: {
  parkId: string;
  parkName: string;
  username: string;
  photos: PickedMedia[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const c = useColors();
  const upload = useUploadParkPhotos(parkId);
  const [photographer, setPhotographer] = useState(username);
  const [choice, setChoice] = useState<SourceChoice>('own');
  const [otherSource, setOtherSource] = useState('');
  const [license, setLicense] = useState(LICENSE_OWN);
  /** Photos already added from this batch before a failed attempt. */
  const [base, setBase] = useState(0);

  const pick = (next: SourceChoice) => {
    setChoice(next);
    setLicense(LICENSE_FOR[next]);
  };

  const source =
    choice === 'own'
      ? SOURCE_OWN
      : choice === 'permission'
        ? permissionSource(parkName)
        : choice === 'wikimedia'
          ? SOURCE_WIKIMEDIA
          : otherSource.trim();
  const ready = source.length > 0 && license.trim().length > 0 && !upload.isPending;

  const added = base + upload.done;
  const submit = () => {
    // A retry carries on from the first photo that didn't go up.
    const from = upload.isError ? added : base;
    setBase(from);
    upload.mutate(
      { photos: photos.slice(from), credit: { photographer, source, license } },
      { onSuccess: onClose },
    );
  };

  const close = () => {
    if (!upload.isPending) onClose();
  };

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: c.surface }]}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.sheetHead}>
          <Text variant="title" accessibilityRole="header" style={styles.flex}>
            {t('parkPhotos.addPark')}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('common.close')}
            onPress={close}
            disabled={upload.isPending}
            hitSlop={4}
            style={({ pressed }) => [styles.close, { backgroundColor: c.surfaceRaised }, pressed && styles.pressed]}
          >
            <Icon name="close" color={c.text} size={22} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled">
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.thumbs}>
            {photos.map((p) => (
              <Image
                key={p.key}
                source={{ uri: p.uri }}
                style={[styles.thumb, { backgroundColor: c.surfaceSunk }]}
                contentFit="cover"
                accessibilityIgnoresInvertColors
              />
            ))}
          </ScrollView>

          <TextField
            label={t('parkPhotos.photographer')}
            value={photographer}
            onChangeText={setPhotographer}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={100}
            hint={t('parkPhotos.photographerHint')}
          />

          <View style={styles.group} accessibilityRole="radiogroup">
            <Text variant="bodySm" style={{ fontFamily: fontFamily.sansSemiBold }}>
              {t('parkPhotos.source')}
            </Text>
            <SelectRow title={t('parkPhotos.sourceOwn')} selected={choice === 'own'} onPress={() => pick('own')} />
            <SelectRow
              title={t('parkPhotos.sourcePermission', { park: parkName })}
              selected={choice === 'permission'}
              onPress={() => pick('permission')}
            />
            <SelectRow
              title={t('parkPhotos.sourceWikimedia')}
              selected={choice === 'wikimedia'}
              onPress={() => pick('wikimedia')}
            />
            <SelectRow title={t('parkPhotos.sourceOther')} selected={choice === 'other'} onPress={() => pick('other')} />
            {choice === 'other' ? (
              <TextField
                label={t('parkPhotos.sourceOtherLabel')}
                value={otherSource}
                onChangeText={setOtherSource}
                maxLength={200}
              />
            ) : null}
          </View>

          <TextField
            label={t('parkPhotos.license')}
            value={license}
            onChangeText={setLicense}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={100}
            hint={t('parkPhotos.licenseHint')}
          />

          <Text variant="bodySm" color="textSecondary">
            {t('parkPhotos.tipRights')}
          </Text>
        </ScrollView>

        <View style={styles.sheetFoot}>
          {upload.isError ? (
            <Text variant="bodySm" color="statusClosed" accessibilityLiveRegion="polite">
              {added > 0
                ? t('parkPhotos.partFailed', { done: added, count: photos.length })
                : t('parkPhotos.failed')}
            </Text>
          ) : null}
          <Button
            label={
              upload.isPending
                ? t('parkPhotos.uploading', { current: Math.min(added + 1, photos.length), count: photos.length })
                : upload.isError
                  ? t('common.retry')
                  : t('parkPhotos.upload', { count: photos.length })
            }
            onPress={submit}
            disabled={!ready}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pressed: { opacity: 0.75 },
  badge: { paddingHorizontal: space[2], paddingVertical: space[1] },
  card: { borderWidth: stroke.rule, padding: space[4], gap: space[3] },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  slots: { flexDirection: 'row', gap: 6 },
  slot: { flex: 1, height: 64, borderWidth: stroke.rule, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  tips: { gap: space[1] },
  tip: { flexDirection: 'row', gap: space[2] },
  pinkButton: {
    height: size.tapMin,
    borderWidth: stroke.rule,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[2],
  },
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingHorizontal: space[4], paddingVertical: space[3] },
  close: { width: size.tapMin, height: size.tapMin, alignItems: 'center', justifyContent: 'center' },
  sheetBody: { paddingHorizontal: space[4], paddingBottom: space[6], gap: space[6] },
  thumbs: { gap: 6 },
  thumb: { width: 88, height: 88 },
  group: { gap: space[2] },
  sheetFoot: { paddingHorizontal: space[4], paddingTop: space[2], paddingBottom: space[4], gap: space[2] },
});
