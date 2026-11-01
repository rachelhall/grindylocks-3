/**
 * Tagging, shared by the posting flow and Edit post: the park picker, the
 * person picker, and one slide's obstacle and people tags (Post-Tag mockup).
 *
 * Tags are always optional. Nothing here blocks posting.
 */
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar } from '@/components/profile';
import { Button, Icon, TextField } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { type ObstacleType, useDirectorySearch, useParksByIds } from '@/lib/parks';
import { type PersonResult, searchPeople } from '@/lib/people';
import { type SlideTags, type TagObstacle, useSuggestObstacle, useTaggableObstacles } from '@/lib/posts';
import { fresh } from '@/lib/query';
import { Sentry } from '@/lib/sentry';
import { brand, fontFamily, size, space, stroke, Text, useColors } from '@/theme';

/** Obstacle types in the picker: every type except the street plaza placeholder. */
export const PICKABLE_TYPES: ObstacleType[] = [
  'rail', 'ledge', 'hubba', 'manual_pad', 'stairs', 'gap', 'bank', 'pyramid', 'fun_box', 'box', 'hip',
  'quarter_pipe', 'kicker', 'mini_ramp', 'half_pipe', 'vert_ramp', 'spine', 'bump', 'volcano', 'bowl',
  'pool', 'snake_run', 'ditch', 'full_pipe', 'pump_track', 'pole_jam', 'rainbow_bench', 'other',
];

/** How many of a park's obstacles show before "More". */
const OBSTACLES_SHOWN = 6;
const NAME_MAX = 60;

export type PickedPark = { id: string; name: string };

/* Small pieces --------------------------------------------------------------------- */

function ModalHeader({ title, onClose }: { title: string; onClose: () => void }) {
  const { t } = useTranslation();
  const c = useColors();
  return (
    <View style={styles.modalHeader}>
      <Text variant="title" accessibilityRole="header" style={styles.flex}>
        {title}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('common.close')}
        onPress={onClose}
        style={({ pressed }) => [styles.square, { backgroundColor: c.surfaceRaised }, pressed && styles.pressed]}
      >
        <Icon name="close" color={c.text} />
      </Pressable>
    </View>
  );
}

/** A choice chip: pink with a check when picked, outlined otherwise. */
export function Chip({
  label,
  picked,
  onPress,
  note,
}: {
  label: string;
  picked: boolean;
  onPress: () => void;
  note?: string;
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
        picked
          ? { backgroundColor: c.accent, borderColor: c.accent }
          : { backgroundColor: c.surfaceRaised, borderColor: c.textMuted },
        pressed && styles.pressed,
      ]}
    >
      {picked ? <Icon name="check" color={c.onAccent} size={14} /> : null}
      <Text
        variant="bodySm"
        style={{ fontFamily: fontFamily.sansSemiBold, color: picked ? c.onAccent : c.text }}
      >
        {label}
      </Text>
      {note ? (
        <Text variant="caption" style={{ color: picked ? c.onAccent : c.textSecondary }}>
          {note}
        </Text>
      ) : null}
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

/* Park ------------------------------------------------------------------------------- */

/** The ink park row at the top of Tag it: "City Heights · Park for every slide". */
export function ParkButton({ park, onPress }: { park: PickedPark | null; onPress: () => void }) {
  const { t } = useTranslation();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={park ? t('tagging.parkChange', { park: park.name }) : t('tagging.parkPick')}
      onPress={onPress}
      style={({ pressed }) => [styles.parkButton, pressed && styles.pressed]}
    >
      <Icon name="pin" color={brand.paper} size={20} />
      <View style={styles.flex}>
        <Text variant="headline" style={{ color: brand.paper }}>
          {park ? park.name : t('tagging.parkNone')}
        </Text>
        <Text variant="caption" style={{ color: '#B8B4AA' }}>
          {park ? t('tagging.parkEverySlide') : t('tagging.parkEncourage')}
        </Text>
      </View>
      <Icon name="chevron" color={brand.paper} size={18} />
    </Pressable>
  );
}

/**
 * Picks the post's park: your home park first, then search by name. "No
 * park" is always there, for garage sessions and street spots.
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
  const { profile } = useAuth();
  const [q, setQ] = useState('');
  const search = useDirectorySearch(q);
  const homeIds = profile?.home_park_id ? [profile.home_park_id] : [];
  const home = useParksByIds(homeIds);

  const results = q.trim().length >= 2 ? (search.data ?? []).filter((r) => r.kind === 'park') : [];
  const suggestions: { id: string; name: string; line: string }[] =
    q.trim().length >= 2
      ? results.map((r) => ({ id: r.id, name: r.name, line: r.detail }))
      : (home.data ?? []).map((p) => ({ id: p.id, name: p.display_name, line: t('tagging.homePark') }));

  function pick(park: PickedPark | null) {
    onPick(park);
    setQ('');
    onClose();
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={[styles.flex, { backgroundColor: c.surface }]}>
        <ModalHeader title={t('tagging.parkTitle')} onClose={onClose} />
        <View style={styles.modalBody}>
          <TextField
            label={t('tagging.parkSearch')}
            icon="search"
            value={q}
            onChangeText={setQ}
            autoCorrect={false}
            autoCapitalize="none"
            placeholder={t('tagging.parkSearchPlaceholder')}
          />
        </View>
        <FlatList
          data={suggestions}
          keyExtractor={(p) => p.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            <Row
              title={t('tagging.noPark')}
              line={t('tagging.noParkLine')}
              picked={current === null}
              onPress={() => pick(null)}
            />
          }
          renderItem={({ item }) => (
            <Row
              title={item.name}
              line={item.line}
              picked={current?.id === item.id}
              onPress={() => pick({ id: item.id, name: item.name })}
            />
          )}
          ListEmptyComponent={
            q.trim().length >= 2 && !search.isFetching ? (
              <Text variant="bodySm" color="textSecondary" style={styles.empty}>
                {t('search.noResults', { q: q.trim() })}
              </Text>
            ) : null
          }
        />
      </SafeAreaView>
    </Modal>
  );
}

function Row({
  title,
  line,
  picked,
  onPress,
  leading,
}: {
  title: string;
  line?: string;
  picked?: boolean;
  onPress: () => void;
  leading?: React.ReactNode;
}) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: Boolean(picked) }}
      accessibilityLabel={line ? `${title}, ${line}` : title}
      onPress={onPress}
      style={({ pressed }) => [styles.row, { backgroundColor: c.surfaceRaised }, pressed && styles.pressed]}
    >
      {leading}
      <View style={styles.flex}>
        <Text variant="headline">{title}</Text>
        {line ? (
          <Text variant="bodySm" color="textSecondary">
            {line}
          </Text>
        ) : null}
      </View>
      {picked ? <Icon name="check" color={c.text} /> : null}
    </Pressable>
  );
}

/* People ------------------------------------------------------------------------------- */

/** Finds a member by username to tag or credit. */
export function PersonPickerModal({
  visible,
  title,
  exclude,
  onClose,
  onPick,
}: {
  visible: boolean;
  title: string;
  exclude: string[];
  onClose: () => void;
  onPick: (person: { id: string; username: string }) => void;
}) {
  const { t } = useTranslation();
  const c = useColors();
  const [q, setQ] = useState('');
  const query = q.trim().replace(/^@+/, '');
  const { data, isFetching, isError } = useQuery({
    queryKey: ['people-search', query],
    queryFn: () => searchPeople(query),
    enabled: query.length >= 2,
    staleTime: fresh.search,
  });
  const results: PersonResult[] = (data ?? []).filter((p) => !exclude.includes(p.id));

  function pick(p: PersonResult) {
    onPick({ id: p.id, username: p.username });
    setQ('');
    onClose();
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={[styles.flex, { backgroundColor: c.surface }]}>
        <ModalHeader title={title} onClose={onClose} />
        <View style={styles.modalBody}>
          <TextField
            label={t('tagging.personSearch')}
            prefix="@"
            value={q}
            onChangeText={setQ}
            autoCorrect={false}
            autoCapitalize="none"
            autoFocus
          />
        </View>
        <FlatList
          data={query.length >= 2 ? results : []}
          keyExtractor={(p) => p.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <Row
              title={item.username}
              line={item.home_park_name ?? item.home_metro_name ?? undefined}
              onPress={() => pick(item)}
              leading={<Avatar path={null} username={item.username} size={36} />}
            />
          )}
          ListEmptyComponent={
            query.length < 2 ? (
              <Text variant="bodySm" color="textSecondary" style={styles.empty}>
                {t('tagging.personHint')}
              </Text>
            ) : isError ? (
              <Text variant="bodySm" color="statusClosed" style={styles.empty}>
                {t('find.error')}
              </Text>
            ) : !isFetching ? (
              <Text variant="bodySm" color="textSecondary" style={styles.empty}>
                {t('search.noResults', { q: query })}
              </Text>
            ) : null
          }
        />
      </SafeAreaView>
    </Modal>
  );
}

/* Obstacle type or suggestion ------------------------------------------------------- */

/**
 * "Not listed?": pick just a general type, or suggest the obstacle so a
 * park contributor can add it. A suggestion is tagged right away; others
 * see it once it's approved.
 */
function TypeOrSuggestModal({
  visible,
  parkId,
  current,
  onClose,
  onPickType,
  onSuggested,
}: {
  visible: boolean;
  parkId: string | null;
  current: ObstacleType | null;
  onClose: () => void;
  onPickType: (type: ObstacleType) => void;
  onSuggested: (o: TagObstacle) => void;
}) {
  const { t } = useTranslation();
  const c = useColors();
  const { session } = useAuth();
  const suggest = useSuggestObstacle(session?.user.id);
  const [type, setType] = useState<ObstacleType | null>(current);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!parkId || !type || !name.trim()) return;
    setError(null);
    try {
      const o = await suggest.mutateAsync({ parkId, name, type });
      onSuggested(o);
      setName('');
      onClose();
    } catch (err) {
      Sentry.captureException(err);
      setError(t('errors.generic'));
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={[styles.flex, { backgroundColor: c.surface }]}>
        <ModalHeader title={t('tagging.typeTitle')} onClose={onClose} />
        <ScrollView contentContainerStyle={styles.modalScroll} keyboardShouldPersistTaps="handled">
          <Text variant="bodySm" color="textSecondary">
            {parkId ? t('tagging.typeBody') : t('tagging.typeBodyNoPark')}
          </Text>
          <View style={styles.chips}>
            {PICKABLE_TYPES.map((ty) => (
              <Chip key={ty} label={t(`obstacleTypes.${ty}`)} picked={type === ty} onPress={() => setType(ty)} />
            ))}
          </View>
          <Button
            label={t('tagging.useType')}
            disabled={!type}
            onPress={() => {
              if (!type) return;
              onPickType(type);
              onClose();
            }}
          />
          {parkId ? (
            <View style={[styles.suggest, { borderTopColor: c.text }]}>
              <TagSectionTitle>{t('tagging.suggestTitle')}</TagSectionTitle>
              <TextField
                label={t('tagging.suggestName')}
                hint={t('tagging.suggestHint')}
                value={name}
                onChangeText={(v) => setName(v.slice(0, NAME_MAX))}
                placeholder={t('tagging.suggestPlaceholder')}
                error={error}
              />
              <Button
                label={t('tagging.suggestSend')}
                variant="secondary"
                loading={suggest.isPending}
                disabled={!type || !name.trim()}
                onPress={submit}
              />
            </View>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

/* One slide's tags ------------------------------------------------------------------- */

/**
 * The obstacle chips and people list for one slide. With a park, the park's
 * obstacles come first; without one, only general types can be picked.
 */
export function SlideTagEditor({
  parkId,
  tags,
  names,
  onChange,
  onName,
}: {
  parkId: string | null;
  tags: SlideTags;
  /** Usernames for the IDs in `tags`. */
  names: Record<string, string>;
  onChange: (next: SlideTags) => void;
  /** Remembers a username picked in the person picker. */
  onName: (id: string, username: string) => void;
}) {
  const { t } = useTranslation();
  const c = useColors();
  const { session } = useAuth();
  const obstacles = useTaggableObstacles(parkId, session?.user.id);
  const [showAll, setShowAll] = useState(false);
  const [typeOpen, setTypeOpen] = useState(false);
  const [personOpen, setPersonOpen] = useState<'person' | 'filmer' | null>(null);

  const list = obstacles.data ?? [];
  const picked = list.find((o) => o.id === tags.obstacleId);
  // The picked obstacle always shows, even past the cut-off.
  const shown = showAll
    ? list
    : [...list.slice(0, OBSTACLES_SHOWN), ...(picked && !list.slice(0, OBSTACLES_SHOWN).includes(picked) ? [picked] : [])];

  const everyone = [...(tags.filmerId ? [tags.filmerId] : []), ...tags.peopleIds];

  return (
    <View style={styles.editor}>
      <View style={styles.section}>
        <TagSectionTitle>{t('tagging.obstacle')}</TagSectionTitle>
        <View style={styles.chips}>
          {shown.map((o) => (
            <Chip
              key={o.id}
              label={o.name}
              note={o.pending ? t('tagging.pending') : undefined}
              picked={tags.obstacleId === o.id}
              onPress={() =>
                onChange({ ...tags, obstacleId: tags.obstacleId === o.id ? null : o.id, obstacleType: null })
              }
            />
          ))}
          {!showAll && list.length > shown.length ? (
            <Chip label={t('tagging.more')} picked={false} onPress={() => setShowAll(true)} />
          ) : null}
          {tags.obstacleType && !tags.obstacleId ? (
            <Chip
              label={t(`obstacleTypes.${tags.obstacleType}`)}
              note={t('tagging.typeOnly')}
              picked
              onPress={() => onChange({ ...tags, obstacleType: null })}
            />
          ) : null}
        </View>
        {parkId && list.length === 0 && !obstacles.isLoading ? (
          <Text variant="bodySm" color="textSecondary">
            {t('tagging.noObstacles')}
          </Text>
        ) : null}
        <Pressable accessibilityRole="button" onPress={() => setTypeOpen(true)} hitSlop={8}>
          <Text variant="bodySm" color="accentText" style={styles.link}>
            {parkId ? t('tagging.notListed') : t('tagging.pickType')}
          </Text>
        </Pressable>
      </View>

      <View style={styles.section}>
        <TagSectionTitle>{t('tagging.people')}</TagSectionTitle>
        {tags.filmerId ? (
          <PersonRow
            username={names[tags.filmerId] ?? '…'}
            filmer
            onToggleFilmer={() =>
              onChange({
                ...tags,
                filmerId: null,
                peopleIds: tags.peopleIds.includes(tags.filmerId!) ? tags.peopleIds : [...tags.peopleIds, tags.filmerId!],
              })
            }
            onRemove={() => onChange({ ...tags, filmerId: null })}
          />
        ) : null}
        {tags.peopleIds.map((id) => (
          <PersonRow
            key={id}
            username={names[id] ?? '…'}
            filmer={false}
            onToggleFilmer={() =>
              onChange({
                ...tags,
                // One filmer per slide: the old filmer goes back to the people list.
                filmerId: id,
                peopleIds: [...tags.peopleIds.filter((p) => p !== id), ...(tags.filmerId ? [tags.filmerId] : [])],
              })
            }
            onRemove={() => onChange({ ...tags, peopleIds: tags.peopleIds.filter((p) => p !== id) })}
          />
        ))}
        <View style={styles.addRow}>
          <Pressable
            accessibilityRole="button"
            onPress={() => setPersonOpen('person')}
            style={({ pressed }) => [styles.dashed, { borderColor: c.textSecondary }, pressed && styles.pressed]}
          >
            <Text variant="bodySm" style={{ fontFamily: fontFamily.sansSemiBold }}>
              {t('tagging.tagSomeone')}
            </Text>
          </Pressable>
          {!tags.filmerId ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => setPersonOpen('filmer')}
              style={({ pressed }) => [styles.dashed, { borderColor: c.textSecondary }, pressed && styles.pressed]}
            >
              <Text variant="bodySm" style={{ fontFamily: fontFamily.sansSemiBold }}>
                {t('tagging.addFilmer')}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      <TypeOrSuggestModal
        visible={typeOpen}
        parkId={parkId}
        current={tags.obstacleType}
        onClose={() => setTypeOpen(false)}
        onPickType={(type) => onChange({ ...tags, obstacleId: null, obstacleType: type })}
        onSuggested={(o) => onChange({ ...tags, obstacleId: o.id, obstacleType: null })}
      />
      <PersonPickerModal
        visible={personOpen !== null}
        title={personOpen === 'filmer' ? t('tagging.filmerTitle') : t('tagging.personTitle')}
        exclude={everyone}
        onClose={() => setPersonOpen(null)}
        onPick={(p) => {
          onName(p.id, p.username);
          if (personOpen === 'filmer') onChange({ ...tags, filmerId: p.id });
          else if (tags.peopleIds.length < 20) onChange({ ...tags, peopleIds: [...tags.peopleIds, p.id] });
        }}
      />
    </View>
  );
}

function PersonRow({
  username,
  filmer,
  onToggleFilmer,
  onRemove,
}: {
  username: string;
  filmer: boolean;
  onToggleFilmer: () => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const c = useColors();
  return (
    <View style={[styles.person, { backgroundColor: c.surfaceRaised }]}>
      <Avatar path={null} username={username} size={30} />
      <Text variant="body" numberOfLines={1} style={[styles.flex, { fontFamily: fontFamily.sansSemiBold }]}>
        {username}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected: filmer }}
        accessibilityLabel={filmer ? t('tagging.filmerOff', { username }) : t('tagging.filmerOn', { username })}
        onPress={onToggleFilmer}
        hitSlop={6}
        style={({ pressed }) => [
          styles.filmerTag,
          filmer ? { backgroundColor: c.text } : { borderColor: c.textSecondary, borderWidth: stroke.hairline },
          pressed && styles.pressed,
        ]}
      >
        <Text variant="label" style={{ color: filmer ? c.surface : c.textSecondary }}>
          {filmer ? t('tagging.filmer') : t('tagging.skating')}
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('tagging.removePerson', { username })}
        onPress={onRemove}
        style={({ pressed }) => [styles.removeButton, pressed && styles.pressed]}
      >
        <Icon name="close" color={c.text} size={18} />
      </Pressable>
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
  flex: { flex: 1 },
  pressed: { opacity: 0.75 },
  square: { width: size.tapMin, height: size.tapMin, alignItems: 'center', justifyContent: 'center' },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingHorizontal: space[4],
    paddingTop: space[4],
    paddingBottom: space[2],
  },
  modalBody: { paddingHorizontal: space[4], paddingBottom: space[3] },
  modalScroll: { padding: space[4], gap: space[4], paddingBottom: space[12] },
  list: { paddingHorizontal: space[4], paddingBottom: space[12], gap: 6 },
  empty: { paddingVertical: space[4] },
  row: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: space[3], paddingHorizontal: space[3], paddingVertical: space[2] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: space[3],
    borderWidth: stroke.rule,
  },
  sectionTitle: { fontFamily: fontFamily.sansSemiBold, letterSpacing: 0.5 },
  parkButton: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    backgroundColor: brand.ink,
  },
  editor: { gap: space[6] },
  section: { gap: space[2] },
  link: { fontFamily: fontFamily.sansSemiBold, paddingVertical: space[1] },
  suggest: { borderTopWidth: stroke.rule, paddingTop: space[4], gap: space[3] },
  person: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: space[3], paddingLeft: space[3] },
  filmerTag: { paddingHorizontal: 6, paddingVertical: 3 },
  removeButton: { width: size.tapMin, height: size.tapMin, alignItems: 'center', justifyContent: 'center' },
  addRow: { flexDirection: 'row', gap: space[2] },
  dashed: {
    flex: 1,
    minHeight: size.tapMin,
    borderWidth: stroke.rule,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space[2],
  },
});
