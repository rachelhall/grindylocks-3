// POST /functions/v1/stream-sign-existing
//
// One-off, owner only: makes every clip already on Stream require signed
// tokens, for clips uploaded before stream-upload started asking for that.
// Safe to run more than once. Delete this function once it has run.
//
// Run it only after stream-token is deployed with the signing key set and
// the app asks for tokens; until then, signed clips won't play.

import {
  adminClient,
  corsHeaders,
  json,
  setRequireSignedURLs,
  streamConfig,
  streamSigningKey,
  userClient,
} from '../_shared/stream.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const cfg = streamConfig();
  if (!cfg) return json({ error: 'video_not_configured' }, 503);
  if (!(await streamSigningKey())) return json({ error: 'signing_key_missing' }, 503);

  const { data: auth } = await userClient(req).auth.getUser();
  const user = auth.user;
  if (!user) return json({ error: 'not_signed_in' }, 401);

  const admin = adminClient();
  const { data: owner } = await admin
    .from('role_assignments')
    .select('id')
    .eq('user_id', user.id)
    .eq('role', 'owner')
    .is('ended_at', null)
    .maybeSingle();
  if (!owner) return json({ error: 'owner_only' }, 403);

  const { data, error } = await admin
    .from('post_slides')
    .select('stream_video_id')
    .eq('kind', 'video')
    .not('stream_video_id', 'is', null);
  if (error) return json({ error: 'server_error' }, 500);

  const uids = [...new Set((data ?? []).map((r) => r.stream_video_id as string))];
  const failed: string[] = [];
  for (const uid of uids) {
    try {
      await setRequireSignedURLs(cfg, uid, true);
    } catch (err) {
      console.error('stream-sign-existing', uid, err);
      failed.push(uid);
    }
  }
  return json({ checked: uids.length, signed: uids.length - failed.length, failed });
});
