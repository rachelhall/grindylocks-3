/**
 * Grindylocks media layer, app side: picking, preparing and showing photos
 * and clips. The server side is supabase/functions/_shared/stream.ts.
 *
 * - Photos are re-encoded to JPEG (at most 2048 px on the long edge) before
 *   upload, so HEIC and PNG come out as JPEG and every phone can show them.
 * - Clips go to Cloudflare Stream. On iOS the picker transcodes them to
 *   1080p HEVC first; Android uploads the original file.
 * - Feeds crop to one frame shape per post (v2, Nov 2): the first slide
 *   sets it, between 4:5 and 1.91:1, and each slide stores where it sits in
 *   that frame (`frame_x`, `frame_y`). The full media is never lost: width
 *   and height are stored per slide and the full-screen viewer shows it
 *   uncropped.
 */
import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { env } from './env';
import { supabase } from './supabase';

/** Same limits as the database and the stream-upload function. */
export const MAX_SLIDES = 10;
export const MAX_CLIP_SECONDS = 60;
/** Stream's limit for a single direct upload. */
export const MAX_VIDEO_BYTES = 200 * 1024 * 1024;
const PHOTO_MAX_EDGE = 2048;
const PHOTO_QUALITY = 0.82;

export type MediaKind = 'photo' | 'video';

/** One picked item, before upload. */
export type PickedMedia = {
  key: string;
  kind: MediaKind;
  uri: string;
  width: number;
  height: number;
  /** Clips only, in seconds. */
  durationS?: number;
  mimeType?: string;
  fileSize?: number;
};

export type Rejection = 'tooLong' | 'tooBig' | 'unsupported';

const PHOTO_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/heic', 'image/heif'];
const VIDEO_TYPES = ['video/quicktime', 'video/mp4'];
const PHOTO_EXTENSIONS = ['jpg', 'jpeg', 'png', 'heic', 'heif'];
const VIDEO_EXTENSIONS = ['mov', 'mp4', 'm4v'];

function extensionOf(uri: string, fileName?: string | null): string {
  const name = fileName ?? uri.split('?')[0];
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

/**
 * Opens the camera roll for up to `limit` photos and clips, in pick order.
 * `photosOnly` hides clips (park photos).
 */
export async function pickFromLibrary(
  limit: number,
  { photosOnly = false }: { photosOnly?: boolean } = {},
): Promise<{
  picked: PickedMedia[];
  rejected: { kind: MediaKind; reason: Rejection }[];
}> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: photosOnly ? ['images'] : ['images', 'videos'],
    allowsMultipleSelection: true,
    selectionLimit: limit,
    orderedSelection: true,
    quality: 1,
    exif: false,
    // iOS: transcode clips to 1080p HEVC, which keeps a 60 s clip well under
    // Stream's 200 MB direct-upload limit. Stream re-encodes anyway.
    videoExportPreset: ImagePicker.VideoExportPreset.HEVC_1920x1080,
  });
  if (result.canceled) return { picked: [], rejected: [] };

  const picked: PickedMedia[] = [];
  const rejected: { kind: MediaKind; reason: Rejection }[] = [];

  for (const asset of result.assets) {
    const isVideo = asset.type === 'video' || asset.type === 'pairedVideo';
    const kind: MediaKind = isVideo ? 'video' : 'photo';
    const mime = asset.mimeType?.toLowerCase();
    const ext = extensionOf(asset.uri, asset.fileName);
    const allowed = isVideo
      ? (mime ? VIDEO_TYPES.includes(mime) : VIDEO_EXTENSIONS.includes(ext))
      : (mime ? PHOTO_TYPES.includes(mime) : PHOTO_EXTENSIONS.includes(ext));
    if (!allowed || !asset.width || !asset.height) {
      rejected.push({ kind, reason: 'unsupported' });
      continue;
    }
    const durationS = isVideo && asset.duration ? asset.duration / 1000 : undefined;
    if (isVideo && (!durationS || durationS > MAX_CLIP_SECONDS)) {
      rejected.push({ kind, reason: 'tooLong' });
      continue;
    }
    if (isVideo && asset.fileSize && asset.fileSize > MAX_VIDEO_BYTES) {
      rejected.push({ kind, reason: 'tooBig' });
      continue;
    }
    picked.push({
      key: asset.assetId ?? asset.uri,
      kind,
      uri: asset.uri,
      width: Math.round(asset.width),
      height: Math.round(asset.height),
      durationS,
      mimeType: mime,
      fileSize: asset.fileSize,
    });
  }
  return { picked, rejected };
}

/* Local copies ------------------------------------------------------------ */

/**
 * Uploads read from the app's own documents folder, not the picker's
 * temporary files, so a queued upload still has its file after the app is
 * closed and reopened.
 */
function uploadsDir(): Directory {
  const dir = new Directory(Paths.document, 'uploads');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

export type PreparedMedia = {
  kind: MediaKind;
  /** file:// URI inside the uploads folder. */
  uri: string;
  mimeType: string;
  width: number;
  height: number;
  durationS?: number;
};

/**
 * Compresses a photo or copies a clip into the uploads folder, named after
 * `slideId` (a park photo's ID for park photos).
 */
export async function prepareForUpload(media: PickedMedia, slideId: string): Promise<PreparedMedia> {
  const dir = uploadsDir();

  if (media.kind === 'photo') {
    const longEdge = Math.max(media.width, media.height);
    const ctx = ImageManipulator.manipulate(media.uri);
    if (longEdge > PHOTO_MAX_EDGE) {
      if (media.width >= media.height) ctx.resize({ width: PHOTO_MAX_EDGE });
      else ctx.resize({ height: PHOTO_MAX_EDGE });
    }
    const image = await ctx.renderAsync();
    const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: PHOTO_QUALITY });
    const target = new File(dir, `${slideId}.jpg`);
    if (target.exists) target.delete();
    await new File(saved.uri).move(target);
    return {
      kind: 'photo',
      uri: target.uri,
      mimeType: 'image/jpeg',
      width: saved.width,
      height: saved.height,
    };
  }

  const ext = extensionOf(media.uri) || 'mp4';
  const target = new File(dir, `${slideId}.${ext}`);
  if (target.exists) target.delete();
  await new File(media.uri).copy(target);
  return {
    kind: 'video',
    uri: target.uri,
    mimeType: media.mimeType ?? (ext === 'mov' ? 'video/quicktime' : 'video/mp4'),
    width: media.width,
    height: media.height,
    durationS: media.durationS,
  };
}

export function deleteLocalFile(uri: string) {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // Already gone; nothing to clean up.
  }
}

/* Showing media ------------------------------------------------------------ */

/**
 * Short-lived (one hour) signed URLs for photos the viewer is allowed to
 * see: post photos, or park photos from the park-media bucket.
 */
export async function photoUrls(
  paths: string[],
  bucket: 'post-media' | 'park-media' = 'post-media',
): Promise<Record<string, string>> {
  if (paths.length === 0) return {};
  const { data, error } = await supabase.storage.from(bucket).createSignedUrls(paths, 60 * 60);
  if (error || !data) return {};
  const out: Record<string, string> = {};
  for (const item of data) {
    if (item.path && item.signedUrl) out[item.path] = item.signedUrl;
  }
  return out;
}

/** stream-token signs at most this many clips per call. */
const TOKEN_BATCH = 100;

/**
 * Playback keys for clips the viewer is allowed to see: a signed Stream
 * token per video ID (good for a few hours), which goes where the video ID
 * would in a Stream URL. Every clip needs one to play, the way photos need
 * a signed URL. A clip the viewer can't see gets no key.
 *
 * Before the signing key is set up (or if the call fails) this falls back
 * to the plain video IDs, which play only while clips don't require signing.
 */
export async function videoKeys(videoIds: (string | null | undefined)[]): Promise<Record<string, string>> {
  const ids = [...new Set(videoIds.filter((v): v is string => Boolean(v)))];
  const out: Record<string, string> = {};
  for (const id of ids) out[id] = id;
  for (let i = 0; i < ids.length; i += TOKEN_BATCH) {
    const batch = ids.slice(i, i + TOKEN_BATCH);
    const { data, error } = await supabase.functions.invoke('stream-token', { body: { video_ids: batch } });
    if (error || !data?.signed) continue;
    const tokens = (data.tokens ?? {}) as Record<string, string>;
    for (const id of batch) {
      if (tokens[id]) out[id] = tokens[id];
      else delete out[id];
    }
  }
  return out;
}

/**
 * HLS playback URL for a clip's key from `videoKeys`, or null until Stream
 * is configured for the app.
 */
export function videoPlaybackUrl(key: string): string | null {
  const code = env.streamCustomerCode;
  if (!code) return null;
  return `https://customer-${code}.cloudflarestream.com/${key}/manifest/video.m3u8`;
}

/** A frame from a clip, by its key from `videoKeys`. */
export function videoThumbnailUrl(key: string, height = 480): string | null {
  const code = env.streamCustomerCode;
  if (!code) return null;
  return `https://customer-${code}.cloudflarestream.com/${key}/thumbnails/thumbnail.jpg?time=1s&height=${height}`;
}

/* Layout ---------------------------------------------------------------------- */

/** Tallest a post's frame may be, relative to its width (4:5, like Instagram's tallest). */
export const MAX_HEIGHT_RATIO = 1.25;
/** Widest: 1.91:1. */
export const MIN_HEIGHT_RATIO = 1 / 1.91;

type Size = { width: number; height: number };

/**
 * Where a slide sits in its frame, like CSS object-position: 0 shows the
 * left (or top) edge of the media, 1 the right (or bottom), 0.5 the middle.
 * Only the axis the media overflows on matters.
 */
export type FramePoint = { x: number; y: number };
export const CENTERED: FramePoint = { x: 0.5, y: 0.5 };

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/**
 * A post's frame shape (height ÷ width). Every slide shares it, like
 * Instagram: the first slide sets it, held between 4:5 and 1.91:1. Shapes
 * in between show as they are.
 */
export function frameRatio(slides: Size[]): number {
  const first = slides[0];
  if (!first || first.width <= 0 || first.height <= 0) return 1;
  return Math.min(MAX_HEIGHT_RATIO, Math.max(MIN_HEIGHT_RATIO, first.height / first.width));
}

/** A post's frame height at a given width. */
export function frameHeight(width: number, slides: Size[]): number {
  return Math.round(width * frameRatio(slides));
}

/**
 * Media scaled to cover a frame, placed at `at`. Returns the media's size
 * and offset inside the frame (offsets are zero or negative). Media of
 * unknown size fills the frame.
 */
export function coverRect(frame: Size, media: Size, at: FramePoint = CENTERED): Size & { left: number; top: number } {
  if (media.width <= 0 || media.height <= 0) return { width: frame.width, height: frame.height, left: 0, top: 0 };
  const scale = Math.max(frame.width / media.width, frame.height / media.height);
  const width = media.width * scale;
  const height = media.height * scale;
  return {
    width,
    height,
    left: (frame.width - width) * clamp01(at.x),
    top: (frame.height - height) * clamp01(at.y),
  };
}

/** "4:5", "1:1", "1.91:1": a frame shape (height ÷ width) for labels. */
export function frameShapeLabel(ratio: number): string {
  const named: [number, number][] = [[4, 5], [1, 1], [3, 4], [2, 3], [4, 3], [3, 2], [16, 9], [1.91, 1]];
  for (const [w, h] of named) if (Math.abs(h / w - ratio) < 0.015) return `${w}:${h}`;
  return `${(1 / ratio).toFixed(2)}:1`;
}

/** "0:14" for a clip length in seconds. */
export function formatDuration(seconds: number): string {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
