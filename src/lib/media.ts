/**
 * Grindylocks media layer, app side: picking, preparing and showing photos
 * and clips. The server side is supabase/functions/_shared/stream.ts.
 *
 * - Photos are re-encoded to JPEG (at most 2048 px on the long edge) before
 *   upload, so HEIC and PNG come out as JPEG and every phone can show them.
 * - Clips go to Cloudflare Stream. On iOS the picker transcodes them to
 *   1080p HEVC first; Android uploads the original file.
 * - Nothing is ever cropped: width and height are stored per slide and
 *   layouts letterbox to the original aspect ratio.
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

/**
 * Tallest a slide may show, relative to its width (4:5, like Instagram's
 * tallest). Taller media is letterboxed at this height, never cropped.
 */
export const MAX_HEIGHT_RATIO = 1.25;
/** Widest: 1.91:1. Wider media is letterboxed at this height. */
export const MIN_HEIGHT_RATIO = 1 / 1.91;

/** Display height for one slide at a given width. */
export function slideHeight(width: number, media: { width: number; height: number }): number {
  const ratio = media.height / media.width;
  return width * Math.min(MAX_HEIGHT_RATIO, Math.max(MIN_HEIGHT_RATIO, ratio));
}

/** A carousel takes its height from its tallest slide, within the cap. */
export function carouselHeight(width: number, slides: { width: number; height: number }[]): number {
  return slides.reduce((h, s) => Math.max(h, slideHeight(width, s)), 0);
}

/** "0:14" for a clip length in seconds. */
export function formatDuration(seconds: number): string {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
