/**
 * The upload queue.
 *
 * Creating a post writes the post row (unpublished) and its photo slide rows
 * right away, then hands each slide's media to this queue. The post goes
 * public on its own (a database trigger) once every slide is ready.
 *
 * - The queue is saved to AsyncStorage, and files live in the app's own
 *   documents folder, so closing the app loses nothing: on the next launch
 *   it checks where each slide got to and carries on.
 * - On iOS uploads run in a background URL session, so they keep going when
 *   the app is in the background.
 * - Failed attempts retry with backoff (2 s, 4 s, 8 s … up to 5 min), and
 *   right away when the connection comes back or the app is reopened.
 * - A retry uploads the slide's file again from the start (no byte-level
 *   resume); photos are small and clips are at most 60 s.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { File, UploadType } from 'expo-file-system';
import { FunctionsHttpError } from '@supabase/supabase-js';
import * as Network from 'expo-network';
import { AppState } from 'react-native';
import { useSyncExternalStore } from 'react';

import { env } from './env';
import { deleteLocalFile, type MediaKind, type PreparedMedia } from './media';
import { hasTags, setSlideTags, type SlideTags } from './posts';
import { Sentry } from './sentry';
import { supabase } from './supabase';
import { uuid } from './uuid';

const STORAGE_KEY = 'grindylocks.uploads.v1';
const MAX_BACKOFF_MS = 5 * 60_000;
/** How long the app itself polls Stream for a clip to finish encoding. */
const PROCESSING_POLL_MS = [3000, 5000, 8000, 13000, 20000, 30000];
const PROCESSING_POLL_LIMIT_MS = 10 * 60_000;

export type SlideJobState = 'waiting' | 'uploading' | 'processing' | 'done' | 'failed';
/** Why a slide failed for good (no automatic retry). */
export type SlideError = 'tooLong' | 'videoNotConfigured' | 'rejected';

export type SlideJob = {
  position: number;
  kind: MediaKind;
  /** Photos: known up front. Clips: assigned by the stream-upload function. */
  slideId: string | null;
  file: string;
  mimeType: string;
  width: number;
  height: number;
  durationS?: number;
  state: SlideJobState;
  attempts: number;
  nextAttemptAt: number;
  error?: SlideError;
  /** Set while a clip waits on Stream; when we started waiting. */
  processingSince?: number;
  /** 0–1, while uploading in this app session. Not saved. */
  progress?: number;
  /**
   * Tags picked in the posting flow. They're saved once the slide row exists:
   * right away for photos, and once the upload service has made the row for
   * clips. Saving tags never holds up the upload.
   */
  tags?: SlideTags;
  tagsSaved?: boolean;
};

export type PostJob = {
  userId: string;
  postId: string;
  createdAt: string;
  caption: string;
  parkId?: string | null;
  slides: SlideJob[];
};

type Snapshot = { posts: PostJob[] };

/* Store ---------------------------------------------------------------------- */

let snapshot: Snapshot = { posts: [] };
const listeners = new Set<() => void>();

function emit(next: Snapshot) {
  snapshot = next;
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

async function persist() {
  // Progress is session-only; everything else survives a restart.
  const saved = snapshot.posts.map((p) => ({
    ...p,
    slides: p.slides.map(({ progress: _progress, ...rest }) => rest),
  }));
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(saved)).catch(() => undefined);
}

function updateSlide(postId: string, position: number, patch: Partial<SlideJob>) {
  emit({
    posts: snapshot.posts.map((p) =>
      p.postId !== postId
        ? p
        : { ...p, slides: p.slides.map((s) => (s.position === position ? { ...s, ...patch } : s)) },
    ),
  });
  if (!('progress' in patch) || Object.keys(patch).length > 1) void persist();
}

function findSlide(postId: string, position: number): SlideJob | undefined {
  return snapshot.posts.find((p) => p.postId === postId)?.slides.find((s) => s.position === position);
}

/**
 * Saves a slide's tags once its row exists. Best effort: a failure is logged
 * and tried again on the next pass, and never stops the upload.
 */
async function saveTagsIfNeeded(postId: string, position: number) {
  const slide = findSlide(postId, position);
  if (!slide || !slide.slideId || slide.tagsSaved || !slide.tags || !hasTags(slide.tags)) return;
  try {
    await setSlideTags(slide.slideId, slide.tags);
    updateSlide(postId, position, { tagsSaved: true });
  } catch (err) {
    Sentry.captureException(err);
  }
}

/** Posts drop out of the queue once every slide is done. */
function pruneFinished() {
  const done = snapshot.posts.filter((p) => p.slides.every((s) => s.state === 'done'));
  if (done.length === 0) return;
  for (const p of done) for (const s of p.slides) deleteLocalFile(s.file);
  emit({ posts: snapshot.posts.filter((p) => !done.includes(p)) });
  void persist();
}

/* Errors ---------------------------------------------------------------------- */

class PermanentError extends Error {
  constructor(public reason: SlideError) {
    super(reason);
  }
}

async function functionError(error: unknown): Promise<{ status: number; body: Record<string, unknown> } | null> {
  if (error instanceof FunctionsHttpError) {
    const res = error.context as Response;
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
  }
  return null;
}

/* Upload steps ---------------------------------------------------------------- */

async function accessToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('signed out');
  return token;
}

async function uploadPhoto(job: PostJob, slide: SlideJob) {
  const path = `${job.userId}/${job.postId}/${slide.slideId}.jpg`;
  const token = await accessToken();
  const task = new File(slide.file).createUploadTask(
    `${env.supabaseUrl}/storage/v1/object/post-media/${path}`,
    {
      httpMethod: 'POST',
      uploadType: UploadType.BINARY_CONTENT,
      mimeType: 'image/jpeg',
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: env.supabasePublishableKey,
        'content-type': 'image/jpeg',
        'x-upsert': 'true',
      },
      sessionType: 'background',
      onProgress: ({ bytesSent, totalBytes }) =>
        updateSlide(job.postId, slide.position, { progress: totalBytes > 0 ? bytesSent / totalBytes : 0 }),
    },
  );
  const res = await task.uploadAsync();
  if (res.status < 200 || res.status >= 300) {
    // 4xx other than auth/rate limits means the storage rules said no.
    if (res.status === 400 || res.status === 403 || res.status === 413) throw new PermanentError('rejected');
    throw new Error(`photo upload ${res.status}`);
  }
  const { error } = await supabase
    .from('post_slides')
    .update({ upload_status: 'ready' })
    .eq('id', slide.slideId!);
  if (error) throw error;
  updateSlide(job.postId, slide.position, { state: 'done', progress: 1 });
}

/** A fresh one-time Stream URL; creates the slide row the first time. */
async function videoUploadUrl(job: PostJob, slide: SlideJob): Promise<{ slideId: string; url: string }> {
  const body = slide.slideId
    ? { slide_id: slide.slideId }
    : {
        post_id: job.postId,
        position: slide.position,
        width: slide.width,
        height: slide.height,
        duration_s: slide.durationS,
      };
  const { data, error } = await supabase.functions.invoke('stream-upload', { body });
  if (error) {
    const info = await functionError(error);
    if (info?.status === 503) throw new PermanentError('videoNotConfigured');
    if (info?.status === 422) throw new PermanentError('tooLong');
    // The slide was created on an earlier attempt whose reply got lost.
    if (info?.status === 409 && typeof info.body.slide_id === 'string') {
      updateSlide(job.postId, slide.position, { slideId: info.body.slide_id });
      return videoUploadUrl(job, { ...slide, slideId: info.body.slide_id });
    }
    // Already uploaded (e.g. the background session finished it).
    if (info?.status === 409 && info.body.error === 'already_uploaded') {
      throw new AlreadyUploaded();
    }
    throw error;
  }
  const slideId = data.slide_id as string;
  if (!slide.slideId) updateSlide(job.postId, slide.position, { slideId });
  return { slideId, url: data.upload_url as string };
}

class AlreadyUploaded extends Error {}

async function videoStatus(slideId: string): Promise<{ status: string; tooLong?: boolean }> {
  const { data, error } = await supabase.functions.invoke('stream-status', { body: { slide_id: slideId } });
  if (error) {
    const info = await functionError(error);
    if (info?.status === 503) throw new PermanentError('videoNotConfigured');
    throw error;
  }
  return { status: data.status as string, tooLong: Boolean(data.too_long) };
}

async function uploadVideo(job: PostJob, slide: SlideJob) {
  // A retry, or a restart: the last upload may have finished on its own in
  // the background session, so ask Stream before uploading again.
  if (slide.slideId) {
    const { status } = await videoStatus(slide.slideId).catch(() => ({ status: 'unknown' }));
    if (status === 'processing' || status === 'ready') {
      updateSlide(job.postId, slide.position, { state: 'processing', processingSince: Date.now() });
      return;
    }
  }

  let target: { slideId: string; url: string };
  try {
    target = await videoUploadUrl(job, slide);
  } catch (err) {
    if (err instanceof AlreadyUploaded) {
      updateSlide(job.postId, slide.position, { state: 'processing', processingSince: Date.now() });
      return;
    }
    throw err;
  }

  const task = new File(slide.file).createUploadTask(target.url, {
    httpMethod: 'POST',
    uploadType: UploadType.MULTIPART,
    fieldName: 'file',
    mimeType: slide.mimeType,
    sessionType: 'background',
    onProgress: ({ bytesSent, totalBytes }) =>
      updateSlide(job.postId, slide.position, { progress: totalBytes > 0 ? bytesSent / totalBytes : 0 }),
  });
  const res = await task.uploadAsync();
  if (res.status < 200 || res.status >= 300) {
    // Stream answers 4xx when the clip breaks the rules set on the URL
    // (over 60 s, or over 200 MB).
    if (res.status === 400 || res.status === 413) throw new PermanentError('tooLong');
    throw new Error(`video upload ${res.status}`);
  }
  updateSlide(job.postId, slide.position, { state: 'processing', processingSince: Date.now(), progress: 1 });
}

/** Asks Stream (via our function) whether a processing clip is ready. */
async function checkProcessing(job: PostJob, slide: SlideJob) {
  if (!slide.slideId) return;
  const { status, tooLong } = await videoStatus(slide.slideId);
  if (status === 'ready') {
    updateSlide(job.postId, slide.position, { state: 'done' });
  } else if (status === 'failed') {
    throw new PermanentError(tooLong ? 'tooLong' : 'rejected');
  } else if (status === 'uploading') {
    // Stream never got the file: upload it again.
    updateSlide(job.postId, slide.position, { state: 'waiting', nextAttemptAt: Date.now() });
  }
}

/* Runner ----------------------------------------------------------------------- */

let running = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let started = false;

function backoff(attempts: number): number {
  return Math.min(MAX_BACKOFF_MS, 2000 * 2 ** Math.max(0, attempts - 1));
}

function nextPollDelay(slide: SlideJob, now: number): number | null {
  const since = slide.processingSince ?? now;
  if (now - since > PROCESSING_POLL_LIMIT_MS) return null; // leave it to the webhook
  const step = Math.min(slide.attempts, PROCESSING_POLL_MS.length - 1);
  return PROCESSING_POLL_MS[step];
}

/** Runs one due slide at a time; reschedules itself for the next one. */
async function run() {
  if (running) return;
  running = true;
  try {
    for (;;) {
      const net = await Network.getNetworkStateAsync().catch(() => null);
      if (net && net.isConnected === false) break; // the network listener kicks us

      const now = Date.now();
      const due = snapshot.posts
        .flatMap((p) => p.slides.map((s) => ({ p, s })))
        .find(
          ({ s }) =>
            (s.state === 'waiting' || s.state === 'uploading' || s.state === 'processing') &&
            s.nextAttemptAt <= now,
        );
      if (!due) break;
      const { p, s } = due;

      try {
        if (s.state === 'processing') {
          await checkProcessing(p, s);
          const after = findSlide(p.postId, s.position);
          if (after?.state === 'processing') {
            const delay = nextPollDelay(after, Date.now());
            updateSlide(p.postId, s.position, {
              attempts: after.attempts + 1,
              // After the polling window the webhook takes over; check again
              // on the next app launch.
              nextAttemptAt: delay === null ? Number.MAX_SAFE_INTEGER : Date.now() + delay,
            });
          }
        } else {
          updateSlide(p.postId, s.position, { state: 'uploading', progress: 0 });
          if (s.kind === 'photo') await uploadPhoto(p, s);
          else await uploadVideo(p, s);
          const after = findSlide(p.postId, s.position);
          if (after?.state === 'processing') {
            updateSlide(p.postId, s.position, { attempts: 0, nextAttemptAt: Date.now() + PROCESSING_POLL_MS[0] });
          }
        }
      } catch (err) {
        if (err instanceof PermanentError) {
          updateSlide(p.postId, s.position, { state: 'failed', error: err.reason, progress: undefined });
        } else {
          const attempts = s.attempts + 1;
          updateSlide(p.postId, s.position, {
            state: s.state === 'processing' ? 'processing' : 'waiting',
            attempts,
            nextAttemptAt: Date.now() + backoff(attempts),
            progress: undefined,
          });
        }
      }
      // Clips get their row from the upload service, so their tags go on now.
      await saveTagsIfNeeded(p.postId, s.position);
      pruneFinished();
    }
  } finally {
    running = false;
    schedule();
  }
}

function schedule() {
  if (timer) clearTimeout(timer);
  timer = null;
  const pending = snapshot.posts
    .flatMap((p) => p.slides)
    .filter((s) => s.state === 'waiting' || s.state === 'uploading' || s.state === 'processing')
    .map((s) => s.nextAttemptAt)
    .filter((t) => t < Number.MAX_SAFE_INTEGER);
  if (pending.length === 0) return;
  const wait = Math.max(0, Math.min(...pending) - Date.now());
  timer = setTimeout(() => void run(), wait);
}

/** Retry now: on reconnect, on return to the app, or when asked. */
function kick(resetBackoff = false) {
  if (resetBackoff) {
    const now = Date.now();
    emit({
      posts: snapshot.posts.map((p) => ({
        ...p,
        slides: p.slides.map((s) =>
          s.state === 'waiting' || s.state === 'uploading' || s.state === 'processing'
            ? { ...s, nextAttemptAt: now, processingSince: s.state === 'processing' ? now : s.processingSince }
            : s,
        ),
      })),
    });
  }
  void run();
}

/* Public API ------------------------------------------------------------------ */

export const uploads = {
  /**
   * Loads the saved queue for this member and starts working through it.
   * Call once the member is signed in and onboarded.
   */
  async start(userId: string) {
    const raw = await AsyncStorage.getItem(STORAGE_KEY).catch(() => null);
    let saved: PostJob[] = [];
    try {
      saved = raw ? (JSON.parse(raw) as PostJob[]) : [];
    } catch {
      saved = [];
    }
    // Slides that were mid-upload when the app closed are retried; the
    // upload step checks first whether the background session finished.
    const mine = saved
      .filter((p) => p.userId === userId)
      .map((p) => ({
        ...p,
        slides: p.slides.map((s) =>
          s.state === 'uploading' ? { ...s, state: 'waiting' as const, nextAttemptAt: 0 } : s,
        ),
      }));
    emit({ posts: mine });
    void persist();

    if (!started) {
      started = true;
      AppState.addEventListener('change', (state) => {
        if (state === 'active') kick(true);
      });
      Network.addNetworkStateListener((state) => {
        if (state.isConnected) kick(true);
      });
    }
    kick(true);
  },

  /** Clears the in-memory queue (on sign-out). Saved jobs stay for next time. */
  stop() {
    if (timer) clearTimeout(timer);
    timer = null;
    emit({ posts: [] });
  },

  /** Queues a freshly created post's media. */
  enqueue(job: PostJob) {
    emit({ posts: [...snapshot.posts.filter((p) => p.postId !== job.postId), job] });
    void persist();
    kick();
  },

  /** Retries a post's failed slides (and anything waiting) right away. */
  retry(postId: string) {
    const now = Date.now();
    emit({
      posts: snapshot.posts.map((p) =>
        p.postId !== postId
          ? p
          : {
              ...p,
              slides: p.slides.map((s) =>
                s.state === 'done'
                  ? s
                  : { ...s, state: 'waiting', error: undefined, attempts: 0, nextAttemptAt: now },
              ),
            },
      ),
    });
    void persist();
    kick();
  },

  /** Gives up on a post: deletes it and its local files. */
  async discard(postId: string) {
    const job = snapshot.posts.find((p) => p.postId === postId);
    await supabase.from('posts').update({ status: 'deleted' }).eq('id', postId);
    if (job) for (const s of job.slides) deleteLocalFile(s.file);
    emit({ posts: snapshot.posts.filter((p) => p.postId !== postId) });
    void persist();
  },
};

export function useUploads(): PostJob[] {
  return useSyncExternalStore(subscribe, () => snapshot.posts);
}

/* Creating a post ---------------------------------------------------------- */

/**
 * Writes the post (unpublished) and its photo slide rows, then queues the
 * media. Clip rows are created by the stream-upload function as each clip
 * starts uploading. Media must already be prepared (compressed or copied).
 */
export async function createPost(input: {
  userId: string;
  metroAreaId: string;
  caption: string;
  /** The park for every slide, if one was picked. */
  parkId?: string | null;
  media: (PreparedMedia & { slideId: string; tags?: SlideTags })[];
}): Promise<string> {
  const postId = uuid();
  const caption = input.caption.trim() || null;

  const { error: postError } = await supabase.from('posts').insert({
    id: postId,
    author_id: input.userId,
    // The database replaces this with the park's metro area when there's a park.
    metro_area_id: input.metroAreaId,
    park_id: input.parkId ?? null,
    caption,
    slide_count: input.media.length,
  });
  if (postError) throw postError;

  const photoRows = input.media
    .map((m, position) => ({ m, position }))
    .filter(({ m }) => m.kind === 'photo')
    .map(({ m, position }) => ({
      id: m.slideId,
      post_id: postId,
      position,
      kind: 'photo' as const,
      storage_path: `${input.userId}/${postId}/${m.slideId}.jpg`,
      width: m.width,
      height: m.height,
      upload_status: 'uploading' as const,
    }));
  if (photoRows.length > 0) {
    const { error } = await supabase.from('post_slides').insert(photoRows);
    if (error) {
      await supabase.from('posts').update({ status: 'deleted' }).eq('id', postId);
      throw error;
    }
  }

  // Photo rows exist now, so their tags can go on straight away.
  const photoTagsSaved = new Set<number>();
  for (const [position, m] of input.media.entries()) {
    if (m.kind !== 'photo' || !m.tags || !hasTags(m.tags)) continue;
    try {
      await setSlideTags(m.slideId, m.tags);
      photoTagsSaved.add(position);
    } catch (err) {
      // Tried again by the queue; never blocks posting.
      Sentry.captureException(err);
    }
  }

  uploads.enqueue({
    userId: input.userId,
    postId,
    createdAt: new Date().toISOString(),
    caption: caption ?? '',
    parkId: input.parkId ?? null,
    slides: input.media.map((m, position) => ({
      position,
      kind: m.kind,
      slideId: m.kind === 'photo' ? m.slideId : null,
      file: m.uri,
      mimeType: m.mimeType,
      width: m.width,
      height: m.height,
      durationS: m.durationS,
      state: 'waiting',
      attempts: 0,
      nextAttemptAt: 0,
      tags: m.tags,
      tagsSaved: photoTagsSaved.has(position),
    })),
  });
  return postId;
}

/** Overall progress of a queued post, 0–1, for a progress bar. */
export function postProgress(job: PostJob): number {
  const per = job.slides.map((s) =>
    s.state === 'done' || s.state === 'processing' ? 1 : s.state === 'uploading' ? (s.progress ?? 0) : 0,
  );
  return per.reduce((a, b) => a + b, 0) / Math.max(1, per.length);
}

export function postState(job: PostJob): 'uploading' | 'processing' | 'failed' {
  if (job.slides.some((s) => s.state === 'failed')) return 'failed';
  if (job.slides.every((s) => s.state === 'done' || s.state === 'processing')) return 'processing';
  return 'uploading';
}
