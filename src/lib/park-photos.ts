/**
 * Park photos: a few wide shots of the whole park, shown in the park page
 * header (the first one) and the park photo gallery. Riding shots go in
 * posts, not here.
 *
 * - Files are JPEGs in the park-media bucket at <park id>/<photo id>.jpg,
 *   re-encoded on the phone like post photos.
 * - Upload order: the file first, then the row. The row checks the file is
 *   there (migration `park_photos`), so a half-finished upload never shows.
 * - Photos are archived for the whole gallery, never deleted.
 * - Reads share the park's freshness; every write invalidates the park's photos.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { File, UploadType } from 'expo-file-system';

import { env } from './env';
import { deleteLocalFile, encodePhoto, type PickedMedia } from './media';
import { fresh, keys } from './query';
import { supabase } from './supabase';
import { uuid } from './uuid';

export const PARK_MEDIA_BUCKET = 'park-media';
/** Same limit as the database. */
export const MAX_PARK_PHOTOS = 8;
/** Signed URLs outlive the cache entry (30 minutes at most). */
const SIGNED_URL_SECONDS = 60 * 60;

export type ParkPhoto = {
  id: string;
  park_id: string;
  storage_path: string;
  width: number;
  height: number;
  sort_order: number;
  photographer: string;
  source: string;
  license: string;
  created_at: string;
  uploaded_by: string;
  /** The uploader's current username, for linking the credit to a profile. */
  uploader: string | null;
  /** Signed URL; null if it couldn't be signed. */
  url: string | null;
};

/* Credit ------------------------------------------------------------------------- */

/**
 * Credit values are stored in English so every reader sees the same record;
 * the app shows the standard ones translated.
 */
export const OWN_SOURCE = 'own photo';
export const permissionSource = (parkName: string) => `permission from ${parkName}`;
export const LICENSES = ['own', 'permission', 'CC BY-SA 4.0', 'CC BY 4.0'] as const;

export type Credit = { photographer: string; source: string; license: string };

/* Reads -------------------------------------------------------------------------- */

export async function fetchParkPhotos(parkId: string): Promise<ParkPhoto[]> {
  const { data, error } = await supabase
    .from('park_photos')
    .select(
      `id, park_id, storage_path, width, height, sort_order, photographer, source, license, created_at, uploaded_by,
       uploader:profiles!park_photos_uploaded_by_fkey(username)`,
    )
    .eq('park_id', parkId)
    .is('archived_at', null)
    .order('sort_order')
    .order('created_at');
  if (error) throw error;
  const rows = data ?? [];
  if (rows.length === 0) return [];

  const { data: signed } = await supabase.storage
    .from(PARK_MEDIA_BUCKET)
    .createSignedUrls(
      rows.map((r) => r.storage_path),
      SIGNED_URL_SECONDS,
    );
  const urls = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));

  return rows.map(({ uploader, ...row }) => ({
    ...row,
    uploader: uploader?.username ?? null,
    url: urls.get(row.storage_path) ?? null,
  }));
}

/** A park's photos in gallery order. The park page header shows the first. */
export function useParkPhotos(parkId: string | undefined) {
  return useQuery({
    queryKey: keys.parkPhotos(parkId ?? ''),
    queryFn: () => fetchParkPhotos(parkId!),
    enabled: Boolean(parkId),
    staleTime: fresh.parks,
  });
}

/* Writes ------------------------------------------------------------------------- */

async function accessToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('signed out');
  return token;
}

/** Re-encodes, uploads and records one photo. */
async function uploadOne(parkId: string, userId: string, media: PickedMedia, credit: Credit) {
  const id = uuid();
  const path = `${parkId}/${id}.jpg`;
  const encoded = await encodePhoto(media);
  try {
    const token = await accessToken();
    const task = new File(encoded.uri).createUploadTask(
      `${env.supabaseUrl}/storage/v1/object/${PARK_MEDIA_BUCKET}/${path}`,
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
      },
    );
    const res = await task.uploadAsync();
    if (res.status < 200 || res.status >= 300) throw new Error(`park photo upload ${res.status}`);

    const { error } = await supabase.from('park_photos').insert({
      id,
      park_id: parkId,
      uploaded_by: userId,
      storage_path: path,
      width: encoded.width,
      height: encoded.height,
      photographer: credit.photographer.trim(),
      source: credit.source.trim(),
      license: credit.license.trim(),
    });
    if (error) throw error;
  } finally {
    deleteLocalFile(encoded.uri);
  }
}

/**
 * Upload, reorder and archive for one park. Each invalidates the park's
 * photos, so the header and gallery pick up the change.
 */
export function useParkPhotoMutations(parkId: string | undefined, userId: string | undefined) {
  const client = useQueryClient();
  const key = keys.parkPhotos(parkId ?? '');
  const invalidate = () => client.invalidateQueries({ queryKey: key });

  const upload = useMutation({
    mutationFn: async ({ photos, credit }: { photos: PickedMedia[]; credit: Credit }) => {
      // One at a time, so a park's photos keep the order they were picked in.
      for (const media of photos) await uploadOne(parkId!, userId!, media, credit);
    },
    onSettled: invalidate,
  });

  /** Moves a photo to the front, so it becomes the header photo. */
  const makeFirst = useMutation({
    mutationFn: async (photoId: string) => {
      const current = client.getQueryData<ParkPhoto[]>(key) ?? [];
      const order = [photoId, ...current.map((p) => p.id).filter((id) => id !== photoId)];
      const { error } = await supabase.rpc('reorder_park_photos', { park: parkId!, photo_ids: order });
      if (error) throw error;
    },
    onMutate: async (photoId) => {
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData<ParkPhoto[]>(key);
      client.setQueryData<ParkPhoto[]>(key, (list = []) => {
        const picked = list.find((p) => p.id === photoId);
        return picked ? [picked, ...list.filter((p) => p.id !== photoId)] : list;
      });
      return { previous };
    },
    onError: (_e, _v, context) => client.setQueryData(key, context?.previous),
    onSettled: invalidate,
  });

  const archive = useMutation({
    mutationFn: async (photoId: string) => {
      // The database stamps the time and who archived it.
      const { error } = await supabase
        .from('park_photos')
        .update({ archived_at: new Date().toISOString() })
        .eq('id', photoId);
      if (error) throw error;
    },
    onSettled: invalidate,
  });

  return { upload, makeFirst, archive };
}
