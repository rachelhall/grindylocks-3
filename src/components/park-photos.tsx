import { Image } from 'expo-image';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Icon, TextField } from '@/components/ui';
import type { PickedMedia } from '@/lib/media';
import { type Credit, LICENSES, MAX_PARK_PHOTOS, OWN_SOURCE, permissionSource } from '@/lib/park-photos';
import type { RoleName } from '@/lib/roles';
import { fontFamily, size, space, stroke, Text, useColors } from '@/theme';

/* Chips ------------------------------------------------------------------------------ */

/** Blue role badge, e.g. "You're a contributor". Not shown for the owner. */
export function RoleBadge({ role }: { role: RoleName | null }) {
  const { t } = useTranslation();
  const c = useColors();
  if (!role || role === 'owner') return null;
  return (
    <View style={[styles.chip, { backgroundColor: c.role }]}>
      <Text variant="label" style={{ color: c.onRole }}>
        {t(`park.youAre.${role}`)}
      </Text>
    </View>
  );
}

/** Grey outlined "Not verified yet" chip. */
export function NotVerifiedChip() {
  const { t } = useTranslation();
  const c = useColors();
  return (
    <View style={[styles.chip, styles.outlined, { borderColor: c.statusSoon }]}>
      <Text variant="label" color="statusSoon">
        {t('park.notVerified')}
      </Text>
    </View>
  );
}

/* Contributor card ------------------------------------------------------------------- */

/** What contributors see on a park with no photos: three empty slots, the guidance and a button. */
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
      <AccentButton icon="addPhoto" label={t('parkPhotos.addPark')} onPress={onAdd} />
    </View>
  );
}

/** Pink fill, ink outline and ink text, 48px tall, as on the mockups. */
export function AccentButton({
  icon,
  label,
  onPress,
  disabled,
}: {
  icon?: 'addPhoto';
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.accentButton,
        { backgroundColor: c.accent, borderColor: c.onAccent },
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      {icon ? <Icon name={icon} color={c.onAccent} size={20} /> : null}
      <Text variant="headline" style={{ color: c.onAccent, fontSize: 15 }}>
        {label}
      </Text>
    </Pressable>
  );
}

/* Upload sheet ----------------------------------------------------------------------- */

type SourceKind = 'own' | 'permission' | 'other';
type LicenseKind = (typeof LICENSES)[number] | 'other';

const defaultLicense: Record<SourceKind, LicenseKind> = { own: 'own', permission: 'permission', other: 'CC BY-SA 4.0' };

/**
 * Asks who took the picked photos and on what terms, prefilled for "own
 * photo" by the uploader, then uploads them.
 */
export function AddPhotosSheet(props: {
  /** The picked photos; the sheet shows while there are any. */
  photos: PickedMedia[];
  parkName: string;
  username: string;
  busy: boolean;
  failed: boolean;
  onCancel: () => void;
  onSubmit: (credit: Credit) => void;
}) {
  const visible = props.photos.length > 0;
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : undefined}
      onRequestClose={props.busy ? () => undefined : props.onCancel}
    >
      {/* Mounted per batch, so every batch starts prefilled for "own photo". */}
      {visible ? <CreditForm {...props} /> : null}
    </Modal>
  );
}

function CreditForm({
  photos,
  parkName,
  username,
  busy,
  failed,
  onCancel,
  onSubmit,
}: {
  photos: PickedMedia[];
  parkName: string;
  username: string;
  busy: boolean;
  failed: boolean;
  onCancel: () => void;
  onSubmit: (credit: Credit) => void;
}) {
  const { t } = useTranslation();
  const c = useColors();

  const [photographer, setPhotographer] = useState(username);
  const [source, setSource] = useState<SourceKind>('own');
  const [sourceText, setSourceText] = useState('');
  const [license, setLicense] = useState<LicenseKind>('own');
  const [licenseText, setLicenseText] = useState('');

  const pickSource = (next: SourceKind) => {
    setSource(next);
    setLicense(defaultLicense[next]);
  };

  const credit: Credit = {
    photographer: photographer.trim() || username,
    source: source === 'own' ? OWN_SOURCE : source === 'permission' ? permissionSource(parkName) : sourceText.trim(),
    license: license === 'other' ? licenseText.trim() : license,
  };
  const ready = credit.source.length > 0 && credit.license.length > 0;

  return (
    <SafeAreaView edges={['top', 'bottom', 'left', 'right']} style={[styles.sheet, { backgroundColor: c.surface }]}>
      <View style={styles.sheetHead}>
        <Text variant="title" accessibilityRole="header" style={styles.flex}>
          {t('parkPhotos.sheetTitle', { count: photos.length })}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.cancel')}
          disabled={busy}
          onPress={onCancel}
          hitSlop={4}
          style={({ pressed }) => [styles.close, { backgroundColor: c.surfaceRaised }, pressed && styles.pressed]}
        >
          <Icon name="close" color={c.text} size={22} />
        </Pressable>
      </View>
      <ScrollView
        contentContainerStyle={styles.sheetBody}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.thumbs}>
          {photos.map((p) => (
            <Image key={p.key} source={{ uri: p.uri }} contentFit="cover" style={styles.thumb} accessibilityIgnoresInvertColors />
          ))}
        </ScrollView>

        <TextField
          label={t('parkPhotos.photographer')}
          value={photographer}
          onChangeText={setPhotographer}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={80}
          hint={t('parkPhotos.photographerHint')}
        />

        <ChoiceGroup
          label={t('parkPhotos.source')}
          value={source}
          onChange={pickSource}
          options={[
            { value: 'own', label: t('parkPhotos.sourceOwn') },
            { value: 'permission', label: t('parkPhotos.sourcePermission', { park: parkName }) },
            { value: 'other', label: t('parkPhotos.sourceOther') },
          ]}
        />
        {source === 'other' ? (
          <TextField
            label={t('parkPhotos.sourceWhere')}
            value={sourceText}
            onChangeText={setSourceText}
            placeholder="Wikimedia Commons"
            maxLength={120}
          />
        ) : null}

        <ChoiceGroup
          label={t('parkPhotos.license')}
          value={license}
          onChange={setLicense}
          options={[
            { value: 'own', label: t('parkPhotos.licenseOwn') },
            { value: 'permission', label: t('parkPhotos.licensePermission') },
            { value: 'CC BY-SA 4.0', label: 'CC BY-SA 4.0' },
            { value: 'CC BY 4.0', label: 'CC BY 4.0' },
            { value: 'other', label: t('parkPhotos.licenseOther') },
          ]}
        />
        {license === 'other' ? (
          <TextField
            label={t('parkPhotos.licenseWhich')}
            value={licenseText}
            onChangeText={setLicenseText}
            placeholder="CC0"
            maxLength={60}
            autoCapitalize="none"
          />
        ) : null}

        <Text variant="bodySm" color="textSecondary">
          {t('parkPhotos.tipRights')}
        </Text>
        {failed ? (
          <Text variant="bodySm" color="statusClosed" accessibilityLiveRegion="polite">
            {t('parkPhotos.uploadFailed')}
          </Text>
        ) : null}
        <Button
          label={t('parkPhotos.upload', { count: photos.length })}
          loading={busy}
          disabled={!ready}
          palette={{ fill: c.accent, text: c.onAccent, border: c.onAccent }}
          onPress={() => onSubmit(credit)}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

function ChoiceGroup<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (next: T) => void;
  options: { value: T; label: string }[];
}) {
  const c = useColors();
  return (
    <View style={styles.group} accessibilityRole="radiogroup" accessibilityLabel={label}>
      <Text variant="bodySm" style={{ fontFamily: fontFamily.sansSemiBold }}>
        {label}
      </Text>
      <View style={styles.choices}>
        {options.map((o) => {
          const selected = o.value === value;
          return (
            <Pressable
              key={o.value}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              onPress={() => onChange(o.value)}
              style={({ pressed }) => [
                styles.choice,
                selected
                  ? { backgroundColor: c.accent, borderColor: c.onAccent }
                  : { backgroundColor: c.surfaceRaised, borderColor: c.border },
                pressed && styles.pressed,
              ]}
            >
              <Text variant="bodySm" style={{ fontFamily: fontFamily.sansSemiBold, color: selected ? c.onAccent : c.text }}>
                {o.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pressed: { opacity: 0.75 },
  disabled: { opacity: 0.45 },
  chip: { paddingHorizontal: space[2], paddingVertical: space[1] },
  outlined: { borderWidth: stroke.rule, paddingVertical: 2 },
  card: { borderWidth: stroke.rule, padding: space[4], gap: space[3] },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  slots: { flexDirection: 'row', gap: 6 },
  slot: {
    flex: 1,
    height: 64,
    borderWidth: stroke.rule,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tips: { gap: space[1] },
  tip: { flexDirection: 'row', gap: space[2] },
  accentButton: {
    height: size.tapMin,
    borderWidth: stroke.rule,
    paddingHorizontal: space[4],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[2],
  },
  sheet: { flex: 1 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: space[3], padding: space[4] },
  close: { width: size.tapMin, height: size.tapMin, alignItems: 'center', justifyContent: 'center' },
  sheetBody: { paddingHorizontal: space[4], paddingBottom: space[8], gap: space[4] },
  thumbs: { gap: 6 },
  thumb: { width: 96, height: 72 },
  group: { gap: 6 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  choice: { minHeight: size.tapMin, borderWidth: stroke.rule, paddingHorizontal: space[3], justifyContent: 'center' },
});
