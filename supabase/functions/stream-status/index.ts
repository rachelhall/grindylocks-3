// POST /functions/v1/stream-status  { slide_id }
//
// Asks Stream where a video slide is (waiting for the upload, encoding,
// ready or failed), saves that on the slide and replies { status }.
// The app calls this after an upload finishes and while it waits for
// encoding; the stream-webhook function does the same without the app.

import {
  adminClient,
  applyVideoState,
  corsHeaders,
  getVideo,
  json,
  streamConfig,
  userClient,
} from '../_shared/stream.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const cfg = streamConfig();
  if (!cfg) return json({ error: 'video_not_configured' }, 503);

  const db = userClient(req);
  const { data: auth } = await db.auth.getUser();
  const user = auth.user;
  if (!user) return json({ error: 'not_signed_in' }, 401);

  const body = await req.json().catch(() => null);
  const slideId = body?.slide_id;
  if (typeof slideId !== 'string') return json({ error: 'bad_request' }, 400);

  try {
    const { data: slide } = await db
      .from('post_slides')
      .select('id, kind, upload_status, stream_video_id, posts!inner(author_id)')
      .eq('id', slideId)
      .maybeSingle();
    const post = slide?.posts as unknown as { author_id: string } | undefined;
    if (!slide || !post || post.author_id !== user.id) return json({ error: 'not_found' }, 404);
    if (slide.kind !== 'video' || !slide.stream_video_id) return json({ error: 'not_a_video' }, 400);
    if (slide.upload_status === 'ready') return json({ status: 'ready' });

    const video = await getVideo(cfg, slide.stream_video_id);
    const status = await applyVideoState(adminClient(), cfg, slide, video);
    return json({ status, too_long: status === 'failed' && (video?.duration ?? 0) > 60 });
  } catch (err) {
    console.error('stream-status', err);
    return json({ error: 'server_error' }, 500);
  }
});
