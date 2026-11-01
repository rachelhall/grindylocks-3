import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { HomePicker } from '@/components/home-picker';
import { Avatar } from '@/components/profile';
import { FormScreen } from '@/components/screen';
import { Button, Icon, TextField, Toggle } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { useDirectory } from '@/lib/parks';
import {
  BIO_MAX,
  bioLength,
  type Discipline,
  nextUsernameChange,
  pickAvatar,
  type Profile,
  PROFILE_DISCIPLINES,
  type ProfileChanges,
  ProfileSaveError,
  useMyProfile,
  useReservedUsernames,
  useSaveProfile,
} from '@/lib/profiles';
import { useUsernameCheck } from '@/lib/username';
import { fontFamily, size, space, stroke, Text, useColors } from '@/theme';

/** Edit profile (Nov 1): Cancel / Save, photo, username, bio, disciplines, home and meet-ups. */
export default function EditProfile() {
  const { t } = useTranslation();
  const c = useColors();
  const { session } = useAuth();
  const { data: profile, isError, refetch } = useMyProfile(session?.user.id);

  if (profile) return <EditForm profile={profile} />;
  return (
    <SafeAreaView style={[styles.flex, styles.centered, { backgroundColor: c.surface }]}>
      {isError ? (
        <>
          <Text variant="body" color="statusClosed">
            {t('errors.network')}
          </Text>
          <Button label={t('common.retry')} variant="secondary" onPress={() => void refetch()} />
          <Button label={t('post.cancel')} variant="tertiary" onPress={() => router.back()} />
        </>
      ) : (
        <ActivityIndicator color={c.text} accessibilityLabel={t('common.loading')} />
      )}
    </SafeAreaView>
  );
}

function EditForm({ profile }: { profile: Profile }) {
  const { t, i18n } = useTranslation();
  const c = useColors();
  const { session, refreshProfile } = useAuth();
  const userId = session?.user.id;
  const directory = useDirectory();
  const reserved = useReservedUsernames(userId);
  const save = useSaveProfile(userId);

  const [photo, setPhoto] = useState<string | null>(null);
  const [username, setUsername] = useState(profile.username);
  const [bio, setBio] = useState(profile.bio ?? '');
  const [disciplines, setDisciplines] = useState<Discipline[]>(profile.disciplines);
  const [home, setHome] = useState({ metroId: profile.homeMetro?.id ?? null, parkId: profile.homePark?.id ?? null });
  const [meetup, setMeetup] = useState(profile.openToMeetup);
  const [pickingHome, setPickingHome] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const name = username.trim();
  const { availability, markTaken } = useUsernameCheck(name, profile.username);
  const lockedUntil = nextUsernameChange(profile.usernameChangedAt);
  const takeBack = (reserved.data ?? []).filter((r) => r.username.toLowerCase() !== name.toLowerCase());
  const dateFormat = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' });

  const metroName = directory.data?.metros.find((m) => m.id === home.metroId)?.name ?? profile.homeMetro?.name;
  const parkName = home.parkId
    ? (directory.data?.parks.find((p) => p.id === home.parkId)?.display_name ??
      (home.parkId === profile.homePark?.id ? profile.homePark.name : undefined))
    : undefined;

  const trimmedBio = bio.trim();
  const changes: ProfileChanges = {};
  if (name !== profile.username) changes.username = name;
  if (trimmedBio !== (profile.bio ?? '')) changes.bio = trimmedBio || null;
  if ([...disciplines].sort().join() !== [...profile.disciplines].sort().join()) changes.disciplines = disciplines;
  if (home.metroId && home.metroId !== (profile.homeMetro?.id ?? null)) changes.home_metro_area_id = home.metroId;
  if (home.parkId !== (profile.homePark?.id ?? null)) changes.home_park_id = home.parkId;
  if (meetup !== profile.openToMeetup) changes.open_to_meetup = meetup;
  const dirty = Boolean(photo) || Object.keys(changes).length > 0;

  function toggleDiscipline(d: Discipline) {
    setDisciplines((current) => (current.includes(d) ? current.filter((x) => x !== d) : [...current, d]));
  }

  function onBioChange(value: string) {
    // Counted the way the database counts (an emoji is one character).
    setBio(bioLength(value) > BIO_MAX ? [...value].slice(0, BIO_MAX).join('') : value);
  }

  async function changePhoto() {
    try {
      const uri = await pickAvatar();
      if (uri) setPhoto(uri);
    } catch {
      Alert.alert(t('errors.generic'));
    }
  }

  function cancel() {
    if (!dirty) {
      router.back();
      return;
    }
    Alert.alert(t('editProfile.discardTitle'), undefined, [
      { text: t('editProfile.keepEditing'), style: 'cancel' },
      { text: t('editProfile.discard'), style: 'destructive', onPress: () => router.back() },
    ]);
  }

  async function submit() {
    setShowErrors(true);
    setError(null);
    const usernameOk = availability === 'unchanged' || availability === 'free';
    if (!usernameOk || disciplines.length === 0 || !home.metroId) return;
    if (!dirty) {
      router.back();
      return;
    }
    try {
      await save.mutateAsync({ changes, newPhoto: photo, oldPhotoPath: profile.avatarPath });
    } catch (e) {
      const reason = e instanceof ProfileSaveError ? e.reason : 'generic';
      if (reason === 'usernameTaken') markTaken(name);
      else if (reason === 'usernameCooldown') setError(t('editProfile.usernameCooldown'));
      else setError(t('errors.generic'));
      return;
    }
    await refreshProfile();
    if (changes.home_metro_area_id) {
      router.replace({
        pathname: '/say-hi',
        params: { metroId: changes.home_metro_area_id, parkId: home.parkId ?? '' },
      });
    } else {
      router.back();
    }
  }

  const usernameError =
    availability === 'taken'
      ? t('onboarding.username.taken')
      : availability === 'invalid' || (showErrors && !name)
        ? t('onboarding.username.invalid')
        : null;

  const badge =
    availability === 'free' ? (
      <View style={[styles.badge, { borderColor: c.statusOpen }]}>
        <Text variant="label" color="statusOpen">
          {t('onboarding.username.free')}
        </Text>
      </View>
    ) : availability === 'checking' ? (
      <Text variant="label" color="textSecondary">
        {t('onboarding.username.checking')}
      </Text>
    ) : null;

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: c.surface }]}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.bar}>
          <Pressable
            accessibilityRole="button"
            onPress={cancel}
            disabled={save.isPending}
            style={({ pressed }) => [styles.barButton, pressed && styles.pressed]}
          >
            <Text variant="body" style={{ fontFamily: fontFamily.sansSemiBold }}>
              {t('post.cancel')}
            </Text>
          </Pressable>
          <Text variant="title" accessibilityRole="header" style={styles.barTitle} numberOfLines={1}>
            {t('editProfile.title')}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ busy: save.isPending }}
            onPress={submit}
            disabled={save.isPending}
            style={({ pressed }) => [
              styles.saveButton,
              { backgroundColor: c.accent, borderColor: c.onAccent },
              pressed && styles.pressed,
            ]}
          >
            {save.isPending ? (
              <ActivityIndicator color={c.onAccent} />
            ) : (
              <Text variant="headline" style={{ color: c.onAccent, fontSize: 16 }}>
                {t('editProfile.save')}
              </Text>
            )}
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
          {error ? (
            <Text variant="bodySm" color="statusClosed" accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}

          <View style={styles.photoRow}>
            <Avatar path={profile.avatarPath} username={name || profile.username} localUri={photo} />
            <Pressable
              accessibilityRole="button"
              onPress={changePhoto}
              style={({ pressed }) => [styles.outlineButton, { borderColor: c.border }, pressed && styles.pressed]}
            >
              <Icon name="camera" color={c.text} size={20} />
              <Text variant="body" style={{ fontFamily: fontFamily.sansSemiBold }}>
                {t('editProfile.changePhoto')}
              </Text>
            </Pressable>
          </View>

          {/* Username */}
          <View style={styles.group}>
            <TextField
              label={t('onboarding.username.label')}
              prefix="@"
              value={username}
              onChangeText={(v) => setUsername(v.replace(/\s/g, ''))}
              editable={!lockedUntil}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="username-new"
              textContentType="username"
              maxLength={30}
              accessory={badge}
              error={usernameError}
            />
            {lockedUntil ? (
              <Text variant="bodySm" style={{ fontFamily: fontFamily.sansSemiBold }}>
                {t('editProfile.usernameLocked', { date: dateFormat.format(lockedUntil) })}
              </Text>
            ) : null}
            <Text variant="bodySm" color="textSecondary">
              {t('editProfile.usernameNote')}
            </Text>
            {takeBack.map((r) => (
              <Button
                key={r.username}
                variant="tertiary"
                label={t('editProfile.takeBack', { username: r.username })}
                note={t('editProfile.heldUntil', { date: dateFormat.format(new Date(r.reserved_until)) })}
                onPress={() => setUsername(r.username)}
                style={styles.inlineButton}
              />
            ))}
          </View>

          {/* Bio */}
          <View style={styles.group}>
            <View style={styles.labelRow}>
              <Text variant="bodySm" style={{ fontFamily: fontFamily.sansSemiBold }}>
                {t('editProfile.bio')}
              </Text>
              <Text variant="caption" color="textSecondary" accessibilityLabel={t('editProfile.bioCountLabel', { count: bioLength(bio), max: BIO_MAX })}>
                {`${bioLength(bio)} / ${BIO_MAX}`}
              </Text>
            </View>
            <TextInput
              accessibilityLabel={t('editProfile.bio')}
              value={bio}
              onChangeText={onBioChange}
              multiline
              placeholder={t('editProfile.bioPlaceholder')}
              placeholderTextColor={c.textMuted}
              selectionColor={c.accent}
              cursorColor={c.text}
              style={[styles.bio, { color: c.text, backgroundColor: c.surfaceRaised, borderColor: c.border }]}
            />
          </View>

          {/* Disciplines */}
          <View style={styles.group} accessibilityRole="list">
            <Text variant="bodySm" style={{ fontFamily: fontFamily.sansSemiBold }}>
              {t('editProfile.iSkate')}
            </Text>
            <View style={styles.disciplines}>
              {PROFILE_DISCIPLINES.map((d) => {
                const on = disciplines.includes(d);
                return (
                  <Pressable
                    key={d}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={t(`disciplines.${d}`)}
                    onPress={() => toggleDiscipline(d)}
                    style={({ pressed }) => [
                      styles.discipline,
                      on
                        ? { backgroundColor: c.accentSubtle, borderColor: c.border }
                        : { backgroundColor: 'transparent', borderColor: c.borderSubtle },
                      pressed && styles.pressed,
                    ]}
                  >
                    {on ? <Icon name="check" color={c.onAccentSubtle} size={18} /> : null}
                    <Text variant="body" style={{ color: on ? c.onAccentSubtle : c.text, fontFamily: fontFamily.sansSemiBold }}>
                      {t(`disciplines.${d}`)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {showErrors && disciplines.length === 0 ? (
              <Text variant="bodySm" color="statusClosed" accessibilityLiveRegion="polite">
                {t('onboarding.username.pickOne')}
              </Text>
            ) : null}
          </View>

          {/* Home city and park */}
          <View>
            <Text variant="bodySm" style={[styles.homeLabel, { fontFamily: fontFamily.sansSemiBold }]}>
              {t('editProfile.home')}
            </Text>
            <HomeRow
              title={t('onboarding.city.cityLabel')}
              value={metroName ?? ''}
              onPress={() => setPickingHome(true)}
              first
            />
            <HomeRow
              title={t('onboarding.city.parkLabel')}
              value={parkName ?? t('editProfile.noHomePark')}
              onPress={() => setPickingHome(true)}
            />
            <Text variant="bodySm" color="textSecondary" style={styles.homeNote}>
              {t('editProfile.homeNote')}
            </Text>
          </View>

          {/* Open to meeting up */}
          <View style={[styles.meetup, { backgroundColor: c.surfaceRaised }]}>
            <View style={styles.flex}>
              <Text variant="body" style={{ fontFamily: fontFamily.sansSemiBold }}>
                {t('profile.openToMeetup')}
              </Text>
              <Text variant="bodySm" color="textSecondary">
                {t('editProfile.meetupNote')}
              </Text>
            </View>
            <Toggle value={meetup} onChange={setMeetup} label={t('profile.openToMeetup')} fg={c.text} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal visible={pickingHome} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setPickingHome(false)}>
        <FormScreen
          header={
            <View style={styles.modalBar}>
              <Text variant="title" accessibilityRole="header">
                {t('editProfile.home')}
              </Text>
            </View>
          }
          footer={
            <Button label={t('editProfile.done')} onPress={() => setPickingHome(false)} disabled={!home.metroId} />
          }
        >
          <HomePicker metroId={home.metroId} parkId={home.parkId} onChange={setHome} showErrors />
        </FormScreen>
      </Modal>
    </SafeAreaView>
  );
}

function HomeRow({ title, value, onPress, first }: { title: string; value: string; onPress: () => void; first?: boolean }) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${value}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.homeRow,
        { borderColor: c.borderSubtle, borderTopWidth: first ? stroke.hairline : 0 },
        pressed && styles.pressed,
      ]}
    >
      <Text variant="body" style={{ fontFamily: fontFamily.sansSemiBold }}>
        {title}
      </Text>
      <View style={styles.homeValue}>
        <Text variant="body" color="textSecondary" numberOfLines={1} style={styles.shrink}>
          {value}
        </Text>
        <Icon name="chevron" color={c.textSecondary} size={20} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  centered: { alignItems: 'center', justifyContent: 'center', gap: space[4], padding: space[6] },
  pressed: { opacity: 0.75 },
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[2], paddingHorizontal: space[3], paddingTop: space[2] },
  barButton: { minHeight: size.tapMin, minWidth: size.tapMin, paddingHorizontal: space[2], justifyContent: 'center' },
  barTitle: { flexShrink: 1, fontSize: 18 },
  saveButton: { minHeight: size.tapMin, minWidth: 72, paddingHorizontal: space[4], borderWidth: stroke.rule, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: 20, paddingTop: space[4], paddingBottom: space[12], gap: space[6] },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: space[4] },
  outlineButton: { minHeight: size.tapMin, paddingHorizontal: space[4], borderWidth: stroke.rule, flexDirection: 'row', alignItems: 'center', gap: space[2] },
  group: { gap: 6 },
  badge: { borderWidth: stroke.rule, paddingHorizontal: 6, paddingVertical: 2 },
  inlineButton: { alignSelf: 'flex-start', paddingHorizontal: 0, alignItems: 'flex-start' },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  bio: {
    minHeight: 96,
    borderWidth: stroke.rule,
    paddingHorizontal: space[3],
    paddingVertical: 10,
    fontFamily: fontFamily.sans,
    fontSize: 16,
    lineHeight: 22,
    textAlignVertical: 'top',
  },
  disciplines: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  discipline: { minHeight: size.tapMin, paddingHorizontal: 14, borderWidth: stroke.rule, flexDirection: 'row', alignItems: 'center', gap: 6 },
  homeLabel: { paddingBottom: space[2] },
  homeRow: { minHeight: 56, borderBottomWidth: stroke.hairline, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[3] },
  homeValue: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 },
  shrink: { flexShrink: 1 },
  homeNote: { paddingTop: space[2] },
  meetup: { flexDirection: 'row', alignItems: 'center', gap: space[3], padding: space[3] },
  modalBar: { minHeight: size.tapMin, justifyContent: 'center' },
});
