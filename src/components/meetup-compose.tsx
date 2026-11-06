/**
 * Pieces of the meetup composer (Meetups v2 mockups "New meetup · fast path"
 * and "Repeats sheet · seasons"): the Post | Meetup switch, and the sheets
 * behind its rows. Times are always picked on the park's clock.
 */
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DateTimePicker as ComposeDateTimePicker, Host as ComposeHost } from '@expo/ui/jetpack-compose';
import { DatePicker as SwiftDatePicker, Host as SwiftHost } from '@expo/ui/swift-ui';
import { datePickerStyle, labelsHidden, tint } from '@expo/ui/swift-ui/modifiers';
import { Alert, Animated, PanResponder, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Avatar } from '@/components/profile';
import { Caption, Chip, ParkPickerModal, type PickedPark, Sheet } from '@/components/tagging';
import { Button, CheckBox, Icon } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { formatClock, localNow } from '@/lib/hours';
import {
  type Discipline,
  MAX_CO_HOSTS,
  MAX_MORE_PARKS,
  MEETUP_TITLE_MAX,
  type Season,
  WHO_FOR_MAX,
  zonedToUtc,
} from '@/lib/meetups';
import { searchPeople } from '@/lib/people';
import { fresh } from '@/lib/query';
import { useFollowing } from '@/lib/social';
import { fontFamily, size, space, stroke, Text, useColorSchemeName, useColors } from '@/theme';

export const MEETUP_DISCIPLINES: Discipline[] = ['inline', 'quad', 'skateboard'];
const WEEK = [1, 2, 3, 4, 5, 6, 7];

/* Post | Meetup ------------------------------------------------------------------ */

/** The switch at the top of New: Post goes to the posting flow, Meetup to the composer. */
export function NewModeSwitch({ mode, park }: { mode: 'post' | 'meetup'; park?: { id: string; name: string } | null }) {
  const { t } = useTranslation();
  const c = useColors();
  const params = park ? { park: park.id, parkName: park.name } : {};
  const go = (next: 'post' | 'meetup') => {
    if (next === mode) return;
    router.replace({ pathname: next === 'post' ? '/new-post' : '/new-meetup', params });
  };
  return (
    <View accessibilityRole="tablist" style={[styles.switch, { borderColor: c.border }]}>
      {(['post', 'meetup'] as const).map((m) => {
        const on = m === mode;
        return (
          <Pressable
            key={m}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => go(m)}
            style={[styles.switchTab, { backgroundColor: on ? c.text : 'transparent' }]}
          >
            <Text variant="body" style={{ color: on ? c.surface : c.text, fontFamily: fontFamily.sansSemiBold }}>
              {m === 'post' ? t('meetupCompose.modePost') : t('meetupCompose.modeMeetup')}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/* Date and time ------------------------------------------------------------------- */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const PICK_DAYS = 28;
const END_SHORTCUTS = [1, 2, 3];

/**
 * The native pickers show the phone's clock, but meetup times are on the
 * park's. These shift a time so the picker shows the park's wall clock, and back.
 */
function parkToPicker(at: Date, timeZone: string | null): Date {
  const p = localNow(at, timeZone);
  return new Date(p.year, p.month - 1, p.day, Math.floor(p.minutes / 60), p.minutes % 60);
}
function pickerToPark(at: Date, timeZone: string | null): Date {
  return zonedToUtc(at.getFullYear(), at.getMonth() + 1, at.getDate(), at.getHours() * 60 + at.getMinutes(), timeZone);
}
/** An end picked as a clock time: on the start's day, or the next day if that's not after the start. */
function endAfter(start: Date, picked: Date, timeZone: string | null): Date {
  const s = localNow(start, timeZone);
  const end = zonedToUtc(s.year, s.month, s.day, picked.getHours() * 60 + picked.getMinutes(), timeZone);
  return end <= start ? new Date(end.getTime() + 24 * HOUR) : end;
}
const nextQuarterHour = (now: Date) => new Date(Math.ceil(now.getTime() / (15 * MINUTE)) * 15 * MINUTE);

/**
 * Starts: the native date and time picker (now through the next four weeks).
 * Ends (`after` set): a time-only picker plus +1/+2/+3 hr; an end at or before
 * the start lands on the next day. Times are always on the park's clock.
 * `optional` adds "No end time".
 */
export function DateTimeSheet({
  visible,
  title,
  value,
  timeZone,
  after,
  optional,
  onPick,
  onClose,
}: {
  visible: boolean;
  title: string;
  value: Date | null;
  timeZone: string | null;
  /** Ends: the meetup's start. Only the time is picked. */
  after?: Date | null;
  optional?: boolean;
  onPick: (next: Date | null) => void;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const c = useColors();
  const scheme = useColorSchemeName();
  const fallback = () => (after ? new Date(after.getTime() + 2 * HOUR) : nextQuarterHour(new Date()));
  const [picked, setPicked] = useState<Date>(() => value ?? fallback());
  const [now, setNow] = useState(() => new Date());
  const [wasVisible, setWasVisible] = useState(visible);

  // Each time it opens, start from the current value.
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setNow(new Date());
      setPicked(value ? (after ? endAfter(after, parkToPicker(value, timeZone), timeZone) : value) : fallback());
    }
  }

  const choose = (d: Date) => setPicked(after ? endAfter(after, d, timeZone) : pickerToPark(d, timeZone));

  const summary = () => {
    const p = localNow(picked, timeZone);
    const clock = formatClock(p.minutes, locale);
    if (after) {
      const mins = Math.round((picked.getTime() - after.getTime()) / MINUTE);
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      const length = h && m ? t('meetupCompose.lengthHm', { h, m }) : h ? t('meetupCompose.lengthH', { h }) : t('meetupCompose.lengthM', { m });
      return `${clock} · ${length}`;
    }
    const today = localNow(now, timeZone);
    const dayNumber = (y: number, mo: number, d: number) => Date.UTC(y, mo - 1, d) / (24 * HOUR);
    const diff = dayNumber(p.year, p.month, p.day) - dayNumber(today.year, today.month, today.day);
    const day =
      diff === 0
        ? t('meetupCompose.today')
        : diff === 1
          ? t('meetupCompose.tomorrow')
          : new Intl.DateTimeFormat(locale, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(
              new Date(Date.UTC(p.year, p.month - 1, p.day)),
            );
    return `${day} · ${clock}`;
  };

  // Starts can't be in the past (an earlier saved start stays pickable).
  const first = value && value < now ? value : now;
  const range = after
    ? undefined
    : { start: parkToPicker(first, timeZone), end: parkToPicker(new Date(now.getTime() + PICK_DAYS * 24 * HOUR), timeZone) };
  const shown = parkToPicker(picked, timeZone);

  const done = () => {
    onPick(picked);
    onClose();
  };

  return (
    <Sheet visible={visible} title={title} onClose={done} done>
      <ScrollView contentContainerStyle={styles.sheetBody}>
        <View accessibilityLiveRegion="polite">
          <Text variant="title">{summary()}</Text>
          {timeZone ? (
            <Text variant="caption" color="textSecondary">
              {t('meetupCompose.parkClock')}
            </Text>
          ) : null}
        </View>
        {after ? (
          <View style={styles.quick}>
            {END_SHORTCUTS.map((h) => (
              <Chip
                key={h}
                label={t('meetupCompose.plusHours', { h })}
                picked={picked.getTime() - after.getTime() === h * HOUR}
                onPress={() => setPicked(new Date(after.getTime() + h * HOUR))}
              />
            ))}
          </View>
        ) : null}
        {Platform.OS === 'ios' ? (
          <SwiftHost matchContents colorScheme={scheme}>
            <SwiftDatePicker
              selection={shown}
              range={range}
              displayedComponents={after ? ['hourAndMinute'] : ['date', 'hourAndMinute']}
              onDateChange={choose}
              modifiers={[datePickerStyle('wheel'), labelsHidden(), tint(c.accent)]}
            />
          </SwiftHost>
        ) : (
          <ComposeHost matchContents colorScheme={scheme}>
            <ComposeDateTimePicker
              key={visible ? 'open' : 'closed'}
              initialDate={shown.toISOString()}
              displayedComponents={after ? 'hourAndMinute' : 'dateAndTime'}
              selectableDates={range}
              showVariantToggle={false}
              color={c.accent}
              onDateSelected={choose}
            />
          </ComposeHost>
        )}
        {optional ? (
          <Button
            variant="secondary"
            label={t('meetupCompose.noEnd')}
            onPress={() => {
              onPick(null);
              onClose();
            }}
          />
        ) : null}
      </ScrollView>
    </Sheet>
  );
}

/* Disciplines --------------------------------------------------------------------- */

export function DisciplinesSheet({
  visible,
  value,
  onChange,
  onClose,
}: {
  visible: boolean;
  value: Discipline[];
  onChange: (next: Discipline[]) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Sheet visible={visible} title={t('meetupCompose.disciplines')} onClose={onClose} done>
      <View style={styles.sheetBody}>
        <View style={styles.wrap}>
          {MEETUP_DISCIPLINES.map((d) => (
            <Chip
              key={d}
              label={t(`disciplines.${d}`)}
              picked={value.includes(d)}
              onPress={() => onChange(value.includes(d) ? value.filter((x) => x !== d) : [...value, d])}
            />
          ))}
        </View>
        <Text variant="bodySm" color="textSecondary">
          {t('meetupCompose.disciplinesHint')}
        </Text>
      </View>
    </Sheet>
  );
}

/* Title --------------------------------------------------------------------------- */

export function TitleSheet({
  visible,
  value,
  onChange,
  onClose,
}: {
  visible: boolean;
  value: string;
  onChange: (next: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const c = useColors();
  return (
    <Sheet visible={visible} title={t('meetupCompose.title')} onClose={onClose} done>
      <View style={styles.sheetBody}>
        <TextInput
          value={value}
          onChangeText={(v) => onChange(v.slice(0, MEETUP_TITLE_MAX))}
          placeholder={t('meetupCompose.titlePlaceholder')}
          placeholderTextColor={c.textSecondary}
          autoFocus
          maxLength={MEETUP_TITLE_MAX}
          accessibilityLabel={t('meetupCompose.title')}
          returnKeyType="done"
          onSubmitEditing={onClose}
          style={[styles.input, { borderColor: c.border, backgroundColor: c.surfaceRaised, color: c.text }]}
        />
        <Text variant="bodySm" color="textSecondary">
          {t('meetupCompose.titleHint')}
        </Text>
      </View>
    </Sheet>
  );
}

/**
 * Who it's for (WhoFor-Sheet): one line under the title, so people know if
 * it's for them. A counter, a few examples and a note that it's information,
 * not a rule. Clear empties it; Done keeps what's typed.
 */
export function WhoForSheet({
  visible,
  value,
  onChange,
  onClose,
}: {
  visible: boolean;
  value: string;
  onChange: (next: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const c = useColors();
  return (
    <Sheet visible={visible} title={t('whoFor.title')} onClose={onClose}>
      <View style={styles.sheetBody}>
        <Text variant="body">{t('whoFor.body')}</Text>
        <View style={styles.whoForLabel}>
          <Text variant="label" color="textSecondary" style={styles.flex}>
            {t('whoFor.label')}
          </Text>
          <Text variant="label" color="textSecondary" accessibilityLabel={t('whoFor.counterA11y', { count: value.length, max: WHO_FOR_MAX })}>
            {`${value.length} / ${WHO_FOR_MAX}`}
          </Text>
        </View>
        <TextInput
          value={value}
          // One line: a pasted line break becomes a space.
          onChangeText={(v) => onChange(v.replace(/\s*\n\s*/g, ' ').slice(0, WHO_FOR_MAX))}
          placeholder={t('whoFor.placeholder')}
          placeholderTextColor={c.textSecondary}
          autoFocus
          maxLength={WHO_FOR_MAX}
          accessibilityLabel={t('whoFor.title')}
          returnKeyType="done"
          onSubmitEditing={onClose}
          style={[styles.input, { borderColor: c.border, backgroundColor: c.surfaceRaised, color: c.text }]}
        />
        <Text variant="bodySm" color="textSecondary">
          {t('whoFor.examples')}
        </Text>
        <View style={[styles.note, { backgroundColor: c.surfaceRaised }]}>
          <Icon name="info" color={c.text} size={20} />
          <Text variant="bodySm" color="textSecondary" style={styles.flex}>
            {t('whoFor.note')}
          </Text>
        </View>
        <View style={styles.whoForButtons}>
          <Button label={t('whoFor.clear')} variant="secondary" disabled={!value} onPress={() => onChange('')} style={styles.flex} />
          <Button label={t('whoFor.done')} onPress={onClose} style={styles.flex} />
        </View>
      </View>
    </Sheet>
  );
}

/* Repeats ------------------------------------------------------------------------- */

export type RepeatDraft = { weekdays: number[]; repeatEndsOn: string | null; seasons: Season[] };

/**
 * Repeats (mockup "Repeats sheet · seasons"): the week's days, optional
 * seasons that pick each date's park, and when it ends.
 */
export function RepeatsSheet({
  visible,
  value,
  startLabel,
  seasons: withSeasons = true,
  onChange,
  onClose,
}: {
  visible: boolean;
  value: RepeatDraft;
  /** "18:00–21:00 · Copenhagen time", or null before a time is picked. */
  startLabel: string | null;
  /** Seasons pick each date's park, so they're for meetups at parks (PR 9). */
  seasons?: boolean;
  onChange: (next: RepeatDraft) => void;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const c = useColors();
  const locale = i18n.language;
  const [parkFor, setParkFor] = useState<number | null>(null);
  const weekday = (d: number, style: 'narrow' | 'long') =>
    new Intl.DateTimeFormat(locale, { weekday: style, timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 0, 4 + d)));
  const month = (m: number) =>
    new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, m - 1, 1)));
  const monthLong = (m: number) =>
    new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, m - 1, 1)));

  const setSeason = (i: number, patch: Partial<Season>) =>
    onChange({ ...value, seasons: value.seasons.map((s, j) => (j === i ? { ...s, ...patch } : s)) });

  // Ends: never, or the end of one of the next six months.
  const endChoices = useMemo(() => {
    const now = new Date();
    return Array.from({ length: 6 }, (_, i) => {
      const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i + 1, 0));
      return last.toISOString().slice(0, 10);
    });
  }, []);
  const endLabel = (iso: string) =>
    new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));

  return (
    <Sheet visible={visible} title={t('meetupCompose.repeats')} onClose={onClose} done>
      <ScrollView contentContainerStyle={styles.sheetBody}>
        <Caption>{t('meetupCompose.everyWeekOn')}</Caption>
        <View style={styles.week}>
          {WEEK.map((d) => {
            const on = value.weekdays.includes(d);
            return (
              <Pressable
                key={d}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                accessibilityLabel={weekday(d, 'long')}
                onPress={() =>
                  onChange({
                    ...value,
                    weekdays: on ? value.weekdays.filter((x) => x !== d) : [...value.weekdays, d].sort(),
                  })
                }
                style={[styles.day, { borderColor: c.border, backgroundColor: on ? c.accent : 'transparent' }]}
              >
                <Text variant="body" style={{ fontFamily: fontFamily.sansSemiBold, color: on ? c.onAccent : c.text }}>
                  {weekday(d, 'narrow')}
                </Text>
              </Pressable>
            );
          })}
        </View>
        {startLabel ? (
          <Text variant="bodySm" color="textSecondary">
            {startLabel}
          </Text>
        ) : null}

        {withSeasons ? (
        <>
        <View style={styles.headingRow}>
          <Caption>{t('meetupCompose.seasons')}</Caption>
          <Text variant="caption" color="textSecondary" style={styles.flexEnd}>
            {t('meetupCompose.seasonsHint')}
          </Text>
        </View>
        {value.seasons.map((s, i) => (
          <View key={i} style={[styles.season, { borderColor: c.border, backgroundColor: c.surfaceRaised }]}>
            <View style={styles.seasonHead}>
              <Text variant="headline" style={styles.flex}>
                {t('meetupCompose.seasonRange', { from: monthLong(s.fromMonth), to: monthLong(s.toMonth) })}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('meetupCompose.removeSeason')}
                onPress={() => onChange({ ...value, seasons: value.seasons.filter((_, j) => j !== i) })}
                hitSlop={8}
              >
                <Icon name="close" color={c.text} size={20} />
              </Pressable>
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={() => setParkFor(i)}
              style={[styles.seasonRow, { borderTopColor: c.borderSubtle }]}
            >
              <Icon name="pin" color={c.text} size={20} />
              <Text variant="body" style={[styles.flex, { fontFamily: fontFamily.sansSemiBold }]}>
                {s.park.name}
              </Text>
              <Icon name="chevron" color={c.textSecondary} size={18} />
            </Pressable>
            <Text variant="label" color="textSecondary" style={styles.monthLabel}>
              {t('meetupCompose.from')}
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.chips, styles.inset]}>
              {WEEK.concat([8, 9, 10, 11, 12]).map((m) => (
                <Chip key={m} label={month(m)} picked={s.fromMonth === m} onPress={() => setSeason(i, { fromMonth: m })} />
              ))}
            </ScrollView>
            <Text variant="label" color="textSecondary" style={styles.monthLabel}>
              {t('meetupCompose.to')}
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.chips, styles.inset]}>
              {WEEK.concat([8, 9, 10, 11, 12]).map((m) => (
                <Chip key={m} label={month(m)} picked={s.toMonth === m} onPress={() => setSeason(i, { toMonth: m })} />
              ))}
            </ScrollView>
          </View>
        ))}
        {value.seasons.length < 4 ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => setParkFor(value.seasons.length)}
            style={({ pressed }) => [styles.addSeason, { borderColor: c.textSecondary }, pressed && styles.pressed]}
          >
            <Icon name="add" color={c.text} size={20} />
            <Text variant="body" style={{ fontFamily: fontFamily.sansSemiBold }}>
              {t('meetupCompose.addSeason')}
            </Text>
          </Pressable>
        ) : null}
        </>
        ) : null}

        <Caption>{t('meetupCompose.ends')}</Caption>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          <Chip
            label={t('meetupCompose.never')}
            picked={value.repeatEndsOn === null}
            onPress={() => onChange({ ...value, repeatEndsOn: null })}
          />
          {endChoices.map((iso) => (
            <Chip
              key={iso}
              label={endLabel(iso)}
              picked={value.repeatEndsOn === iso}
              onPress={() => onChange({ ...value, repeatEndsOn: iso })}
            />
          ))}
        </ScrollView>

        <View style={[styles.note, { backgroundColor: c.surfaceRaised }]}>
          <Icon name="repeat" color={c.text} size={20} />
          <Text variant="bodySm" color="textSecondary" style={styles.flex}>
            {t('meetupCompose.repeatsNote')}
          </Text>
        </View>
      </ScrollView>

      <ParkPickerModal
        visible={parkFor !== null}
        current={parkFor !== null ? (value.seasons[parkFor]?.park ?? null) : null}
        onClose={() => setParkFor(null)}
        onPick={(park: PickedPark | null) => {
          if (!park || parkFor === null) return;
          if (parkFor < value.seasons.length) setSeason(parkFor, { park });
          else {
            // A new season starts after the last one ends.
            const last = value.seasons[value.seasons.length - 1];
            const from = last ? (last.toMonth % 12) + 1 : 5;
            onChange({
              ...value,
              seasons: [...value.seasons, { park, fromMonth: from, toMonth: ((from + 4) % 12) + 1 }],
            });
          }
        }}
      />
    </Sheet>
  );
}

/* Parks, in order (PR 9b) ----------------------------------------------------------- */

const STOP_HEIGHT = 60;

/**
 * Parks, in order (mockup Hop-Parks): the start (the Park or Place row) is
 * stop 1; up to 9 more parks follow. Drag to reorder (or Move up and Move
 * down for screen readers), ✕ to remove, Add a park.
 */
export function ParksSheet({
  visible,
  start,
  startParkId,
  value,
  onChange,
  onClose,
}: {
  visible: boolean;
  /** Stop 1's name: the park, or a page's base, shop or address. Null before one is picked. */
  start: string | null;
  /** The start's park, which can't also be a stop. */
  startParkId: string | null;
  value: PickedPark[];
  onChange: (next: PickedPark[]) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const c = useColors();
  const [picking, setPicking] = useState(false);
  const [dragging, setDragging] = useState(false);
  const total = 1 + value.length;
  const full = value.length >= MAX_MORE_PARKS;

  const move = useCallback(
    (from: number, to: number) => {
      if (to < 0 || to >= value.length || from === to) return;
      const next = [...value];
      const [park] = next.splice(from, 1);
      next.splice(to, 0, park);
      onChange(next);
    },
    [value, onChange],
  );

  return (
    <Sheet visible={visible} title={t('hops.sheetTitle')} onClose={onClose} done>
      <ScrollView contentContainerStyle={styles.sheetBody} scrollEnabled={!dragging} keyboardShouldPersistTaps="handled">
        <Text variant="label" color="textSecondary" accessibilityLabel={t('hops.countA11y', { count: total, max: MAX_MORE_PARKS + 1 })}>
          {t('hops.count', { count: total, max: MAX_MORE_PARKS + 1 })}
        </Text>
        <View style={{ borderTopWidth: stroke.hairline, borderTopColor: c.borderSubtle }}>
          <View style={[styles.stop, { backgroundColor: c.surfaceRaised, borderBottomColor: c.borderSubtle }]}>
            <StopNumber n={1} />
            <Text variant="body" numberOfLines={1} color={start ? 'text' : 'textSecondary'} style={[styles.flex, styles.semi]}>
              {start ?? t('hops.startFirst')}
            </Text>
            <Text variant="label" color="textSecondary">
              {t('hops.start')}
            </Text>
          </View>
          {value.map((park, i) => (
            <DraggableStop
              key={park.id}
              park={park}
              index={i}
              count={value.length}
              onMove={move}
              onRemove={() => onChange(value.filter((p) => p.id !== park.id))}
              onDragState={setDragging}
            />
          ))}
        </View>
        {full ? (
          <Text variant="bodySm" color="textSecondary">
            {t('hops.full', { max: MAX_MORE_PARKS + 1 })}
          </Text>
        ) : (
          <Pressable
            accessibilityRole="button"
            onPress={() => setPicking(true)}
            style={({ pressed }) => [styles.addSeason, { borderColor: c.text }, pressed && styles.pressed]}
          >
            <Icon name="add" color={c.text} size={20} />
            <Text variant="body" style={styles.semi}>
              {t('hops.addPark')}
            </Text>
          </Pressable>
        )}
        <Text variant="bodySm" color="textSecondary">
          {t('hops.sheetNote')}
        </Text>
      </ScrollView>

      <ParkPickerModal
        visible={picking}
        current={null}
        onClose={() => setPicking(false)}
        onPick={(park: PickedPark | null) => {
          if (!park) return;
          if (park.id === startParkId || value.some((p) => p.id === park.id)) {
            Alert.alert(t('hops.alreadyOn', { park: park.name }));
            return;
          }
          if (!full) onChange([...value, park]);
        }}
      />
    </Sheet>
  );
}

function StopNumber({ n }: { n: number }) {
  const c = useColors();
  return (
    <View style={[styles.stopNumber, { backgroundColor: c.text }]} accessibilityElementsHidden importantForAccessibility="no">
      <Text variant="bodySm" style={[styles.semi, { color: c.surface }]}>
        {n}
      </Text>
    </View>
  );
}

/** A stop after the start: drag its handle up or down to move it. */
function DraggableStop({
  park,
  index,
  count,
  onMove,
  onRemove,
  onDragState,
}: {
  park: PickedPark;
  index: number;
  count: number;
  onMove: (from: number, to: number) => void;
  onRemove: () => void;
  onDragState: (dragging: boolean) => void;
}) {
  const { t } = useTranslation();
  const c = useColors();
  const [dy] = useState(() => new Animated.Value(0));
  const [lifted, setLifted] = useState(false);

  // Made again only when the list changes, which never happens mid-drag
  // (the move lands on release), so a drag keeps its responder.
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          setLifted(true);
          onDragState(true);
        },
        onPanResponderMove: Animated.event([null, { dy }], { useNativeDriver: false }),
        onPanResponderRelease: (_, g) => {
          const to = Math.max(0, Math.min(count - 1, index + Math.round(g.dy / STOP_HEIGHT)));
          dy.setValue(0);
          setLifted(false);
          onDragState(false);
          onMove(index, to);
        },
        onPanResponderTerminate: () => {
          dy.setValue(0);
          setLifted(false);
          onDragState(false);
        },
      }),
    [dy, index, count, onMove, onDragState],
  );

  return (
    <Animated.View
      style={[
        styles.stop,
        { backgroundColor: c.surfaceRaised, borderBottomColor: c.borderSubtle, transform: [{ translateY: dy }] },
        lifted && [styles.lifted, { borderColor: c.border }],
      ]}
    >
      <StopNumber n={index + 2} />
      <Text variant="body" numberOfLines={1} style={[styles.flex, styles.semi]}>
        {park.name}
      </Text>
      <View
        {...responder.panHandlers}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={t('hops.moveA11y', { park: park.name, n: index + 2 })}
        accessibilityActions={[
          { name: 'increment', label: t('hops.moveDown') },
          { name: 'decrement', label: t('hops.moveUp') },
        ]}
        onAccessibilityAction={(e) => {
          if (e.nativeEvent.actionName === 'increment') onMove(index, index + 1);
          if (e.nativeEvent.actionName === 'decrement') onMove(index, index - 1);
        }}
        style={styles.stopButton}
      >
        <Icon name="dragHandle" color={c.textSecondary} size={22} />
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('hops.removeA11y', { park: park.name })}
        onPress={onRemove}
        style={({ pressed }) => [styles.stopButton, pressed && styles.pressed]}
      >
        <Icon name="close" color={c.text} size={22} />
      </Pressable>
    </Animated.View>
  );
}

/* Co-hosts ------------------------------------------------------------------------ */

type Person = { id: string; username: string };

/** Co-hosts: search, then people you follow. They accept before they're listed. */
export function CoHostSheet({
  visible,
  value,
  onChange,
  onClose,
}: {
  visible: boolean;
  value: Person[];
  onChange: (next: Person[]) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const c = useColors();
  const { session } = useAuth();
  const [q, setQ] = useState('');
  const query = q.trim().replace(/^@+/, '');
  const search = useQuery({
    queryKey: ['people-search', query],
    queryFn: () => searchPeople(query),
    enabled: visible && query.length >= 2,
    staleTime: fresh.search,
  });
  const following = useFollowing(session?.user.id, visible);
  const people: (Person & { avatarPath: string | null })[] =
    query.length >= 2
      ? (search.data ?? [])
          .filter((p) => p.id !== session?.user.id && p.username)
          .map((p) => ({ id: p.id, username: p.username, avatarPath: null }))
      : (following.data ?? []).map((p) => ({ id: p.id, username: p.username, avatarPath: p.avatarPath }));
  const picked = new Set(value.map((p) => p.id));
  const full = value.length >= MAX_CO_HOSTS;

  return (
    <Sheet visible={visible} title={t('meetupCompose.coHosts')} onClose={onClose} done>
      <View style={styles.sheetBody}>
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder={t('meetupCompose.coHostSearch')}
          placeholderTextColor={c.textSecondary}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel={t('meetupCompose.coHostSearch')}
          style={[styles.input, { borderColor: c.border, backgroundColor: c.surfaceRaised, color: c.text }]}
        />
        <Text variant="bodySm" color="textSecondary">
          {t('meetupCompose.coHostHint')}
        </Text>
        {value.length > 0 ? (
          <View style={styles.wrap}>
            {value.map((p) => (
              <Chip
                key={p.id}
                label={`@${p.username}`}
                picked
                trailing="close"
                onPress={() => onChange(value.filter((x) => x.id !== p.id))}
              />
            ))}
          </View>
        ) : null}
        <Caption>{query.length >= 2 ? t('meetupCompose.results') : t('meetupCompose.youFollow')}</Caption>
      </View>
      <ScrollView>
        {people.map((p) => {
          const on = picked.has(p.id);
          return (
            <Pressable
              key={p.id}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on, disabled: !on && full }}
              disabled={!on && full}
              onPress={() => onChange(on ? value.filter((x) => x.id !== p.id) : [...value, { id: p.id, username: p.username }])}
              style={({ pressed }) => [
                styles.personRow,
                { borderBottomColor: c.borderSubtle, backgroundColor: on ? c.accentSubtle : 'transparent' },
                pressed && styles.pressed,
                !on && full && styles.dim,
              ]}
            >
              <Avatar path={p.avatarPath} username={p.username} size={36} />
              <Text variant="body" style={[styles.flex, { color: on ? c.onAccentSubtle : c.text, fontFamily: fontFamily.sansSemiBold }]}>
                {p.username}
              </Text>
              <CheckBox checked={on} c={c} />
            </Pressable>
          );
        })}
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  whoForLabel: { flexDirection: 'row', alignItems: 'baseline' },
  whoForButtons: { flexDirection: 'row', gap: space[2] },
  flexEnd: { flex: 1, textAlign: 'right' },
  pressed: { opacity: 0.75 },
  dim: { opacity: 0.4 },
  switch: { flexDirection: 'row', borderWidth: stroke.rule },
  switchTab: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  sheetBody: { paddingHorizontal: space[4], paddingBottom: space[4], gap: space[3] },
  chips: { gap: space[2], paddingVertical: 2 },
  inset: { paddingHorizontal: space[3] },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  quick: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  input: { minHeight: 52, borderWidth: stroke.rule, paddingHorizontal: space[3], fontFamily: fontFamily.sans, fontSize: 16 },
  week: { flexDirection: 'row', gap: 4 },
  day: { flex: 1, height: size.tapMin, borderWidth: stroke.rule, alignItems: 'center', justifyContent: 'center' },
  headingRow: { flexDirection: 'row', alignItems: 'baseline', gap: space[2] },
  season: { borderWidth: stroke.rule, paddingBottom: space[3] },
  seasonHead: { flexDirection: 'row', alignItems: 'center', gap: space[2], padding: space[3] },
  seasonRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingHorizontal: space[3],
    borderTopWidth: stroke.hairline,
  },
  monthLabel: { paddingHorizontal: space[3], paddingTop: space[2] },
  addSeason: {
    minHeight: size.tapMin,
    borderWidth: stroke.rule,
    borderStyle: 'dashed',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[2],
  },
  note: { flexDirection: 'row', gap: space[2], padding: space[3] },
  semi: { fontFamily: fontFamily.sansSemiBold },
  stop: {
    height: STOP_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingLeft: space[3],
    borderBottomWidth: stroke.hairline,
  },
  lifted: { zIndex: 1, elevation: 4, borderWidth: stroke.rule },
  stopNumber: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  stopButton: { width: size.tapMin, height: size.tapMin, alignItems: 'center', justifyContent: 'center' },
  personRow: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingHorizontal: space[4],
    borderBottomWidth: stroke.hairline,
  },
});
