/**
 * Park photos: the header photo and the gallery.
 *
 * - Every member sees a park's photos; people with a role at the park or its
 *   metro area (contributors, park and city admins, the owner) add and
 *   reorder them, and the uploader or an admin removes one (archived, not
 *   deleted). The database enforces all of this; `useParkRole` only decides
 *   what to show.
 * - Files are JPEG in the private park-media bucket at <park>/<photo>.jpg,
 *   re-encoded on the phone like post photos (2048 px, quality 0.82).
 * - Reads share the park's freshness (`fresh.parks`); every write
 *   invalidates the park's photos.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { File, UploadType } from 'expo-file-system';
import { useState } from 'react';

import type { Database } from './database.types';
import { env } from './env';
import { deleteLocalFile, photoUrls, type PickedMedia, prepareForUpload } from './media';
import { fresh, keys } from './query';
import { supabase } from './supabase';
import { uuid } from './uuid';

/** Same limit as the database. */
export const MAX_PARK_PHOTOS = 8;

export type RoleName = Database['public']['Enums']['role_name'];

export type ParkPhoto = {
  id: string;
  storagePath: string;
  /** Signed for an hour. */
  url: string | null;
  width: number;
  height: number;
  photographer: string;
  source: string;
  license: string;
  createdAt: string;
  uploadedBy: string;
  uploaderUsername: string | null;
};

/** Credit for a batch of photos, as asked for in the upload sheet. */
export type PhotoCredit = { photographer: string; source: string; license: string };

/** Stored values for the preset sources and licenses (data, not UI text). */
export const SOURCE_OWN = 'own photo';
export const SOURCE_WIKIMEDIA = 'Wikimedia Commons';
export const permissionSource = (parkName: string) => `permission from ${parkName}`;
export const LICENSE_OWN = 'own';
export const LICENSE_PERMISSION = 'permission';
export const LICENSE_CC_BY_SA = 'CC BY-SA 4.0';

/* Reads ---------------------------------------------------------------------- */

export async function fetchParkPhotos(parkId: string): Promise<ParkPhoto[]> {
  const { data, error } = await supabase
    .from('park_photos')
    .select(
      `id, storage_path, width, height, photographer, source, license, created_at, uploaded_by,
       uploader:profiles!park_photos_uploaded_by_fkey(username)`,
    )
    .eq('park_id', parkId)
    .is('archived_at', null)
    .order('sort_order')
    .order('created_at');
  if (error) throw error;
  const rows = data ?? [];
  const urls = await photoUrls(
    rows.map((r) => r.storage_path),
    'park-media',
  );
  return rows.map((r) => ({
    id: r.id,
    storagePath: r.storage_path,
    url: urls[r.storage_path] ?? null,
    width: r.width,
    height: r.height,
    photographer: r.photographer,
    source: r.source,
    license: r.license,
    createdAt: r.created_at,
    uploadedBy: r.uploaded_by,
    uploaderUsername: r.uploader?.username ?? null,
  }));
}

export async function fetchParkRole(parkId: string): Promise<RoleName | null> {
  const { data, error } = await supabase.rpc('my_park_role', { park: parkId });
  if (error) throw error;
  return data ?? null;
}

/** A park's active photos, first one first (the header photo). */
export function useParkPhotos(parkId: string | undefined) {
  return useQuery({
    queryKey: keys.parkPhotos(parkId ?? ''),
    queryFn: () => fetchParkPhotos(parkId!),
    enabled: Boolean(parkId),
    staleTime: fresh.parks,
  });
}

/**
 * Your strongest role covering this park, or null for a plain member.
 * Your own data, so it's checked again on every view.
 */
export function useParkRole(userId: string | undefined, parkId: string | undefined) {
  const { data } = useQuery({
    queryKey: keys.parkRole(userId ?? '', parkId ?? ''),
    queryFn: () => fetchParkRole(parkId!),
    enabled: Boolean(userId && parkId),
    staleTime: fresh.mine,
  });
  const role = data ?? null;
  return {
    role,
    /** Add and reorder photos. */
    canContribute: role !== null,
    /** Remove anyone's photo (not just your own). */
    canModerate: role === 'owner' || role === 'city_admin' || role === 'park_admin',
  };
}

/* Uploading -------------------------------------------------------------------- */

async function accessToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('signed out');
  return token;
}

/**
 * Uploads one prepared JPEG to a storage bucket. Park photos overwrite the
 * same path on a retry; report photos (M5) may only be added, never
 * replaced, so they go up without upsert.
 */
export async function uploadJpeg(
  uri: string,
  path: string,
  bucket: 'park-media' | 'report-photos' = 'park-media',
) {
  const token = await accessToken();
  const task = new File(uri).createUploadTask(`${env.supabaseUrl}/storage/v1/object/${bucket}/${path}`, {
    httpMethod: 'POST',
    uploadType: UploadType.BINARY_CONTENT,
    mimeType: 'image/jpeg',
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: env.supabasePublishableKey,
      'content-type': 'image/jpeg',
      'x-upsert': bucket === 'park-media' ? 'true' : 'false',
    },
  });
  const res = await task.uploadAsync();
  if (!res || res.status < 200 || res.status >= 300) {
    throw new Error(`${bucket} upload ${res?.status ?? 'failed'}`);
  }
}

/** Re-encodes, uploads and adds one photo. Cleans up after itself on failure. */
async function addParkPhoto(parkId: string, media: PickedMedia, credit: PhotoCredit) {
  const id = uuid();
  const path = `${parkId}/${id}.jpg`;
  const prepared = await prepareForUpload(media, id);
  try {
    await uploadJpeg(prepared.uri, path);
    const { error } = await supabase.from('park_photos').insert({
      id,
      park_id: parkId,
      storage_path: path,
      width: prepared.width,
      height: prepared.height,
      // Blank becomes the uploader's username in the database.
      photographer: credit.photographer.trim().replace(/^@/, ''),
      source: credit.source.trim() || SOURCE_OWN,
      license: credit.license.trim() || LICENSE_OWN,
    });
    if (error) {
      // The row was refused (e.g. the park filled up meanwhile): drop the file.
      await supabase.storage.from('park-media').remove([path]);
      throw error;
    }
  } finally {
    deleteLocalFile(prepared.uri);
  }
}

/**
 * Uploads a batch of picked photos with one credit, one at a time, and
 * reports progress. Photos that went up before a failure stay added.
 */
export function useUploadParkPhotos(parkId: string) {
  const client = useQueryClient();
  const [done, setDone] = useState(0);
  const mutation = useMutation({
    mutationFn: async ({ photos, credit }: { photos: PickedMedia[]; credit: PhotoCredit }) => {
      setDone(0);
      for (const photo of photos) {
        await addParkPhoto(parkId, photo, credit);
        setDone((n) => n + 1);
      }
    },
    onSettled: () => client.invalidateQueries({ queryKey: keys.parkPhotos(parkId) }),
  });
  return { ...mutation, done };
}

/* Reordering and removing -------------------------------------------------------- */

/**
 * Puts the park's photos in a new order (the first is the header photo).
 * Optimistic, so the gallery moves at once; rolls back if refused.
 */
export function useReorderParkPhotos(parkId: string) {
  const client = useQueryClient();
  const key = keys.parkPhotos(parkId);
  return useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase.rpc('reorder_park_photos', { park: parkId, photo_ids: ids });
      if (error) throw error;
    },
    onMutate: async (ids) => {
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData<ParkPhoto[]>(key);
      if (previous) {
        const byId = new Map(previous.map((p) => [p.id, p]));
        client.setQueryData<ParkPhoto[]>(
          key,
          ids.map((id) => byId.get(id)).filter((p): p is ParkPhoto => Boolean(p)),
        );
      }
      return { previous };
    },
    onError: (_error, _ids, context) => client.setQueryData(key, context?.previous),
    onSettled: () => client.invalidateQueries({ queryKey: key }),
  });
}

/** Removes a photo from the gallery for everyone (archived, not deleted). */
export function useArchiveParkPhoto(parkId: string) {
  const client = useQueryClient();
  const key = keys.parkPhotos(parkId);
  return useMutation({
    mutationFn: async (photoId: string) => {
      // A count, not the row: an uploader who has since lost their role
      // can't read an archived photo back.
      const { count, error } = await supabase
        .from('park_photos')
        .update({ archived_at: new Date().toISOString() }, { count: 'exact' })
        .eq('id', photoId);
      if (error) throw error;
      if (!count) throw new Error('not allowed');
    },
    onMutate: async (photoId) => {
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData<ParkPhoto[]>(key);
      client.setQueryData<ParkPhoto[]>(key, (photos) => photos?.filter((p) => p.id !== photoId));
      return { previous };
    },
    onError: (_error, _id, context) => client.setQueryData(key, context?.previous),
    onSettled: () => client.invalidateQueries({ queryKey: key }),
  });
}
