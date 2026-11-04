// POST /functions/v1/stream-upload
//
// Gives the app a one-time Cloudflare Stream upload URL for one video slide.
//
// New slide:  { post_id, position, width, height, duration_s }
// Retry:      { slide_id }   (a fresh URL for a slide whose upload failed or
//                             whose URL expired; the old Stream video is
//                             deleted)
//
// Replies { slide_id, video_id, upload_url }. Video slides are written here
// with the secret key because members can't set stream_video_id themselves.

import {
  adminClient,
  corsHeaders,
  createDirectUpload,
  deleteVideo,
  json,
  MAX_CLIP_SECONDS,
  streamConfig,
  userClient,
} from '../_shared/stream.ts';

type NewSlide = {
  post_id: string;
  position: number;
  width: number;
  height: number;
  duration_s: number;
};

const isUuid = (v: unknown): v is string =>
  typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const isPositiveInt = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0;

/** The caller wrote this post: its author, or the member who posted it as a page. */
async function madeIt(db: ReturnType<typeof userClient>, postId: string): Promise<boolean> {
  const { data, error } = await db.rpc('i_made_post', { post: postId });
  return !error && data === true;
}

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
  if (!body || typeof body !== 'object') return json({ error: 'bad_request' }, 400);
  const admin = adminClient();

  try {
    /* Retry: new URL for an existing video slide ------------------------- */
    if ('slide_id' in body) {
      if (!isUuid(body.slide_id)) return json({ error: 'bad_request' }, 400);
      // Read through RLS: only the author can see an unpublished post's slides.
      const { data: slide } = await db
        .from('post_slides')
        .select('id, post_id, kind, upload_status, stream_video_id, posts!inner(author_id, published_at)')
        .eq('id', body.slide_id)
        .maybeSingle();
      const post = slide?.posts as unknown as { author_id: string | null; published_at: string | null } | undefined;
      // A page post has no author_id; the member who made it is checked by the database.
      if (!slide || !post || !(await madeIt(db, slide.post_id))) return json({ error: 'not_found' }, 404);
      if (slide.kind !== 'video') return json({ error: 'not_a_video' }, 400);
      if (slide.upload_status === 'ready' || slide.upload_status === 'processing') {
        return json({ error: 'already_uploaded', status: slide.upload_status }, 409);
      }

      const upload = await createDirectUpload(cfg, { slideId: slide.id, postId: slide.post_id, userId: user.id });
      const { error } = await admin
        .from('post_slides')
        .update({ stream_video_id: upload.uid, upload_status: 'uploading' })
        .eq('id', slide.id);
      if (error) throw error;
      if (slide.stream_video_id) await deleteVideo(cfg, slide.stream_video_id);
      return json({ slide_id: slide.id, video_id: upload.uid, upload_url: upload.uploadURL });
    }

    /* New video slide ------------------------------------------------------ */
    const b = body as Partial<NewSlide>;
    if (
      !isUuid(b.post_id) ||
      !Number.isInteger(b.position) ||
      !isPositiveInt(b.width) ||
      !isPositiveInt(b.height) ||
      typeof b.duration_s !== 'number'
    ) {
      return json({ error: 'bad_request' }, 400);
    }
    if (!(b.duration_s > 0) || b.duration_s > MAX_CLIP_SECONDS) {
      return json({ error: 'too_long', max_seconds: MAX_CLIP_SECONDS }, 422);
    }

    const { data: post } = await db
      .from('posts')
      .select('id, author_id, slide_count, published_at')
      .eq('id', b.post_id)
      .maybeSingle();
    if (!post || !(await madeIt(db, post.id))) return json({ error: 'not_found' }, 404);
    if (post.published_at) return json({ error: 'already_published' }, 409);
    if (b.position! < 0 || b.position! >= post.slide_count) return json({ error: 'bad_position' }, 400);

    const { data: existing } = await admin
      .from('post_slides')
      .select('id')
      .eq('post_id', post.id)
      .eq('position', b.position!)
      .maybeSingle();
    if (existing) return json({ error: 'slide_exists', slide_id: existing.id }, 409);

    const slideId = crypto.randomUUID();
    const upload = await createDirectUpload(cfg, { slideId, postId: post.id, userId: user.id });
    const { error } = await admin.from('post_slides').insert({
      id: slideId,
      post_id: post.id,
      position: b.position,
      kind: 'video',
      stream_video_id: upload.uid,
      width: b.width,
      height: b.height,
      duration_s: Math.round(b.duration_s * 100) / 100,
      upload_status: 'uploading',
    });
    if (error) {
      await deleteVideo(cfg, upload.uid);
      throw error;
    }
    return json({ slide_id: slideId, video_id: upload.uid, upload_url: upload.uploadURL });
  } catch (err) {
    console.error('stream-upload', err);
    return json({ error: 'server_error' }, 500);
  }
});
