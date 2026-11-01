// POST /functions/v1/stream-webhook   (called by Cloudflare Stream, not the app)
//
// Stream calls this when a video finishes encoding or fails. It marks the
// slide ready or failed, so a post publishes even if its author has closed
// the app. Deployed with JWT verification off; the Webhook-Signature header
// (HMAC with CLOUDFLARE_STREAM_WEBHOOK_SECRET) is what proves the caller.

import {
  adminClient,
  applyVideoState,
  json,
  streamConfig,
  type StreamVideo,
  verifyWebhook,
} from '../_shared/stream.ts';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const secret = Deno.env.get('CLOUDFLARE_STREAM_WEBHOOK_SECRET');
  if (!secret) return json({ error: 'video_not_configured' }, 503);

  const raw = await req.text();
  if (!(await verifyWebhook(req.headers.get('Webhook-Signature'), raw, secret))) {
    return json({ error: 'bad_signature' }, 401);
  }

  let video: StreamVideo;
  try {
    video = JSON.parse(raw) as StreamVideo;
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  if (!video?.uid) return json({ error: 'bad_request' }, 400);

  try {
    const admin = adminClient();
    const { data: slide } = await admin
      .from('post_slides')
      .select('id, upload_status, stream_video_id')
      .eq('stream_video_id', video.uid)
      .maybeSingle();
    // Not ours (or already replaced by a retry): acknowledge so Stream stops.
    if (!slide) return json({ ok: true, ignored: true });

    const status = await applyVideoState(admin, streamConfig(), slide, video);
    return json({ ok: true, status });
  } catch (err) {
    console.error('stream-webhook', err);
    return json({ error: 'server_error' }, 500);
  }
});
