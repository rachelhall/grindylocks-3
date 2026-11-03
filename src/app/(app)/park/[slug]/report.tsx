import { Image } from 'expo-image';
import { type TFunction } from 'i18next';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Platform, Pressable, StyleSheet, View } from 'react-native';

import { FormScreen } from '@/components/screen';
import { Chip } from '@/components/tagging';
import { Button, Icon, TextField } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import type { Json } from '@/lib/database.types';
import { dayRanges, formatClock, weekdayName } from '@/lib/hours';
import { pickFromLibrary, type PickedMedia } from '@/lib/media';
import { MAX_PARK_NOTE, type ParkField, useReportParkInfo } from '@/lib/moderation';
import { type Discipline, type ParkDetail, pickDescription, usePark } from '@/lib/parks';
import { Sentry } from '@/lib/sentry';
import { fontFamily, size, space, stroke, Text, useColors } from '@/theme';

const FIELDS: ParkField[] = [
  'hours',
  'status',
  'lighting',
  'location',
  'fees',
  'disciplines',
  'helmet_rule',
  'description',
  'obstacle',
  'other',
];

const STATUSES = ['open', 'temporarily_closed', 'seasonal_closure', 'coming_soon'] as const;
const DISCIPLINES: Discipline[] = ['inline', 'quad', 'skateboard', 'bmx', 'scooter'];
const DAY_SETS = { daily: [1, 2, 3, 4, 5, 6, 7], weekdays: [1, 2, 3, 4, 5], weekends: [6, 7] } as const;
type DaySet = keyof typeof DAY_SETS;
const DESCRIPTION_MAX = 2000;
const LOCALES = ['en', 'es', 'da', 'de'];

/** "9", "9:00", "09.00" or "0900" → "09:00"; null if it isn't a time. */
function normalizeTime(text: string): string | null {
  const m = text.trim().match(/^(\d{1,2})(?:[:.]?(\d{2}))?$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2] ?? '0');
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/** Everything the suggested-value inputs hold, kept per screen so switching fields loses nothing. */
type Draft = {
  days: DaySet;
  start: string;
  sunrise: boolean;
  end: string;
  sunset: boolean;
  status: (typeof STATUSES)[number] | null;
  lit: boolean | null;
  address: string;
  paid: boolean | null;
  fee: string;
  disciplines: Discipline[];
  helmet: boolean | null;
  description: string;
};

const EMPTY: Draft = {
  days: 'daily',
  start: '',
  sunrise: false,
  end: '',
  sunset: false,
  status: null,
  lit: null,
  address: '',
  paid: null,
  fee: '',
  disciplines: [],
  helmet: null,
  description: '',
};

/** The JSON the database applies for a field (see private.apply_park_field), or undefined when there's no fix to suggest. */
function suggestedValue(field: ParkField, d: Draft, locale: string): Json | undefined {
  switch (field) {
    case 'hours': {
      const start = d.sunrise ? 'sunrise' : normalizeTime(d.start);
      const end = d.sunset ? 'sunset' : normalizeTime(d.end);
      return start && end ? { days: [...DAY_SETS[d.days]], start, end } : undefined;
    }
    case 'status':
      return d.status ? { status: d.status } : undefined;
    case 'lighting':
      return d.lit === null ? undefined : { night_lighting: d.lit };
    case 'location':
      return d.address.trim() ? { address: d.address.trim() } : undefined;
    case 'fees':
      if (d.paid === null) return undefined;
      return d.paid ? { is_paid: true, entry_fee: d.fee.trim() } : { is_paid: false, entry_fee: '' };
    case 'disciplines':
      return d.disciplines.length ? { disciplines: d.disciplines } : undefined;
    case 'helmet_rule':
      return d.helmet === null ? undefined : { helmet_required: d.helmet };
    case 'description':
      return d.description.trim()
        ? { body: d.description.trim(), locale: LOCALES.includes(locale) ? locale : 'en' }
        : undefined;
    default:
      return undefined;
  }
}

/**
 * Report park info (Park-Report mockup, M5): pick what's wrong, see what's
 * listed now, optionally suggest the right value, add a note or a photo of
 * the sign, and send it to the park's admins (report_park_info). Nothing
 * changes until an admin approves it; the reporter is told when it does.
 * Opened from the park page's More menu and its "Suggest a fix" line.
 */
export default function ReportParkInfo() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { t, i18n } = useTranslation();
  const c = useColors();
  const { session } = useAuth();
  const { data: park } = usePark(slug);
  const send = useReportParkInfo(park?.id ?? '', session?.user.id);
  const [field, setField] = useState<ParkField>('hours');
  const [obstacleId, setObstacleId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState<PickedMedia | null>(null);
  const [error, setError] = useState<string | null>(null);
  const locale = i18n.language;

  const set = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    if (error) setError(null);
  };

  const close = () => router.back();

  if (!park) {
    return (
      <FormScreen header={<CloseRow onClose={close} />}>
        {park === undefined ? <ActivityIndicator color={c.text} /> : <Text variant="body">{t('park.missing')}</Text>}
      </FormScreen>
    );
  }

  const obstacles = park.obstacles.filter((o) => o.general_type !== 'street_plaza');
  const suggested = suggestedValue(field, draft, locale);
  const listed = listedNow(park, field, obstacleId, t, locale);

  async function addPhoto() {
    try {
      const { picked, rejected } = await pickFromLibrary(1, { photosOnly: true });
      if (rejected.length > 0) Alert.alert(t('parkPhotos.unsupported'));
      if (picked[0]) setPhoto(picked[0]);
    } catch {
      Alert.alert(t('errors.generic'));
    }
  }

  function submit() {
    if (!park) return;
    if (field === 'obstacle' && !obstacleId) {
      setError(t('parkReport.errors.pick_an_obstacle'));
      return;
    }
    if (suggested === undefined && !note.trim() && !photo) {
      setError(t('parkReport.errors.say_what_is_wrong'));
      return;
    }
    setError(null);
    send.mutate(
      { field, obstacle: field === 'obstacle' ? (obstacleId ?? undefined) : undefined, suggested, note, photo },
      {
        onSuccess: () =>
          Alert.alert(t('parkReport.sentTitle'), t('parkReport.sentBody'), [{ text: t('report.done'), onPress: close }]),
        onError: (err) => {
          if (err.message === 'generic') Sentry.captureException(err);
          setError(
            t(
              `parkReport.errors.${
                (['say_what_is_wrong', 'pick_an_obstacle', 'photo_not_uploaded', 'too_many_reports'] as const).find(
                  (code) => code === err.message,
                ) ?? 'generic'
              }`,
            ),
          );
        },
      },
    );
  }

  const fieldLabel = t(`parkReport.fixLabel.${field}`);

  return (
    <FormScreen
      // A sheet on iOS (already below the status bar); full screen on Android.
      edges={Platform.OS === 'ios' ? ['bottom', 'left', 'right'] : undefined}
      header={
        <View style={styles.head}>
          <View style={styles.flex}>
            <Text variant="label" color="textSecondary">
              {park.display_name}
            </Text>
            <Text variant="title" accessibilityRole="header" style={styles.title}>
              {t('parkReport.title')}
            </Text>
          </View>
          <CloseButton onPress={close} />
        </View>
      }
      footer={
        <Button
          label={t('report.send')}
          palette={{ fill: c.accent, text: c.onAccent, border: c.accent }}
          onPress={submit}
          loading={send.isPending}
        />
      }
    >
      <View style={styles.chips} accessibilityRole="radiogroup">
        {FIELDS.map((f) => (
          <Chip
            key={f}
            label={t(`parkReport.fields.${f}`)}
            picked={field === f}
            onPress={() => {
              setField(f);
              setError(null);
            }}
          />
        ))}
      </View>

      {field === 'obstacle' ? (
        <View style={styles.group}>
          <Text variant="label" color="textSecondary">
            {t('parkReport.whichObstacle')}
          </Text>
          {obstacles.length === 0 ? (
            <Text variant="bodySm" color="textSecondary">
              {t('park.noObstacles')}
            </Text>
          ) : (
            <View style={styles.chips}>
              {obstacles.map((o) => (
                <Chip key={o.id} label={o.name} picked={obstacleId === o.id} onPress={() => setObstacleId(o.id)} />
              ))}
            </View>
          )}
        </View>
      ) : null}

      {listed ? (
        <View style={[styles.listed, { backgroundColor: c.surfaceRaised }]}>
          <Text variant="label" color="textSecondary">
            {t('parkReport.listedNow')}
          </Text>
          <Text variant="body" style={styles.semi}>
            {listed}
          </Text>
        </View>
      ) : null}

      {field !== 'obstacle' && field !== 'other' ? (
        <View style={styles.group}>
          <Text variant="bodySm" style={styles.semi}>
            {fieldLabel}
            <Text variant="bodySm" color="textSecondary">{` ${t('common.optional')}`}</Text>
          </Text>
          <FixInput field={field} draft={draft} set={set} />
        </View>
      ) : null}

      <TextField
        label={t('parkReport.note')}
        labelNote={t('common.optional')}
        value={note}
        onChangeText={(v) => {
          setNote(v);
          if (error) setError(null);
        }}
        maxLength={MAX_PARK_NOTE}
        multiline
        textAlignVertical="top"
      />

      {photo ? (
        <View style={styles.photoRow}>
          <Image source={{ uri: photo.uri }} style={styles.photo} contentFit="cover" accessibilityIgnoresInvertColors />
          <Button variant="tertiary" label={t('parkReport.removePhoto')} onPress={() => setPhoto(null)} />
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          onPress={() => void addPhoto()}
          style={({ pressed }) => [styles.addPhoto, { borderColor: c.textSecondary }, pressed && styles.pressed]}
        >
          <Icon name="camera" color={c.text} size={20} />
          <Text variant="body" style={styles.semi}>
            {t('parkReport.addPhoto')}
          </Text>
        </Pressable>
      )}

      <Text variant="bodySm" color="textSecondary">
        {t('parkReport.footnote')}
      </Text>
      {error ? (
        <Text variant="bodySm" color="statusClosed" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </FormScreen>
  );
}

/** The input for the right value of one field. */
function FixInput({ field, draft, set }: { field: ParkField; draft: Draft; set: (patch: Partial<Draft>) => void }) {
  const { t } = useTranslation();
  switch (field) {
    case 'hours':
      return (
        <View style={styles.group}>
          <View style={styles.chips}>
            {(Object.keys(DAY_SETS) as DaySet[]).map((d) => (
              <Chip key={d} label={t(`parkReport.days.${d}`)} picked={draft.days === d} onPress={() => set({ days: d })} />
            ))}
          </View>
          <View style={styles.times}>
            <View style={styles.flex}>
              <TextField
                label={t('parkReport.opens')}
                value={draft.sunrise ? t('park.sunrise') : draft.start}
                editable={!draft.sunrise}
                onChangeText={(v) => set({ start: v })}
                placeholder="09:00"
                keyboardType="numbers-and-punctuation"
                maxLength={5}
              />
              <Chip label={t('parkReport.atSunrise')} picked={draft.sunrise} onPress={() => set({ sunrise: !draft.sunrise })} />
            </View>
            <View style={styles.flex}>
              <TextField
                label={t('parkReport.closes')}
                value={draft.sunset ? t('park.sunset') : draft.end}
                editable={!draft.sunset}
                onChangeText={(v) => set({ end: v })}
                placeholder="22:00"
                keyboardType="numbers-and-punctuation"
                maxLength={5}
              />
              <Chip label={t('parkReport.atSunset')} picked={draft.sunset} onPress={() => set({ sunset: !draft.sunset })} />
            </View>
          </View>
          {(draft.start && !draft.sunrise && !normalizeTime(draft.start)) ||
          (draft.end && !draft.sunset && !normalizeTime(draft.end)) ? (
            <Text variant="bodySm" color="statusClosed">
              {t('parkReport.timeFormat')}
            </Text>
          ) : null}
        </View>
      );
    case 'status':
      return (
        <View style={styles.chips}>
          {STATUSES.map((s) => (
            <Chip key={s} label={t(`park.status.${s}`)} picked={draft.status === s} onPress={() => set({ status: s })} />
          ))}
        </View>
      );
    case 'lighting':
      return (
        <YesNo
          value={draft.lit}
          yes={t('park.litYes')}
          no={t('park.litNo')}
          onChange={(lit) => set({ lit })}
        />
      );
    case 'helmet_rule':
      return (
        <YesNo
          value={draft.helmet}
          yes={t('parkReport.helmetYes')}
          no={t('parkReport.helmetNo')}
          onChange={(helmet) => set({ helmet })}
        />
      );
    case 'location':
      return (
        <TextField
          label={t('parkReport.address')}
          value={draft.address}
          onChangeText={(address) => set({ address })}
          autoCapitalize="words"
          maxLength={300}
        />
      );
    case 'fees':
      return (
        <View style={styles.group}>
          <YesNo value={draft.paid} yes={t('park.paid')} no={t('park.free')} onChange={(paid) => set({ paid })} />
          {draft.paid ? (
            <TextField
              label={t('parkReport.fee')}
              value={draft.fee}
              onChangeText={(fee) => set({ fee })}
              placeholder={t('parkReport.feePlaceholder')}
              maxLength={200}
            />
          ) : null}
        </View>
      );
    case 'disciplines':
      return (
        <View style={styles.chips}>
          {DISCIPLINES.map((d) => {
            const on = draft.disciplines.includes(d);
            return (
              <Chip
                key={d}
                label={t(`disciplines.${d}`)}
                picked={on}
                onPress={() =>
                  set({ disciplines: on ? draft.disciplines.filter((x) => x !== d) : [...draft.disciplines, d] })
                }
              />
            );
          })}
        </View>
      );
    case 'description':
      return (
        <TextField
          label={t('parkReport.fields.description')}
          value={draft.description}
          onChangeText={(description) => set({ description })}
          multiline
          textAlignVertical="top"
          maxLength={DESCRIPTION_MAX}
        />
      );
    default:
      return null;
  }
}

function YesNo({
  value,
  yes,
  no,
  onChange,
}: {
  value: boolean | null;
  yes: string;
  no: string;
  onChange: (v: boolean) => void;
}) {
  return (
    <View style={styles.chips}>
      <Chip label={yes} picked={value === true} onPress={() => onChange(true)} />
      <Chip label={no} picked={value === false} onPress={() => onChange(false)} />
    </View>
  );
}

/** What the park page shows now for a field; null when there's nothing to show. */
function listedNow(
  park: ParkDetail,
  field: ParkField,
  obstacleId: string | null,
  t: TFunction,
  locale: string,
): string | null {
  const unknown = t('park.unknown');
  switch (field) {
    case 'hours': {
      if (park.sessions.length === 0) return t('park.hoursUnknown');
      const time = (anchor: string | null, value: string | null): string | null => {
        if (anchor === 'sunrise') return t('park.sunrise');
        if (anchor === 'sunset') return t('park.sunset');
        if (!value) return null;
        const [h, m] = value.split(':').map(Number);
        return formatClock(h * 60 + m, locale);
      };
      return [...park.sessions]
        .sort((a, b) => (a.season_start_month ?? 0) - (b.season_start_month ?? 0) || a.days[0] - b.days[0])
        .map((s) => {
          const ranges = dayRanges(s.days);
          const days =
            ranges.length === 1 && ranges[0][0] === 1 && ranges[0][1] === 7
              ? t('park.daily')
              : ranges
                  .map(([a, b]) =>
                    a === b ? weekdayName(a, locale) : `${weekdayName(a, locale)}–${weekdayName(b, locale)}`,
                  )
                  .join(', ');
          const start = time(s.start_anchor, s.start_time);
          const end = time(s.end_anchor, s.end_time);
          return `${days} ${start && end ? t('park.timeRange', { start, end }) : t('park.hoursUnknown')}`;
        })
        .join('\n');
    }
    case 'status':
      return t(`park.status.${park.status}`);
    case 'lighting':
      return park.night_lighting === true ? t('park.litYes') : park.night_lighting === false ? t('park.litNo') : unknown;
    case 'location':
      return park.address ?? unknown;
    case 'fees':
      return park.is_paid ? [t('park.paid'), park.entry_fee].filter(Boolean).join(' · ') : t('park.free');
    case 'disciplines': {
      const all = [...new Set(park.sessions.flatMap((s) => s.disciplines))];
      return all.length ? all.map((d) => t(`disciplines.${d}`)).join(', ') : unknown;
    }
    case 'helmet_rule':
      return park.helmet_required === true
        ? t('parkReport.helmetYes')
        : park.helmet_required === false
          ? t('parkReport.helmetNo')
          : unknown;
    case 'description':
      return pickDescription(park.descriptions, locale) ?? t('parkReport.noDescription');
    case 'obstacle': {
      const o = park.obstacles.find((x) => x.id === obstacleId);
      return o ? [o.name, o.notes].filter(Boolean).join(' · ') : null;
    }
    default:
      return null;
  }
}

function CloseButton({ onPress }: { onPress: () => void }) {
  const { t } = useTranslation();
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('common.close')}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [styles.close, { backgroundColor: c.surfaceRaised }, pressed && styles.pressed]}
    >
      <Icon name="close" color={c.text} size={20} />
    </Pressable>
  );
}

function CloseRow({ onClose }: { onClose: () => void }) {
  return (
    <View style={styles.closeRow}>
      <CloseButton onPress={onClose} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, gap: space[2] },
  pressed: { opacity: 0.75 },
  semi: { fontFamily: fontFamily.sansSemiBold },
  head: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingTop: space[3] },
  title: { fontSize: 28, lineHeight: 28 },
  close: { width: size.tapMin, height: size.tapMin, alignItems: 'center', justifyContent: 'center' },
  closeRow: { flexDirection: 'row', justifyContent: 'flex-end', paddingTop: space[3] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  group: { gap: space[2] },
  listed: { padding: space[3], gap: space[1] },
  times: { flexDirection: 'row', gap: space[3] },
  addPhoto: {
    height: size.tapMin,
    borderWidth: stroke.rule,
    borderStyle: 'dashed',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[2],
  },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  photo: { width: 72, height: 72 },
});
