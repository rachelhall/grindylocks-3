// POST /functions/v1/stream-token  { video_ids: string[] }
//
// Signed playback tokens for clips the caller is allowed to see. Every clip
// needs one to play (requireSignedURLs), the way post photos need a signed
// storage URL, so a copied link stops working after a few hours and private
// accounts' clips can't be watched by people who don't follow them.
//
// Which clips the caller may see is decided by row-level security: only
// ready slides the caller can read through post_slides get a token.
// Replies { tokens: { [videoId]: token }, expires_at }. Clips the caller
// can't see are left out. If the signing key isn't set yet it replies with
// no tokens and signed: false, and the app falls back to plain video IDs
// (which only play while clips don't require signing).

import {
  corsHeaders,
  json,
  PLAYBACK_TOKEN_HOURS,
  signPlaybackToken,
  streamSigningKey,
  userClient,
} from '../_shared/stream.ts';

const MAX_IDS = 100;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const db = userClient(req);
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return json({ error: 'not_signed_in' }, 401);

  const body = await req.json().catch(() => null);
  const ids = body?.video_ids;
  if (
    !Array.isArray(ids) ||
    ids.length > MAX_IDS ||
    !ids.every((v) => typeof v === 'string' && /^[0-9a-f]{32}$/.test(v))
  ) {
    return json({ error: 'bad_request' }, 400);
  }
  const unique = [...new Set(ids as string[])];
  if (unique.length === 0) return json({ tokens: {}, signed: true });

  try {
    const signer = await streamSigningKey();
    if (!signer) return json({ tokens: {}, signed: false });

    // RLS: only slides of posts the caller can see come back.
    const { data, error } = await db
      .from('post_slides')
      .select('stream_video_id')
      .eq('kind', 'video')
      .eq('upload_status', 'ready')
      .in('stream_video_id', unique);
    if (error) throw error;

    const visible = [...new Set((data ?? []).map((r) => r.stream_video_id as string))];
    const tokens: Record<string, string> = {};
    await Promise.all(
      visible.map(async (uid) => {
        tokens[uid] = await signPlaybackToken(signer, uid);
      }),
    );
    const expiresAt = new Date(Date.now() + PLAYBACK_TOKEN_HOURS * 3600_000).toISOString();
    return json({ tokens, signed: true, expires_at: expiresAt });
  } catch (err) {
    console.error('stream-token', err);
    return json({ error: 'server_error' }, 500);
  }
});
