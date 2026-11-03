// POST /functions/v1/delete-account   { keep_posts?: boolean }  (default true)
//
// Deletes the signed-in member's account. The app first has them enter a
// fresh emailed sign-in code; the database refuses unless the session has a
// code sign-in from the last 15 minutes.
//
//  1. delete_my_account(keep_posts), as the member: all the database work
//     (roles end, invites cancelled, posts anonymized or removed, follows
//     and the rest cleared, profile marked deleted, username freed).
//  2. With the secret key: their files. Avatars always; post photos and
//     Stream clips only when keep_posts is false; report photos best effort.
//  3. The sign-in itself (auth.admin.deleteUser). profiles has no foreign
//     key to auth.users, so the "deleted user" profile row stays.
//
// Once step 1 succeeds the account is gone as far as the app is concerned,
// so failures in steps 2 and 3 are logged but don't fail the request.
//
// Replies { ok: true, signInRemoved }, or { error } with:
//   400 bad_request, 401 not_signed_in, 403 confirm_with_a_code,
//   500 delete_failed.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { adminClient, corsHeaders, deleteVideo, json, streamConfig, userClient } from '../_shared/stream.ts';

/** Storage remove() takes a list of paths; keep each call a sensible size. */
const REMOVE_BATCH = 100;
const PAGE = 1000;

/** Entries directly under a storage prefix (files and folders), all pages. */
async function listAll(admin: SupabaseClient, bucket: string, prefix: string) {
  const out: { name: string; id: string | null }[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: PAGE, offset });
    if (error) throw error;
    out.push(...data.map((e) => ({ name: e.name, id: e.id as string | null })));
    if (data.length < PAGE) return out;
  }
}

/** Files directly under a prefix (folders have a null id). */
async function filesIn(admin: SupabaseClient, bucket: string, prefix: string): Promise<string[]> {
  return (await listAll(admin, bucket, prefix)).filter((e) => e.id).map((e) => `${prefix}/${e.name}`);
}

/** Subfolders directly under a prefix ('' for the bucket root). */
async function foldersIn(admin: SupabaseClient, bucket: string, prefix: string): Promise<string[]> {
  return (await listAll(admin, bucket, prefix))
    .filter((e) => !e.id)
    .map((e) => (prefix ? `${prefix}/${e.name}` : e.name));
}

async function removeAll(admin: SupabaseClient, bucket: string, paths: string[]) {
  for (let i = 0; i < paths.length; i += REMOVE_BATCH) {
    const { error } = await admin.storage.from(bucket).remove(paths.slice(i, i + REMOVE_BATCH));
    if (error) throw error;
  }
}

/** Runs one cleanup step; a failure is logged and the rest carry on. */
async function bestEffort(label: string, step: () => Promise<void>) {
  try {
    await step();
  } catch (err) {
    console.error(`delete-account: ${label}`, err);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  if (!req.headers.get('Authorization')) return json({ error: 'not_signed_in' }, 401);
  const db = userClient(req);
  const { data: auth } = await db.auth.getUser();
  const user = auth.user;
  if (!user) return json({ error: 'not_signed_in' }, 401);
  const userId = user.id;

  const body = await req.json().catch(() => ({}));
  const keepPosts = body?.keep_posts ?? true;
  if (typeof keepPosts !== 'boolean') return json({ error: 'bad_request' }, 400);

  /* 1. Database, as the member ------------------------------------------- */
  const { error } = await db.rpc('delete_my_account', { keep_posts: keepPosts });
  if (error) {
    if (error.message === 'confirm_with_a_code') return json({ error: 'confirm_with_a_code' }, 403);
    if (error.message === 'not_signed_in') return json({ error: 'not_signed_in' }, 401);
    console.error('delete-account: delete_my_account', error);
    return json({ error: 'delete_failed' }, 500);
  }

  /* 2. Files, with the secret key ------------------------------------------- */
  const admin = adminClient();

  await bestEffort('avatars', async () => {
    await removeAll(admin, 'avatars', await filesIn(admin, 'avatars', userId));
  });

  if (!keepPosts) {
    // Clips first: the slide rows still have their Stream IDs.
    await bestEffort('stream videos', async () => {
      const cfg = streamConfig();
      if (!cfg) return; // Stream isn't set up, so there are no clips to delete.
      const { data, error } = await admin
        .from('post_slides')
        .select('stream_video_id, posts!inner(author_id)')
        .eq('posts.author_id', userId)
        .eq('kind', 'video')
        .not('stream_video_id', 'is', null);
      if (error) throw error;
      for (const slide of data ?? []) {
        if (slide.stream_video_id) await deleteVideo(cfg, slide.stream_video_id);
      }
    });

    // post-media is <user>/<post>/<slide>.jpg: one level of post folders.
    await bestEffort('post-media', async () => {
      const paths = await filesIn(admin, 'post-media', userId);
      for (const folder of await foldersIn(admin, 'post-media', userId)) {
        paths.push(...(await filesIn(admin, 'post-media', folder)));
      }
      await removeAll(admin, 'post-media', paths);
    });
  }

  // report-photos is <park>/<user>/<id>.jpg.
  await bestEffort('report-photos', async () => {
    const paths: string[] = [];
    for (const park of await foldersIn(admin, 'report-photos', '')) {
      paths.push(...(await filesIn(admin, 'report-photos', `${park}/${userId}`)));
    }
    await removeAll(admin, 'report-photos', paths);
  });

  /* 3. The sign-in ------------------------------------------------------------ */
  const { error: authError } = await admin.auth.admin.deleteUser(userId);
  if (authError) {
    console.error('delete-account: deleteUser', authError);
    return json({ ok: true, signInRemoved: false });
  }
  return json({ ok: true, signInRemoved: true });
});
