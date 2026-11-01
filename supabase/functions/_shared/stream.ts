// Grindylocks media layer: the only code that talks to Cloudflare Stream.
// Supabase stores just the Stream video ID on post_slides, so moving to
// another provider later (e.g. Mux) means rewriting this file and the
// app's src/lib/media.ts, nothing else.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

/** Clips can be at most this long, here, in the app and in the database. */
export const MAX_CLIP_SECONDS = 60;

/** Stream rounds durations a little; allow this much slack before rejecting. */
const DURATION_SLACK_SECONDS = 0.5;

/** How long a one-time upload URL stays valid. Generous, for slow connections. */
const UPLOAD_URL_HOURS = 4;

export type SlideStatus = 'uploading' | 'processing' | 'ready' | 'failed';

export type StreamVideo = {
  uid: string;
  readyToStream?: boolean;
  duration?: number;
  status?: { state?: string; errorReasonCode?: string };
};

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/* Config --------------------------------------------------------------- */

export function streamConfig(): { accountId: string; apiToken: string } | null {
  const accountId = Deno.env.get('CLOUDFLARE_ACCOUNT_ID');
  const apiToken = Deno.env.get('CLOUDFLARE_STREAM_API_TOKEN');
  if (!accountId || !apiToken) return null;
  return { accountId, apiToken };
}

/** The JSON-dictionary key env vars, with a fallback to the legacy ones. */
function namedKey(dictVar: string, legacyVar: string): string {
  const dict = Deno.env.get(dictVar);
  if (dict) {
    try {
      const parsed = JSON.parse(dict) as Record<string, string>;
      if (parsed.default) return parsed.default;
    } catch {
      // fall through to the legacy key
    }
  }
  const legacy = Deno.env.get(legacyVar);
  if (!legacy) throw new Error(`Missing ${dictVar} and ${legacyVar}`);
  return legacy;
}

/** Client that acts as the calling member, so row-level security applies. */
export function userClient(req: Request): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    namedKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY'),
    {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}

/** Secret-key client. Only for writing upload state the member can't. */
export function adminClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    namedKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

/* Stream API ------------------------------------------------------------- */

const api = (accountId: string, path: string) =>
  `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream${path}`;

/**
 * A one-time URL the phone uploads the clip to directly (a single multipart
 * POST, up to 200 MB). Stream itself rejects anything over 60 seconds.
 */
export async function createDirectUpload(
  cfg: { accountId: string; apiToken: string },
  meta: { slideId: string; postId: string; userId: string },
): Promise<{ uid: string; uploadURL: string }> {
  const expiry = new Date(Date.now() + UPLOAD_URL_HOURS * 3600_000).toISOString();
  const res = await fetch(api(cfg.accountId, '/direct_upload'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.apiToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      maxDurationSeconds: MAX_CLIP_SECONDS,
      expiry,
      creator: meta.userId,
      meta: { slide: meta.slideId, post: meta.postId },
      requireSignedURLs: false,
    }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.success || !body.result?.uid || !body.result?.uploadURL) {
    throw new Error(`Stream direct_upload failed (${res.status}): ${JSON.stringify(body?.errors ?? body)}`);
  }
  return { uid: body.result.uid, uploadURL: body.result.uploadURL };
}

/** Null when Stream has no such video (deleted, or never existed). */
export async function getVideo(
  cfg: { accountId: string; apiToken: string },
  uid: string,
): Promise<StreamVideo | null> {
  const res = await fetch(api(cfg.accountId, `/${uid}`), {
    headers: { Authorization: `Bearer ${cfg.apiToken}` },
  });
  if (res.status === 404) return null;
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.success) {
    throw new Error(`Stream get video failed (${res.status})`);
  }
  return body.result as StreamVideo;
}

export async function deleteVideo(cfg: { accountId: string; apiToken: string }, uid: string) {
  await fetch(api(cfg.accountId, `/${uid}`), {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${cfg.apiToken}` },
  }).catch(() => undefined);
}

/* Mapping Stream state onto post_slides ------------------------------------ */

export type Mapped = { status: SlideStatus; durationS?: number; tooLong?: boolean };

export function mapVideo(video: StreamVideo | null): Mapped {
  if (!video) return { status: 'failed' };
  const state = video.status?.state ?? '';
  if (state === 'error') return { status: 'failed' };
  if (state === 'pendingupload') return { status: 'uploading' };
  if (video.readyToStream || state === 'ready') {
    const d = video.duration ?? 0;
    if (d > MAX_CLIP_SECONDS + DURATION_SLACK_SECONDS) return { status: 'failed', tooLong: true };
    if (d <= 0) return { status: 'processing' }; // duration not known yet
    return { status: 'ready', durationS: Math.min(Math.round(d * 100) / 100, MAX_CLIP_SECONDS) };
  }
  return { status: 'processing' };
}

/** Writes the mapped state to the slide if it changed. Returns the new status. */
export async function applyVideoState(
  admin: SupabaseClient,
  cfg: { accountId: string; apiToken: string } | null,
  slide: { id: string; upload_status: SlideStatus; stream_video_id: string | null },
  video: StreamVideo | null,
): Promise<SlideStatus> {
  const mapped = mapVideo(video);
  if (mapped.tooLong && cfg && slide.stream_video_id) {
    await deleteVideo(cfg, slide.stream_video_id);
  }
  // A ready slide stays ready; late or repeated webhooks don't undo it.
  if (slide.upload_status === 'ready') return 'ready';
  if (mapped.status === slide.upload_status && mapped.durationS === undefined) return mapped.status;

  const patch: Record<string, unknown> = { upload_status: mapped.status };
  if (mapped.durationS !== undefined) patch.duration_s = mapped.durationS;
  const { error } = await admin.from('post_slides').update(patch).eq('id', slide.id);
  if (error) throw error;
  return mapped.status;
}

/* Webhook signatures ------------------------------------------------------- */

const enc = new TextEncoder();

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Checks Stream's `Webhook-Signature: time=<unix>,sig1=<hex>` header. */
export async function verifyWebhook(
  header: string | null,
  rawBody: string,
  secret: string,
  maxAgeSeconds = 300,
): Promise<boolean> {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(',').map((p) => {
      const i = p.indexOf('=');
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    }),
  );
  const time = Number(parts.time);
  if (!parts.sig1 || !Number.isFinite(time)) return false;
  if (Math.abs(Date.now() / 1000 - time) > maxAgeSeconds) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${parts.time}.${rawBody}`));
  return safeEqual(hex(sig), parts.sig1.toLowerCase());
}
