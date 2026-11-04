import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { EditBar } from '@/components/edit-bar';
import { Sheet, SheetHead } from '@/components/pages';
import { useTeamErrorAlert } from '@/components/page-team';
import { SafeAreaView } from '@/components/safe-area';
import { ShopHours } from '@/components/shop';
import { Chip } from '@/components/tagging';
import { BackButton, Button, Icon, TextField } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { dayRanges, formatClock, formatMonthDay, type HoursRow } from '@/lib/hours';
import {
  type DayGroup,
  firstOverlap,
  type HoursSet,
  MAX_HOURS_NOTE,
  MAX_HOURS_ROWS,
  monthDays,
  newKey,
  nextSeasonAfter,
  normalizeTime,
  type Opening,
  rowCount,
  rowsFromSets,
  type Season,
  setsFromRows,
  uncoveredRuns,
} from '@/lib/page-hours';
import { roleRank, useSetPageHours } from '@/lib/page-team';
import { type Page, usePage, usePageViewerState } from '@/lib/pages';
import { timeZoneCity } from '@/lib/shops';
import { fontFamily, size, space, stroke, Text, useColors } from '@/theme';

const WEEK = [1, 2, 3, 4, 5, 6, 7];

/**
 * Edit page › Hours (part A PR 7b; Page-Hours, Page-Hours-Row and
 * Page-Hours-Seasons mockups), for everyone on a shop's team: whoever's
 * behind the counter knows. Hours are the same all year or change with the
 * seasons (sets of dates); each set has groups of days, and a day can have
 * more than one opening (a lunch break). Clock times only. Saving replaces
 * the shop's hours in one go.
 */
export default function PageHoursScreen() {
  const { t } = useTranslation();
  const c = useColors();
  const { handle } = useLocalSearchParams<{ handle: string }>();
  const { session } = useAuth();
  const { data: page, isError, refetch } = usePage(handle);
  const viewer = usePageViewerState(session?.user.id, page?.id);
  if (!page || !viewer.data) {
    return (
      <SafeAreaView style={[styles.screen, { backgroundColor: c.surface }]}>
        <View style={styles.top}>
          <BackButton />
        </View>
        {isError || viewer.isError ? (
          <View style={styles.block}>
            <Text variant="body" color="textSecondary">
              {t('errors.network')}
            </Text>
            <Button label={t('common.retry')} onPress={() => void refetch()} />
          </View>
        ) : (
          <ActivityIndicator color={c.text} accessibilityLabel={t('common.loading')} style={styles.loading} />
        )}
      </SafeAreaView>
    );
  }
  if (roleRank(viewer.data.teamRole) < 1 || page.state !== 'managed' || !page.roles.includes('shop')) {
    return (
      <SafeAreaView style={[styles.screen, { backgroundColor: c.surface }]}>
        <View style={styles.top}>
          <BackButton />
        </View>
        <View style={styles.block}>
          <Text variant="body" color="textSecondary">
            {t('pageEdit.notYours')}
          </Text>
        </View>
      </SafeAreaView>
    );
  }
  return <HoursForm key={page.id} page={page} />;
}

/** "Mon, Wed–Fri" for a group of ISO weekdays; one day reads in full ("Wednesday"). */
function useDaysLabel() {
  const { t, i18n } = useTranslation();
  const name = (d: number, style: 'short' | 'long') =>
    // 2026-01-05 was a Monday.
    new Intl.DateTimeFormat(i18n.language, { weekday: style, timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 0, 4 + d)));
  return (days: number[]) => {
    if (days.length === 7) return t('park.daily');
    if (days.length === 1) return name(days[0], 'long');
    return dayRanges(days)
      .map(([a, b]) => (a === b ? name(a, 'short') : t('shop.dayRange', { from: name(a, 'short'), to: name(b, 'short') })))
      .join(', ');
  };
}

const clockOf = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

function HoursForm({ page }: { page: Page }) {
  const { t, i18n } = useTranslation();
  const c = useColors();
  const { session } = useAuth();
  const alertError = useTeamErrorAlert();
  const save = useSetPageHours(session?.user.id);
  const daysLabel = useDaysLabel();
  const locale = i18n.language;

  const original = useMemo(() => setsFromRows(page.hours), [page.hours]);
  const [sets, setSets] = useState<HoursSet[]>(original);
  const [editing, setEditing] = useState<{ setKey: string; group: DayGroup | null } | null>(null);
  const [dates, setDates] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const seasons = sets.some((s) => s.season);
  const payload = rowsFromSets(sets);
  const dirty = JSON.stringify(payload) !== JSON.stringify(rowsFromSets(original));
  const gaps = uncoveredRuns(sets);
  const overlap = firstOverlap(sets);
  const city = page.city ?? timeZoneCity(page.timeZone);
  const date = (s: { month: number; day: number }) => formatMonthDay(s.month, s.day, locale);
  const seasonLabel = (s: Season) =>
    t('pageHours.seasonDates', { from: formatMonthDay(s.startMonth, s.startDay, locale), to: formatMonthDay(s.endMonth, s.endDay, locale) });

  const updateSet = (key: string, change: (s: HoursSet) => HoursSet | null) =>
    setSets((all) => all.map((s) => (s.key === key ? change(s) : s)).filter((s): s is HoursSet => s !== null));

  const setMode = (want: 'all' | 'seasons') => {
    if (want === 'seasons' && !seasons) {
      setSets((all) =>
        all.length
          ? all.map((s) => ({ ...s, season: { startMonth: 1, startDay: 1, endMonth: 12, endDay: 31 } }))
          : [{ key: newKey(), season: { startMonth: 1, startDay: 1, endMonth: 12, endDay: 31 }, groups: [] }],
      );
      return;
    }
    if (want === 'all' && seasons) {
      const keep = () => setSets((all) => (all.length ? [{ ...all[0], season: null }] : []));
      if (sets.length <= 1) return keep();
      Alert.alert(t('pageHours.sameAllYearConfirm'), t('pageHours.sameAllYearBody', { dates: seasonLabel(sets[0].season!) }), [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('pageHours.sameAllYearButton'), style: 'destructive', onPress: keep },
      ]);
    }
  };

  const clearAll = () =>
    Alert.alert(t('pageHours.clearConfirm'), t('pageHours.clearBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('pageHours.clearButton'), style: 'destructive', onPress: () => setSets([]) },
    ]);

  const submit = () => {
    setError(null);
    if (overlap) {
      setError(t('pageHours.overlap', { date: date(overlap) }));
      return;
    }
    if (rowCount(sets) > MAX_HOURS_ROWS) {
      setError(t('pageHours.tooMany', { count: MAX_HOURS_ROWS }));
      return;
    }
    save.mutate(
      { pageId: page.id, rows: payload },
      {
        onSuccess: () => router.back(),
        onError: async (err) => {
          const message = (err as { message?: string } | null)?.message ?? '';
          if (message === 'invalid_hours') return setError(t('pageHours.invalid'));
          if (message === 'too_many') return setError(t('pageHours.tooMany', { count: MAX_HOURS_ROWS }));
          await alertError(err);
        },
      },
    );
  };

  // What the page's hours card will show, as rows.
  const previewRows: HoursRow[] = payload.map((r, i) => ({
    id: String(i),
    days: r.days,
    start_anchor: 'clock',
    start_time: r.start,
    end_anchor: 'clock',
    end_time: r.end,
    note: r.note,
    season_start_month: r.season?.start_month ?? null,
    season_start_day: r.season?.start_day ?? null,
    season_end_month: r.season?.end_month ?? null,
    season_end_day: r.season?.end_day ?? null,
  }));

  const editingSet = editing ? sets.find((s) => s.key === editing.setKey) ?? null : null;
  const datesSet = dates ? sets.find((s) => s.key === dates) ?? null : null;

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: c.surface }]}>
      <EditBar title={t('pageHours.title')} dirty={dirty} saving={save.isPending} onSave={submit} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text variant="bodySm" color="textSecondary">
          {city ? t('pageHours.onCityTime', { city }) : t('pageHours.onShopTime')}
        </Text>

        <View accessibilityRole="radiogroup" style={[styles.segments, { borderColor: c.border }]}>
          {(['all', 'seasons'] as const).map((m) => {
            const on = (m === 'seasons') === seasons;
            return (
              <Pressable
                key={m}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                onPress={() => setMode(m)}
                style={[styles.segment, { backgroundColor: on ? c.text : c.surfaceRaised }]}
              >
                <Text variant="bodySm" style={{ color: on ? c.surface : c.text, fontFamily: fontFamily.sansSemiBold, textAlign: 'center' }}>
                  {t(m === 'all' ? 'pageHours.sameAllYear' : 'pageHours.withSeasons')}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {(sets.length ? sets : [null]).map((set) => {
          const groups = set?.groups ?? [];
          const closed = WEEK.filter((d) => !groups.some((g) => g.days.includes(d)));
          return (
            <View key={set?.key ?? 'empty'} style={styles.section}>
              {set?.season ? (
                <View style={styles.setHead}>
                  <Text variant="title" accessibilityRole="header" style={styles.flex}>
                    {seasonLabel(set.season)}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('pageHours.changeDates', { dates: seasonLabel(set.season) })}
                    onPress={() => setDates(set.key)}
                    style={({ pressed }) => [styles.square, { borderColor: c.border, backgroundColor: c.surfaceRaised }, pressed && styles.pressed]}
                  >
                    <Icon name="calendar" color={c.text} size={20} />
                  </Pressable>
                </View>
              ) : (
                <Text variant="label" color="textSecondary">
                  {t('pageHours.open')}
                </Text>
              )}
              <View>
                {groups.map((g, i) => (
                  <Pressable
                    key={g.key}
                    accessibilityRole="button"
                    accessibilityLabel={`${daysLabel(g.days)}, ${g.openings
                      .map((o) => t('park.timeRange', { start: formatClock(clockOf(o.start), locale), end: formatClock(clockOf(o.end), locale) }))
                      .join(', ')}${g.note ? `, ${g.note}` : ''}`}
                    onPress={() => set && setEditing({ setKey: set.key, group: g })}
                    style={({ pressed }) => [styles.row, { borderColor: c.borderSubtle }, i === 0 && { borderTopWidth: 1 }, pressed && styles.pressed]}
                  >
                    <View style={styles.flex}>
                      <Text variant="body" style={{ fontFamily: fontFamily.sansSemiBold }}>
                        {daysLabel(g.days)}
                      </Text>
                      {g.note ? (
                        <Text variant="bodySm" color="textSecondary">
                          {g.note}
                        </Text>
                      ) : null}
                    </View>
                    <View style={styles.times}>
                      {g.openings.map((o) => (
                        <Text key={`${o.start}-${o.end}`} variant="body" color="textSecondary">
                          {t('park.timeRange', { start: formatClock(clockOf(o.start), locale), end: formatClock(clockOf(o.end), locale) })}
                        </Text>
                      ))}
                    </View>
                    <Icon name="chevron" color={c.textSecondary} size={20} />
                  </Pressable>
                ))}
                {groups.length && closed.length ? (
                  <View style={[styles.closedRow, { borderColor: c.borderSubtle }]}>
                    <Text variant="body" color="textSecondary">
                      {t('pageHours.closedOn', { days: daysLabel(closed) })}
                    </Text>
                  </View>
                ) : null}
              </View>
              {closed.length ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    if (set) return setEditing({ setKey: set.key, group: null });
                    const fresh: HoursSet = { key: newKey(), season: null, groups: [] };
                    setSets([fresh]);
                    setEditing({ setKey: fresh.key, group: null });
                  }}
                  style={({ pressed }) => [styles.add, pressed && styles.pressed]}
                >
                  <Icon name="add" color={c.accentText} size={20} />
                  <Text variant="body" color="accentText" style={styles.link}>
                    {set?.season ? t('pageHours.addForDates') : t('pageHours.addHours')}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          );
        })}

        {seasons && gaps.length ? (
          <View style={[styles.warning, { borderColor: c.warning }]}>
            <Icon name="calendarOff" color={c.warning} size={20} />
            <Text variant="bodySm" style={styles.flex}>
              <Text variant="bodySm" color="warning" style={styles.link}>
                {t('pageHours.gap', {
                  dates: gaps.map((g) => t('pageHours.seasonDates', { from: date(g.from), to: date(g.to) })).join(', '),
                })}
              </Text>
              {` ${t('pageHours.gapBody')}`}
            </Text>
          </View>
        ) : null}
        {seasons && overlap ? (
          <Text variant="bodySm" color="statusClosed">
            {t('pageHours.overlap', { date: date(overlap) })}
          </Text>
        ) : null}

        {seasons ? (
          <Button
            variant="secondary"
            icon="add"
            label={t('pageHours.addDates')}
            onPress={() => {
              const fresh: HoursSet = { key: newKey(), season: nextSeasonAfter(sets), groups: [] };
              setSets((all) => [...all, fresh]);
              setDates(fresh.key);
            }}
          />
        ) : null}

        {payload.length ? (
          <View style={styles.section}>
            <Text variant="label" color="textSecondary">
              {t('pageHours.onYourPage')}
            </Text>
            <ShopHours page={{ ...page, locationType: 'storefront', tempClosedAt: null, hours: previewRows }} />
          </View>
        ) : null}

        {sets.length ? (
          <View style={styles.section}>
            <Button
              variant="secondary"
              label={t('pageHours.clearButton')}
              onPress={clearAll}
              palette={{ fill: 'transparent', text: c.danger, border: c.danger }}
            />
            <Text variant="bodySm" color="textSecondary">
              {t('pageHours.clearNote')}
            </Text>
          </View>
        ) : null}

        {error ? (
          <Text variant="bodySm" color="statusClosed" accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
      </ScrollView>

      <DaySheet
        set={editingSet}
        group={editing?.group ?? null}
        onClose={() => setEditing(null)}
        onSave={(g) => {
          if (!editingSet) return;
          updateSet(editingSet.key, (s) => {
            // A day belongs to one group in a set: picking it here takes it from the others.
            const others = s.groups
              .filter((x) => x.key !== g.key)
              .map((x) => ({ ...x, days: x.days.filter((d) => !g.days.includes(d)) }))
              .filter((x) => x.days.length > 0);
            return { ...s, groups: [...others, g].sort((a, b) => a.days[0] - b.days[0]) };
          });
          setEditing(null);
        }}
        onRemove={(key) => {
          if (!editingSet) return;
          updateSet(editingSet.key, (s) => ({ ...s, groups: s.groups.filter((x) => x.key !== key) }));
          setEditing(null);
        }}
      />
      <DatesSheet
        set={datesSet}
        onClose={() => setDates(null)}
        onSave={(season) => {
          if (datesSet) updateSet(datesSet.key, (s) => ({ ...s, season }));
          setDates(null);
        }}
        onRemove={
          sets.length > 1
            ? () => {
                if (datesSet) updateSet(datesSet.key, () => null);
                setDates(null);
              }
            : undefined
        }
      />
    </SafeAreaView>
  );
}

/* Edit a group of days (Page-Hours-Row) ------------------------------------------------- */

type OpeningDraft = { key: string; start: string; end: string };

function DaySheet({
  set,
  group,
  onClose,
  onSave,
  onRemove,
}: {
  set: HoursSet | null;
  group: DayGroup | null;
  onClose: () => void;
  onSave: (g: DayGroup) => void;
  onRemove: (key: string) => void;
}) {
  return (
    <Sheet visible={set !== null} onClose={onClose}>
      {set ? <DayForm key={group?.key ?? 'new'} set={set} group={group} onClose={onClose} onSave={onSave} onRemove={onRemove} /> : null}
    </Sheet>
  );
}

function DayForm({
  set,
  group,
  onClose,
  onSave,
  onRemove,
}: {
  set: HoursSet;
  group: DayGroup | null;
  onClose: () => void;
  onSave: (g: DayGroup) => void;
  onRemove: (key: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const c = useColors();
  const daysLabel = useDaysLabel();
  const takenElsewhere = new Set(set.groups.filter((g) => g.key !== group?.key).flatMap((g) => g.days));
  const [days, setDays] = useState<number[]>(group?.days ?? WEEK.filter((d) => !takenElsewhere.has(d)).slice(0, 1));
  const [openings, setOpenings] = useState<OpeningDraft[]>(
    (group?.openings ?? [{ start: '', end: '' }]).map((o) => ({ key: newKey(), ...o })),
  );
  const [note, setNote] = useState(group?.note ?? '');
  const [error, setError] = useState<string | null>(null);

  const letter = (d: number) =>
    new Intl.DateTimeFormat(i18n.language, { weekday: 'narrow', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 0, 4 + d)));
  const full = (d: number) =>
    new Intl.DateTimeFormat(i18n.language, { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 0, 4 + d)));

  const done = () => {
    setError(null);
    if (days.length === 0) return setError(t('pageHours.pickDays'));
    const clean: Opening[] = [];
    for (const o of openings) {
      const start = normalizeTime(o.start);
      const end = normalizeTime(o.end);
      if (!start || !end) return setError(t('pageHours.timeFormat'));
      if (start === end) return setError(t('pageHours.sameTimes'));
      clean.push({ start, end });
    }
    if (clean.length === 0) return setError(t('pageHours.openingNeeded'));
    clean.sort((a, b) => a.start.localeCompare(b.start));
    onSave({ key: group?.key ?? newKey(), days: [...days].sort((a, b) => a - b), openings: clean, note: note.trim() });
  };

  return (
    <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled">
      <SheetHead title={group ? t('pageHours.editTitle') : t('pageHours.addTitle')} onClose={onClose} />

      <View style={styles.section}>
        <Text variant="label" color="textSecondary">
          {t('pageHours.days')}
        </Text>
        <View style={styles.dayRow}>
          {WEEK.map((d) => {
            const on = days.includes(d);
            const taken = takenElsewhere.has(d);
            return (
              <Pressable
                key={d}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                accessibilityLabel={taken ? t('pageHours.dayTaken', { day: full(d) }) : full(d)}
                onPress={() => setDays((all) => (on ? all.filter((x) => x !== d) : [...all, d]))}
                style={[
                  styles.day,
                  { borderColor: c.border, backgroundColor: on ? c.text : c.surfaceRaised },
                  taken && !on && styles.dashed,
                ]}
              >
                <Text variant="body" style={{ color: on ? c.surface : taken ? c.textSecondary : c.text, fontFamily: fontFamily.sansSemiBold }}>
                  {letter(d)}
                </Text>
              </Pressable>
            );
          })}
        </View>
        {takenElsewhere.size ? (
          <Text variant="bodySm" color="textSecondary">
            {t('pageHours.daysTakenNote')}
          </Text>
        ) : null}
      </View>

      <View style={styles.section}>
        <Text variant="label" color="textSecondary">
          {t('pageHours.openings')}
        </Text>
        {openings.map((o, i) => (
          <View key={o.key} style={styles.openingRow}>
            <View style={styles.flex}>
              <TextField
                label={t('pageHours.opens')}
                value={o.start}
                onChangeText={(v) => setOpenings((all) => all.map((x) => (x.key === o.key ? { ...x, start: v } : x)))}
                placeholder="10:00"
                keyboardType="numbers-and-punctuation"
                maxLength={5}
              />
            </View>
            <View style={styles.flex}>
              <TextField
                label={t('pageHours.closes')}
                value={o.end}
                onChangeText={(v) => setOpenings((all) => all.map((x) => (x.key === o.key ? { ...x, end: v } : x)))}
                placeholder="17:00"
                keyboardType="numbers-and-punctuation"
                maxLength={5}
              />
            </View>
            {openings.length > 1 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('pageHours.removeOpening', { n: i + 1 })}
                onPress={() => setOpenings((all) => all.filter((x) => x.key !== o.key))}
                hitSlop={4}
                style={({ pressed }) => [styles.removeOpening, pressed && styles.pressed]}
              >
                <Icon name="close" color={c.text} size={20} />
              </Pressable>
            ) : null}
          </View>
        ))}
        {openings.length < 4 ? (
          <Chip
            label={t('pageHours.addOpening')}
            picked={false}
            dashed
            trailing="add"
            onPress={() => setOpenings((all) => [...all, { key: newKey(), start: '', end: '' }])}
          />
        ) : null}
        <Text variant="bodySm" color="textSecondary">
          {t('pageHours.openingsNote')}
        </Text>
      </View>

      <View style={styles.section}>
        <TextField
          label={t('pageHours.note')}
          labelNote={t('pageHours.optional')}
          value={note}
          onChangeText={setNote}
          maxLength={MAX_HOURS_NOTE}
          placeholder={t('pageHours.notePlaceholder')}
          hint={t('pageHours.noteHint')}
        />
      </View>

      {error ? (
        <Text variant="bodySm" color="statusClosed" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}

      <Button label={t('pageHours.done')} onPress={done} />
      {group ? (
        <Button
          variant="secondary"
          label={t('pageHours.removeGroup', { days: daysLabel(group.days) })}
          onPress={() => onRemove(group.key)}
          palette={{ fill: 'transparent', text: c.danger, border: c.danger }}
        />
      ) : null}
    </ScrollView>
  );
}

/* A set's dates (Page-Hours-Seasons) ---------------------------------------------------- */

function DatesSheet({
  set,
  onClose,
  onSave,
  onRemove,
}: {
  set: HoursSet | null;
  onClose: () => void;
  onSave: (s: Season) => void;
  onRemove?: () => void;
}) {
  return (
    <Sheet visible={set !== null} onClose={onClose}>
      {set?.season ? <DatesForm key={set.key} season={set.season} onClose={onClose} onSave={onSave} onRemove={onRemove} /> : null}
    </Sheet>
  );
}

function DatesForm({ season, onClose, onSave, onRemove }: { season: Season; onClose: () => void; onSave: (s: Season) => void; onRemove?: () => void }) {
  const { t, i18n } = useTranslation();
  const c = useColors();
  const [start, setStart] = useState({ month: season.startMonth, day: String(season.startDay) });
  const [end, setEnd] = useState({ month: season.endMonth, day: String(season.endDay) });
  const [error, setError] = useState<string | null>(null);
  const monthName = (m: number) => new Intl.DateTimeFormat(i18n.language, { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, m - 1, 1)));

  const done = () => {
    const sd = Number(start.day);
    const ed = Number(end.day);
    if (!Number.isInteger(sd) || sd < 1 || sd > monthDays(start.month) || !Number.isInteger(ed) || ed < 1 || ed > monthDays(end.month)) {
      setError(t('pageHours.dayOfMonth'));
      return;
    }
    onSave({ startMonth: start.month, startDay: sd, endMonth: end.month, endDay: ed });
  };

  const boundary = (
    label: string,
    value: { month: number; day: string },
    set: (v: { month: number; day: string }) => void,
  ) => (
    <View style={styles.section}>
      <Text variant="label" color="textSecondary">
        {label}
      </Text>
      <View style={styles.months}>
        {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
          <Chip key={m} label={monthName(m)} picked={value.month === m} onPress={() => set({ ...value, month: m })} />
        ))}
      </View>
      <View style={styles.dayField}>
        <TextInput
          accessibilityLabel={t('pageHours.dayOf', { label, month: monthName(value.month) })}
          value={value.day}
          onChangeText={(v) => set({ ...value, day: v.replace(/\D/g, '') })}
          keyboardType="number-pad"
          maxLength={2}
          style={[styles.dayInput, { borderColor: c.border, backgroundColor: c.surfaceRaised, color: c.text }]}
        />
        <Text variant="body" color="textSecondary">
          {monthName(value.month)}
        </Text>
      </View>
    </View>
  );

  return (
    <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled">
      <SheetHead title={t('pageHours.datesTitle')} onClose={onClose} />
      {boundary(t('pageHours.from'), start, setStart)}
      {boundary(t('pageHours.to'), end, setEnd)}
      <Text variant="bodySm" color="textSecondary">
        {t('pageHours.datesNote')}
      </Text>
      {error ? (
        <Text variant="bodySm" color="statusClosed" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
      <Button label={t('pageHours.done')} onPress={done} />
      {onRemove ? (
        <Button
          variant="secondary"
          label={t('pageHours.removeDates')}
          onPress={onRemove}
          palette={{ fill: 'transparent', text: c.danger, border: c.danger }}
        />
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  pressed: { opacity: 0.75 },
  top: { paddingHorizontal: space[4], paddingVertical: space[2] },
  block: { paddingHorizontal: space[4], gap: space[3], paddingTop: space[4] },
  loading: { marginTop: space[12] },
  content: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: space[12], gap: 20 },
  section: { gap: space[2] },
  link: { fontFamily: fontFamily.sansSemiBold },
  segments: { flexDirection: 'row', borderWidth: stroke.rule },
  segment: { flex: 1, minHeight: size.tapMin, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  setHead: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  square: { width: size.tapMin, height: size.tapMin, borderWidth: stroke.rule, alignItems: 'center', justifyContent: 'center' },
  row: { minHeight: 56, borderBottomWidth: 1, flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: space[2] },
  times: { alignItems: 'flex-end', gap: 2 },
  closedRow: { minHeight: size.tapMin, borderBottomWidth: 1, justifyContent: 'center' },
  add: { minHeight: size.tapMin, flexDirection: 'row', alignItems: 'center', gap: 6 },
  warning: { borderWidth: stroke.rule, padding: space[3], flexDirection: 'row', gap: space[2], alignItems: 'flex-start' },
  sheetBody: { paddingHorizontal: 20, paddingBottom: space[4], gap: 18 },
  dayRow: { flexDirection: 'row', gap: 4 },
  day: { flex: 1, height: size.tapMin, borderWidth: stroke.rule, alignItems: 'center', justifyContent: 'center' },
  dashed: { borderStyle: 'dashed' },
  openingRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space[2] },
  removeOpening: { width: size.tapMin, height: size.tapMin, alignItems: 'center', justifyContent: 'center' },
  months: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  dayField: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  dayInput: { width: 72, height: size.tapMin, borderWidth: stroke.rule, paddingHorizontal: space[3], fontSize: 16 },
});
