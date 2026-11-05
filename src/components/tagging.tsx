/**
 * Tagging, shared by the posting flow (Tag it) and Edit post: the park row,
 * one slide's Obstacle / People / Filmer rows, and the sheets they open.
 * Laid out from the "Built from the brief" mockups (Nov 2): Park picker,
 * Person picker, Obstacle sheet · pick one and Obstacle sheet · suggest one.
 *
 * Every picker is a sheet over a dimmed screen, with a grab bar, a title and
 * a close or Done button; the current choice sits on the pale pink with a
 * pink check box. Tags are always optional. Nothing here blocks posting.
 */
import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/avatar';
import { CheckBox, Icon, type IconName } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { type ObstacleType, useDirectorySearch, useMetro, useParksByIds } from '@/lib/parks';
import { searchPeople } from '@/lib/people';
import {
  type SlideTags,
  type TagObstacle,
  useParkRegulars,
  useRecentParks,
  useSuggestObstacle,
  useTaggableObstacles,
} from '@/lib/posts';
import type { Discipline } from '@/lib/profiles';
import { fresh } from '@/lib/query';
import { Sentry } from '@/lib/sentry';
import { useFollowing } from '@/lib/social';
import { fontFamily, size, space, stroke, Text, type ThemeColors, useColors } from '@/theme';

/** Obstacle types in the picker: every type except the street plaza placeholder. */
export const PICKABLE_TYPES: ObstacleType[] = [
  'rail', 'ledge', 'hubba', 'manual_pad', 'stairs', 'gap', 'bank', 'pyramid', 'fun_box', 'box', 'hip',
  'quarter_pipe', 'kicker', 'mini_ramp', 'half_pipe', 'vert_ramp', 'spine', 'bump', 'volcano', 'bowl',
  'pool', 'snake_run', 'ditch', 'full_pipe', 'pump_track', 'pole_jam', 'rainbow_bench', 'other',
];

/** The eight common types shown first when suggesting an obstacle. */
const COMMON_TYPES: ObstacleType[] = ['rail', 'ledge', 'hubba', 'stairs', 'box', 'bank', 'quarter_pipe', 'bowl'];

const NAME_MAX = 60;
const PEOPLE_MAX = 20;

export type PickedPark = { id: string; name: string };

/* Small pieces --------------------------------------------------------------------- */

/** A choice chip: pink with a check when picked, outlined otherwise. */
export function Chip({
  label,
  picked,
  onPress,
  note,
  dashed,
  trailing,
}: {
  label: string;
  picked: boolean;
  onPress: () => void;
  note?: string;
  dashed?: boolean;
  trailing?: IconName;
}) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: picked }}
      accessibilityLabel={note ? `${label}, ${note}` : label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        { borderColor: c.border, backgroundColor: picked ? c.accent : dashed ? 'transparent' : c.surfaceRaised },
        dashed && styles.dashedBorder,
        pressed && styles.pressed,
      ]}
    >
      {picked ? <Icon name="check" color={c.onAccent} size={14} /> : null}
      <Text variant="bodySm" style={{ fontFamily: fontFamily.sansSemiBold, color: picked ? c.onAccent : c.text }}>
        {label}
      </Text>
      {note ? (
        <Text variant="caption" style={{ color: picked ? c.onAccent : c.textSecondary }}>
          {note}
        </Text>
      ) : null}
      {trailing ? <Icon name={trailing} color={c.text} size={14} /> : null}
    </Pressable>
  );
}

/** Section label in the tagging screens ("OBSTACLE", "PEOPLE"). */
export function TagSectionTitle({ children }: { children: string }) {
  return (
    <Text variant="bodySm" accessibilityRole="header" style={styles.sectionTitle}>
      {children.toUpperCase()}
    </Text>
  );
}

/** Small uppercase caption above a group in a sheet ("YOUR HOME PARK"). */
export function Caption({ children }: { children: string }) {
  return (
    <Text variant="label" color="textSecondary" accessibilityRole="header" style={styles.caption}>
      {children}
    </Text>
  );
}

/** The pink check box on the current choice, or nothing. */
function Picked({ on, c }: { on: boolean; c: ThemeColors }) {
  return on ? <CheckBox checked c={c} /> : null;
}

/**
 * A sheet over a dimmed screen (Nov 2 mockups): grab bar, an Archivo Black
 * title, and Close (✕) or a Done button. Tapping the dimmed strip closes it.
 */
export function Sheet({
  visible,
  title,
  onClose,
  done,
  onBack,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  /** Shows an ink Done button instead of ✕. */
  done?: boolean;
  /** Shows a back arrow before the title (a second step). */
  onBack?: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const c = useColors();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={onBack ?? onClose}>
      <View style={[styles.flex, { backgroundColor: c.overlay }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
          onPress={onClose}
          style={{ height: insets.top + 52 }}
        />
        <View
          accessibilityViewIsModal
          style={[styles.sheet, { backgroundColor: c.surface, borderTopColor: c.border, paddingBottom: insets.bottom }]}
        >
          <View style={styles.grab} accessibilityElementsHidden importantForAccessibility="no">
            <View style={[styles.grabBar, { backgroundColor: c.text }]} />
          </View>
          <View style={styles.sheetHeader}>
            {onBack ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('common.back')}
                onPress={onBack}
                style={({ pressed }) => [styles.square, { backgroundColor: c.surfaceRaised }, pressed && styles.pressed]}
              >
                <Icon name="back" color={c.text} size={22} />
              </Pressable>
            ) : null}
            <Text variant="title" accessibilityRole="header" numberOfLines={2} style={styles.flex}>
              {title}
            </Text>
            {done ? (
              <Pressable
                accessibilityRole="button"
                onPress={onClose}
                style={({ pressed }) => [styles.doneButton, { backgroundColor: c.text }, pressed && styles.pressed]}
              >
                <Text variant="body" style={{ color: c.surface, fontFamily: fontFamily.sansSemiBold }}>
                  {t('tagging.done')}
                </Text>
              </Pressable>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('common.close')}
                onPress={onClose}
                style={({ pressed }) => [styles.square, { backgroundColor: c.surfaceRaised }, pressed && styles.pressed]}
              >
                <Icon name="close" color={c.text} size={22} />
              </Pressable>
            )}
          </View>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
            {children}
          </KeyboardAvoidingView>
        </View>
      </View>
    </Modal>
  );
}

/** The search box at the top of a sheet: a 2px outline with a search icon. */
export function SearchBox({ value, onChangeText, placeholder }: { value: string; onChangeText: (v: string) => void; placeholder: string }) {
  const c = useColors();
  return (
    <View style={styles.searchWrap}>
      <View style={styles.searchIcon}>
        <Icon name="search" color={c.textSecondary} size={20} />
      </View>
      <TextInput
        accessibilityLabel={placeholder}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={c.textMuted}
        autoCorrect={false}
        autoCapitalize="none"
        selectionColor={c.accent}
        cursorColor={c.text}
        style={[styles.search, { color: c.text, borderColor: c.border, backgroundColor: c.surfaceRaised }]}
      />
    </View>
  );
}

/** One choice in a sheet: icon or avatar, a name and a line, and the check. */
function Option({
  leading,
  title,
  line,
  picked,
  disabled,
  trailing,
  onPress,
  first,
  accessibilityRole = 'button',
}: {
  leading?: ReactNode;
  title: string;
  line?: string | null;
  picked?: boolean;
  disabled?: boolean;
  trailing?: ReactNode;
  onPress?: () => void;
  first?: boolean;
  accessibilityRole?: 'button' | 'radio' | 'checkbox';
}) {
  const c = useColors();
  const ink = picked ? c.onAccentSubtle : disabled ? c.textSecondary : c.text;
  const sub = picked ? c.onAccentSubtle : c.textSecondary;
  return (
    <Pressable
      accessibilityRole={accessibilityRole}
      accessibilityState={{ checked: accessibilityRole === 'button' ? undefined : Boolean(picked), disabled }}
      accessibilityLabel={line ? `${title}, ${line}` : title}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.option,
        { borderBottomColor: c.borderSubtle },
        first && { borderTopWidth: stroke.hairline, borderTopColor: c.borderSubtle },
        picked && { backgroundColor: c.accentSubtle },
        pressed && styles.pressed,
      ]}
    >
      {leading}
      <View style={styles.flex}>
        <Text variant="body" numberOfLines={1} style={{ color: ink, fontFamily: fontFamily.sansSemiBold }}>
          {title}
        </Text>
        {line ? (
          <Text variant="caption" numberOfLines={2} style={{ color: sub }}>
            {line}
          </Text>
        ) : null}
      </View>
      {trailing ?? <Picked on={Boolean(picked)} c={c} />}
    </Pressable>
  );
}

/* Park ------------------------------------------------------------------------------- */

/**
 * The park picker sheet (Park picker mockup): search by name, then your
 * home park, then Recent (parks you've posted at), then No park, which
 * says the post shows under your home city and not on a park page.
 */
export function ParkPickerModal({
  visible,
  current,
  onClose,
  onPick,
}: {
  visible: boolean;
  current: PickedPark | null;
  onClose: () => void;
  onPick: (park: PickedPark | null) => void;
}) {
  const { t } = useTranslation();
  const c = useColors();
  const { profile, session } = useAuth();
  const [q, setQ] = useState('');
  const searching = q.trim().length >= 2;
  const search = useDirectorySearch(q);
  const home = useParksByIds(profile?.home_park_id ? [profile.home_park_id] : []);
  const recent = useRecentParks(visible ? session?.user.id : undefined);
  const metro = useMetro(profile?.home_metro_area_id);

  const homePark = (home.data ?? [])[0];
  const recentParks = (recent.data ?? []).filter((p) => p.id !== homePark?.id);
  const results = searching ? (search.data ?? []).filter((r) => r.kind === 'park') : [];
  const line = (type: string, city: string) => `${t(`park.type.${type}` as 'park.type.skatepark')} · ${city}`;

  function pick(park: PickedPark | null) {
    onPick(park);
    setQ('');
    onClose();
  }

  const pin = (name: IconName) => <Icon name={name} color={c.text} size={22} />;

  return (
    <Sheet visible={visible} title={t('tagging.parkTitle')} onClose={onClose}>
      <SearchBox value={q} onChangeText={setQ} placeholder={t('tagging.parkSearchPlaceholder')} />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheetList}>
        {searching ? (
          <>
            <Caption>{t('tagging.results')}</Caption>
            {results.map((r, i) => (
              <Option
                key={r.id}
                first={i === 0}
                accessibilityRole="radio"
                leading={pin('pin')}
                title={r.name}
                line={r.detail}
                picked={current?.id === r.id}
                onPress={() => pick({ id: r.id, name: r.name })}
              />
            ))}
            {results.length === 0 && !search.isFetching ? (
              <Text variant="bodySm" color="textSecondary" style={styles.empty}>
                {t('search.noResults', { q: q.trim() })}
              </Text>
            ) : null}
          </>
        ) : (
          <>
            {homePark ? (
              <>
                <Caption>{t('tagging.homePark')}</Caption>
                <Option
                  first
                  accessibilityRole="radio"
                  leading={pin('homePin')}
                  title={homePark.display_name}
                  line={line(homePark.park_type, homePark.city)}
                  picked={current?.id === homePark.id}
                  onPress={() => pick({ id: homePark.id, name: homePark.display_name })}
                />
              </>
            ) : null}
            {recentParks.length > 0 ? (
              <>
                <Caption>{t('tagging.recent')}</Caption>
                {recentParks.map((p, i) => (
                  <Option
                    key={p.id}
                    first={i === 0}
                    accessibilityRole="radio"
                    leading={pin('pin')}
                    title={p.name}
                    line={line(p.type, p.city)}
                    picked={current?.id === p.id}
                    onPress={() => pick({ id: p.id, name: p.name })}
                  />
                ))}
              </>
            ) : null}
            {current && current.id !== homePark?.id && !recentParks.some((p) => p.id === current.id) ? (
              <>
                <Caption>{t('tagging.currentPark')}</Caption>
                <Option first accessibilityRole="radio" leading={pin('pin')} title={current.name} picked onPress={() => pick(current)} />
              </>
            ) : null}
          </>
        )}
        <Caption>{t('tagging.notAtPark')}</Caption>
        <Option
          first
          accessibilityRole="radio"
          leading={pin('pinOff')}
          title={t('tagging.noPark')}
          line={metro.data ? t('tagging.noParkLineMetro', { metro: metro.data.name }) : t('tagging.noParkLineHome')}
          picked={current === null}
          onPress={() => pick(null)}
        />
      </ScrollView>
    </Sheet>
  );
}

/* People ------------------------------------------------------------------------------- */

type PickerPerson = { id: string; username: string; avatarPath: string | null; line: string | null };

/**
 * The person picker sheet (Person picker mockup), for one slide's people or
 * its filmer: search, chips for who's already on the slide, then You follow
 * and Regulars at this park. The filmer can't also be a people tag, so in
 * People the slide's filmer shows greyed as "Filmer on this slide" (and in
 * Filmer, people tags show greyed as "Tagged on this slide"). Blocked
 * people never appear: search, follows and regulars all leave them out.
 */
function PersonPickerSheet({
  visible,
  mode,
  slideNumber,
  parkId,
  parkName,
  tags,
  names,
  onChange,
  onName,
  onClose,
}: {
  visible: boolean;
  mode: 'people' | 'filmer';
  slideNumber: number;
  parkId: string | null;
  parkName: string | null;
  tags: SlideTags;
  names: Record<string, string>;
  onChange: (next: SlideTags) => void;
  onName: (id: string, username: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const c = useColors();
  const { session } = useAuth();
  const [q, setQ] = useState('');
  const query = q.trim().replace(/^@+/, '');
  const searching = query.length >= 2;
  const search = useQuery({
    queryKey: ['people-search', query],
    queryFn: () => searchPeople(query),
    enabled: visible && searching,
    staleTime: fresh.search,
  });
  const following = useFollowing(session?.user.id, visible);
  const regulars = useParkRegulars(visible ? (parkId ?? undefined) : undefined);

  const disciplineLine = (ds: Discipline[] | null | undefined, place?: string | null) =>
    [...(ds ?? []).map((d) => t(`disciplines.${d}`)), ...(place ? [place] : [])].join(' · ') || null;

  const followed: PickerPerson[] = (following.data ?? []).map((p) => ({
    id: p.id,
    username: p.username,
    avatarPath: p.avatarPath,
    line: disciplineLine(p.disciplines),
  }));
  const followedIds = new Set(followed.map((p) => p.id));
  const locals: PickerPerson[] = (regulars.data ?? [])
    .filter((r) => !followedIds.has(r.id))
    .map((r) => ({ id: r.id, username: r.username, avatarPath: r.avatar_path, line: disciplineLine(r.disciplines, parkName) }));
  const found: PickerPerson[] = (search.data ?? []).map((p) => ({
    id: p.id,
    username: p.username,
    avatarPath: null,
    line: disciplineLine(p.disciplines, p.home_park_name ?? p.home_metro_name),
  }));

  const chosen = mode === 'people' ? tags.peopleIds : tags.filmerId ? [tags.filmerId] : [];
  const blockedBy = (id: string) =>
    mode === 'people' ? (tags.filmerId === id ? 'filmer' : null) : tags.peopleIds.includes(id) ? 'tagged' : null;

  function toggle(p: PickerPerson) {
    onName(p.id, p.username);
    if (mode === 'people') {
      const on = tags.peopleIds.includes(p.id);
      if (!on && tags.peopleIds.length >= PEOPLE_MAX) return;
      onChange({ ...tags, peopleIds: on ? tags.peopleIds.filter((x) => x !== p.id) : [...tags.peopleIds, p.id] });
    } else {
      onChange({ ...tags, filmerId: tags.filmerId === p.id ? null : p.id });
    }
  }

  function close() {
    setQ('');
    onClose();
  }

  const renderPerson = (p: PickerPerson, i: number) => {
    const reason = blockedBy(p.id);
    const on = chosen.includes(p.id);
    return (
      <Option
        key={p.id}
        first={i === 0}
        accessibilityRole="checkbox"
        leading={<Avatar path={p.avatarPath} username={p.username} size={36} />}
        title={p.username}
        line={reason === 'filmer' ? t('tagging.filmerOnSlide') : reason === 'tagged' ? t('tagging.taggedOnSlide') : p.line}
        picked={on}
        disabled={reason !== null}
        trailing={
          reason === 'filmer' ? (
            <Icon name="video" color={c.textSecondary} size={20} />
          ) : reason === 'tagged' ? (
            <Icon name="people" color={c.textSecondary} size={20} />
          ) : (
            <CheckBox checked={on} c={c} />
          )
        }
        onPress={() => toggle(p)}
      />
    );
  };

  const title =
    mode === 'people'
      ? t('tagging.peopleTitle', { number: slideNumber })
      : t('tagging.filmerSheetTitle', { number: slideNumber });

  return (
    <Sheet visible={visible} title={title} onClose={close} done>
      <SearchBox value={q} onChangeText={setQ} placeholder={t('tagging.personSearchPlaceholder')} />
      {chosen.length > 0 ? (
        <View style={styles.chosen} accessibilityLabel={t('tagging.onThisSlide')}>
          {chosen.map((id) => {
            const username = names[id] ?? '…';
            return (
              <Pressable
                key={id}
                accessibilityRole="button"
                accessibilityLabel={t('tagging.removePerson', { username })}
                onPress={() =>
                  onChange(
                    mode === 'people'
                      ? { ...tags, peopleIds: tags.peopleIds.filter((x) => x !== id) }
                      : { ...tags, filmerId: null },
                  )
                }
                style={({ pressed }) => [
                  styles.chosenChip,
                  { backgroundColor: c.accentSubtle, borderColor: c.border },
                  pressed && styles.pressed,
                ]}
              >
                <Text variant="bodySm" style={{ color: c.onAccentSubtle, fontFamily: fontFamily.sansSemiBold }}>
                  {username}
                </Text>
                <Icon name="close" color={c.onAccentSubtle} size={16} />
              </Pressable>
            );
          })}
        </View>
      ) : null}
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheetList}>
        {searching ? (
          <>
            <Caption>{t('tagging.results')}</Caption>
            {found.map(renderPerson)}
            {search.isError ? (
              <Text variant="bodySm" color="statusClosed" style={styles.empty}>
                {t('find.error')}
              </Text>
            ) : found.length === 0 && !search.isFetching ? (
              <Text variant="bodySm" color="textSecondary" style={styles.empty}>
                {t('search.noResults', { q: query })}
              </Text>
            ) : null}
          </>
        ) : (
          <>
            {followed.length > 0 ? (
              <>
                <Caption>{t('tagging.youFollow')}</Caption>
                {followed.map(renderPerson)}
              </>
            ) : null}
            {locals.length > 0 && parkName ? (
              <>
                <Caption>{t('tagging.regularsAt', { park: parkName })}</Caption>
                {locals.map(renderPerson)}
              </>
            ) : null}
            {followed.length === 0 && locals.length === 0 && !following.isPending ? (
              <Text variant="bodySm" color="textSecondary" style={styles.empty}>
                {t('tagging.personHint')}
              </Text>
            ) : null}
          </>
        )}
      </ScrollView>
    </Sheet>
  );
}

/* Obstacle ------------------------------------------------------------------------------ */

/**
 * The obstacle sheet (Obstacle sheet mockups). Step one lists the park's
 * obstacles with their type (street plaza placeholders can't be tagged, so
 * they're left out), then "Not listed?" with Just the type and Suggest an
 * obstacle, and No obstacle on this slide at the bottom. Suggesting asks
 * what locals call it and its type; the clip is tagged right away and
 * others see the tag once a contributor at the park approves it.
 */
function ObstacleSheet({
  visible,
  slideNumber,
  parkId,
  parkName,
  tags,
  onChange,
  onClose,
}: {
  visible: boolean;
  slideNumber: number;
  parkId: string | null;
  parkName: string | null;
  tags: SlideTags;
  onChange: (next: SlideTags) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const c = useColors();
  const { session } = useAuth();
  const obstacles = useTaggableObstacles(visible ? parkId : null, session?.user.id);
  const suggest = useSuggestObstacle(session?.user.id);
  const [step, setStep] = useState<'list' | 'type' | 'suggest'>('list');
  const [name, setName] = useState('');
  const [type, setType] = useState<ObstacleType | null>(null);
  const [allTypes, setAllTypes] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    setStep('list');
    setName('');
    setType(null);
    setAllTypes(false);
    setError(null);
    onClose();
  }

  function choose(next: SlideTags) {
    onChange(next);
    close();
  }

  async function submit() {
    if (!parkId || !type || !name.trim()) return;
    setError(null);
    try {
      const o: TagObstacle = await suggest.mutateAsync({ parkId, name, type });
      choose({ ...tags, obstacleId: o.id, obstacleType: null });
    } catch (err) {
      Sentry.captureException(err);
      setError(t('errors.generic'));
    }
  }

  const list = obstacles.data ?? [];
  const typeLabel = (ty: ObstacleType) => t(`obstacleTypes.${ty}`);

  // One sheet for all three steps, so moving between them doesn't re-open it.
  const sheet = (title: string, body: ReactNode, back?: boolean) => (
    <Sheet visible={visible} title={title} onClose={close} onBack={back ? () => setStep('list') : undefined}>
      {body}
    </Sheet>
  );

  if (step === 'type') {
    return sheet(
      t('tagging.typeTitle'),
      <>
        <ScrollView contentContainerStyle={styles.sheetBody}>
          <View style={styles.chips}>
            {PICKABLE_TYPES.map((ty) => (
              <Chip
                key={ty}
                label={typeLabel(ty)}
                picked={!tags.obstacleId && tags.obstacleType === ty}
                onPress={() => choose({ ...tags, obstacleId: null, obstacleType: ty })}
              />
            ))}
          </View>
        </ScrollView>
      </>,
      true,
    );
  }

  if (step === 'suggest' && parkId) {
    const shownTypes = allTypes ? PICKABLE_TYPES : COMMON_TYPES;
    return sheet(
      t('tagging.suggestRow'),
      <>
        <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled">
          {parkName ? (
            <Text variant="bodySm" color="textSecondary">
              {t('tagging.atPark', { park: parkName })}
            </Text>
          ) : null}
          <View style={styles.field}>
            <Text variant="label" color="textSecondary">
              {t('tagging.suggestName')}
            </Text>
            <TextInput
              accessibilityLabel={t('tagging.suggestName')}
              value={name}
              onChangeText={(v) => setName(v.slice(0, NAME_MAX))}
              placeholder={t('tagging.suggestPlaceholder')}
              placeholderTextColor={c.textMuted}
              selectionColor={c.accent}
              cursorColor={c.text}
              style={[styles.input, { color: c.text, borderColor: c.border, backgroundColor: c.surfaceRaised }]}
            />
          </View>
          <View style={styles.field}>
            <Text variant="label" color="textSecondary">
              {t('tagging.suggestType')}
            </Text>
            <View style={styles.chips}>
              {shownTypes.map((ty) => (
                <Chip key={ty} label={typeLabel(ty)} picked={type === ty} onPress={() => setType(ty)} />
              ))}
              {/* A picked type stays visible when the list is short again. */}
              {!allTypes && type && !COMMON_TYPES.includes(type) ? (
                <Chip label={typeLabel(type)} picked onPress={() => setType(null)} />
              ) : null}
              <Chip
                label={allTypes ? t('tagging.fewerTypes') : t('tagging.allTypes', { count: PICKABLE_TYPES.length })}
                picked={false}
                dashed
                trailing={allTypes ? undefined : 'chevronDown'}
                onPress={() => setAllTypes((v) => !v)}
              />
            </View>
          </View>
          <View style={[styles.note, { backgroundColor: c.surfaceRaised, borderColor: c.borderSubtle }]}>
            <Icon name="info" color={c.text} size={20} />
            <Text variant="bodySm" style={styles.flex}>
              {t('tagging.suggestNote')}
            </Text>
          </View>
          {error ? (
            <Text variant="bodySm" color="statusClosed" accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}
        </ScrollView>
        <View style={styles.sheetFooter}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !type || !name.trim() || suggest.isPending, busy: suggest.isPending }}
            disabled={!type || !name.trim() || suggest.isPending}
            onPress={submit}
            style={({ pressed }) => [
              styles.bigButton,
              { backgroundColor: c.accent, borderColor: c.border },
              (!type || !name.trim()) && styles.disabled,
              pressed && styles.pressed,
            ]}
          >
            <Text variant="body" style={{ color: c.onAccent, fontFamily: fontFamily.sansSemiBold }}>
              {t('tagging.suggestSend')}
            </Text>
          </Pressable>
        </View>
      </>,
      true,
    );
  }

  return sheet(
    t('tagging.obstacleTitle', { number: slideNumber }),
    <>
      <ScrollView contentContainerStyle={styles.sheetList}>
        {parkId && parkName ? (
          <>
            <Caption>{t('tagging.atPark', { park: parkName })}</Caption>
            {list.map((o, i) => (
              <Option
                key={o.id}
                first={i === 0}
                accessibilityRole="radio"
                title={o.name}
                line={o.pending ? t('tagging.pending') : null}
                picked={tags.obstacleId === o.id}
                trailing={
                  <View style={styles.optionEnd}>
                    <View style={[styles.typeTag, { borderColor: tags.obstacleId === o.id ? c.onAccentSubtle : c.border }]}>
                      <Text variant="label" style={{ color: tags.obstacleId === o.id ? c.onAccentSubtle : c.text, fontSize: 11 }}>
                        {typeLabel(o.type)}
                      </Text>
                    </View>
                    <Picked on={tags.obstacleId === o.id} c={c} />
                  </View>
                }
                onPress={() => choose({ ...tags, obstacleId: o.id, obstacleType: null })}
              />
            ))}
            {list.length === 0 && !obstacles.isLoading ? (
              <Text variant="bodySm" color="textSecondary" style={styles.empty}>
                {t('tagging.noObstacles')}
              </Text>
            ) : null}
          </>
        ) : null}

        <Caption>{parkId ? t('tagging.notListedTitle') : t('tagging.pickType')}</Caption>
        <Option
          first
          leading={<Icon name="category" color={c.text} size={22} />}
          title={tags.obstacleType && !tags.obstacleId ? typeLabel(tags.obstacleType) : t('tagging.justType')}
          line={tags.obstacleType && !tags.obstacleId ? t('tagging.typeOnly') : t('tagging.justTypeLine')}
          picked={Boolean(tags.obstacleType && !tags.obstacleId)}
          trailing={<Icon name="chevron" color={c.textSecondary} size={20} />}
          onPress={() => setStep('type')}
        />
        {parkId ? (
          <Option
            leading={<Icon name="addPin" color={c.text} size={22} />}
            title={t('tagging.suggestRow')}
            line={t('tagging.suggestRowLine')}
            trailing={<Icon name="chevron" color={c.textSecondary} size={20} />}
            onPress={() => setStep('suggest')}
          />
        ) : null}
      </ScrollView>
      <View style={styles.sheetFooter}>
        <Pressable
          accessibilityRole="button"
          onPress={() => choose({ ...tags, obstacleId: null, obstacleType: null })}
          style={({ pressed }) => [styles.bigButton, { borderColor: c.border }, pressed && styles.pressed]}
        >
          <Text variant="body" style={{ fontFamily: fontFamily.sansSemiBold }}>
            {t('tagging.noObstacleSlide')}
          </Text>
        </Pressable>
      </View>
    </>,
  );
}

/* Rows ------------------------------------------------------------------------------- */

/** A row with an icon, a name, its value and a chevron. */
function TagRow({
  icon,
  title,
  value,
  placeholder,
  onPress,
  line,
}: {
  icon: IconName;
  title: string;
  value: string | null;
  placeholder: string;
  onPress: () => void;
  line?: string;
}) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${value ?? placeholder}`}
      onPress={onPress}
      style={({ pressed }) => [styles.tagRow, { borderBottomColor: c.borderSubtle }, pressed && styles.pressed]}
    >
      <Icon name={icon} color={c.text} size={22} />
      {line ? (
        <View style={styles.flex}>
          <Text variant="headline" numberOfLines={1}>
            {value ?? placeholder}
          </Text>
          <Text variant="caption" color="textSecondary">
            {line}
          </Text>
        </View>
      ) : (
        <>
          <Text variant="body" style={styles.tagRowTitle}>
            {title}
          </Text>
          <Text
            variant="body"
            numberOfLines={1}
            color={value ? 'text' : 'textSecondary'}
            style={[styles.flex, value ? { fontFamily: fontFamily.sansSemiBold } : null]}
          >
            {value ?? placeholder}
          </Text>
        </>
      )}
      <Icon name="chevron" color={c.textSecondary} size={18} />
    </Pressable>
  );
}

/**
 * The park as a light row: "City Heights · Park · every slide". Edit post
 * passes its own line, warning that changing it clears obstacle tags.
 */
export function ParkRow({ park, onPress, line }: { park: PickedPark | null; onPress: () => void; line?: string }) {
  const { t } = useTranslation();
  const c = useColors();
  return (
    <View style={[styles.parkRow, { backgroundColor: c.surfaceRaised, borderTopColor: c.borderSubtle }]}>
      <TagRow
        icon="pin"
        title={t('tagging.park')}
        value={park?.name ?? null}
        placeholder={t('tagging.parkNone')}
        line={park ? (line ?? t('tagging.parkLine')) : t('tagging.parkEncourage')}
        onPress={onPress}
      />
    </View>
  );
}

/**
 * One slide's tags as three rows: Obstacle opens the obstacle sheet; People
 * and Filmer open the person picker for that slide.
 */
export function SlideTagRows({
  slideNumber,
  parkId,
  parkName,
  tags,
  names,
  onChange,
  onName,
}: {
  slideNumber: number;
  parkId: string | null;
  parkName: string | null;
  tags: SlideTags;
  names: Record<string, string>;
  onChange: (next: SlideTags) => void;
  onName: (id: string, username: string) => void;
}) {
  const { t } = useTranslation();
  const { session } = useAuth();
  const obstacles = useTaggableObstacles(parkId, session?.user.id);
  const [open, setOpen] = useState<'obstacle' | 'people' | 'filmer' | null>(null);

  const obstacle = obstacles.data?.find((o) => o.id === tags.obstacleId);
  const obstacleValue = obstacle
    ? obstacle.name
    : tags.obstacleType
      ? t(`obstacleTypes.${tags.obstacleType}`)
      : null;
  const people = tags.peopleIds.map((id) => names[id] ?? '…');
  const peopleValue =
    people.length === 0
      ? null
      : people.length === 1
        ? people[0]
        : t('tagging.peopleMore', { first: people[0], count: people.length - 1 });
  const filmerValue = tags.filmerId ? (names[tags.filmerId] ?? '…') : null;

  return (
    <View>
      <TagRow
        icon="obstacle"
        title={t('tagging.obstacle')}
        value={obstacleValue}
        placeholder={t('tagging.noObstacle')}
        onPress={() => setOpen('obstacle')}
      />
      <TagRow
        icon="people"
        title={t('tagging.people')}
        value={peopleValue}
        placeholder={t('tagging.noPeople')}
        onPress={() => setOpen('people')}
      />
      <TagRow
        icon="video"
        title={t('tagging.filmer')}
        value={filmerValue}
        placeholder={t('tagging.noFilmer')}
        onPress={() => setOpen('filmer')}
      />

      <ObstacleSheet
        visible={open === 'obstacle'}
        slideNumber={slideNumber}
        parkId={parkId}
        parkName={parkName}
        tags={tags}
        onChange={onChange}
        onClose={() => setOpen(null)}
      />
      <PersonPickerSheet
        visible={open === 'people' || open === 'filmer'}
        mode={open === 'filmer' ? 'filmer' : 'people'}
        slideNumber={slideNumber}
        parkId={parkId}
        parkName={parkName}
        tags={tags}
        names={names}
        onChange={onChange}
        onName={onName}
        onClose={() => setOpen(null)}
      />
    </View>
  );
}

/* Summary --------------------------------------------------------------------------- */

/** "Backyard pool · kaito.rolls · filmed by soulsofi", or null for no tags. */
export function useTagSummary(parkId: string | null) {
  const { t } = useTranslation();
  const { session } = useAuth();
  const obstacles = useTaggableObstacles(parkId, session?.user.id);
  return (tags: SlideTags, names: Record<string, string>): string | null => {
    const parts: string[] = [];
    const o = obstacles.data?.find((x) => x.id === tags.obstacleId);
    if (o) parts.push(o.name);
    else if (tags.obstacleType) parts.push(t(`obstacleTypes.${tags.obstacleType}`));
    for (const id of tags.peopleIds) parts.push(names[id] ?? '…');
    if (tags.filmerId) parts.push(t('tagging.filmedBy', { username: names[tags.filmerId] ?? '…' }));
    return parts.length ? parts.join(' · ') : null;
  };
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.75 },
  disabled: { opacity: 0.5 },
  square: { width: size.tapMin, height: size.tapMin, alignItems: 'center', justifyContent: 'center' },
  sheet: { flex: 1, borderTopWidth: stroke.rule },
  grab: { alignItems: 'center', paddingTop: space[2] },
  grabBar: { width: 40, height: 4 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingHorizontal: space[4], paddingTop: space[2], paddingBottom: space[2] },
  doneButton: { minHeight: size.tapMin, paddingHorizontal: space[4], alignItems: 'center', justifyContent: 'center' },
  sheetList: { paddingBottom: space[12] },
  sheetBody: { padding: space[4], gap: space[4], paddingBottom: space[12] },
  sheetFooter: { paddingHorizontal: space[4], paddingTop: space[3], paddingBottom: space[4] },
  bigButton: { minHeight: 52, borderWidth: stroke.rule, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space[4] },
  caption: { paddingHorizontal: 20, paddingTop: space[4], paddingBottom: 6 },
  empty: { paddingHorizontal: 20, paddingVertical: space[4] },
  searchWrap: { paddingHorizontal: space[4], justifyContent: 'center' },
  searchIcon: { position: 'absolute', left: space[4] + 12, zIndex: 1 },
  search: { height: size.tapMin, borderWidth: stroke.rule, paddingLeft: 42, paddingRight: space[3], fontFamily: fontFamily.sans, fontSize: 16 },
  option: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingHorizontal: 20,
    paddingVertical: space[2],
    borderBottomWidth: stroke.hairline,
  },
  optionEnd: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  typeTag: { borderWidth: stroke.hairline, paddingHorizontal: 6, paddingVertical: 2 },
  chosen: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], paddingHorizontal: space[4], paddingTop: space[3] },
  chosenChip: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 4, paddingLeft: space[3], paddingRight: 6, borderWidth: stroke.rule },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  chip: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 14, borderWidth: stroke.rule },
  dashedBorder: { borderStyle: 'dashed' },
  field: { gap: 6 },
  input: { height: size.tapMin, borderWidth: stroke.rule, paddingHorizontal: space[3], fontFamily: fontFamily.sans, fontSize: 16 },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: space[3], borderWidth: stroke.hairline },
  sectionTitle: { fontFamily: fontFamily.sansSemiBold, letterSpacing: 0.5 },
  tagRow: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingHorizontal: space[4],
    paddingVertical: space[2],
    borderBottomWidth: stroke.hairline,
  },
  tagRowTitle: { width: 84, fontFamily: fontFamily.sansSemiBold },
  parkRow: { borderTopWidth: stroke.hairline },
});
